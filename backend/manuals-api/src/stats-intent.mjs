import { getConfig } from './config.mjs';
import { applyCors, isOriginAllowed } from './cors.mjs';

const STATS_INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'groupBy', 'metric', 'sort', 'limit', 'status', 'partStatus', 'period', 'title'],
  properties: {
    kind: { type: 'string', enum: ['all', 'protocol', 'revize', 'fault', 'part'] },
    groupBy: { type: 'string', enum: ['machine', 'serial', 'model', 'maker', 'person', 'place', 'faultType', 'partName'] },
    metric: { type: 'string', enum: ['count'] },
    sort: { type: 'string', enum: ['desc', 'asc'] },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    status: { type: 'string', enum: ['all', 'open', 'repaired', 'service', 'waiting_parts'] },
    partStatus: { type: 'string', enum: ['all', 'open', 'ordered', 'sent', 'resolved'] },
    period: { type: 'string', enum: ['7', '30', '90', '365', 'all'] },
    title: { type: 'string' }
  }
};

export function createStatsIntentHandler(deps = {}) {
  return async function statsIntentHandler(req, res) {
    const config = getConfig(process.env);
    applyCors(req, res, config);

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { status: 'error', error: 'method_not_allowed' });
      return;
    }
    if (!isOriginAllowed(req, config)) {
      sendJson(res, 403, { status: 'error', error: 'origin_not_allowed' });
      return;
    }

    let body;
    try {
      body = parseBody(req.body);
    } catch {
      sendJson(res, 400, { status: 'error', error: 'invalid_json' });
      return;
    }

    const question = String(body?.question || '').trim().slice(0, 800);
    if (!question) {
      sendJson(res, 400, { status: 'error', error: 'missing_question' });
      return;
    }

    const localIntent = localStatsIntent(question);
    const aiIntent = await openAiStatsIntent(question, config, deps);
    const intent = normalizeStatsIntent(aiIntent || localIntent, localIntent);

    sendJson(res, 200, {
      status: aiIntent ? 'ok' : 'fallback',
      intent,
      message: aiIntent
        ? 'Dotaz byl preveden na filtr statistik pres API.'
        : 'OpenAI neni dostupne, pouzil se bezpecny lokalni parser.'
    });
  };
}

export function localStatsIntent(question = '') {
  const q = normalize(question);
  const limitMatch = q.match(/\b(\d{1,2})\b/);
  const limit = limitMatch ? clamp(Number(limitMatch[1]), 1, 50) : 10;

  let kind = 'all';
  if (/\b(reviz|zz|rz)/.test(q)) kind = 'revize';
  if (/\b(kontrol|protokol|ctvrtlet|ctvrtletni)/.test(q)) kind = 'protocol';
  if (/\b(poruch|zavad|servis)/.test(q)) kind = 'fault';
  if (/\b(nd|nahradn|dil|dily|objednav)/.test(q)) kind = 'part';

  let groupBy = 'machine';
  if (/\b(vyrobni|serial|cislo)/.test(q)) groupBy = 'serial';
  if (/\b(model|typ)/.test(q)) groupBy = 'model';
  if (/\b(vyrobc|znack)/.test(q)) groupBy = 'maker';
  if (/\b(technik|provedl|kdo|osoba)/.test(q)) groupBy = 'person';
  if (kind === 'fault' && /\b(typ|druh|nejcastejsi|opakovan)/.test(q)) groupBy = 'faultType';
  if (kind === 'part' && /\b(dil|dily|nd|soucast)/.test(q)) groupBy = 'partName';
  if (/\b(pobock|poboc|misto|mist|lokal|provozovn|jazlovic|brno|ostrava|liberec|praha)/.test(q)) groupBy = 'place';
  if (/\b(plosin|stroj|stroje|zarizeni)/.test(q)) groupBy = 'machine';

  let status = 'all';
  if (/\b(otevren|neopraven|aktivn)/.test(q)) status = 'open';
  if (/\b(opraven|hotov|vyresen)/.test(q)) status = 'repaired';
  if (/\b(do servisu|servis)\b/.test(q)) status = 'service';
  if (/\b(ceka na nd|cekaji na nd|bez dilu)\b/.test(q)) status = 'waiting_parts';

  let partStatus = 'all';
  if (/\b(neodeslan|neposlan|ceka na odeslan|ceka na poslani)/.test(q)) partStatus = 'open';
  else if (/\b(odeslan)/.test(q)) partStatus = 'sent';
  if (/\b(objednan)/.test(q)) partStatus = 'ordered';
  if (/\b(dodany|vyresen|uzavren)/.test(q)) partStatus = 'resolved';

  let period = 'all';
  if (/\b(tyden|7 dni|poslednich 7)\b/.test(q)) period = '7';
  if (/\b(mesic|30 dni|poslednich 30)\b/.test(q)) period = '30';
  if (/\b(kvartal|ctvrtlet|90 dni|poslednich 90)\b/.test(q)) period = '90';
  if (/\b(rok|365 dni|letos|poslednich 365)\b/.test(q)) period = '365';

  return {
    kind,
    groupBy,
    metric: 'count',
    sort: 'desc',
    limit,
    status,
    partStatus,
    period,
    title: makeTitle({ kind, groupBy, limit })
  };
}

export function normalizeStatsIntent(intent, fallback = localStatsIntent('')) {
  const safe = intent && typeof intent === 'object' ? intent : {};
  return {
    kind: pickEnum(safe.kind, ['all', 'protocol', 'revize', 'fault', 'part'], fallback.kind),
    groupBy: pickEnum(safe.groupBy, ['machine', 'serial', 'model', 'maker', 'person', 'place', 'faultType', 'partName'], fallback.groupBy),
    metric: 'count',
    sort: pickEnum(safe.sort, ['desc', 'asc'], 'desc'),
    limit: clamp(Number(safe.limit) || fallback.limit || 10, 1, 50),
    status: pickEnum(safe.status, ['all', 'open', 'repaired', 'service', 'waiting_parts'], fallback.status || 'all'),
    partStatus: pickEnum(safe.partStatus, ['all', 'open', 'ordered', 'sent', 'resolved'], fallback.partStatus || 'all'),
    period: pickEnum(String(safe.period || ''), ['7', '30', '90', '365', 'all'], fallback.period || 'all'),
    title: String(safe.title || fallback.title || '').trim().slice(0, 90) || makeTitle(fallback)
  };
}

async function openAiStatsIntent(question, config, deps = {}) {
  if (!config.openaiApiKey) return null;
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
              'Convert a Czech natural-language LiftControl statistics request into a safe filter intent.',
              'Never request or infer raw database contents.',
              'Use only the schema. If unsure, choose conservative defaults.',
              'kind selects record type, groupBy selects aggregation dimension, period is a recent-day window or all.'
            ].join(' ')
          },
          {
            role: 'user',
            content: JSON.stringify({ question })
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'liftcontrol_stats_intent',
            strict: true,
            schema: STATS_INTENT_SCHEMA
          }
        }
      })
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = await res.json();
    const text = extractResponseText(data);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body || '{}');
  return body;
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function makeTitle(intent = {}) {
  const kind = {
    all: 'zaznamu',
    protocol: 'kontrol',
    revize: 'revizi',
    fault: 'poruch',
    part: 'nahradnich dilu'
  }[intent.kind] || 'zaznamu';
  const group = {
    machine: 'podle stroju',
    serial: 'podle vyrobnich cisel',
    model: 'podle modelu',
    maker: 'podle vyrobcu',
    person: 'podle techniku',
    place: 'podle pobocky',
    faultType: 'podle typu zavady',
    partName: 'podle dilu'
  }[intent.groupBy] || 'podle stroju';
  return `Top ${intent.limit || 10} ${kind} ${group}`;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
