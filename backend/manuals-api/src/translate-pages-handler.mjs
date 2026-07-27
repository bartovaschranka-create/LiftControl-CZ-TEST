import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';
import { readJsonBody, sendJson } from './http.mjs';
import { translateSourcePagesWithOpenAI } from './openai.mjs';

export function createTranslatePagesHandler(deps = {}) {
  return async function translatePagesHandler(req, res) {
    const config = getConfig(deps.env || process.env);
    const perf = createPerformanceTrace('manuals/translate-pages');
    const deadlineAt = Date.now() + Number(config.manualSearchBudgetMs || 26000);
    perf.mark('request received');
    applyCors(req, res, config);

    if (req.method === 'OPTIONS') {
      res.statusCode = isOriginAllowed(req, config) ? 204 : 403;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      return sendJson(res, 405, { status: 'error', message: 'Povolen je pouze POST.' });
    }
    if (!isOriginAllowed(req, config)) {
      return sendJson(res, 403, { status: 'error', message: 'Origin neni povolen.' });
    }

    let body;
    try {
      body = await readJsonBody(req, Math.max(config.maxBodyBytes * 4, 8 * 1024 * 1024));
      perf.mark('request body read');
    } catch (error) {
      return sendJson(res, 400, {
        status: 'error',
        message: error?.code === 'body_too_large'
          ? 'Pozadavek na preklad stran je prilis velky.'
          : 'Neplatny nebo prilis velky JSON request.'
      });
    }

    const request = normalizeRequest(body?.request || body || {});
    const sourcePages = normalizeSourcePages(body?.sourcePages || body?.result?.sourcePages || []);
    if (!request.maker || !request.model || !request.task) {
      return sendJson(res, 400, { status: 'error', message: 'Chybi vyrobce, model nebo pozadovany ukon.' });
    }
    if (!sourcePages.length) {
      return sendJson(res, 400, { status: 'error', message: 'Chybi nalezene strany manualu k prekladu.' });
    }

    const openaiDebug = createOpenAiDebug(config);
    const result = await translateSourcePagesWithOpenAI({
      request,
      sourcePages,
      config,
      deps,
      openaiDebug,
      deadlineAt,
      perf
    });
    perf.mark('response sent', { translatedPages: result.translatedPages.length });
    return sendJson(res, 200, {
      status: result.translatedPages.length ? 'ok' : 'warn',
      translatedPages: result.translatedPages,
      message: result.message,
      debug: {
        openai: openaiDebug,
        performance: perf.events
      }
    });
  };
}

function normalizeRequest(value) {
  return {
    maker: String(value?.maker || '').trim(),
    model: String(value?.model || '').trim(),
    serial: String(value?.serial || '').trim(),
    task: String(value?.task || '').trim()
  };
}

function normalizeSourcePages(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map(page => ({
      page: Number(page?.page) || 0,
      title: String(page?.title || '').slice(0, 160),
      chapter: String(page?.chapter || '').slice(0, 160),
      width: Number(page?.width) || 0,
      height: Number(page?.height) || 0,
      text: String(page?.text || '').slice(0, 8000),
      textBlocks: (Array.isArray(page?.textBlocks) ? page.textBlocks : [])
        .map(block => ({
          text: String(block?.text || '').slice(0, 1000),
          x: Number(block?.x) || 0,
          y: Number(block?.y) || 0,
          width: Number(block?.width) || 0,
          height: Number(block?.height) || 0,
          fontSize: Number(block?.fontSize) || 0
        }))
        .filter(block => block.text && block.width > 0 && block.height > 0)
        .slice(0, 180)
    }))
    .filter(page => page.page && page.textBlocks.length)
    .slice(0, 6);
}

function createOpenAiDebug(config) {
  return {
    configured: !!config.openaiApiKey,
    model: config.openaiModel,
    requestSent: false,
    responseStatus: null,
    errorCode: config.openaiApiKey ? null : 'openai_missing_key',
    errorMessage: config.openaiApiKey ? null : 'OPENAI_API_KEY is not configured.',
    parsed: false,
    validationRejectedSteps: 0,
    acceptedSteps: 0
  };
}

function createPerformanceTrace(scope) {
  const startedAt = Date.now();
  const events = [];
  return {
    events,
    mark(label, extra = {}) {
      const ms = Date.now() - startedAt;
      const event = { ms, label, ...extra };
      events.push(event);
      try {
        console.log(`[${ms} ms] ${scope} ${label}`);
      } catch {
        // Logging must never affect the API response.
      }
      return event;
    }
  };
}
