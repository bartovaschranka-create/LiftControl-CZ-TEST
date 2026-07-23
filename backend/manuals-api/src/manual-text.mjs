const TASK_MAP = [
  ['kalibrace uhloveho senzoru', [
    'angle sensor', 'angle sensor calibration', 'calibrate angle sensor',
    'angle sensor adjustment', 'angle sensor zero', 'platform angle sensor',
    'boom angle sensor', 'level sensor', 'tilt sensor', 'calibration',
    'calibration procedure', 'machine calibration', 'function calibration',
    'service calibration', 'controller calibration', 'ECM calibration'
  ]],
  ['kalibrace', [
    'calibration', 'calibrate', 'calibration procedure', 'function calibration',
    'machine calibration', 'service calibration', 'controller calibration',
    'ECM calibration', 'sensor calibration', 'adjustment', 'setup',
    'service mode', 'zero point', 'set zero', 'teach', 'learn', 'zero'
  ]],
  ['nastaveni naklonoveho cidla', ['tilt sensor', 'tilt alarm', 'tilt calibration', 'level sensor', 'angle sensor']],
  ['vymena hydraulickeho filtru', [
    'hydraulic filter', 'hydraulic oil filter', 'return filter', 'filter element',
    'filter replacement', 'replace filter', 'changing the filter',
    'hydraulic system maintenance', 'maintenance schedule', 'scheduled maintenance',
    'maintenance procedure'
  ]],
  ['kontrola nouzoveho spousteni', ['emergency lowering', 'emergency descent', 'manual lowering']],
  ['kontrola nabijece', ['charger', 'battery charger', 'charging']],
  ['diagnostika zavady', ['diagnostic', 'troubleshooting', 'fault code']]
];

const SERVICE_TASK_RE = /\b(kalibrace|calibration|calibrate|sensor|senzor|cidlo|uhlovy|angle|tilt|level|serizeni|nastaveni|adjustment|diagnostika|diagnostic|troubleshooting|fault|hydraulic|filter|filtr|udrzba|maintenance|vymena|replace|replacement|oprava|repair|mereni|measurement|measure|test)\b/i;
const PARTS_TASK_RE = /\b(part number|parts|nahradni dil|nahradni dily|cislo dilu|objednat dil)\b/i;

export function taskTerms(task) {
  const { normalizedTask, detectedIntent } = getTaskIntent(task);
  const terms = new Set(normalizedTask.split(/[^\p{L}\p{N}]+/u).filter(x => x.length >= 3));
  if (detectedIntent === 'angle_sensor_calibration') {
    TASK_MAP[0][1].forEach(x => terms.add(x));
    TASK_MAP[1][1].forEach(x => terms.add(x));
  } else if (detectedIntent === 'calibration') {
    TASK_MAP[1][1].forEach(x => terms.add(x));
  } else if (detectedIntent === 'hydraulic_filter') {
    TASK_MAP[3][1].forEach(x => terms.add(x));
  } else {
    for (const [cz, en] of TASK_MAP) {
      if (normalizedTask.includes(cz)) en.forEach(x => terms.add(x));
    }
  }
  return [...terms];
}

export function getTaskIntent(task) {
  const normalizedTask = normalizeText(task);
  let detectedIntent = 'general';
  if (isHydraulicFilterTask(task)) {
    detectedIntent = 'hydraulic_filter';
  } else if (isAngleSensorCalibrationTask(task)) {
    detectedIntent = 'angle_sensor_calibration';
  } else if (isCalibrationTask(task)) {
    detectedIntent = 'calibration';
  }
  return {
    normalizedTask,
    detectedIntent,
    taskTerms: []
  };
}

export function isServiceTask(task) {
  return SERVICE_TASK_RE.test(normalizeText(task)) && !PARTS_TASK_RE.test(normalizeText(task));
}

export function isPartsTask(task) {
  return PARTS_TASK_RE.test(normalizeText(task));
}

export function isCalibrationTask(task) {
  return /\b(kalibrace|calibration|calibrate)\b/i.test(normalizeText(task));
}

export function isHydraulicFilterTask(task) {
  const text = normalizeText(task);
  return /\b(hydraulic|hydraulick\w*|filter\w*|filtr\w*)\b/i.test(text) && (text.includes('filter') || text.includes('filtr'));
}

export function isAngleSensorCalibrationTask(task) {
  const text = normalizeText(task);
  const hasSensor = /\b(angle|uhlov\w*|tilt|level|senzor\w*|cidl\w*|cidlo|sensor)\b/.test(text);
  const hasCalibration = /\b(kalibrace|calibration|calibrate|serizeni|nastaveni|adjustment|zero)\b/.test(text);
  return hasSensor && hasCalibration;
}

export function taskIntentDebug(task) {
  const intent = getTaskIntent(task);
  return {
    ...intent,
    taskTerms: taskTerms(task)
  };
}

export function findRelevantPages(pages, task, options = {}) {
  const terms = taskTerms(task);
  const limit = options.limit || relevantPageLimit(task, options.manualType);
  return pages
    .map(page => ({ ...page, score: scoreText(searchablePageText(page), terms, task) }))
    .filter(page => page.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function classifyProcedureEvidence(pages, task = '') {
  const usablePages = Array.isArray(pages) ? pages.filter(page => page?.text) : [];
  if (!usablePages.length) {
    return {
      status: 'not_found',
      message: 'V textu manualu nebyl nalezen dolozitelny postup pro zadany ukon.'
    };
  }
  const combined = normalizeText(usablePages.map(page => page.text).join('\n'));
  const referenceOnly = looksLikeReferenceOnly(combined);
  const hasProcedureSignal = hasProcedureText(combined, task);
  if (referenceOnly && !hasProcedureSignal) {
    return {
      status: 'reference_found',
      message: 'V manualu byla nalezena pouze zminka nebo odkaz na hledany ukon, ne pouzitelny servisni postup.'
    };
  }
  if (hasProcedureSignal) {
    return {
      status: 'partial_procedure_found',
      message: 'Byla nalezena relevantni cast postupu. Pred provedenim prace overte uplny postup v originalnim manualu.'
    };
  }
  return {
    status: 'reference_found',
    message: 'V manualu byla nalezena relevantni stranka, ale automaticky nebyl potvrzen kompletni pracovni postup.'
  };
}

function relevantPageLimit(task, manualType) {
  if (manualType !== 'service') return 6;
  if (isAngleSensorCalibrationTask(task)) return 12;
  if (isCalibrationTask(task)) return 8;
  if (isHydraulicFilterTask(task)) return 8;
  return 10;
}

export function buildSourceOnlyResult({ request, candidate, finalUrl, pages, fit = {}, openaiDebug = null }) {
  const evidence = classifyProcedureEvidence(pages, request.task);
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
    sources: uniqueSources([...(fit.sources || []), ...sourceSnippetsFromPages(pages)]),
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
    status: evidence.status,
    message: sourceOnlyMessage(openaiDebug, evidence),
    variants: [{
      title: candidate.title || '',
      type: candidate.type || '',
      url: finalUrl || candidate.url,
      confidence: Number(candidate.confidence?.toFixed(2) || 0)
    }]
  };
}

function sourceOnlyMessage(openaiDebug, evidence) {
  if (!openaiDebug?.configured || openaiDebug?.errorCode === 'openai_missing_key') {
    return `${evidence.message} OpenAI API klic neni nastaveny, proto nelze vytvorit ceske servisni kroky.`;
  }
  if (openaiDebug?.errorCode === 'openai_validation_rejected') {
    return evidence.message;
  }
  if (openaiDebug?.requestSent || openaiDebug?.errorCode) {
    return `${evidence.message} OpenAI API je nastavene, ale zpracovani kroku selhalo. Viz debug.openai.`;
  }
  return evidence.message;
}

function scoreText(text, terms, task) {
  const hay = normalizeText(text);
  let score = terms.reduce((sum, term) => sum + (hay.includes(normalizeText(term)) ? 1 : 0), 0);
  if (isHydraulicFilterTask(task)) {
    if (hay.includes('hydraulic') && hay.includes('filter')) score += 4;
    if (hay.includes('filter') && /\b(replace|replacement|element|changing|change)\b/.test(hay)) score += 3;
  }
  if (isAngleSensorCalibrationTask(task) || /angle|tilt|level|sensor|senzor|cidlo/.test(normalizeText(task))) {
    if (hay.includes('angle') && hay.includes('sensor')) score += 4;
    if (hay.includes('sensor') && hay.includes('calibration')) score += 3;
    if (hay.includes('tilt') && hay.includes('sensor')) score += 3;
    if (hay.includes('level') && hay.includes('sensor')) score += 3;
  }
  if (isCalibrationTask(task) && /\b(calibration|calibrate|adjustment|zero)\b/.test(hay)) score += 2;
  return score;
}

function searchablePageText(page) {
  if (typeof page === 'string') return page;
  const keywords = Array.isArray(page?.keywords) ? page.keywords.join(' ') : '';
  return [
    page?.title || '',
    page?.chapter || '',
    keywords,
    page?.text || ''
  ].filter(Boolean).join('\n');
}

function looksLikeReferenceOnly(text) {
  const hasReferenceWords = /\b(contents|table of contents|index|list of figures|page\s+\d+|section\s+\d+)\b/.test(text);
  const hasActionWords = /\b(remove|install|adjust|calibrate|connect|disconnect|press|hold|select|set|check|verify|perform|measure|test)\b/.test(text);
  return hasReferenceWords && !hasActionWords;
}

function hasProcedureText(text, task = '') {
  const taskText = normalizeText(task);
  const procedureWords = /\b(procedure|calibration|calibrate|adjustment|setup|service mode|analyzer|select|press|hold|set|zero|teach|learn|verify|check|test|measure|remove|install|disconnect|connect|warning|caution|note)\b/.test(text);
  const numberedSteps = /(^|\n|\s)(\d+[\.)]\s+|step\s+\d+)/.test(text);
  const taskSpecific = (isAngleSensorCalibrationTask(taskText) || /tilt|angle|level|sensor|cidlo|senzor/.test(taskText))
    && /\b(tilt|angle|level|sensor|calibration|calibrate|adjustment|zero)\b/.test(text);
  return procedureWords || numberedSteps || taskSpecific;
}

function sourceSnippetsFromPages(pages) {
  return (pages || [])
    .slice(0, 4)
    .map(page => ({ page: page.page, quote: firstUsefulQuote(page.text) }))
    .filter(source => source.page && source.quote);
}

function firstUsefulQuote(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/(?:[^.!?]*\b(?:calibration|calibrate|tilt|angle|level|sensor|procedure|adjustment|service mode|warning|caution)\b[^.!?]*[.!?]?)/i);
  return (match?.[0] || cleaned).trim().slice(0, 300);
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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
