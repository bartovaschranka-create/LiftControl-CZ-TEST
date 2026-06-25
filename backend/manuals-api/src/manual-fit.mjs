const SERIAL_TERMS = /serial\s*(number|no\.?|range)|s\/n|from\s+serial|after\s+serial|before\s+serial|prior\s+to\s+serial|starting\s+with\s+serial/i;

export function evaluateManualFit({ request, pages }) {
  const model = normalizeModel(request.model);
  const serial = parseSerialValue(request.serial);
  const metaPages = selectMetadataPages(pages);
  const metaText = metaPages.map(p => p.text).join('\n');
  const modelMatch = model && textContainsModel(metaText, model);
  const serialEvidence = findSerialEvidence(metaPages, serial);

  if (!modelMatch) {
    return {
      status: 'not_found',
      serialRange: serialEvidence.label,
      sources: serialEvidence.sources,
      message: 'Manuál neobsahuje prokazatelnou shodu se zadaným modelem.'
    };
  }

  if (serial.original && serialEvidence.decision === 'out') {
    return {
      status: 'not_found',
      serialRange: serialEvidence.label,
      sources: serialEvidence.sources,
      message: 'Manuál prokazatelně neodpovídá zadanému výrobnímu číslu.'
    };
  }

  if (!serial.original || serialEvidence.decision === 'in' || serialEvidence.decision === 'unrestricted') {
    return {
      status: 'ok',
      serialRange: serialEvidence.label,
      sources: serialEvidence.sources,
      message: serialEvidence.label
        ? 'Model a výrobní číslo byly ověřeny podle textu manuálu.'
        : 'Manuál jednoznačně uvádí příslušnou produktovou řadu bez dohledaného omezení výrobního čísla.'
    };
  }

  return {
    status: 'warn',
    serialRange: serialEvidence.label,
    sources: serialEvidence.sources,
    message: 'Model pravděpodobně odpovídá, ale rozsah výrobních čísel se nepodařilo prokazatelně ověřit.'
  };
}

export function selectMetadataPages(pages) {
  const byPage = new Map();
  for (const page of pages.slice(0, 6)) byPage.set(page.page, page);
  for (const page of pages) {
    if (SERIAL_TERMS.test(page.text)) byPage.set(page.page, page);
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

export function parseSerialValue(value) {
  const original = String(value || '').trim();
  const normalized = original.toUpperCase().replace(/\s+/g, '');
  if (!normalized) return { original, normalized: '', prefix: '', number: NaN, suffix: '', reliable: false };

  const compact = normalized.replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/^([A-Z0-9]*?[A-Z])?(\d{3,})([A-Z]*)$/);
  if (!match) return { original, normalized: compact, prefix: '', number: NaN, suffix: '', reliable: false };

  return {
    original,
    normalized: compact,
    prefix: match[1] || '',
    number: Number(match[2]),
    suffix: match[3] || '',
    reliable: Number.isFinite(Number(match[2]))
  };
}

export function parseSerialRange(text) {
  const compact = String(text || '').replace(/[, ]+/g, ' ');
  const serialToken = '([A-Z0-9-]*\\d{3,}[A-Z0-9-]*)';
  const fromTo = compact.match(new RegExp(`(?:from|starting(?:\\s+with)?|serial\\s*(?:number|no\\.?)?)\\s*${serialToken}\\s*(?:to|through)\\s*${serialToken}`, 'i'));
  if (fromTo) return makeRange(fromTo[1], fromTo[2]);

  const dashRange = compact.match(new RegExp(`${serialToken}\\s+-\\s+${serialToken}`, 'i'));
  if (dashRange) return makeRange(dashRange[1], dashRange[2]);

  const andUp = compact.match(new RegExp(`${serialToken}\\s*(?:and\\s+up|and\\s+after|or\\s+higher|and\\s+above|to\\s+present)`, 'i'));
  if (andUp) return makeRange(andUp[1], null);

  const before = compact.match(new RegExp(`(?:before|prior\\s+to|up\\s+to)\\s*(?:serial\\s*(?:number|no\\.?)?\\s*)?${serialToken}`, 'i'));
  if (before) {
    const max = parseSerialValue(before[1]);
    if (!max.reliable) return { reliable: false, min: null, max, prefix: '', label: before[0] };
    return { reliable: true, min: null, max, prefix: max.prefix, label: before[0], mode: 'before' };
  }
  return null;
}

function findSerialEvidence(pages, serial) {
  const snippets = [];
  for (const page of pages) {
    for (const snippet of snippetsAroundSerialTerms(page.text)) {
      snippets.push({ page: page.page, quote: snippet });
    }
  }
  if (!snippets.length) return { decision: 'unknown', label: '', sources: [] };

  const ranges = snippets.map(source => ({ source, range: parseSerialRange(source.quote) })).filter(x => x.range);
  if (!ranges.length) {
    return { decision: 'unknown', label: snippets[0].quote, sources: snippets.slice(0, 3) };
  }

  if (!serial.original || !serial.reliable) {
    return { decision: 'unknown', label: ranges[0].source.quote, sources: ranges.map(x => x.source).slice(0, 3) };
  }

  let hasIn = false;
  let hasOut = false;
  let hasUnknown = false;
  for (const { range } of ranges) {
    const decision = rangeContains(range, serial);
    if (decision === 'in') hasIn = true;
    else if (decision === 'out') hasOut = true;
    else hasUnknown = true;
  }
  return {
    decision: hasIn ? 'in' : (hasOut && !hasUnknown ? 'out' : 'unknown'),
    label: ranges[0].source.quote,
    sources: ranges.map(x => x.source).slice(0, 3)
  };
}

function makeRange(minRaw, maxRaw) {
  const min = parseSerialValue(minRaw);
  const max = maxRaw ? parseSerialValue(maxRaw) : null;
  const reliable = min.reliable && (!max || max.reliable);
  const prefix = min.prefix || max?.prefix || '';
  return { reliable, min, max, prefix, label: [minRaw, maxRaw].filter(Boolean).join(' to '), mode: max ? 'between' : 'and_up' };
}

function rangeContains(range, serial) {
  if (!range?.reliable || !serial?.reliable) return 'unknown';
  if (range.prefix && serial.prefix && range.prefix !== serial.prefix) return 'out';
  if (range.prefix && !serial.prefix) return 'unknown';
  if (!range.prefix && serial.prefix) return 'unknown';

  if (range.mode === 'before') {
    if (range.max.prefix && serial.prefix !== range.max.prefix) return 'out';
    return serial.number < range.max.number ? 'in' : 'out';
  }
  if (range.mode === 'between') {
    if (range.max?.prefix && range.min?.prefix && range.max.prefix !== range.min.prefix) return 'unknown';
    return serial.number >= range.min.number && serial.number <= range.max.number ? 'in' : 'out';
  }
  return serial.number >= range.min.number ? 'in' : 'out';
}

function snippetsAroundSerialTerms(text) {
  const out = [];
  const source = String(text || '');
  const regex = new RegExp(SERIAL_TERMS.source, 'ig');
  let match;
  while ((match = regex.exec(source))) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(source.length, match.index + 260);
    out.push(source.slice(start, end).replace(/\s+/g, ' ').trim());
    if (out.length >= 8) break;
  }
  return out;
}

function textContainsModel(text, model) {
  const hay = normalizeModel(text);
  const tokens = model.split(' ').filter(Boolean);
  if (!tokens.length) return false;
  if (hay.includes(model)) return true;
  return tokens.every(token => token.length <= 2 || hay.includes(token));
}

function normalizeModel(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
