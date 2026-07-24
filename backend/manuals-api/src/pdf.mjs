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
  if (candidate.source === 'local' && candidate.url && /^https:\/\//i.test(candidate.url)) {
    try {
      return await downloadCatalogPdf(candidate, config, deps);
    } catch (error) {
      if (!candidate.localPath) throw error;
      try {
        return await readLocalPdf(candidate, config);
      } catch {
        throw error;
      }
    }
  }
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

async function downloadCatalogPdf(candidate, config, deps = {}) {
  const validated = validateCatalogPdfUrl(candidate.url);
  if (!validated.ok) {
    const err = new Error(validated.reason);
    err.code = 'blocked_url';
    throw err;
  }
  const fetchImpl = deps.fetch || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.downloadTimeoutMs);
  let res;
  try {
    res = await fetchImpl(validated.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/pdf,*/*;q=0.8' }
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = new Error(`Stazeni PDF selhalo (${res.status}).`);
    err.code = 'download_failed';
    throw err;
  }
  const maxBytes = config.firebaseManualsMaxPdfBytes || config.maxPdfBytes;
  const processingMaxBytes = config.firebaseManualsProcessingMaxBytes || maxBytes;
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength && contentLength > processingMaxBytes) {
    const err = new Error(`PDF je prilis velke pro serverless zpracovani (${contentLength} B > ${processingMaxBytes} B).`);
    err.code = 'pdf_too_large_for_serverless';
    err.contentLength = contentLength;
    err.processingMaxBytes = processingMaxBytes;
    throw err;
  }
  if (contentLength && contentLength > maxBytes) {
    const err = new Error('PDF je vetsi nez povoleny limit.');
    err.code = 'pdf_too_large';
    throw err;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > processingMaxBytes) {
    const err = new Error(`PDF je prilis velke pro serverless zpracovani (${buffer.length} B > ${processingMaxBytes} B).`);
    err.code = 'pdf_too_large_for_serverless';
    err.contentLength = buffer.length;
    err.processingMaxBytes = processingMaxBytes;
    throw err;
  }
  if (buffer.length > maxBytes) {
    const err = new Error('PDF je vetsi nez povoleny limit.');
    err.code = 'pdf_too_large';
    throw err;
  }
  return { buffer, finalUrl: validated.url };
}

function validateCatalogPdfUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'Neplatna URL lokalniho katalogu.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Manual musi byt dostupny pres HTTPS.' };
  const host = url.hostname.toLowerCase();
  const allowed = host === 'firebasestorage.googleapis.com' || host === 'storage.googleapis.com';
  if (!allowed) return { ok: false, reason: 'Katalog manualu smi ukazovat jen na Firebase/Google Storage.' };
  if (/github\.io|githubusercontent\.com|github\.com/i.test(url.toString())) {
    return { ok: false, reason: 'PDF manual nesmi byt stahovan z GitHubu.' };
  }
  return { ok: true, url: url.toString() };
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

export async function extractPdfLayoutPages(buffer, debug = null) {
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
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        const items = normalizeTextBlocks(content.items || [], viewport);
        const text = normalizeExtractedText(textContentToString(content.items || []));
        if (text) {
          pages.push({
            page: pageNumber,
            width: Number(viewport.width) || 0,
            height: Number(viewport.height) || 0,
            text,
            textBlocks: items
          });
        }
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

function normalizeTextBlocks(items, viewport) {
  const blocks = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const text = item.str.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]) || 0;
    const baseY = Number(transform[5]) || 0;
    const width = Math.max(1, Number(item.width) || text.length * 4);
    const height = Math.max(5, Number(item.height) || Math.abs(Number(transform[3]) || 8));
    const topY = Math.max(0, (Number(viewport.height) || 0) - baseY - height);
    blocks.push({
      text,
      x: round2(x),
      y: round2(topY),
      width: round2(width),
      height: round2(height),
      fontSize: round2(height),
      dir: item.dir || ''
    });
  }
  return mergeTextBlocks(blocks);
}

function mergeTextBlocks(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs((last.y + last.height / 2) - (item.y + item.height / 2)) <= Math.max(3, item.height * 0.35);
    const close = last && item.x >= last.x && item.x - (last.x + last.width) <= Math.max(16, item.height * 1.5);
    if (sameLine && close) {
      last.text = `${last.text} ${item.text}`.replace(/\s+/g, ' ').trim();
      const right = Math.max(last.x + last.width, item.x + item.width);
      last.y = round2(Math.min(last.y, item.y));
      last.height = round2(Math.max(last.y + last.height, item.y + item.height) - last.y);
      last.width = round2(right - last.x);
      last.fontSize = round2(Math.max(last.fontSize || 0, item.fontSize || 0));
    } else {
      out.push({ ...item });
    }
  }
  return out.filter(item => item.text.length >= 2).slice(0, 400);
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
