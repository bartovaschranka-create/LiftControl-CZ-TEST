const SERIAL_TERMS = /serial\s*(number|no\.?|range)|s\/n|from\s+serial|after\s+serial|before\s+serial|prior\s+to\s+serial|starting\s+with\s+serial/i;

export function evaluateManualFit({ request, pages }) {
  const model = normalizeModel(request.model);
  const serial = normalizeSerial(request.serial);
  const metaPages = selectMetadataPages(pages);
  const metaText = metaPages.map(p => p.text).join('\n');
  const modelMatch = model && textContainsModel(metaText, model);
  const serialEvidence = findSerialEvidence(metaPages, serial);

  if (!modelMatch) {
    return {
      status: 'not_found',
      serialRange: serialEvidence.label,
      sources: serialEvidence.sources,
      message: 'Manual neobsahuje prokazatelnou shodu se zadanym modelem.'
    };
  }

  if (serial && serialEvidence.decision === 'out') {
    return {
      status: 'not_found',
      serialRange: serialEvidence.label,
      sources: serialEvidence.sources,
      message: 'Manual prokazatelne neodpovida zadanemu vyrobnimu cislu.'
    };
  }

  if (!serial || serialEvidence.decision === 'in' || serialEvidence.decision === 'unrestricted') {
    return {
      status: 'ok',
      serialRange: serialEvidence.label,
      sources: serialEvidence.sources,
      message: serialEvidence.label
        ? 'Model a vyrobni cislo byly overeny podle textu manualu.'
        : 'Manual jednoznacne uvadi prislusnou produktovou radu bez dohledaneho omezeni vyrobniho cisla.'
    };
  }

  return {
    status: 'warn',
    serialRange: serialEvidence.label,
    sources: serialEvidence.sources,
    message: 'Model pravdepodobne odpovida, ale rozsah vyrobnich cisel se nepodarilo prokazatelne overit.'
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

function findSerialEvidence(pages, serial) {
  const serialNumber = numericPart(serial);
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

  if (!serialNumber) {
    return { decision: 'unknown', label: ranges[0].source.quote, sources: ranges.map(x => x.source).slice(0, 3) };
  }

  let hasIn = false;
  let hasOut = false;
  for (const { range } of ranges) {
    const decision = rangeContains(range, serialNumber);
    if (decision === 'in') hasIn = true;
    if (decision === 'out') hasOut = true;
  }
  return {
    decision: hasIn ? 'in' : (hasOut ? 'out' : 'unknown'),
    label: ranges[0].source.quote,
    sources: ranges.map(x => x.source).slice(0, 3)
  };
}

function parseSerialRange(text) {
  const compact = String(text || '').replace(/[, ]+/g, ' ');
  const fromTo = compact.match(/(?:from|starting(?:\s+with)?|serial\s*(?:number|no\.?)?)\s*([A-Z]*\d{3,})\s*(?:to|through|-)\s*([A-Z]*\d{3,})/i);
  if (fromTo) return { min: numericPart(fromTo[1]), max: numericPart(fromTo[2]) };
  const andUp = compact.match(/([A-Z]*\d{3,})\s*(?:and\s+up|and\s+after|or\s+higher|and\s+above|to\s+present)/i);
  if (andUp) return { min: numericPart(andUp[1]), max: Infinity };
  const before = compact.match(/(?:before|prior\s+to|up\s+to)\s*(?:serial\s*(?:number|no\.?)?\s*)?([A-Z]*\d{3,})/i);
  if (before) return { min: 0, max: numericPart(before[1]) - 1 };
  return null;
}

function rangeContains(range, serialNumber) {
  if (!Number.isFinite(serialNumber)) return 'unknown';
  if (serialNumber >= range.min && serialNumber <= range.max) return 'in';
  return 'out';
}

function snippetsAroundSerialTerms(text) {
  const out = [];
  const source = String(text || '');
  const regex = new RegExp(SERIAL_TERMS.source, 'ig');
  let match;
  while ((match = regex.exec(source))) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(source.length, match.index + 220);
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

function normalizeSerial(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function numericPart(value) {
  const digits = String(value || '').match(/\d+/g)?.join('');
  return digits ? Number(digits) : NaN;
}
