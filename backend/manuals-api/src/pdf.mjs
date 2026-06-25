import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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
      if (!location) throw new Error('Presmerovani bez cilove URL.');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      const err = new Error(`Stazeni PDF selhalo (${res.status}).`);
      err.code = 'download_failed';
      throw err;
    }
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength && contentLength > config.maxPdfBytes) {
      const err = new Error('PDF je vetsi nez povoleny limit.');
      err.code = 'pdf_too_large';
      throw err;
    }
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (type && !type.includes('pdf') && !candidate.url.toLowerCase().includes('.pdf')) {
      const err = new Error('Stazeny soubor nevypada jako PDF.');
      err.code = 'not_pdf';
      throw err;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > config.maxPdfBytes) {
      const err = new Error('PDF je vetsi nez povoleny limit.');
      err.code = 'pdf_too_large';
      throw err;
    }
    return { buffer, finalUrl: currentUrl };
  }

  const err = new Error('Prekrocen maximalni pocet presmerovani.');
  err.code = 'too_many_redirects';
  throw err;
}

export async function extractPdfTextPages(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.includes(Buffer.from('%PDF'))) return [];
  let doc;
  try {
    const task = getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: true,
      stopAtErrors: false,
      isEvalSupported: false
    });
    doc = await task.promise;
  } catch {
    return [];
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const text = normalizeExtractedText(textContentToString(content.items || []));
      if (text) pages.push({ page: pageNumber, text });
      page.cleanup?.();
    }
  } finally {
    await doc.destroy?.();
  }
  return pages;
}

function textContentToString(items) {
  const pieces = [];
  let lastY = null;
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5] || 0) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) pieces.push('\n');
    pieces.push(item.str);
    if (item.hasEOL) pieces.push('\n');
    else pieces.push(' ');
    if (y !== null) lastY = y;
  }
  return pieces.join('');
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
