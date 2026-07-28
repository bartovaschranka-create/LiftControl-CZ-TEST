import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';
import { readJsonBody, sendJson } from './http.mjs';
import { createServiceProcedurePdf } from './service-pdf.mjs';

export function createServicePdfHandler(deps = {}) {
  return async function servicePdfHandler(req, res) {
    const config = getConfig(deps.env || process.env);
    applyCors(req, res, config);

    if (req.method === 'OPTIONS') {
      res.statusCode = isOriginAllowed(req, config) ? 204 : 403;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, {
        status: 'error',
        message: 'Povolen je pouze POST.'
      });
    }

    if (!isOriginAllowed(req, config)) {
      return sendJson(res, 403, {
        status: 'error',
        message: 'Origin neni povolen.'
      });
    }

    let body;

    try {
      const servicePdfMaxBodyBytes = Math.max(
        config.maxBodyBytes * 4,
        8 * 1024 * 1024
      );

      body = await readJsonBody(req, servicePdfMaxBodyBytes);
    } catch (error) {
      return sendJson(res, 400, {
        status: 'error',
        message: error?.code === 'body_too_large'
          ? 'Servisni PDF obsahuje prilis velky pozadavek. Zkus mensi pocet obrazovych stran nebo zmensi index obrazku.'
          : 'Neplatny nebo prilis velky JSON request.'
      });
    }

    try {
      body = markMissingTranslatedManualPages(body);
      const pdf = createServiceProcedurePdf(body || {});

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdf.length));
      const diagnostics = body?.result?.pdfDiagnostics || {};
      if (Object.keys(diagnostics).length) {
        res.setHeader('X-Manual-Pdf-Debug', encodeURIComponent(JSON.stringify(diagnostics).slice(0, 1800)));
      }
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safePdfName(body)}"`
      );

      res.end(pdf);
    } catch (error) {
      return sendJson(res, 400, {
        status: 'error',
        message: error?.message || 'Servisni PDF se nepodarilo vytvorit.'
      });
    }
  };
}

function markMissingTranslatedManualPages(body) {
  const result = body?.result || {};
  const hasTranslated = Array.isArray(result.translatedPages) && result.translatedPages.length;
  const sourcePages = Array.isArray(result.sourcePages) ? result.sourcePages : [];
  if (hasTranslated || !sourcePages.length) return body;
  const hasLayout = sourcePages.some(page =>
    (Array.isArray(page?.textBlocks) && page.textBlocks.length)
    && (Array.isArray(page?.images) && page.images.some(image => image?.dataUrl))
  );
  if (!hasLayout) return body;
  return {
    ...body,
    result: {
      ...result,
      translatedPages: [],
      pdfDiagnostics: {
        ...(result.pdfDiagnostics || {}),
        servicePdfTranslationAttempted: false,
        servicePdfTranslationSkipped: true,
        servicePdfTranslationSkipReason: 'translate-pages endpoint must prepare translatedPages before PDF render',
        translatedPages: 0
      }
    }
  };
}

function safePdfName(body) {
  const result = body?.result || {};
  const request = body?.request || {};

  const raw = [
    'servisni-postup',
    result.maker || request.maker,
    result.model || request.model,
    result.serial || request.serial
  ]
    .filter(Boolean)
    .join('-');

  return `${
    ascii(raw)
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'servisni-postup'
  }.pdf`;
}

function ascii(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}
