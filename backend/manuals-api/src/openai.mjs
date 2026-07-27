import { classifyProcedureEvidence, taskTerms } from './manual-text.mjs';

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps', 'safety', 'translatedPages', 'serialRange', 'message'],
  properties: {
    steps: { type: 'array', items: sourceItemSchema() },
    safety: { type: 'array', items: sourceItemSchema() },
    translatedPages: { type: 'array', items: translatedPageSchema() },
    serialRange: { type: 'string' },
    message: { type: 'string' }
  }
};

const TRANSLATED_PAGE_REPAIR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translatedPages'],
  properties: {
    translatedPages: { type: 'array', items: translatedPageSchema() }
  }
};

export async function structureWithOpenAI({ request, candidate, finalUrl, pages, config, deps = {}, fit = {}, openaiDebug = null, perf = null, deadlineAt = 0 }) {
  if (!config.openaiApiKey) {
    setOpenAiDebug(openaiDebug, {
      configured: false,
      errorCode: 'openai_missing_key',
      errorMessage: 'OPENAI_API_KEY is not configured.'
    });
    return null;
  }
  const fetchImpl = deps.fetch || fetch;
  const sourcePages = limitOpenAiPages(pages, config);
  const sourceText = sourcePages.map(formatSourcePage).join('\n\n---\n\n');
  const promptTokenEstimate = estimateTokens(JSON.stringify({
    task: request.task,
    maker: request.maker,
    model: request.model,
    serial: request.serial || '',
    verifiedSerialRange: fit.serialRange || '',
    sourceText
  }));
  const promptInput = [
    {
      role: 'system',
      content: [
        'Return only structured JSON matching the schema.',
        'Do not invent service procedures, safety warnings, serial ranges, page numbers, or sources.',
        'Every step and safety warning must be based on its exact English sourceQuote from the stated page.',
        'The text field must always be Czech. Never copy the English sourceQuote into the text field.',
        'Do not summarize or shorten the procedure.',
        'Create a Czech service manual chapter that follows the original procedure structure as closely as possible.',
        'Preserve all supported steps, warnings, cautions, notices, notes, tables, display/menu values, and figure references from the provided source pages.',
        'Keep the original technical term in parentheses at its first Czech occurrence when the English term is important for service work.',
        'Keep machine display/menu labels in English, for example ACCESS LEVEL 2, CALIBRATIONS, or PLATFORM ANGLE.',
        'Use the steps array for every translated procedural paragraph, numbered action, table row explanation, or supported note in the original order.',
        'Use the safety array only for explicit WARNING, CAUTION, NOTICE, danger, injury, electrical, hydraulic, fall, crush, or lockout warnings.',
        'Also fill translatedPages when TEXT_BLOCKS are provided.',
        'For translatedPages, translate every original text block provided in TEXT_BLOCKS without shortening; keep its blockId and exact sourceQuote.',
        'Do not translate machine display labels or menu labels; keep them in English inside the Czech text.',
        'If a procedure is not explicitly supported by the source text, return empty arrays.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: request.task,
        maker: request.maker,
        model: request.model,
        serial: request.serial || '',
        verifiedSerialRange: fit.serialRange || '',
        sourceText
      })
    }
  ];
  const requestBody = {
    model: config.openaiModel,
    max_output_tokens: config.openaiMaxOutputTokens,
    input: promptInput,
    text: {
      format: {
        type: 'json_schema',
        name: 'manual_procedure_result',
        strict: true,
        schema: RESULT_SCHEMA
      }
    }
  };
  setOpenAiDebug(openaiDebug, {
    configured: true,
    model: config.openaiModel,
    requestSent: true,
    errorCode: null,
    errorMessage: null,
    prompt: requestBody,
    foundPages: Array.isArray(pages) ? pages.length : 0,
    sentPages: sourcePages.length,
    sentPageNumbers: sourcePages.map(page => page.page),
    sentPageDetails: sourcePages.map(page => ({
      page: page.page,
      score: page.score || 0,
      matchedTerms: page.matchedTerms || [],
      title: page.title || '',
      chapter: page.chapter || '',
      procedureContinuation: !!page.procedureContinuation,
      procedureStartPage: page.procedureStartPage || '',
      originalTextChars: Number(page.originalTextChars || String(page.text || '').length),
      sentTextChars: String(page.text || '').length,
      truncated: !!page.truncated
    })),
    sentCharacters: sourceText.length,
    promptTokenEstimate,
    timeoutMs: config.openaiTimeoutMs,
    maxOutputTokens: config.openaiMaxOutputTokens,
    elapsedMs: 0
  });
  let res;
  const startedAt = Date.now();
  const mainTimeoutMs = openAiTimeoutForDeadline(config, deadlineAt, 4000);
  if (mainTimeoutMs < 1000) {
    setOpenAiDebug(openaiDebug, {
      responseStatus: null,
      elapsedMs: 0,
      errorCode: 'openai_timeout',
      errorMessage: 'Not enough serverless time left for OpenAI processing before Vercel timeout.',
      timeoutMs: mainTimeoutMs
    });
    perf?.mark?.('OpenAI skipped before call', { reason: 'deadline_too_close', remainingMs: remainingMs(deadlineAt) });
    return buildOpenAiTimeoutResult({ request, candidate, finalUrl, pages: sourcePages, fit });
  }
  setOpenAiDebug(openaiDebug, { timeoutMs: mainTimeoutMs });
  try {
    perf?.mark?.('OpenAI main request sent', { timeoutMs: mainTimeoutMs, pages: sourcePages.length, chars: sourceText.length });
    res = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: openAiTimeoutSignal({ openaiTimeoutMs: mainTimeoutMs }),
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = isAbortError(error);
    setOpenAiDebug(openaiDebug, {
      responseStatus: null,
      elapsedMs,
      errorCode: timedOut ? 'openai_timeout' : 'openai_unknown_error',
      errorMessage: timedOut ? 'The operation was aborted due to timeout' : safeOpenAiErrorMessage(error)
    });
    return buildOpenAiTimeoutResult({ request, candidate, finalUrl, pages: sourcePages, fit });
  }
  perf?.mark?.('OpenAI main response received', { status: Number(res.status) || null, elapsedMs: Date.now() - startedAt });
  setOpenAiDebug(openaiDebug, { responseStatus: Number(res.status) || null, elapsedMs: Date.now() - startedAt });
  if (!res.ok) {
    const errorText = await readOpenAiErrorText(res);
    setOpenAiDebug(openaiDebug, {
      errorCode: classifyOpenAiError(res.status, errorText),
      errorMessage: safeOpenAiErrorMessage(errorText || `OpenAI HTTP ${res.status}`)
    });
    return null;
  }
  let data;
  let rawResponseBody = '';
  try {
    rawResponseBody = await res.text();
    setOpenAiDebug(openaiDebug, { responseBody: rawResponseBody });
    data = JSON.parse(rawResponseBody);
  } catch (error) {
    setOpenAiDebug(openaiDebug, {
      errorCode: 'openai_response_invalid',
      errorMessage: safeOpenAiErrorMessage(error),
      parseException: safeOpenAiErrorMessage(error)
    });
    return buildOpenAiFallbackResult({ request, candidate, finalUrl, pages: sourcePages, fit, openaiDebug, aiText: rawResponseBody });
  }
  setOpenAiDebug(openaiDebug, { responseTokenUsage: data?.usage || null });
  const text = extractResponseText(data);
  if (!text) {
    setOpenAiDebug(openaiDebug, {
      errorCode: 'openai_response_invalid',
      errorMessage: 'OpenAI response did not contain output text.'
    });
    return buildOpenAiFallbackResult({ request, candidate, finalUrl, pages: sourcePages, fit, openaiDebug });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
    setOpenAiDebug(openaiDebug, { parsed: true });
  } catch (error) {
    setOpenAiDebug(openaiDebug, {
      errorCode: 'openai_response_invalid',
      errorMessage: safeOpenAiErrorMessage(error),
      parseException: safeOpenAiErrorMessage(error)
    });
    return buildOpenAiFallbackResult({ request, candidate, finalUrl, pages: sourcePages, fit, openaiDebug, aiText: text });
  }
  const repairedTranslatedPages = await completeTranslatedPageTranslations({
    parsedTranslatedPages: parsed.translatedPages,
    sourcePages,
    request,
    config,
    deps,
    openaiDebug,
    perf,
    deadlineAt
  });
  const rawItemCount = countSourceItems({ ...parsed, translatedPages: repairedTranslatedPages });
  const validationDetails = [];
  const validated = await validateAiOutput(parsed, sourcePages, request, { config, deps, validationDetails });
  const translatedPages = validateTranslatedPages(repairedTranslatedPages, sourcePages);
  const acceptedCount = validated.steps.length + validated.safety.length + translatedPages.reduce((sum, page) => sum + page.blocks.length, 0);
  const evidence = classifyProcedureEvidence(sourcePages, request.task);
  setOpenAiDebug(openaiDebug, {
    acceptedSteps: acceptedCount,
    validationRejectedSteps: Math.max(0, rawItemCount - acceptedCount),
    validationDetails
  });
  if (!acceptedCount && rawItemCount > 0) {
    setOpenAiDebug(openaiDebug, {
      errorCode: 'openai_validation_rejected',
      errorMessage: 'OpenAI returned source items, but source validation rejected them.'
    });
    return buildOpenAiFallbackResult({ request, candidate, finalUrl, pages: sourcePages, fit, openaiDebug, parsed });
  }
  const sources = uniqueSources([...(fit.sources || []), ...validated.sources, ...evidenceSources(sourcePages)]);
  const images = imagesForResult(sourcePages, validated.steps, translatedPages);
  return {
    status: (validated.steps.length || translatedPages.length) ? (fit.status === 'ok' ? 'procedure_found' : 'partial_procedure_found') : evidence.status,
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: fit.serialRange || validated.serialRange || '',
    originalUrl: finalUrl || candidate.url,
    steps: validated.steps,
    safety: validated.safety,
    translatedPages,
    sources,
    images,
    message: (validated.steps.length || translatedPages.length) ? (validated.message || 'Postup nalezen v originalnim manualu.') : evidence.message,
    variants: []
  };
}

async function completeTranslatedPageTranslations({ parsedTranslatedPages, sourcePages, request, config, deps, openaiDebug, perf = null, deadlineAt = 0 }) {
  const sourcePagesWithBlocks = (sourcePages || [])
    .filter(page => Array.isArray(page?.textBlocks) && page.textBlocks.some(block => String(block?.text || '').trim().length >= 2));
  if (!sourcePagesWithBlocks.length) return Array.isArray(parsedTranslatedPages) ? parsedTranslatedPages : [];

  const currentPages = normalizeRawTranslatedPages(parsedTranslatedPages);
  const repairDebug = {
    attempted: false,
    repairedPages: [],
    skippedPages: [],
    requestedPages: 0,
    requestedBlocks: 0,
    timeoutMs: 0,
    elapsedMs: 0,
    errorCode: null,
    errorMessage: null
  };
  setOpenAiDebug(openaiDebug, { translatedPageRepair: repairDebug });

  const missingByPage = [];
  for (const sourcePage of sourcePagesWithBlocks) {
    const missingBlocks = missingTextBlocksForPage(sourcePage, currentPages.get(Number(sourcePage.page)));
    if (!missingBlocks.length) continue;
    missingByPage.push({ sourcePage, missingBlocks });
  }
  if (!missingByPage.length) return [...currentPages.values()].sort((a, b) => Number(a.page) - Number(b.page));

  const remaining = remainingMs(deadlineAt);
  const minRemaining = Number(config.translatedPageRepairMinRemainingMs || 8000);
  if (remaining && remaining < minRemaining) {
    repairDebug.errorCode = 'translated_page_repair_skipped_deadline';
    repairDebug.errorMessage = `Repair skipped because only ${remaining} ms remained before serverless deadline.`;
    perf?.mark?.('translated page repair skipped', { reason: 'deadline_too_close', remainingMs: remaining });
    return [...currentPages.values()].sort((a, b) => Number(a.page) - Number(b.page));
  }

  const maxPages = Math.max(1, Number(config.translatedPageRepairMaxPages || 4));
  const maxBlocks = Math.max(1, Number(config.translatedPageRepairMaxBlocks || 80));
  const repairPages = [];
  let usedBlocks = 0;
  for (const item of missingByPage.slice(0, maxPages)) {
    const blocks = item.missingBlocks.slice(0, Math.max(0, maxBlocks - usedBlocks));
    if (!blocks.length) break;
    repairPages.push({ sourcePage: item.sourcePage, missingBlocks: blocks });
    usedBlocks += blocks.length;
    if (usedBlocks >= maxBlocks) break;
  }
  if (!repairPages.length) return [...currentPages.values()].sort((a, b) => Number(a.page) - Number(b.page));

  repairDebug.attempted = true;
  repairDebug.requestedPages = repairPages.length;
  repairDebug.requestedBlocks = usedBlocks;
  const repairTimeoutMs = Math.max(1000, Math.min(
    Number(config.translatedPageRepairTimeoutMs || 6000),
    openAiTimeoutForDeadline(config, deadlineAt, 2000)
  ));
  repairDebug.timeoutMs = repairTimeoutMs;
  const startedAt = Date.now();
  try {
    perf?.mark?.('translated page repair request sent', { pages: repairPages.length, blocks: usedBlocks, timeoutMs: repairTimeoutMs });
    const repaired = await translateTextBlocksPages({ repairPages, request, config, deps, timeoutMs: repairTimeoutMs });
    repairDebug.elapsedMs = Date.now() - startedAt;
    const translatedMap = normalizeRawTranslatedPages(repaired?.translatedPages);
    for (const item of repairPages) {
      const pageNumber = Number(item.sourcePage.page);
      const validated = translatedMap.get(pageNumber);
      if (validated?.blocks?.length) {
        mergeRawTranslatedBlocks(currentPages, pageNumber, validated.blocks);
        repairDebug.repairedPages.push({
          page: pageNumber,
          requestedBlocks: item.missingBlocks.length,
          returnedBlocks: validated.blocks.length
        });
      } else {
        repairDebug.skippedPages.push({
          page: pageNumber,
          requestedBlocks: item.missingBlocks.length,
          reason: 'repair_returned_no_blocks'
        });
      }
    }
    perf?.mark?.('translated page repair finished', { elapsedMs: repairDebug.elapsedMs, repairedPages: repairDebug.repairedPages.length });
  } catch (error) {
    repairDebug.elapsedMs = Date.now() - startedAt;
    repairDebug.errorCode = isAbortError(error) ? 'translated_page_repair_timeout' : 'translated_page_repair_failed';
    repairDebug.errorMessage = isAbortError(error) ? 'Translated page repair timed out before serverless deadline.' : safeOpenAiErrorMessage(error);
    perf?.mark?.('translated page repair failed', { code: repairDebug.errorCode, elapsedMs: repairDebug.elapsedMs });
  }

  return [...currentPages.values()].sort((a, b) => Number(a.page) - Number(b.page));
}

function normalizeRawTranslatedPages(pages) {
  const out = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    const pageNumber = Number(page?.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
    const blocks = (Array.isArray(page?.blocks) ? page.blocks : [])
      .map(block => ({
        blockId: String(block?.blockId || '').trim(),
        text: String(block?.text || '').trim(),
        sourceQuote: String(block?.sourceQuote || '').replace(/\s+/g, ' ').trim()
      }))
      .filter(block => block.blockId && block.text && block.sourceQuote);
    out.set(pageNumber, { page: pageNumber, blocks });
  }
  return out;
}

function mergeRawTranslatedBlocks(currentPages, pageNumber, blocks) {
  const current = currentPages.get(pageNumber) || { page: pageNumber, blocks: [] };
  const byId = new Map(current.blocks.map(block => [String(block.blockId), block]));
  for (const block of blocks || []) {
    byId.set(String(block.blockId), block);
  }
  current.blocks = [...byId.values()].sort((a, b) => Number(a.blockId) - Number(b.blockId));
  currentPages.set(pageNumber, current);
}

function missingTextBlocksForPage(sourcePage, translatedPage) {
  const translatedIds = new Set((translatedPage?.blocks || []).map(block => String(block.blockId)));
  return sourceTextBlocks(sourcePage)
    .filter(block => !translatedIds.has(block.blockId));
}

function sourceTextBlocks(sourcePage) {
  return (Array.isArray(sourcePage?.textBlocks) ? sourcePage.textBlocks : [])
    .map((block, index) => ({
      blockId: String(index + 1),
      text: String(block?.text || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(block => block.text.length >= 2)
    .slice(0, 180);
}

async function translateTextBlocksPages({ repairPages, request, config, deps, timeoutMs }) {
  const fetchImpl = deps.fetch || fetch;
  const input = {
    task: request.task,
    maker: request.maker,
    model: request.model,
    rules: [
      'Translate every supplied text block to Czech without shortening.',
      'Keep display/menu labels and diagnostic codes in English.',
      'Do not invent text. Translate only the supplied block text.',
      'Return the same blockId and the exact original text as sourceQuote.'
    ],
    pages: repairPages.map(item => ({
      page: Number(item.sourcePage.page),
      title: item.sourcePage.title || '',
      chapter: item.sourcePage.chapter || '',
      textBlocks: item.missingBlocks
    }))
  };
  const body = {
    model: config.openaiModel,
    max_output_tokens: Math.max(4000, Number(config.openaiMaxOutputTokens || 10000)),
    input: [{
      role: 'system',
      content: 'Return only strict JSON. Translate missing service manual TEXT_BLOCKS to Czech. Keep service display/menu labels in English.'
    }, {
      role: 'user',
      content: JSON.stringify(input)
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'manual_translated_page_repair',
        strict: true,
        schema: TRANSLATED_PAGE_REPAIR_SCHEMA
      }
    }
  };
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: openAiTimeoutSignal({ openaiTimeoutMs: timeoutMs }),
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errorText = await readOpenAiErrorText(res);
    throw new Error(`OpenAI repair HTTP ${res.status}: ${safeOpenAiErrorMessage(errorText)}`);
  }
  const raw = await res.text();
  const data = JSON.parse(raw);
  const text = extractResponseText(data);
  if (!text) throw new Error('OpenAI repair response did not contain output text.');
  return JSON.parse(text);
}

function imagesForResult(pages, steps, translatedPages = []) {
  const stepPages = new Set([
    ...(steps || []).map(step => Number(step.page)).filter(Boolean),
    ...(translatedPages || []).map(page => Number(page.page)).filter(Boolean)
  ]);
  if (!stepPages.size) return [];
  const out = [];
  for (const page of pages || []) {
    if (!stepPages.has(Number(page.page))) continue;
    for (const image of page.images || []) {
      out.push({
        ...image,
        page: Number(image.page || page.page),
        stepPage: Number(page.page)
      });
    }
  }
  return out.slice(0, 12);
}

function limitOpenAiPages(pages, config = {}) {
  const maxPages = Math.min(Math.max(1, Number(config.openaiMaxPages || 4)), 6);
  const maxChars = Math.max(2000, Number(config.openaiMaxChars || 12000));
  const rankedPages = rankPagesForOpenAi(pages);
  const procedurePages = leadingProcedureGroup(rankedPages, pages);
  const orderedPages = procedurePages.length ? [
    ...procedurePages,
    ...rankedPages.filter(page => !procedurePages.some(procPage => Number(procPage.page) === Number(page.page)))
  ] : rankedPages;
  const out = [];
  let usedChars = 0;
  for (const page of orderedPages.slice(0, maxPages)) {
    const originalText = String(page?.text || '');
    const metaText = formatSourcePage({ ...page, text: '' });
    const separator = out.length ? '\n\n---\n\n' : '';
    const overhead = metaText.length + separator.length;
    const remaining = maxChars - usedChars - overhead;
    if (remaining <= 0) break;
    const text = originalText.slice(0, remaining);
    if (!text.trim()) continue;
    const candidate = {
      ...page,
      text,
      originalTextChars: originalText.length,
      truncated: text.length < originalText.length
    };
    const formatted = formatSourcePage(candidate);
    if (usedChars + separator.length + formatted.length > maxChars) break;
    out.push(candidate);
    usedChars += separator.length + formatted.length;
  }
  return out;
}

function leadingProcedureGroup(rankedPages, allPages = []) {
  const first = rankedPages?.[0];
  const start = Number(first?.procedureStartPage || first?.page || 0);
  if (!start) return [];
  const sourcePages = Array.isArray(allPages) && allPages.length ? allPages : rankedPages;
  const group = (sourcePages || [])
    .filter(page => {
      const pageNumber = Number(page.page || 0);
      if (pageNumber < start || pageNumber > start + 5) return false;
      const procedureStart = Number(page.procedureStartPage || 0);
      return pageNumber === start || procedureStart === start || pageNumber <= start + 5;
    })
    .sort((a, b) => Number(a.page || 0) - Number(b.page || 0));
  return group.length > 1 ? group : [];
}

function formatSourcePage(page) {
  const keywords = Array.isArray(page?.keywords) ? page.keywords.join(', ') : '';
  const textBlocks = formatTextBlocks(page);
  return [
    `PAGE ${page?.page || ''}`,
    page?.title ? `TITLE: ${page.title}` : '',
    page?.chapter ? `CHAPTER: ${page.chapter}` : '',
    keywords ? `KEYWORDS: ${keywords}` : '',
    page?.procedureContinuation ? `PROCEDURE CONTINUATION FROM PAGE: ${page.procedureStartPage || ''}` : '',
    textBlocks ? `TEXT_BLOCKS:\n${textBlocks}` : '',
    'TEXT:',
    page?.text || ''
  ].filter(line => line !== '').join('\n');
}

function formatTextBlocks(page) {
  const blocks = Array.isArray(page?.textBlocks) ? page.textBlocks : [];
  if (!blocks.length) return '';
  return blocks
    .filter(block => String(block.text || '').trim().length >= 2)
    .slice(0, 160)
    .map((block, index) => JSON.stringify({
      blockId: String(index + 1),
      page: Number(page.page),
      x: Number(block.x) || 0,
      y: Number(block.y) || 0,
      width: Number(block.width) || 0,
      height: Number(block.height) || 0,
      text: String(block.text || '').slice(0, 500)
    }))
    .join('\n');
}

function rankPagesForOpenAi(pages) {
  const ranked = [...(pages || [])].filter(page => !isOpenAiFrontMatter(page)).sort((a, b) => {
    const scoreA = Number(a?.score || a?.relevanceScore || 0);
    const scoreB = Number(b?.score || b?.relevanceScore || 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return Number(a?.page || 0) - Number(b?.page || 0);
  });
  const procedureGroup = bestProcedureGroup(ranked);
  if (!procedureGroup.length) return ranked;
  const selected = new Set(procedureGroup.map(page => Number(page.page)));
  return [
    ...procedureGroup,
    ...ranked.filter(page => !selected.has(Number(page.page)))
  ];
}

function bestProcedureGroup(pages) {
  const byPage = new Map((pages || []).map(page => [Number(page.page), page]));
  const groups = new Map();
  for (const page of pages || []) {
    const pageNumber = Number(page.page || 0);
    const start = Number(page.procedureStartPage || pageNumber || 0);
    if (!start) continue;
    const startPage = byPage.get(start);
    if (!startPage) continue;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(page);
  }
  let best = [];
  let bestScore = 0;
  for (const group of groups.values()) {
    const sorted = group.sort((a, b) => Number(a.page) - Number(b.page));
    const hasContinuation = sorted.some(page => page.procedureContinuation);
    const score = Math.max(...sorted.map(page => Number(page.score || page.relevanceScore || 0)));
    if (hasContinuation && score > bestScore) {
      best = sorted;
      bestScore = score;
    }
  }
  return bestScore >= 20 ? best : [];
}

function isOpenAiFrontMatter(page) {
  const hay = normalizeText([
    page?.title || '',
    page?.chapter || '',
    page?.text || ''
  ].join('\n'));
  const pageNumber = Number(page?.page || 0);
  if (pageNumber > 30) return false;
  return /\b(copyright|table of contents|contents|foreword|revision history|list of figures|list of tables|cover|introduction|specifications|general specifications)\b/.test(hay);
}

function buildOpenAiTimeoutResult({ request, candidate, finalUrl, pages, fit = {} }) {
  return {
    status: 'partial_procedure_found',
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: fit.serialRange || '',
    originalUrl: finalUrl || candidate.url,
    steps: fallbackStepsFromAiOrPages('', pages),
    safety: [],
    sources: uniqueSources([...(fit.sources || []), ...evidenceSources(pages)]),
    message: 'Relevantni stranky byly nalezeny. AI nestihla dokoncit zpracovani v casovem limitu.',
    variants: []
  };
}

export async function validateAiOutput(parsed, pages, request = {}, options = {}) {
  const pageMap = new Map(pages.map(p => [Number(p.page), p]));
  const terms = taskTerms(request.task || '').map(normalizeText).filter(x => x.length >= 3);
  const validSteps = await validateItems(parsed.steps, pageMap, terms, 'step', options);
  const validSafety = await validateItems(parsed.safety, pageMap, terms, 'safety', options);
  const sources = [...validSteps, ...validSafety].map(item => ({ page: item.page, quote: item.sourceQuote }));
  return {
    steps: validSteps,
    safety: validSafety,
    sources,
    serialRange: typeof parsed.serialRange === 'string' ? parsed.serialRange : '',
    message: typeof parsed.message === 'string' ? parsed.message : ''
  };
}

async function validateItems(items, pageMap, terms, kind, options = {}) {
  const out = [];
  for (const [index, rawItem] of (Array.isArray(items) ? items : []).entries()) {
    const result = validateSourceItem(rawItem, pageMap, terms, kind);
    if (options.validationDetails) {
      options.validationDetails.push({
        index,
        kind,
        page: result.item?.page ?? null,
        sourceQuote: String(result.item?.sourceQuote || '').slice(0, 300),
        text: String(result.item?.text || '').slice(0, 300),
        tests: result.tests,
        accepted: result.accepted,
        rejectReason: result.rejectReason
      });
    }
    if (result.accepted) out.push(result.item);
  }
  return out;
}

function validateSourceItem(rawItem, pageMap, terms, kind) {
  const tests = {};
  const fail = rejectReason => ({ item: normalizeSourceItem(rawItem), tests, accepted: false, rejectReason });

  tests.hasText = Boolean(rawItem?.text && String(rawItem.text).trim());
  tests.hasSourceQuote = Boolean(rawItem?.sourceQuote && String(rawItem.sourceQuote).trim());
  tests.pageIsInteger = Number.isInteger(Number(rawItem?.page));
  if (!tests.hasText) return fail('missing_text');
  if (!tests.hasSourceQuote) return fail('missing_source_quote');
  if (!tests.pageIsInteger) return fail('invalid_page');

  const item = normalizeSourceItem(rawItem);
  tests.quoteSpecific = quoteIsSpecific(item.sourceQuote);
  tests.pageExists = pageMap.has(item.page);
  const page = pageMap.get(item.page);
  tests.sourceQuoteFoundOnPage = tests.pageExists && pageContainsQuote(pageText(page), item.sourceQuote);
  tests.thematicMatch = quoteMatchesPurpose(item.sourceQuote, terms, kind, page);
  tests.thematicContext = tests.thematicMatch ? thematicContext(page, item.sourceQuote, terms, kind) : '';

  if (!tests.quoteSpecific) return { item, tests, accepted: false, rejectReason: 'source_quote_too_short_or_generic' };
  if (!tests.pageExists) return { item, tests, accepted: false, rejectReason: 'source_page_not_sent_to_openai' };
  if (!tests.sourceQuoteFoundOnPage) return { item, tests, accepted: false, rejectReason: 'source_quote_not_found_on_page' };
  if (!tests.thematicMatch) return { item, tests, accepted: false, rejectReason: 'source_quote_not_related_to_task' };
  return { item, tests, accepted: true, rejectReason: '' };
}

function normalizeSourceItem(item) {
  return {
    text: String(item?.text || '').trim(),
    sourceQuote: String(item?.sourceQuote || '').replace(/\s+/g, ' ').trim(),
    page: Number(item?.page)
  };
}

function quoteIsSpecific(quote) {
  const words = quote.split(/\s+/).filter(Boolean);
  return quote.length >= 24 && words.length >= 4 && !/^(warning|caution|note|danger)$/i.test(quote);
}

function pageContainsQuote(pageText, quote) {
  return normalizeForQuote(pageText).includes(normalizeForQuote(quote));
}

function quoteMatchesPurpose(quote, terms, kind, page = null) {
  const q = normalizeText(quote);
  if (kind === 'safety') {
    const safetyContext = normalizeText([q, pageContext(page)].join(' '));
    return /\b(warning|caution|danger|injury|death|hazard|disconnect|support|lockout|ppe|fall|crush|electric|battery|hydraulic)\b/.test(safetyContext);
  }
  if (!terms.length) return true;
  if (terms.some(term => q.includes(term))) return true;
  const context = normalizeText([pageContext(page), q].join(' '));
  return terms.some(term => context.includes(term));
}

function pageText(page) {
  if (typeof page === 'string') return page;
  return page?.text || '';
}

function pageContext(page) {
  if (!page || typeof page === 'string') return '';
  const keywords = Array.isArray(page.keywords) ? page.keywords.join(' ') : '';
  return [
    page.title || '',
    page.chapter || '',
    keywords,
    previousHeadingText(page.text || '')
  ].filter(Boolean).join('\n');
}

function previousHeadingText(text) {
  const value = String(text || '');
  const matches = [...value.matchAll(/(?:^|\n)\s*(?:\d+(?:\.\d+)*\s+)?[A-Z][A-Za-z0-9 /,-]{6,90}(?:\n|$)/g)];
  return matches.slice(0, 5).map(match => match[0]).join('\n');
}

function thematicContext(page, quote, terms, kind) {
  const q = normalizeText(quote);
  if (kind === 'safety') return 'safety_context';
  if (terms.some(term => q.includes(term))) return 'source_quote';
  const context = normalizeText(pageContext(page));
  const match = terms.find(term => context.includes(term));
  return match ? `page_context:${match}` : '';
}

function uniqueSources(sources) {
  const seen = new Set();
  return (sources || []).filter(source => {
    const key = `${source.page}:${source.quote}`;
    if (!source.page || !source.quote || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceSources(pages) {
  return (pages || [])
    .slice(0, 4)
    .map(page => ({ page: page.page, quote: firstEvidenceQuote(page.text) }))
    .filter(source => source.page && source.quote);
}

function buildOpenAiFallbackResult({ request, candidate, finalUrl, pages, fit = {}, openaiDebug = null, aiText = '', parsed = null }) {
  const evidence = classifyProcedureEvidence(pages, request.task);
  const sources = uniqueSources([...(fit.sources || []), ...evidenceSources(pages)]);
  const fallbackSteps = fallbackStepsFromAiOrPages(aiText, pages);
  const hasAiText = Boolean(String(aiText || '').trim());
  const hadParsedItems = countSourceItems(parsed) > 0;
  return {
    status: evidence.status === 'not_found' ? 'reference_found' : evidence.status,
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: fit.serialRange || '',
    originalUrl: finalUrl || candidate.url,
    steps: fallbackSteps,
    safety: [],
    sources,
    message: hasAiText
      ? 'OpenAI vratilo text mimo ocekavany validni JSON. Zobrazuji surovy vystup AI a nalezene zdroje z manualu.'
      : hadParsedItems
      ? 'OpenAI vratilo kroky, ale zadny neprosel zdrojovou validaci. Zobrazuji alespon nalezeny text z manualu.'
      : `${evidence.message} Zobrazuji alespon nalezeny anglicky text z manualu.`,
    variants: []
  };
}

function fallbackStepsFromAiOrPages(aiText, pages) {
  const text = String(aiText || '').trim();
  if (text) {
    const firstSource = evidenceSources(pages)[0] || {};
    return [{
      text: text.slice(0, 2500),
      sourceQuote: firstSource.quote || 'OpenAI returned unstructured text.',
      page: firstSource.page || 1
    }];
  }
  return (pages || [])
    .slice(0, 4)
    .map(page => {
      const quote = firstEvidenceQuote(page.text);
      if (!quote) return null;
      return {
        text: `Zdrojovy text z manualu, strana ${page.page}: ${quote}`,
        sourceQuote: quote,
        page: page.page
      };
    })
    .filter(Boolean);
}

function firstEvidenceQuote(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/(?:[^.!?]*\b(?:calibration|calibrate|tilt|angle|level|sensor|procedure|adjustment|service mode|warning|caution)\b[^.!?]*[.!?]?)/i);
  return (match?.[0] || cleaned).trim().slice(0, 300);
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const blocks = data?.output || [];
  for (const block of blocks) {
    for (const item of block.content || []) {
      if (item.type === 'output_text' && item.text) return item.text;
      if (item.text) return item.text;
    }
  }
  return '';
}

function sourceItemSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'sourceQuote', 'page'],
    properties: {
      text: { type: 'string' },
      sourceQuote: { type: 'string' },
      page: { type: 'integer' }
    }
  };
}

function translatedPageSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['page', 'blocks'],
    properties: {
      page: { type: 'integer' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['blockId', 'text', 'sourceQuote'],
          properties: {
            blockId: { type: 'string' },
            text: { type: 'string' },
            sourceQuote: { type: 'string' }
          }
        }
      }
    }
  };
}

function validateTranslatedPages(translatedPages, pages) {
  if (!Array.isArray(translatedPages)) return [];
  const pageMap = new Map((pages || []).map(page => [Number(page.page), page]));
  const out = [];
  for (const translatedPage of translatedPages) {
    const pageNumber = Number(translatedPage?.page);
    const sourcePage = pageMap.get(pageNumber);
    if (!sourcePage) continue;
    const sourceBlocks = Array.isArray(sourcePage.textBlocks) ? sourcePage.textBlocks : [];
    const blocks = [];
    for (const rawBlock of Array.isArray(translatedPage?.blocks) ? translatedPage.blocks : []) {
      const text = String(rawBlock?.text || '').trim();
      const sourceQuote = String(rawBlock?.sourceQuote || '').replace(/\s+/g, ' ').trim();
      const blockIndex = Math.max(0, Number(rawBlock?.blockId) - 1);
      const sourceBlock = sourceBlocks[blockIndex] || findSourceBlockForQuote(sourceBlocks, sourceQuote);
      if (!text || !sourceQuote || !sourceBlock) continue;
      if (!blockContainsQuote(sourceBlock, sourceQuote) && !pageContainsQuote(pageText(sourcePage), sourceQuote)) continue;
      blocks.push({
        blockId: String(rawBlock.blockId || blockIndex + 1),
        text: text.slice(0, 1600),
        sourceQuote: sourceQuote.slice(0, 1000),
        x: sourceBlock.x,
        y: sourceBlock.y,
        width: sourceBlock.width,
        height: sourceBlock.height,
        fontSize: sourceBlock.fontSize
      });
    }
    if (blocks.length) {
      out.push({
        page: pageNumber,
        width: Number(sourcePage.width) || 0,
        height: Number(sourcePage.height) || 0,
        blocks
      });
    }
  }
  return out;
}

function findSourceBlockForQuote(blocks, quote) {
  const normalized = normalizeForQuote(quote);
  return (blocks || []).find(block => {
    const blockText = normalizeForQuote(block.text);
    return blockText.includes(normalized) || normalized.includes(blockText);
  });
}

function blockContainsQuote(block, quote) {
  const blockText = normalizeForQuote(block?.text || '');
  const normalized = normalizeForQuote(quote);
  return Boolean(blockText && normalized && (blockText.includes(normalized) || normalized.includes(blockText)));
}

function countSourceItems(parsed) {
  const steps = Array.isArray(parsed?.steps) ? parsed.steps.length : 0;
  const safety = Array.isArray(parsed?.safety) ? parsed.safety.length : 0;
  const translated = Array.isArray(parsed?.translatedPages)
    ? parsed.translatedPages.reduce((sum, page) => sum + (Array.isArray(page?.blocks) ? page.blocks.length : 0), 0)
    : 0;
  return steps + safety + translated;
}

function setOpenAiDebug(debug, patch) {
  if (!debug) return;
  Object.assign(debug, patch);
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

async function readOpenAiErrorText(res) {
  try {
    if (typeof res.text === 'function') return await res.text();
    if (typeof res.json === 'function') return JSON.stringify(await res.json());
  } catch {
    return '';
  }
  return '';
}

function classifyOpenAiError(status, errorText) {
  const text = normalizeText(errorText);
  if (status === 401 || status === 403 || text.includes('invalid_api_key') || text.includes('incorrect api key')) {
    return 'openai_auth_failed';
  }
  if (status === 429 || text.includes('insufficient_quota') || text.includes('billing') || text.includes('quota')) {
    return 'openai_quota_or_billing';
  }
  if (status === 404 || text.includes('model_not_found') || (text.includes('model') && (text.includes('not found') || text.includes('not available')))) {
    return 'openai_model_not_available';
  }
  if (text.includes('invalid json') || text.includes('schema')) return 'openai_response_invalid';
  return 'openai_unknown_error';
}

function safeOpenAiErrorMessage(value) {
  const raw = value instanceof Error ? value.message : String(value || '');
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/(api key provided:\s*)[^"'\s.]+/gi, '$1***')
    .replace(/(incorrect api key provided:\s*)[^"'\s.]+/gi, '$1***')
    .replace(/[A-Za-z0-9_-]{16,}/g, '***')
    .slice(0, 500);
}

function openAiTimeoutSignal(config) {
  const ms = Number(config?.openaiTimeoutMs || 120000);
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

function openAiTimeoutForDeadline(config, deadlineAt = 0, reserveMs = 3000) {
  const configured = Number(config?.openaiTimeoutMs || 120000);
  const remaining = remainingMs(deadlineAt);
  if (!remaining) return configured;
  return Math.max(0, Math.min(configured, remaining - reserveMs));
}

function remainingMs(deadlineAt = 0) {
  const deadline = Number(deadlineAt || 0);
  return deadline > 0 ? Math.max(0, deadline - Date.now()) : 0;
}

function isAbortError(error) {
  const text = String(error?.name || error?.message || error || '').toLowerCase();
  return text.includes('abort') || text.includes('timeout') || text.includes('timed out');
}

function normalizeForQuote(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
