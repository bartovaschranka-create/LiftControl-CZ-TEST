import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';
import { readJsonBody, sendJson } from './http.mjs';
import { emptyResponse, validateManualRequest } from './validation.mjs';
import { searchManualCandidates, braveErrorResponse } from './brave.mjs';
import { searchLocalManualCandidates } from './local-manuals.mjs';
import { rankCandidates, toVariant } from './candidates.mjs';
import { downloadPdf, extractPdfTextPages } from './pdf.mjs';
import { loadManualPageIndex } from './page-index.mjs';
import { buildSourceOnlyResult, findRelevantPages, isAngleSensorCalibrationTask, isCalibrationTask, isHydraulicFilterTask, isServiceTask, taskIntentDebug, taskTerms } from './manual-text.mjs';
import { structureWithOpenAI } from './openai.mjs';
import { evaluateManualFit } from './manual-fit.mjs';

export function createManualsHandler(deps = {}) {
  return async function manualsHandler(req, res) {
    const config = getConfig(deps.env || process.env);
    const perf = createPerformanceTrace('manuals/search');
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
      body = await readJsonBody(req, config.maxBodyBytes);
      perf.mark('request body read');
    } catch {
      return sendJson(res, 400, { status: 'error', message: 'Neplatny nebo prilis velky JSON request.' });
    }

    const validation = validateManualRequest(body);
    if (!validation.ok) {
      return sendJson(res, 400, emptyResponse('error', validation.value, validation.errors.join(' ')));
    }
    const request = validation.value;
    perf.mark('request validated', { maker: request.maker, model: request.model, task: request.task });

    let rawCandidates;
    perf.mark('local catalog search started');
    const localCandidates = await searchLocalManualCandidates(request, config, deps);
    perf.mark('local catalog search finished', { candidates: localCandidates.length });
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
      perf.mark('response sent', { status: 'not_found' });
      response.debug = { triedCandidates: [], openai: createOpenAiDebug(config), taskIntent: taskIntentDebug(request.task), deployment: config.deployment, performance: perf.events, catalogCandidates: localCandidates.map(toVariant) };
      return sendJson(res, 200, response);
    }
    try {
      if (!mustUseJlgCatalog) perf.mark('brave search started');
      rawCandidates = mustUseJlgCatalog
        ? exactCatalogServiceCandidates
        : [
            ...localCandidates,
            ...await searchManualCandidates(request, config, deps)
          ];
      perf.mark('manual candidates ready', { candidates: rawCandidates.length, source: mustUseJlgCatalog ? 'firebase_catalog' : 'catalog_plus_brave' });
    } catch (error) {
      if (localCandidates.length) {
        rawCandidates = localCandidates;
        perf.mark('brave search failed, using local catalog', { error: error?.message || String(error) });
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
      perf.mark('response sent', { status: 'not_found' });
      response.debug = { triedCandidates, openai: openaiDebug, taskIntent, deployment: config.deployment, performance: perf.events };
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
        storagePath: candidate.storagePath || '',
        indexStoragePath: candidate.indexStoragePath || '',
        indexUrl: candidate.indexUrl || '',
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
        matchedPageDetails: [],
        matchedTerms: [],
        textSource: '',
        indexLoaded: false,
        skippedCode: '',
        skippedReason: ''
      };
      triedCandidates.push(debug);

      try {
        let finalUrl = candidate.url || '';
        let pages = [];
        perf.mark('candidate processing started', { title: candidate.title || '', type: candidate.type || '', sourceType: debug.sourceType });
        const pageIndex = await loadManualPageIndex(candidate, config, deps, debug);
        if (pageIndex?.pages?.length) {
          pages = pageIndex.pages;
          debug.finalUrl = finalUrl;
          debug.textPages = pages.length;
          debug.indexMetadata = pageIndex.metadata || {};
          perf.mark('manual page index loaded', { pages: pages.length, indexSource: debug.indexSource || '' });
        } else {
          perf.mark('pdf download started');
          const downloaded = await downloadPdf(candidate, request, config, deps);
          finalUrl = downloaded.finalUrl || candidate.url || '';
          debug.downloaded = true;
          debug.finalUrl = finalUrl;
          debug.textSource = 'pdf_text_layer';
          perf.mark('pdf downloaded', { bytes: downloaded.buffer?.length || 0 });
          pages = await extractPdfTextPages(downloaded.buffer, debug);
          perf.mark('pdf parsed', { pages: pages.length });
        }
        debug.textPages = pages.length;
        if (!pages.length) {
          debug.skippedReason = 'PDF nema citelnou textovou vrstvu.';
          continue;
        }

        perf.mark('manual fit evaluation started');
        const fit = evaluateManualFit({ request, pages });
        perf.mark('manual fit evaluation finished', { status: fit.status, serialRange: fit.serialRange || '' });
        if (fit.status === 'not_found') {
          debug.skippedReason = 'Model nebo vyrobni cislo neodpovida rozsahu manualu.';
          continue;
        }

        perf.mark('relevant page search started');
        const relevantPages = findRelevantPages(pages, request.task, { manualType: candidate.type });
        perf.mark('relevant page search finished', { pages: relevantPages.length, pageNumbers: relevantPages.map(p => p.page).slice(0, 8).join(',') });
        debug.matchedPages = relevantPages.map(p => p.page);
        debug.matchedPageDetails = relevantPages.map(page => ({
          page: page.page,
          score: page.score || 0,
          matchedTerms: page.matchedTerms || [],
          title: page.title || '',
          chapter: page.chapter || ''
        }));
        debug.matchedTerms = collectMatchedTerms(relevantPages, request.task);
        if (!relevantPages.length) {
          debug.skippedReason = 'Nenalezeny relevantni stranky pro zadany ukon.';
          continue;
        }

        const aiPages = mergePages(relevantPages, pages, fit.sources, request.task);
        if (!config.manualSearchTranslate && hasPageLayout(aiPages)) {
          const result = buildFoundPagesResult({ request, candidate, finalUrl, pages: aiPages, relevantPages, fit });
          applySelectionDiagnostics(result, candidate, finalUrl, fit);
          result.debug = { triedCandidates, openai: openaiDebug, taskIntent, deployment: config.deployment, performance: perf.events };
          result.variants = variants;
          perf.mark('response sent', { status: result.status, mode: 'source_pages_fast_return' });
          return sendJson(res, 200, result);
        }
        perf.mark('OpenAI processing started', { pages: aiPages.length });
        const aiResult = await structureWithOpenAI({ request, candidate, finalUrl, pages: aiPages, config, deps, fit, openaiDebug, perf, deadlineAt });
        perf.mark('OpenAI processing finished', { status: aiResult?.status || 'fallback' });
        const result = aiResult || buildSourceOnlyResult({ request, candidate, finalUrl, pages: relevantPages, fit, openaiDebug });
        applySelectionDiagnostics(result, candidate, finalUrl, fit);
        result.debug = { triedCandidates, openai: openaiDebug, taskIntent, deployment: config.deployment, performance: perf.events };
        result.variants = result.variants?.length ? result.variants : variants;
        if (!result.message.includes('Pri rozporu ma vzdy prednost originalni manual vyrobce.')) {
          result.message = `${result.message} Pri rozporu ma vzdy prednost originalni manual vyrobce.`;
        }
        perf.mark('response sent', { status: result.status });
        return sendJson(res, 200, result);
      } catch (error) {
        debug.skippedCode = error?.code || '';
        debug.skippedReason = error?.message || 'Chyba pri stazeni nebo zpracovani manualu.';
        perf.mark('candidate processing failed', { code: debug.skippedCode, reason: debug.skippedReason });
        if (error?.code === 'blocked_url') {
          return sendJson(res, 200, emptyResponse('warn', request, 'Nalezeny odkaz byl odmitnut bezpecnostni kontrolou domeny.', variants));
        }
      }
    }

    const serviceTried = triedCandidates.some(x => x.type === 'service' && x.downloaded && x.textPages > 0);
    const allCatalogTooLarge = triedCandidates.length > 0
      && triedCandidates.every(x => x.sourceType === 'firebase_catalog' && x.skippedCode === 'pdf_too_large_for_serverless');
    const catalogNeedsIndex = allCatalogTooLarge || triedCandidates.some(x =>
      x.sourceType === 'firebase_catalog'
      && x.indexLoaded === false
      && x.skippedCode === 'pdf_too_large_for_serverless'
      && Array.isArray(x.indexTried)
      && x.indexTried.some(source => source.source === 'firebase')
    );
    const adminMessage = allCatalogTooLarge
      ? 'Servisni manual je ve Firebase katalogu nalezeny, ale PDF je prilis velke pro prime serverless zpracovani. Je potreba pripravit nebo zpristupnit textovy .pages.json index vedle PDF.'
      : '';
    const message = catalogNeedsIndex
      ? 'Manual byl nalezen, ale zatim neni pripraven pro inteligentni vyhledavani. Pri rozporu ma vzdy prednost originalni manual vyrobce.'
      : serviceTried
      ? 'Service manual byl prohledan, ale konkretni dolozitelny postup nebyl nalezen. Pri rozporu ma vzdy prednost originalni manual vyrobce.'
      : 'Oficialni manual byl nalezen, ale relevantni dolozitelny postup v textu PDF nalezen nebyl. Pri rozporu ma vzdy prednost originalni manual vyrobce.';
    const response = emptyResponse(catalogNeedsIndex ? 'warn' : 'not_found', request, message, variants);
    if (mustUseJlgCatalog) {
      response.sourceType = 'firebase_catalog';
      response.selectionReason = 'Byly prohledány pouze přesné JLG katalogové service manuály pro zadaný model; Brave Search nebyl použit.';
    }
    perf.mark('response sent', { status: response.status });
    response.debug = { triedCandidates, openai: openaiDebug, taskIntent, deployment: config.deployment, performance: perf.events, adminMessage };
    return sendJson(res, 200, response);
  };
}

function hasPageLayout(pages) {
  return (pages || []).some(page =>
    (Array.isArray(page?.textBlocks) && page.textBlocks.length)
    || (Array.isArray(page?.images) && page.images.some(image => image?.dataUrl))
  );
}

function buildFoundPagesResult({ request, candidate, finalUrl, pages, relevantPages, fit = {} }) {
  const sourcePages = normalizeSourcePagesForClient(pages);
  const images = imagesFromPages(pages);
  const selectedPages = sourcePages.map(page => page.page);
  const layoutBlocksCount = sourcePages.reduce((sum, page) => sum + (page.textBlocks || []).length, 0);
  const pageImagesAvailable = sourcePages.every(page => (page.images || []).some(image => image.dataUrl));
  return {
    status: 'partial_procedure_found',
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: fit.serialRange || candidate.serialRange || '',
    originalUrl: finalUrl || candidate.url || '',
    steps: [],
    safety: [],
    translatedPages: [],
    sourcePages,
    sources: sourceSnippetsFromPages(relevantPages.length ? relevantPages : pages),
    images,
    pdfDiagnostics: {
      selectedPages,
      contiguousPageRange: contiguousRange(selectedPages),
      pageImagesAvailable,
      layoutBlocksCount,
      translatedBlocksCount: 0,
      repairedBlocksCount: 0,
      untranslatedBlocksCount: layoutBlocksCount,
      fallbackReason: '',
      finalRenderMode: pageImagesAvailable && layoutBlocksCount ? 'translated_manual_pages_pending_translation' : 'fallback_report'
    },
    message: 'Manual a relevantni strany byly nalezeny. Preklad se vytvori v dalsim kroku z vybranych stran, aby vyhledani nespadlo na timeout Vercelu. Pri rozporu ma vzdy prednost originalni manual vyrobce.',
    variants: []
  };
}

function contiguousRange(pages) {
  const numbers = [...new Set((pages || []).map(Number).filter(Boolean))].sort((a, b) => a - b);
  if (!numbers.length) return '';
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] !== numbers[i - 1] + 1) return numbers.join(',');
  }
  return `${numbers[0]}-${numbers[numbers.length - 1]}`;
}

function normalizeSourcePagesForClient(pages) {
  return (pages || []).map(page => ({
    page: Number(page.page) || 0,
    title: String(page.title || '').slice(0, 160),
    chapter: String(page.chapter || '').slice(0, 160),
    width: Number(page.width) || 0,
    height: Number(page.height) || 0,
    text: String(page.text || '').slice(0, 6000),
    textBlocks: (Array.isArray(page.textBlocks) ? page.textBlocks : [])
      .map(block => ({
        text: String(block?.text || '').slice(0, 1000),
        x: Number(block?.x) || 0,
        y: Number(block?.y) || 0,
        width: Number(block?.width) || 0,
        height: Number(block?.height) || 0,
        fontSize: Number(block?.fontSize) || 0
      }))
      .filter(block => block.text && block.width > 0 && block.height > 0)
      .slice(0, 180),
    images: (Array.isArray(page.images) ? page.images : [])
      .filter(image => image?.dataUrl)
      .map(image => ({
        figure: String(image.figure || '').slice(0, 80),
        bbox: String(image.bbox || '').slice(0, 80),
        caption: String(image.caption || '').slice(0, 240),
        page: Number(image.page || page.page) || 0,
        mimeType: String(image.mimeType || image.mime || '').slice(0, 60),
        dataUrl: String(image.dataUrl || ''),
        width: Number(image.width) || 0,
        height: Number(image.height) || 0
      }))
      .slice(0, 4)
  })).filter(page => page.page);
}

function sourceSnippetsFromPages(pages) {
  return (pages || [])
    .slice(0, 10)
    .map(page => ({ page: page.page, quote: firstUsefulQuote(page.text) }))
    .filter(source => source.page && source.quote);
}

function imagesFromPages(pages) {
  const out = [];
  for (const page of pages || []) {
    for (const image of page.images || []) {
      out.push({
        ...image,
        page: Number(image.page || page.page),
        stepPage: Number(page.page)
      });
    }
  }
  return out.slice(0, 16);
}

function firstUsefulQuote(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/(?:[^.!?]*\b(?:calibration|calibrate|tilt|angle|level|sensor|procedure|adjustment|service mode|warning|caution)\b[^.!?]*[.!?]?)/i);
  return (match?.[0] || cleaned).trim().slice(0, 300);
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

function mergePages(relevantPages, allPages, fitSources = [], task = '') {
  const procedureGroup = preferredProcedureGroup(relevantPages, allPages, task);
  if (procedureGroup.length) return procedureGroup;

  const pageNumbers = new Set(relevantPages.map(p => p.page));
  const relevantByPage = new Map((relevantPages || []).map(page => [page.page, page]));
  const procedureStarts = (relevantPages || [])
    .map(page => ({ page: Number(page.page || 0), heading: procedureHeadingText(page) }))
    .filter(item => item.page && item.heading);
  for (const page of relevantPages || []) {
    pageNumbers.add(page.page - 1);
    pageNumbers.add(page.page + 1);
    pageNumbers.add(page.page + 2);
    for (const continuation of procedureContinuationPages(page, allPages)) {
      pageNumbers.add(continuation.page);
      const inheritedScore = Math.max(1, Number(page.score || 0) - Math.max(1, continuation.page - page.page));
      relevantByPage.set(continuation.page, {
        ...continuation,
        score: Math.max(Number(continuation.score || 0), inheritedScore),
        matchedTerms: [...new Set([...(continuation.matchedTerms || []), ...(page.matchedTerms || []), 'procedure continuation'])],
        procedureContinuation: true,
        procedureStartPage: page.page
      });
    }
  }
  for (const source of fitSources || []) pageNumbers.add(source.page);
  return [...pageNumbers]
    .map(page => relevantByPage.get(page) || allPages.find(p => p.page === page))
    .filter(Boolean)
    .filter(page => !isNextChapterAfterProcedure(page, procedureStarts))
    .sort((a, b) => a.page - b.page);
}

function preferredProcedureGroup(relevantPages, allPages, task = '') {
  if (!isAngleSensorCalibrationTask(task)) return [];
  const starts = (relevantPages || [])
    .filter(page => procedureHeadingText(page))
    .filter(page => /calibrat/i.test(procedureHeadingText(page)) && /(angle|tilt|level).*sensor|sensor/i.test(procedureHeadingText(page)))
    .sort((a, b) => procedureStartScore(b, task) - procedureStartScore(a, task));
  const start = starts[0];
  if (!start) return [];
  const byPage = new Map((allPages || []).map(page => [Number(page.page || 0), page]));
  const group = [start, ...procedureContinuationPages(start, allPages)]
    .map(page => ({
      ...(byPage.get(Number(page.page || 0)) || page),
      ...page,
      score: Number(page.score || start.score || 1),
      matchedTerms: [...new Set([...(page.matchedTerms || []), ...(start.matchedTerms || []), 'contiguous procedure range'])],
      procedureStartPage: Number(start.page || 0),
      procedureContinuation: Number(page.page || 0) !== Number(start.page || 0)
    }))
    .filter(page => Number(page.page || 0));
  return group.slice(0, 10).sort((a, b) => Number(a.page) - Number(b.page));
}

function procedureContinuationPages(startPage, allPages) {
  const startNumber = Number(startPage?.page || 0);
  if (!startNumber) return [];
  const startHeading = procedureHeadingText(startPage);
  if (!startHeading) return [];
  const out = [];
  for (const page of allPages || []) {
    const pageNumber = Number(page?.page || 0);
    if (pageNumber <= startNumber) continue;
    if (pageNumber > startNumber + 9) break;
    const heading = procedureHeadingText(page);
    const trimmed = trimPageAtNextProcedureHeading(page, startHeading);
    if (trimmed) {
      out.push(trimmed);
      break;
    }
    if (heading && isNextProcedureHeading(startHeading, heading)) break;
    out.push(page);
  }
  return out;
}

function procedureHeadingText(page) {
  const title = String(page?.title || '').trim();
  if (title) return title;
  const blockHeading = (Array.isArray(page?.textBlocks) ? page.textBlocks : [])
    .slice(0, 12)
    .map(block => String(block?.text || '').replace(/\s+/g, ' ').trim())
    .find(text => /\b\d+(?:\.\d+){1,4}\s+[A-Z][A-Za-z0-9 /-]{6,120}/.test(text));
  if (blockHeading) return blockHeading;
  const text = String(page?.text || '');
  const match = text.match(/(?:^|\n)\s*(\d+(?:\.\d+){1,4}\s+[A-Z][^\n]{6,120})/);
  return match?.[1]?.trim() || '';
}

function procedureStartScore(page, task = '') {
  const heading = procedureHeadingText(page).toLowerCase();
  let score = Number(page?.score || 0);
  if (/calibrating platform angle sensor/.test(heading)) score += 80;
  if (/platform angle sensor/.test(heading)) score += 40;
  if (/calibrating .*angle sensor|angle sensor calibration/.test(heading)) score += 35;
  if (/refer to figure|location/.test(heading)) score -= 25;
  if (isAngleSensorCalibrationTask(task) && Number(page?.page) >= 120) score += 8;
  return score;
}

function isNextProcedureHeading(startHeading, heading) {
  const start = headingNumber(startHeading);
  const next = headingNumber(heading);
  if (!start || !next || start === next) return false;
  const startParts = start.split('.');
  const nextParts = next.split('.');
  if (startParts.length !== nextParts.length) return false;
  return startParts.slice(0, -1).join('.') === nextParts.slice(0, -1).join('.');
}

function headingNumber(value) {
  return String(value || '').match(/\b(\d+(?:\.\d+){1,4})\b/)?.[1] || '';
}

function trimPageAtNextProcedureHeading(page, startHeading) {
  const start = headingNumber(startHeading);
  if (!start) return null;
  const textBlocks = Array.isArray(page?.textBlocks) ? page.textBlocks : [];
  const headingIndex = textBlocks.findIndex(block => {
    const text = String(block?.text || '').replace(/\s+/g, ' ').trim();
    const found = text.match(/\b(\d+(?:\.\d+){1,4})\s+[A-Za-z][A-Za-z0-9 /+.,()-]{3,140}/);
    return found && isNextProcedureHeading(startHeading, found[0]);
  });
  if (headingIndex > 0) {
    const trimmedBlocks = textBlocks.slice(0, headingIndex);
    return {
      ...page,
      textBlocks: trimmedBlocks,
      text: trimmedBlocks.map(block => block.text).filter(Boolean).join('\n'),
      trimmedAtNextProcedure: true,
      matchedTerms: [...new Set([...(page.matchedTerms || []), 'trimmed before next procedure'])]
    };
  }
  const text = String(page?.text || '');
  const pattern = /\b(\d+(?:\.\d+){1,4})\s+[A-Za-z][^\n]{3,140}/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (isNextProcedureHeading(startHeading, match[0])) {
      const before = text.slice(0, match.index).trim();
      if (!before) return null;
      return {
        ...page,
        text: before,
        trimmedAtNextProcedure: true,
        matchedTerms: [...new Set([...(page.matchedTerms || []), 'trimmed before next procedure'])]
      };
    }
  }
  return null;
}

function isNextChapterAfterProcedure(page, procedureStarts) {
  const pageNumber = Number(page?.page || 0);
  const heading = procedureHeadingText(page);
  if (!pageNumber || !heading) return false;
  return procedureStarts.some(start =>
    pageNumber > start.page
    && pageNumber <= start.page + 5
    && isNextProcedureHeading(start.heading, heading)
  );
}
