import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';
import { readJsonBody, sendJson } from './http.mjs';
import { emptyResponse, validateManualRequest } from './validation.mjs';
import { searchManualCandidates, braveErrorResponse } from './brave.mjs';
import { rankCandidates, toVariant } from './candidates.mjs';
import { downloadPdf, extractPdfTextPages } from './pdf.mjs';
import { buildSourceOnlyResult, findRelevantPages } from './manual-text.mjs';
import { structureWithOpenAI } from './openai.mjs';

export function createManualsHandler(deps = {}) {
  return async function manualsHandler(req, res) {
    const config = getConfig(deps.env || process.env);
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
      return sendJson(res, 403, { status: 'error', message: 'Origin není povolen.' });
    }

    let body;
    try {
      body = await readJsonBody(req, config.maxBodyBytes);
    } catch {
      return sendJson(res, 400, { status: 'error', message: 'Neplatný nebo příliš velký JSON request.' });
    }

    const validation = validateManualRequest(body);
    if (!validation.ok) {
      return sendJson(res, 400, emptyResponse('error', validation.value, validation.errors.join(' ')));
    }
    const request = validation.value;

    let rawCandidates;
    try {
      rawCandidates = await searchManualCandidates(request, config, deps);
    } catch (error) {
      return sendJson(res, 200, braveErrorResponse(error, request));
    }

    const candidates = rankCandidates(rawCandidates, request);
    const variants = candidates.slice(0, 5).map(toVariant);
    if (!candidates.length) {
      return sendJson(res, 200, emptyResponse('not_found', request, 'Nebyl nalezen oficiální manuál výrobce.', []));
    }

    for (const candidate of candidates.slice(0, 3)) {
      try {
        const { buffer, finalUrl } = await downloadPdf(candidate, request, config, deps);
        const pages = extractPdfTextPages(buffer);
        if (!pages.length) {
          continue;
        }
        const relevantPages = findRelevantPages(pages, request.task);
        if (!relevantPages.length) {
          continue;
        }
        const aiResult = await structureWithOpenAI({ request, candidate, finalUrl, pages: relevantPages, config, deps });
        const result = aiResult || buildSourceOnlyResult({ request, candidate, finalUrl, pages: relevantPages });
        result.variants = result.variants?.length ? result.variants : variants;
        if (!result.message.includes('Při rozporu má vždy přednost originální manuál výrobce.')) {
          result.message = `${result.message} Při rozporu má vždy přednost originální manuál výrobce.`;
        }
        return sendJson(res, 200, result);
      } catch (error) {
        if (error?.code === 'blocked_url') {
          return sendJson(res, 200, emptyResponse('warn', request, 'Nalezený odkaz byl odmítnut bezpečnostní kontrolou domény.', variants));
        }
      }
    }

    return sendJson(res, 200, emptyResponse('not_found', request, 'Oficiální manuál byl nalezen, ale relevantní doložitelný postup v textu PDF nalezen nebyl. Při rozporu má vždy přednost originální manuál výrobce.', variants));
  };
}
