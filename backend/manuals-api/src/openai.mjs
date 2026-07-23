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
  const sourceText = sourcePages.map(p => `PAGE ${p.page}\n${p.text}`).join('\n\n---\n\n');
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
      chapter: page.chapter || ''
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
  const validated = await validateAiOutput(parsed, sourcePages, request, { config, deps });
  const acceptedCount = validated.steps.length + validated.safety.length;
  const evidence = classifyProcedureEvidence(sourcePages, request.task);
  setOpenAiDebug(openaiDebug, {
    acceptedSteps: acceptedCount,
    validationRejectedSteps: Math.max(0, rawItemCount - acceptedCount)
  });
  if (!acceptedCount && rawItemCount > 0) {
    setOpenAiDebug(openaiDebug, {
      errorCode: 'openai_validation_rejected',
      errorMessage: 'OpenAI returned source items, but source validation rejected them.'
    });
    return buildOpenAiFallbackResult({ request, candidate, finalUrl, pages: sourcePages, fit, openaiDebug, parsed });
  }
  const sources = uniqueSources([...(fit.sources || []), ...validated.sources, ...evidenceSources(sourcePages)]);
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
    message: validated.steps.length ? (validated.message || 'Postup nalezen v originalnim manualu.') : evidence.message,
    variants: []
  };
}

function limitOpenAiPages(pages, config = {}) {
  const maxPages = Math.max(1, Number(config.openaiMaxPages || 4));
  const maxChars = Math.max(2000, Number(config.openaiMaxChars || 9000));
  const out = [];
  let usedChars = 0;
  for (const page of rankPagesForOpenAi(pages).slice(0, maxPages)) {
    const prefix = `PAGE ${page?.page || ''}\n`;
    const separator = out.length ? '\n\n---\n\n' : '';
    const overhead = prefix.length + separator.length;
    const remaining = maxChars - usedChars - overhead;
    if (remaining <= 0) break;
    const text = String(page?.text || '').slice(0, remaining);
    if (!text.trim()) continue;
    out.push({ ...page, text });
    usedChars += overhead + text.length;
  }
  return out;
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
  const pageMap = new Map(pages.map(p => [Number(p.page), p.text || '']));
  const terms = taskTerms(request.task || '').map(normalizeText).filter(x => x.length >= 3);
  const validSteps = await validateItems(parsed.steps, pageMap, terms, 'step', request, options);
  const validSafety = await validateItems(parsed.safety, pageMap, terms, 'safety', request, options);
  const sources = [...validSteps, ...validSafety].map(item => ({ page: item.page, quote: item.sourceQuote }));
  return {
    steps: validSteps,
    safety: validSafety,
    sources,
    serialRange: typeof parsed.serialRange === 'string' ? parsed.serialRange : '',
    message: typeof parsed.message === 'string' ? parsed.message : ''
  };
}

async function validateItems(items, pageMap, terms, kind, request, options) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.text && item?.sourceQuote && Number.isInteger(Number(item.page)))
    .map(item => ({
      text: String(item.text).trim(),
      sourceQuote: String(item.sourceQuote).replace(/\s+/g, ' ').trim(),
      page: Number(item.page)
    }))
    .filter(item => item.text && quoteIsSpecific(item.sourceQuote))
    .filter(item => pageMap.has(item.page))
    .filter(item => pageContainsQuote(pageMap.get(item.page), item.sourceQuote))
    .filter(item => quoteMatchesPurpose(item.sourceQuote, terms, kind));
}

function quoteIsSpecific(quote) {
  const words = quote.split(/\s+/).filter(Boolean);
  return quote.length >= 24 && words.length >= 4 && !/^(warning|caution|note|danger)$/i.test(quote);
}

function pageContainsQuote(pageText, quote) {
  return normalizeForQuote(pageText).includes(normalizeForQuote(quote));
}

function quoteMatchesPurpose(quote, terms, kind) {
  const q = normalizeText(quote);
  if (kind === 'safety') {
    return /\b(warning|caution|danger|injury|death|hazard|disconnect|support|lockout|ppe|fall|crush|electric|battery|hydraulic)\b/.test(q);
  }
  if (!terms.length) return true;
  return terms.some(term => q.includes(term));
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
