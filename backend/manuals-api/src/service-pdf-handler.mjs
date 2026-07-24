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
        2 * 1024 * 1024
      );

      body = await readJsonBody(req, servicePdfMaxBodyBytes);
    } catch {
      return sendJson(res, 400, {
        status: 'error',
        message: 'Neplatny nebo prilis velky JSON request.'
      });
    }

    try {
      const pdf = createServiceProcedurePdf(body || {});

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdf.length));
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
