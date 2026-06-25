import { taskTerms } from './manual-text.mjs';

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps', 'safety', 'serialRange', 'message'],
  properties: {
    steps: {
      type: 'array',
      items: sourceItemSchema()
    },
    safety: {
      type: 'array',
      items: sourceItemSchema()
    },
    serialRange: { type: 'string' },
    message: { type: 'string' }
  }
};

export async function structureWithOpenAI({ request, candidate, finalUrl, pages, config, deps = {}, fit = {} }) {
  if (!config.openaiApiKey) return null;
  const fetchImpl = deps.fetch || fetch;
  const sourceText = pages.map(p => `PAGE ${p.page}\n${p.text.slice(0, 5000)}`).join('\n\n---\n\n');
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: 'system',
          content: [
            'Return only structured JSON matching the schema.',
            'Do not invent service procedures, safety warnings, serial ranges, page numbers, or sources.',
            'Every step and safety warning must be a Czech translation or tight paraphrase of its exact English sourceQuote from the stated page.',
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
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'manual_procedure_result',
          strict: true,
          schema: RESULT_SCHEMA
        }
      }
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = extractResponseText(data);
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const validated = validateAiOutput(parsed, pages, request);
  const sources = uniqueSources([...(fit.sources || []), ...validated.sources]);
  return {
    status: validated.steps.length ? (fit.status === 'ok' ? 'ok' : 'warn') : 'not_found',
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
    message: validated.message || (validated.steps.length ? 'Postup nalezen v originalnim manualu.' : 'Postup nebyl v overenem textu manualu dolozen.'),
    variants: []
  };
}

export function validateAiOutput(parsed, pages, request = {}) {
  const pageMap = new Map(pages.map(p => [Number(p.page), p.text || '']));
  const terms = taskTerms(request.task || '').map(normalizeText).filter(x => x.length >= 3);
  const validSteps = validateItems(parsed.steps, pageMap, terms, 'step');
  const validSafety = validateItems(parsed.safety, pageMap, terms, 'safety');
  const sources = [...validSteps, ...validSafety].map(item => ({ page: item.page, quote: item.sourceQuote }));
  return {
    steps: validSteps,
    safety: validSafety,
    sources,
    serialRange: typeof parsed.serialRange === 'string' ? parsed.serialRange : '',
    message: typeof parsed.message === 'string' ? parsed.message : ''
  };
}

function validateItems(items, pageMap, terms, kind) {
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

function normalizeForQuote(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
