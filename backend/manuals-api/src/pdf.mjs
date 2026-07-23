import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOfficialUrl } from './official-domains.mjs';

const PDFJS_DIST_DIR = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const CMAP_URL = join(PDFJS_DIST_DIR, 'cmaps') + '/';
const STANDARD_FONT_DATA_URL = join(PDFJS_DIST_DIR, 'standard_fonts') + '/';

globalThis.pdfjsWorker ||= { WorkerMessageHandler };

export async function downloadPdf(candidate, request, config, deps = {}) {
  if (candidate.localPath) {
    return readLocalPdf(candidate, config);
  }

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

async function readLocalPdf(candidate, config) {
  if (!config.localManualsRoot) {
    const err = new Error('LOCAL_MANUALS_ROOT neni nastaveny.');
    err.code = 'local_manuals_root_missing';
    throw err;
  }
  const root = resolve(config.localManualsRoot);
  const requested = isAbsolute(candidate.localPath)
    ? resolve(candidate.localPath)
    : resolve(root, candidate.localPath);
  const rel = relative(root, requested);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    const err = new Error('Lokalni manual je mimo povoleny adresar.');
    err.code = 'local_manual_blocked';
    throw err;
  }
  const buffer = await readFile(requested);
  if (buffer.length > config.localMaxPdfBytes) {
    const err = new Error('PDF je vetsi nez povoleny limit.');
    err.code = 'pdf_too_large';
    throw err;
  }
  return {
    buffer,
    finalUrl: candidate.url || `local-manual://${encodeURIComponent(candidate.fileName || rel)}`
  };
}

export async function extractPdfTextPages(buffer, debug = null) {
  if (!Buffer.isBuffer(buffer) || !buffer.includes(Buffer.from('%PDF'))) return [];
  let doc;
  try {
    const task = getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: true,
      stopAtErrors: false,
      isEvalSupported: false
    });
    doc = await task.promise;
    if (debug) debug.pdfPages = doc.numPages;
  } catch (error) {
    if (debug) debug.extractError = error?.message || String(error);
    return [];
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      try {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        const text = normalizeExtractedText(textContentToString(content.items || []));
        if (text) pages.push({ page: pageNumber, text });
        page.cleanup?.();
      } catch (error) {
        if (debug) {
          debug.pageErrors = debug.pageErrors || [];
          debug.pageErrors.push({ page: pageNumber, error: error?.message || String(error) });
        }
      }
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
