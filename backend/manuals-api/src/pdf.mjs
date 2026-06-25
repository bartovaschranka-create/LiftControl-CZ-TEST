import zlib from 'node:zlib';
import { validateOfficialUrl } from './official-domains.mjs';

export async function downloadPdf(candidate, request, config, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  let currentUrl = candidate.url;
  for (let redirect = 0; redirect <= config.maxRedirects; redirect += 1) {
    const validated = validateOfficialUrl(currentUrl, request.maker);
    if (!validated.ok) {
      const err = new Error(validated.reason);
      err.code = 'blocked_url';
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.downloadTimeoutMs);
    let res;
    try {
      res = await fetchImpl(validated.url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/pdf,*/*;q=0.8' }
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Přesměrování bez cílové URL.');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      const err = new Error(`Stažení PDF selhalo (${res.status}).`);
      err.code = 'download_failed';
      throw err;
    }
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength && contentLength > config.maxPdfBytes) {
      const err = new Error('PDF je větší než povolený limit.');
      err.code = 'pdf_too_large';
      throw err;
    }
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (type && !type.includes('pdf') && !candidate.url.toLowerCase().includes('.pdf')) {
      const err = new Error('Stažený soubor nevypadá jako PDF.');
      err.code = 'not_pdf';
      throw err;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > config.maxPdfBytes) {
      const err = new Error('PDF je větší než povolený limit.');
      err.code = 'pdf_too_large';
      throw err;
    }
    return { buffer, finalUrl: currentUrl };
  }

  const err = new Error('Překročen maximální počet přesměrování.');
  err.code = 'too_many_redirects';
  throw err;
}

export function extractPdfTextPages(buffer) {
  const raw = buffer.toString('latin1');
  if (!raw.includes('%PDF')) return [];

  const pages = [];
  const streamRegex = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;
  let collected = '';
  while ((match = streamRegex.exec(raw))) {
    const dict = match[1] || '';
    let chunk = Buffer.from(match[2] || '', 'latin1');
    if (/\/FlateDecode/.test(dict)) {
      try {
        chunk = zlib.inflateSync(chunk);
      } catch {
        continue;
      }
    }
    collected += '\n' + extractPdfTextOperators(chunk.toString('latin1'));
  }
  const cleaned = normalizeExtractedText(collected);
  if (cleaned) pages.push({ page: 1, text: cleaned });
  return pages;
}

function extractPdfTextOperators(content) {
  const pieces = [];
  const literalRegex = /\((?:\\.|[^\\)])*\)\s*T[jJ]/g;
  const arrayRegex = /\[((?:\s*(?:\((?:\\.|[^\\)])*\)|-?\d+)\s*)+)\]\s*TJ/g;
  const hexRegex = /<([0-9A-Fa-f\s]+)>\s*T[jJ]/g;
  let m;

  while ((m = literalRegex.exec(content))) pieces.push(decodePdfLiteral(m[0].match(/\((?:\\.|[^\\)])*\)/)?.[0] || ''));
  while ((m = arrayRegex.exec(content))) {
    const literals = [...m[1].matchAll(/\((?:\\.|[^\\)])*\)/g)].map(x => decodePdfLiteral(x[0]));
    if (literals.length) pieces.push(literals.join(''));
  }
  while ((m = hexRegex.exec(content))) pieces.push(decodePdfHex(m[1]));

  return pieces.join('\n');
}

function decodePdfLiteral(value) {
  return String(value || '')
    .replace(/^\(|\)$/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function decodePdfHex(value) {
  const hex = String(value || '').replace(/\s+/g, '');
  const bytes = [];
  for (let i = 0; i < hex.length - 1; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return Buffer.from(bytes).toString('utf8').replace(/\0/g, '');
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
