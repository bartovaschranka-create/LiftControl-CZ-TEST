import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';
import { readJsonBody, sendJson } from './http.mjs';
import { emptyResponse, validateManualRequest } from './validation.mjs';
import { searchManualCandidates, braveErrorResponse } from './brave.mjs';
import { searchLocalManualCandidates } from './local-manuals.mjs';
import { rankCandidates, toVariant } from './candidates.mjs';
import { downloadPdf, extractPdfTextPages } from './pdf.mjs';
import { buildSourceOnlyResult, findRelevantPages, isAngleSensorCalibrationTask, isCalibrationTask, isHydraulicFilterTask, isServiceTask, taskIntentDebug, taskTerms } from './manual-text.mjs';
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
      return sendJson(res, 403, { status: 'error', message: 'Origin neni povolen.' });
    }

    let body;
    try {
      body = await readJsonBody(req, config.maxBodyBytes);
    } catch {
      return sendJson(res, 400, { status: 'error', message: 'Neplatny nebo prilis velky JSON request.' });
    }

    const validation = validateManualRequest(body);
    if (!validation.ok) {
      return sendJson(res, 400, emptyResponse('error', validation.value, validation.errors.join(' ')));
    }
    const request = validation.value;

    let rawCandidates;
    const localCandidates = await searchLocalManualCandidates(request, config, deps);
    const exactCatalogServiceCandidates = localCandidates.filter(candidate => candidate.type === 'service' && candidate.modelMatch === 'exact');
    const mustUseJlgCatalog = isJlgCatalogServiceRequest(request);
    if (mustUseJlgCatalog && !exactCatalogServiceCandidates.length) {
      const response = emptyResponse('not_found', request, 'manual_not_in_catalog: Pro zadaný model není ve Firebase katalogu potvrzený JLG service manual.', []);
      response.sourceType = 'firebase_catalog';
      response.selectedManualFile = '';
      response.selectedManualUrl = '';
      response.matchedModel = '';
      response.matchedSerialRange = '';
      response.selectionReason = 'JLG servisní dotaz vyžaduje přesnou shodu modelu ve Firebase katalogu; Brave Search nebyl použit, aby se nevybral nesouvisející manuál.';
      response.debug = { triedCandidates: [], openai: createOpenAiDebug(config), taskIntent: taskIntentDebug(request.task), catalogCandidates: localCandidates.map(toVariant) };
      return sendJson(res, 200, response);
    }
    try {
      rawCandidates = mustUseJlgCatalog
        ? exactCatalogServiceCandidates
        : [
            ...localCandidates,
            ...await searchManualCandidates(request, config, deps)
          ];
    } catch (error) {
      if (localCandidates.length) {
        rawCandidates = localCandidates;
      } else {
        return sendJson(res, 200, braveErrorResponse(error, request));
      }
    }

    const candidates = rankCandidates(rawCandidates, request);
    const variants = candidates.slice(0, 8).map(toVariant);
    const triedCandidates = [];
    const openaiDebug = createOpenAiDebug(config);
    const taskIntent = taskIntentDebug(request.task);
    if (!candidates.length) {
      const response = emptyResponse('not_found', request, 'Nebyl nalezen oficialni manual vyrobce.', []);
      response.debug = { triedCandidates, openai: openaiDebug, taskIntent };
      return sendJson(res, 200, response);
    }

    for (const candidate of candidates.slice(0, 8)) {
      const debug = {
        title: candidate.title || '',
        type: candidate.type || '',
        url: candidate.url || '',
        source: candidate.source || 'web',
        sourceType: candidate.sourceType || (candidate.source === 'local' ? 'firebase_catalog' : 'brave_search'),
        fileName: candidate.fileName || '',
        pvc: candidate.pvc || '',
        selectedManualFile: candidate.fileName || '',
        selectedManualUrl: candidate.url || '',
        matchedModel: candidate.matchedModel || '',
        matchedSerialRange: candidate.serialRange || '',
        selectionReason: candidate.selectionReason || '',
        downloaded: false,
        finalUrl: '',
        textPages: 0,
        matchedPages: [],
        matchedTerms: [],
        skippedCode: '',
        skippedReason: ''
      };
      triedCandidates.push(debug);

      try {
        const { buffer, finalUrl } = await downloadPdf(candidate, request, config, deps);
        debug.downloaded = true;
        debug.finalUrl = finalUrl || candidate.url || '';
        const pages = await extractPdfTextPages(buffer, debug);
        debug.textPages = pages.length;
        if (!pages.length) {
          debug.skippedReason = 'PDF nema citelnou textovou vrstvu.';
          continue;
        }

        const fit = evaluateManualFit({ request, pages });
        if (fit.status === 'not_found') {
          debug.skippedReason = 'Model nebo vyrobni cislo neodpovida rozsahu manualu.';
          continue;
        }

        const relevantPages = findRelevantPages(pages, request.task, { manualType: candidate.type });
        debug.matchedPages = relevantPages.map(p => p.page);
        debug.matchedTerms = collectMatchedTerms(relevantPages, request.task);
        if (!relevantPages.length) {
          debug.skippedReason = 'Nenalezeny relevantni stranky pro zadany ukon.';
          continue;
        }

        const aiPages = mergePages(relevantPages, pages, fit.sources);
        const aiResult = await structureWithOpenAI({ request, candidate, finalUrl, pages: aiPages, config, deps, fit, openaiDebug });
        const result = aiResult || buildSourceOnlyResult({ request, candidate, finalUrl, pages: relevantPages, fit, openaiDebug });
        applySelectionDiagnostics(result, candidate, finalUrl, fit);
        result.debug = { triedCandidates, openai: openaiDebug, taskIntent };
        result.variants = result.variants?.length ? result.variants : variants;
        if (!result.message.includes('Pri rozporu ma vzdy prednost originalni manual vyrobce.')) {
          result.message = `${result.message} Pri rozporu ma vzdy prednost originalni manual vyrobce.`;
        }
        return sendJson(res, 200, result);
      } catch (error) {
        debug.skippedCode = error?.code || '';
        debug.skippedReason = error?.message || 'Chyba pri stazeni nebo zpracovani manualu.';
        if (error?.code === 'blocked_url') {
          return sendJson(res, 200, emptyResponse('warn', request, 'Nalezeny odkaz byl odmitnut bezpecnostni kontrolou domeny.', variants));
        }
      }
    }

    const serviceTried = triedCandidates.some(x => x.type === 'service' && x.downloaded && x.textPages > 0);
    const allCatalogTooLarge = triedCandidates.length > 0
      && triedCandidates.every(x => x.sourceType === 'firebase_catalog' && x.skippedCode === 'pdf_too_large_for_serverless');
    const message = allCatalogTooLarge
      ? 'JLG service manual je ve Firebase katalogu nalezeny, ale PDF je prilis velke pro prime serverless zpracovani. Je potreba pripravit index textu po strankach nebo mensi rozdelene PDF. Pri rozporu ma vzdy prednost originalni manual vyrobce.'
      : serviceTried
      ? 'Service manual byl prohledan, ale konkretni dolozitelny postup nebyl nalezen. Pri rozporu ma vzdy prednost originalni manual vyrobce.'
      : 'Oficialni manual byl nalezen, ale relevantni dolozitelny postup v textu PDF nalezen nebyl. Pri rozporu ma vzdy prednost originalni manual vyrobce.';
    const response = emptyResponse('not_found', request, message, variants);
    if (mustUseJlgCatalog) {
      response.sourceType = 'firebase_catalog';
      response.selectionReason = 'Byly prohledány pouze přesné JLG katalogové service manuály pro zadaný model; Brave Search nebyl použit.';
    }
    response.debug = { triedCandidates, openai: openaiDebug, taskIntent };
    return sendJson(res, 200, response);
  };
}

function isJlgCatalogServiceRequest(request) {
  return String(request?.maker || '').toLowerCase() === 'jlg' && isServiceTask(request?.task || '');
}

function applySelectionDiagnostics(result, candidate, finalUrl, fit = {}) {
  result.sourceType = candidate.sourceType || (candidate.source === 'local' ? 'firebase_catalog' : 'brave_search');
  result.selectedManualFile = candidate.fileName || '';
  result.selectedManualUrl = finalUrl || candidate.url || '';
  result.matchedModel = candidate.matchedModel || '';
  result.matchedSerialRange = fit.serialRange || candidate.serialRange || '';
  result.selectionReason = candidate.selectionReason || (
    result.sourceType === 'firebase_catalog'
      ? 'Vybráno z interního Firebase katalogu.'
      : 'Vybráno ze Brave Search fallbacku.'
  );
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
    acceptedSteps: 0,
    prompt: null,
    promptTokenEstimate: 0,
    responseTokenUsage: null,
    responseBody: null,
    parseException: null
  };
}

function collectMatchedTerms(pages, task) {
  const hay = pages.map(p => p.text || '').join('\n').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const checks = taskTerms(task);
  const found = new Set(checks.filter(term => hay.includes(term.toLowerCase())));
  const q = String(task || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (q.includes('kalibrace') && hay.includes('calibration')) found.add('calibration');
  if (isHydraulicFilterTask(task)) {
    if (hay.includes('hydraulic') && hay.includes('filter')) found.add('hydraulic + filter');
    if (hay.includes('filter') && /\b(replace|replacement|element|changing|change)\b/.test(hay)) found.add('filter + replace/replacement/element');
  }
  if (isAngleSensorCalibrationTask(task) || /angle|tilt|level|sensor|senzor|cidlo/.test(q)) {
    if (hay.includes('angle') && hay.includes('sensor')) found.add('angle + sensor');
    if (hay.includes('tilt') && hay.includes('sensor')) found.add('tilt + sensor');
    if (hay.includes('level') && hay.includes('sensor')) found.add('level + sensor');
  }
  if (isCalibrationTask(task) && /\b(calibration|calibrate|adjustment|zero)\b/.test(hay)) found.add('calibration/calibrate/adjustment/zero');
  return [...found];
}

function mergePages(relevantPages, allPages, fitSources = []) {
  const pageNumbers = new Set(relevantPages.map(p => p.page));
  for (const page of relevantPages || []) {
    pageNumbers.add(page.page - 1);
    pageNumbers.add(page.page + 1);
    pageNumbers.add(page.page + 2);
  }
  for (const source of fitSources || []) pageNumbers.add(source.page);
  return [...pageNumbers]
    .map(page => allPages.find(p => p.page === page))
    .filter(Boolean)
    .sort((a, b) => a.page - b.page);
}
