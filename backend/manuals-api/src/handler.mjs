import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';
import { readJsonBody, sendJson } from './http.mjs';
import { emptyResponse, validateManualRequest } from './validation.mjs';
import { searchManualCandidates, braveErrorResponse } from './brave.mjs';
import { rankCandidates, toVariant } from './candidates.mjs';
import { downloadPdf, extractPdfTextPages } from './pdf.mjs';
import { buildSourceOnlyResult, findRelevantPages } from './manual-text.mjs';
import { structureWithOpenAI } from './openai.mjs';
import { evaluateManualFit } from './manual-fit.mjs';

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
    const attempts = [];
    const openaiDebug = createOpenAiDebug(config);
    if (!candidates.length) {
      const response = emptyResponse('not_found', request, 'Nebyl nalezen oficiální manuál výrobce.', []);
      response.debug = { triedCandidates: attempts, openai: openaiDebug };
      return sendJson(res, 200, response);
    }

    for (const candidate of candidates.slice(0, 3)) {
      const debug = {
        title: candidate.title || '',
        type: candidate.type || '',
        url: candidate.url || '',
        downloaded: false,
        finalUrl: '',
        textPages: 0,
        relevantPages: [],
        angleSensorPages: [],
        skippedReason: ''
      };
      attempts.push(debug);

      try {
        const { buffer, finalUrl } = await downloadPdf(candidate, request, config, deps);
        debug.downloaded = true;
        debug.finalUrl = finalUrl || candidate.url || '';
        const pages = await extractPdfTextPages(buffer);
        Object.assign(debug, buildManualDebug({ candidate, finalUrl, pages }));
        if (!pages.length) {
          debug.skippedReason = 'PDF nemá čitelnou textovou vrstvu.';
          continue;
        }
        const fit = evaluateManualFit({ request, pages });
        if (fit.status === 'not_found') {
          debug.skippedReason = 'Model nebo výrobní číslo neodpovídá rozsahu manuálu.';
          continue;
        }
        const relevantPages = findRelevantPages(pages, request.task, { manualType: candidate.type });
        debug.relevantPages = relevantPages.map(p => p.page);
        if (!relevantPages.length) {
          debug.skippedReason = 'Nenalezeny relevantní stránky pro zadaný úkon.';
          continue;
        }
        const aiPages = mergePages(relevantPages, pages, fit.sources);
        const aiResult = await structureWithOpenAI({ request, candidate, finalUrl, pages: aiPages, config, deps, fit, openaiDebug });
        const result = aiResult || buildSourceOnlyResult({ request, candidate, finalUrl, pages: relevantPages, fit, openaiDebug });
        result.debug = { triedCandidates: attempts, openai: openaiDebug };
        result.variants = result.variants?.length ? result.variants : variants;
        if (!result.message.includes('Při rozporu má vždy přednost originální manuál výrobce.')) {
          result.message = `${result.message} Při rozporu má vždy přednost originální manuál výrobce.`;
        }
        return sendJson(res, 200, result);
      } catch (error) {
        debug.skippedReason = error?.message || 'Chyba při stažení nebo zpracování manuálu.';
        if (error?.code === 'blocked_url') {
          return sendJson(res, 200, emptyResponse('warn', request, 'Nalezený odkaz byl odmítnut bezpečnostní kontrolou domény.', variants));
        }
      }
    }

    if (attempts.length) console.info('manuals-api PDF attempts', attempts);
    const serviceTried = attempts.some(x => x.type === 'service' && x.downloaded && x.textPages > 0);
    const message = serviceTried
      ? 'Service manual byl prohledán, ale konkrétní doložitelný postup nebyl nalezen. Při rozporu má vždy přednost originální manuál výrobce.'
      : 'Oficiální manuál byl nalezen, ale relevantní doložitelný postup v textu PDF nalezen nebyl. Při rozporu má vždy přednost originální manuál výrobce.';
    const response = emptyResponse('not_found', request, message, variants);
    response.debug = { triedCandidates: attempts, openai: openaiDebug };
    return sendJson(res, 200, response);
  };
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

function buildManualDebug({ candidate, finalUrl, pages }) {
  return {
    pdfUrl: finalUrl || candidate.url || '',
    manualType: candidate.type || '',
    textPages: pages.length,
    textLayerPages: pages.length,
    angleSensorPages: pages
      .filter(page => /\bangle\b/i.test(page.text || '') && /\bsensor\b/i.test(page.text || ''))
      .map(page => page.page)
  };
}

function mergePages(relevantPages, allPages, fitSources = []) {
  const pageNumbers = new Set(relevantPages.map(p => p.page));
  for (const source of fitSources || []) pageNumbers.add(source.page);
  return [...pageNumbers]
    .map(page => allPages.find(p => p.page === page))
    .filter(Boolean)
    .sort((a, b) => a.page - b.page);
}
