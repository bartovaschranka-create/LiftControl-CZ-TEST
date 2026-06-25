const TASK_MAP = [
  ['kalibrace úhlového senzoru', ['angle sensor calibration', 'angle sensor', 'calibration']],
  ['nastavení náklonového čidla', ['tilt sensor', 'tilt alarm', 'tilt calibration', 'level sensor']],
  ['výměna hydraulického filtru', ['hydraulic filter', 'filter replacement', 'replace filter']],
  ['kontrola nouzového spouštění', ['emergency lowering', 'emergency descent', 'manual lowering']],
  ['kontrola nabíječe', ['charger', 'battery charger', 'charging']],
  ['diagnostika závady', ['diagnostic', 'troubleshooting', 'fault code']]
];

export function taskTerms(task) {
  const normalized = String(task || '').toLowerCase();
  const terms = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(x => x.length >= 3));
  for (const [cz, en] of TASK_MAP) {
    if (normalized.includes(cz)) en.forEach(x => terms.add(x));
  }
  return [...terms];
}

export function findRelevantPages(pages, task, limit = 4) {
  const terms = taskTerms(task);
  return pages
    .map(page => ({ ...page, score: scoreText(page.text, terms) }))
    .filter(page => page.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildSourceOnlyResult({ request, candidate, finalUrl, pages }) {
  if (!pages.length) {
    return {
      status: 'not_found',
      maker: request.maker,
      model: request.model,
      serial: request.serial,
      manualTitle: candidate.title || '',
      manualType: candidate.type || '',
      serialRange: '',
      originalUrl: finalUrl || candidate.url,
      steps: [],
      safety: [],
      message: 'V textu manuálu nebyl nalezen doložitelný postup pro zadaný úkon.',
      variants: []
    };
  }
  return {
    status: 'warn',
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: '',
    originalUrl: finalUrl || candidate.url,
    steps: [],
    safety: [],
    message: 'Relevantní text byl v manuálu nalezen, ale bez bezpečného AI strukturování nejsou vráceny žádné kroky. Při rozporu má vždy přednost originální manuál výrobce.',
    variants: [{
      title: candidate.title || '',
      type: candidate.type || '',
      url: finalUrl || candidate.url,
      confidence: Number(candidate.confidence?.toFixed(2) || 0)
    }]
  };
}

function scoreText(text, terms) {
  const hay = String(text || '').toLowerCase();
  return terms.reduce((sum, term) => sum + (hay.includes(term.toLowerCase()) ? 1 : 0), 0);
}
