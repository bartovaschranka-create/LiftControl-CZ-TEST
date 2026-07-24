import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

export async function loadManualPageIndex(candidate, config = {}, deps = {}, debug = null) {
  const sources = buildIndexSources(candidate, config);
  if (debug) {
    debug.storagePath = candidate.storagePath || '';
    debug.derivedIndexStoragePath = defaultIndexStoragePath(candidate.storagePath || candidate.fileName || candidate.localPath, candidate);
    debug.indexTried = sources.map(source => ({
      source: source.kind,
      url: source.url || '',
      path: source.path || '',
      storagePath: source.storagePath || ''
    }));
  }

  for (const source of sources) {
    try {
      const json = source.kind === 'local'
        ? await readLocalIndex(source.path, config, deps)
        : await fetchIndexJson(source.url, config, deps);
      const pages = normalizePageIndex(json);
      if (!pages.length) {
        if (debug) debug.indexSkippedReason = 'Index neobsahuje citelny text stranek.';
        continue;
      }
      if (debug) {
        debug.indexLoaded = true;
        debug.indexSource = source.kind;
        debug.indexUrl = source.url || '';
        debug.indexPath = source.storagePath || source.path || '';
        debug.textSource = 'page_index';
      }
      return {
        pages,
        manual: typeof json?.manual === 'string' ? json.manual : '',
        metadata: normalizeManualMetadata(json),
        indexUrl: source.url || '',
        indexPath: source.path || ''
      };
    } catch (error) {
      if (debug) {
        debug.indexErrors = debug.indexErrors || [];
        debug.indexErrors.push({
          source: source.kind,
          url: source.url || '',
          path: source.path || '',
          storagePath: source.storagePath || '',
          httpStatus: error?.httpStatus || null,
          code: error?.code || '',
          message: error?.message || String(error)
        });
      }
    }
  }

  return null;
}

export function defaultIndexStoragePath(storagePath, candidate = {}) {
  const rawPath = String(storagePath || candidate.fileName || candidate.file || '').trim().replace(/\\/g, '/');
  const name = basename(rawPath);
  if (!name) return '';
  const indexName = name.replace(/\.pdf$/i, '.pages.json');
  const folder = dirname(rawPath);
  return folder && folder !== '.' ? `${folder}/${indexName}` : indexName;
}

export function buildFirebaseStorageUrl(storagePath, config = {}) {
  if (!storagePath) return '';
  const base = String(config.firebaseManualsUrlBase || '').trim();
  if (base) return `${base.replace(/\/+$/, '')}/${encodeURIComponent(storagePath)}`;
  const bucket = String(config.firebaseStorageBucket || '').trim();
  if (!bucket) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

function buildIndexSources(candidate, config) {
  const sources = [];
  const explicitUrl = String(candidate.indexUrl || '').trim();
  if (explicitUrl) sources.push({ kind: 'firebase', url: explicitUrl });

  const explicitStoragePath = String(candidate.indexStoragePath || '').trim();
  if (explicitStoragePath) {
    const url = buildFirebaseStorageUrl(explicitStoragePath, config);
    if (url && !sources.some(source => source.url === url)) {
      sources.push({ kind: 'firebase', url, storagePath: explicitStoragePath });
    }
  }

  const defaultStoragePath = defaultIndexStoragePath(candidate.storagePath || candidate.fileName || candidate.localPath, candidate);
  if (defaultStoragePath) {
    const url = buildFirebaseStorageUrl(defaultStoragePath, config);
    if (url && !sources.some(source => source.url === url)) {
      sources.push({ kind: 'firebase', url, storagePath: defaultStoragePath });
    }
  }

  const localPath = String(candidate.indexPath || '').trim();
  if (localPath) sources.push({ kind: 'local', path: localPath });
  if (candidate.localPath) {
    sources.push({
      kind: 'local',
      path: String(candidate.localPath).replace(/\.pdf$/i, '.pages.json')
    });
  }

  return sources;
}

async function fetchIndexJson(url, config, deps = {}) {
  const validated = validateIndexUrl(url);
  if (!validated.ok) {
    const err = new Error(validated.reason);
    err.code = 'blocked_url';
    throw err;
  }
  const fetchImpl = deps.fetch || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.downloadTimeoutMs || 15000);
  let res;
  try {
    res = await fetchImpl(validated.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json,text/plain,*/*;q=0.8' }
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = new Error(`Stazeni indexu selhalo (${res.status}).`);
    err.code = res.status === 404 ? 'index_not_found' : 'index_download_failed';
    err.httpStatus = res.status;
    throw err;
  }
  const contentLength = Number(getHeader(res.headers, 'content-length') || 0);
  const maxBytes = config.manualIndexMaxBytes || 25 * 1024 * 1024;
  if (contentLength && contentLength > maxBytes) {
    const err = new Error('Textovy index je vetsi nez povoleny limit.');
    err.code = 'index_too_large';
    throw err;
  }
  const text = typeof res.text === 'function'
    ? await res.text()
    : Buffer.from(await res.arrayBuffer()).toString('utf8');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const err = new Error('Textovy index je vetsi nez povoleny limit.');
    err.code = 'index_too_large';
    throw err;
  }
  return JSON.parse(text);
}

async function readLocalIndex(path, config, deps = {}) {
  if (!config.localManualsRoot) {
    const err = new Error('LOCAL_MANUALS_ROOT neni nastaveny.');
    err.code = 'local_manuals_root_missing';
    throw err;
  }
  const root = resolve(config.localManualsRoot);
  const requested = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const rel = relative(root, requested);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    const err = new Error('Lokalni index je mimo povoleny adresar.');
    err.code = 'local_index_blocked';
    throw err;
  }
  const text = await (deps.readFile || readFile)(requested, 'utf8');
  const maxBytes = config.manualIndexMaxBytes || 25 * 1024 * 1024;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const err = new Error('Textovy index je vetsi nez povoleny limit.');
    err.code = 'index_too_large';
    throw err;
  }
  return JSON.parse(text);
}

function normalizePageIndex(json) {
  const rawPages = Array.isArray(json) ? json : json?.pages;
  if (!Array.isArray(rawPages)) return [];
  const pages = [];
  const seen = new Set();
  for (const item of rawPages) {
    const page = Number(item?.page);
    const text = String(item?.text || '').trim();
    if (!Number.isInteger(page) || page < 1 || !text || seen.has(page)) continue;
    seen.add(page);
    pages.push({
      page,
      title: stringValue(item?.title),
      chapter: stringValue(item?.chapter),
      keywords: stringArray(item?.keywords),
      text,
      width: Number(item?.width) || 0,
      height: Number(item?.height) || 0,
      textBlocks: normalizeTextBlocks(item?.textBlocks),
      images: normalizeImages(item?.images),
      embedding: numericArray(item?.embedding)
    });
  }
  return pages.sort((a, b) => a.page - b.page);
}

function normalizeManualMetadata(json) {
  return {
    version: Number(json?.version) || 1,
    maker: stringValue(json?.maker),
    model: stringValue(json?.model),
    models: stringArray(json?.models),
    manualType: stringValue(json?.manualType),
    edition: stringValue(json?.edition),
    issueDate: stringValue(json?.issueDate),
    serialRange: stringValue(json?.serialRange),
    pageCount: Number(json?.pageCount) || 0,
    textPageCount: Number(json?.textPageCount) || 0,
    embeddingModel: stringValue(json?.embeddingModel)
  };
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map(image => ({
      figure: stringValue(image?.figure),
      bbox: stringValue(image?.bbox),
      caption: stringValue(image?.caption),
      page: Number(image?.page) || 0,
      mimeType: stringValue(image?.mimeType || image?.mime),
      dataUrl: stringValue(image?.dataUrl),
      width: Number(image?.width) || 0,
      height: Number(image?.height) || 0
    }))
    .filter(image => image.figure || image.caption || image.dataUrl);
}

function normalizeTextBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map(block => ({
      text: stringValue(block?.text).slice(0, 1000),
      x: Number(block?.x) || 0,
      y: Number(block?.y) || 0,
      width: Number(block?.width) || 0,
      height: Number(block?.height) || 0,
      fontSize: Number(block?.fontSize) || 0
    }))
    .filter(block => block.text && block.width > 0 && block.height > 0)
    .slice(0, 400);
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => stringValue(item)).filter(Boolean))];
}

function numericArray(value) {
  if (!Array.isArray(value)) return [];
  const numbers = value.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers : [];
}

function validateIndexUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'Neplatna URL indexu manualu.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Index manualu musi byt dostupny pres HTTPS.' };
  const host = url.hostname.toLowerCase();
  const allowed = host === 'firebasestorage.googleapis.com' || host === 'storage.googleapis.com';
  if (!allowed) return { ok: false, reason: 'Index manualu smi ukazovat jen na Firebase/Google Storage.' };
  if (/github\.io|githubusercontent\.com|github\.com/i.test(url.toString())) {
    return { ok: false, reason: 'Index manualu nesmi byt stahovan z GitHubu.' };
  }
  return { ok: true, url: url.toString() };
}

function getHeader(headers, key) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(key) || '';
  return headers[key] || headers[String(key).toLowerCase()] || '';
}
