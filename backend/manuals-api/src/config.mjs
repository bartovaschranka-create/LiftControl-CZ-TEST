export function getConfig(env = process.env) {
  return {
    braveApiKey: env.BRAVE_SEARCH_API_KEY || '',
    allowedOrigins: parseList(env.ALLOWED_ORIGINS || 'https://bartovaschranka-create.github.io'),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
    maxPdfBytes: numberEnv(env.MAX_PDF_BYTES, 15 * 1024 * 1024),
    downloadTimeoutMs: numberEnv(env.DOWNLOAD_TIMEOUT_MS, 15000),
    maxRedirects: numberEnv(env.MAX_REDIRECTS, 4),
    maxSearchResults: numberEnv(env.MAX_SEARCH_RESULTS, 8),
    maxBodyBytes: numberEnv(env.MAX_BODY_BYTES, 16 * 1024)
  };
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
