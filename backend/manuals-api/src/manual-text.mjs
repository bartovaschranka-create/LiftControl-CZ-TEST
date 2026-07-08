const TASK_MAP = [
  ['kalibrace uhloveho senzoru', [
    'angle sensor',
    'angle sensor calibration',
    'calibrate angle sensor',
    'angle sensor adjustment',
    'angle sensor zero',
    'platform angle sensor',
    'boom angle sensor',
    'level sensor',
    'tilt sensor',
    'calibration',
    'calibration procedure',
    'machine calibration',
    'function calibration',
    'service calibration',
    'controller calibration',
    'ECM calibration'
  ]],
  ['nastaveni naklonoveho cidla', ['tilt sensor', 'tilt alarm', 'tilt calibration', 'level sensor', 'angle sensor']],
  ['vymena hydraulickeho filtru', ['hydraulic filter', 'filter replacement', 'replace filter']],
  ['kontrola nouzoveho spousteni', ['emergency lowering', 'emergency descent', 'manual lowering']],
  ['kontrola nabijece', ['charger', 'battery charger', 'charging']],
  ['diagnostika zavady', ['diagnostic', 'troubleshooting', 'fault code']]
];

const SERVICE_TASK_RE = /\b(kalibrace|calibration|calibrate|sensor|senzor|cidlo|angle sensor|uhlovy senzor|senzor uhlu|cidlo uhlu|serizeni|nastaveni)\b/i;

export function taskTerms(task) {
  const normalized = normalizeText(task);
  const terms = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(x => x.length >= 3));
  for (const [cz, en] of TASK_MAP) {
    if (normalized.includes(cz)) en.forEach(x => terms.add(x));
  }
  if (isServiceCalibrationTask(task)) TASK_MAP[0][1].forEach(x => terms.add(x));
  return [...terms];
}

export function isServiceCalibrationTask(task) {
  return SERVICE_TASK_RE.test(normalizeText(task));
}

export function findRelevantPages(pages, task, options = {}) {
  const terms = taskTerms(task);
  const limit = options.limit || (options.manualType === 'service' && isServiceCalibrationTask(task) ? 12 : 4);
  return pages
    .map(page => ({ ...page, score: scoreText(page.text, terms) }))
    .filter(page => page.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildSourceOnlyResult({ request, candidate, finalUrl, pages, fit = {} }) {
  const base = {
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: fit.serialRange || '',
    originalUrl: finalUrl || candidate.url,
    steps: [],
    safety: [],
    sources: fit.sources || [],
    variants: []
  };
  if (!pages.length) {
    return {
      ...base,
      status: 'not_found',
      message: 'V textu manualu nebyl nalezen dolozitelny postup pro zadany ukon.'
    };
  }
  return {
    ...base,
    status: 'warn',
    message: 'Relevantni text byl v manualu nalezen, ale bez OpenAI nejsou vraceny zadne ceske servisni kroky. Pri rozporu ma vzdy prednost originalni manual vyrobce.',
    variants: [{
      title: candidate.title || '',
      type: candidate.type || '',
      url: finalUrl || candidate.url,
      confidence: Number(candidate.confidence?.toFixed(2) || 0)
    }]
  };
}

function scoreText(text, terms) {
  const hay = normalizeText(text);
  let score = terms.reduce((sum, term) => sum + (hay.includes(normalizeText(term)) ? 1 : 0), 0);
  if (hay.includes('angle') && hay.includes('sensor')) score += 3;
  return score;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
