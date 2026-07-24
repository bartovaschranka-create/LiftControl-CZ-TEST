export function getConfig(env = process.env) {
  return {
    braveApiKey: env.BRAVE_SEARCH_API_KEY || '',
    allowedOrigins: parseList(env.ALLOWED_ORIGINS || 'https://bartovaschranka-create.github.io'),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
    openaiTimeoutMs: numberEnv(env.OPENAI_TIMEOUT_MS, 120000),
    openaiMaxPages: numberEnv(env.OPENAI_MAX_PAGES, 6),
    openaiMaxChars: numberEnv(env.OPENAI_MAX_CHARS, 20000),
    openaiMaxOutputTokens: numberEnv(env.OPENAI_MAX_OUTPUT_TOKENS, 5000),
    maxPdfBytes: numberEnv(env.MAX_PDF_BYTES, 15 * 1024 * 1024),
    downloadTimeoutMs: numberEnv(env.DOWNLOAD_TIMEOUT_MS, 15000),
    maxRedirects: numberEnv(env.MAX_REDIRECTS, 4),
    maxSearchResults: numberEnv(env.MAX_SEARCH_RESULTS, 8),
    maxBodyBytes: numberEnv(env.MAX_BODY_BYTES, 16 * 1024),
    localManualsRoot: env.LOCAL_MANUALS_ROOT || '',
    localManualsIndex: env.LOCAL_MANUALS_INDEX || '',
    localMaxPdfBytes: numberEnv(env.LOCAL_MAX_PDF_BYTES, 150 * 1024 * 1024),
    firebaseStorageBucket: env.FIREBASE_STORAGE_BUCKET || 'doctype-test.firebasestorage.app',
    firebaseManualsUrlBase: env.FIREBASE_MANUALS_URL_BASE || '',
    firebaseManualsMaxPdfBytes: numberEnv(env.FIREBASE_MANUALS_MAX_PDF_BYTES, numberEnv(env.LOCAL_MAX_PDF_BYTES, 150 * 1024 * 1024)),
    firebaseManualsProcessingMaxBytes: numberEnv(env.FIREBASE_MANUALS_PROCESSING_MAX_BYTES, 30 * 1024 * 1024),
    manualIndexMaxBytes: numberEnv(env.MANUAL_INDEX_MAX_BYTES, 25 * 1024 * 1024),
    deployment: {
      vercelEnv: env.VERCEL_ENV || '',
      vercelUrl: env.VERCEL_URL || '',
      vercelGitCommitSha: env.VERCEL_GIT_COMMIT_SHA || '',
      vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF || '',
      vercelProjectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL || ''
    }
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
