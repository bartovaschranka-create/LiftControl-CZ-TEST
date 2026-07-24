import { classifyProcedureEvidence, taskTerms } from './manual-text.mjs';

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps', 'safety', 'serialRange', 'message'],
  properties: {
    steps: { type: 'array', items: sourceItemSchema() },
    safety: { type: 'array', items: sourceItemSchema() },
    serialRange: { type: 'string' },
    message: { type: 'string' }
  }
};

export async function structureWithOpenAI({ request, candidate, finalUrl, pages, config, deps = {}, fit = {}, openaiDebug = null }) {
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
        'Return at most 8 concise work steps and at most 5 safety warnings.',
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
  try {
    res = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: openAiTimeoutSignal(config),
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
  const rawItemCount = countSourceItems(parsed);
  const validationDetails = [];
  const validated = await validateAiOutput(parsed, sourcePages, request, { config, deps, validationDetails });
  const acceptedCount = validated.steps.length + validated.safety.length;
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
  const images = imagesForSteps(sourcePages, validated.steps);
  return {
    status: validated.steps.length ? (fit.status === 'ok' ? 'procedure_found' : 'partial_procedure_found') : evidence.status,
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: fit.serialRange || validated.serialRange || '',
    originalUrl: finalUrl || candidate.url,
    steps: validated.steps,
    safety: validated.safety,
    sources,
    images,
    message: validated.steps.length ? (validated.message || 'Postup nalezen v originalnim manualu.') : evidence.message,
    variants: []
  };
}

function imagesForSteps(pages, steps) {
  const stepPages = new Set((steps || []).map(step => Number(step.page)).filter(Boolean));
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
  const maxPages = Math.max(1, Number(config.openaiMaxPages || 4));
  const maxChars = Math.max(2000, Number(config.openaiMaxChars || 12000));
  const out = [];
  let usedChars = 0;
  for (const page of rankPagesForOpenAi(pages).slice(0, maxPages)) {
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

function formatSourcePage(page) {
  const keywords = Array.isArray(page?.keywords) ? page.keywords.join(', ') : '';
  return [
    `PAGE ${page?.page || ''}`,
    page?.title ? `TITLE: ${page.title}` : '',
    page?.chapter ? `CHAPTER: ${page.chapter}` : '',
    keywords ? `KEYWORDS: ${keywords}` : '',
    page?.procedureContinuation ? `PROCEDURE CONTINUATION FROM PAGE: ${page.procedureStartPage || ''}` : '',
    'TEXT:',
    page?.text || ''
  ].filter(line => line !== '').join('\n');
}

function rankPagesForOpenAi(pages) {
  return [...(pages || [])].filter(page => !isOpenAiFrontMatter(page)).sort((a, b) => {
    const scoreA = Number(a?.score || a?.relevanceScore || 0);
    const scoreB = Number(b?.score || b?.relevanceScore || 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return Number(a?.page || 0) - Number(b?.page || 0);
  });
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

function countSourceItems(parsed) {
  const steps = Array.isArray(parsed?.steps) ? parsed.steps.length : 0;
  const safety = Array.isArray(parsed?.safety) ? parsed.safety.length : 0;
  return steps + safety;
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
