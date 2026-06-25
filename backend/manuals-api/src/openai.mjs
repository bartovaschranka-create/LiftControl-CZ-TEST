import { taskTerms } from './manual-text.mjs';

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
  const validated = await validateAiOutput(parsed, pages, request, { config, deps, requireSemanticValidation: true });
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
    message: validated.message || (validated.steps.length ? 'Postup nalezen v originálním manuálu.' : 'Postup nebyl v ověřeném textu manuálu doložen.'),
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
  const structurallyValid = (Array.isArray(items) ? items : [])
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

  const out = [];
  for (const item of structurallyValid) {
    if (await semanticSupportsItem(item, kind, request, options)) out.push(item);
  }
  return out;
}

async function semanticSupportsItem(item, kind, request, options = {}) {
  if (typeof options.semanticValidator === 'function') {
    try {
      return await options.semanticValidator({ item, kind, request });
    } catch {
      return false;
    }
  }
  if (!options.requireSemanticValidation) return true;
  return validateMeaningWithOpenAI({ item, kind, request, config: options.config, deps: options.deps });
}

async function validateMeaningWithOpenAI({ item, kind, request, config, deps = {} }) {
  if (!config?.openaiApiKey) return false;
  const fetchImpl = deps.fetch || fetch;
  let res;
  try {
    res = await fetchImpl('https://api.openai.com/v1/responses', {
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
              'You are a strict source validation gate.',
              'Decide whether the Czech text is only a translation or narrow paraphrase of the exact English quote.',
              'Do not allow added tools, values, safety instructions, steps, or conclusions.',
              'When unsure, return supported false.'
            ].join(' ')
          },
          {
            role: 'user',
            content: JSON.stringify({
              kind,
              task: request.task || '',
              page: item.page,
              czechText: item.text,
              exactSourceQuote: item.sourceQuote
            })
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'manual_source_support_check',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['supported', 'reason'],
              properties: {
                supported: { type: 'boolean' },
                reason: { type: 'string' }
              }
            }
          }
        }
      })
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  try {
    const data = await res.json();
    const parsed = JSON.parse(extractResponseText(data));
    return parsed?.supported === true;
  } catch {
    return false;
  }
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
