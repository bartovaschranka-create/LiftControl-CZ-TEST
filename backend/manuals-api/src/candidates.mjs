import { isOfficialUrl } from './official-domains.mjs';
import { isPartsTask, isServiceTask } from './manual-text.mjs';

const TYPE_PRIORITY = { service: 3, parts: 2, operator: 1 };
const SERVICE_MANUAL_RE = /service|service and maintenance|maintenance manual|service manual|service repair|parts%20and%20service/i;
const OPERATOR_MANUAL_RE = /operator|operation/i;

export function rankCandidates(rawResults, request) {
  const seen = new Set();
  return rawResults
    .filter(r => r?.localPath || (r?.url && isOfficialUrl(r.url, request.maker)))
    .filter(r => {
      const key = r.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(r => {
      const typed = { ...r, type: inferManualType(r) };
      return { ...typed, confidence: scoreCandidate(typed, request) };
    })
    .filter(r => r.confidence >= 0.25)
    .sort((a, b) => {
      const byServiceIntent = serviceIntentPriority(b, request) - serviceIntentPriority(a, request);
      if (byServiceIntent) return byServiceIntent;
      const byType = (TYPE_PRIORITY[b.type] || 0) - (TYPE_PRIORITY[a.type] || 0);
      if (byType) return byType;
      return b.confidence - a.confidence;
    });
}

export function toVariant(candidate) {
  return {
    title: candidate.title || '',
    type: candidate.type || '',
    url: candidate.url || '',
    source: candidate.source || 'web',
    pvc: candidate.pvc || '',
    storagePath: candidate.storagePath || '',
    confidence: Number(candidate.confidence?.toFixed(2) || 0)
  };
}

function scoreCandidate(candidate, request) {
  const hay = [candidate.title, candidate.url, candidate.description, ...(candidate.snippets || [])].join(' ').toLowerCase();
  if (candidate.source === 'local' && candidate.localPath) return Number(candidate.confidence || 0.5);
  const modelTokens = String(request.model || '').toLowerCase().split(/[\s/-]+/).filter(Boolean);
  const serviceTask = isServiceTask(request.task || '');
  const partsTask = isPartsTask(request.task || '');
  let score = 0.15;
  for (const token of modelTokens) if (token.length >= 2 && hay.includes(token)) score += 0.18;
  if (SERVICE_MANUAL_RE.test(hay)) score += candidate.type === 'service' ? 0.25 : 0.05;
  if (/parts/.test(hay)) score += candidate.type === 'parts' ? 0.2 : 0.04;
  if (OPERATOR_MANUAL_RE.test(hay)) score += candidate.type === 'operator' ? (serviceTask ? 0 : 0.2) : 0.04;
  if (serviceTask) {
    if (candidate.type === 'service') score += 1.2;
    if (candidate.type === 'operator') score -= 0.15;
    if (candidate.type === 'parts' && !partsTask) score -= 0.2;
    if (SERVICE_MANUAL_RE.test(hay)) score += 0.45;
    if (/calibration|calibrate|angle sensor|sensor|adjustment|troubleshooting|diagnostic|replacement|repair|measurement|test/.test(hay)) score += candidate.type === 'service' ? 0.25 : 0.05;
  }
  if (partsTask && candidate.type === 'parts') score += 0.45;
  if (/\.pdf(\?|$)/i.test(candidate.url)) score += 0.1;
  return Math.min(score, 0.98);
}

function serviceIntentPriority(candidate, request) {
  if (!isServiceTask(request.task || '')) return 0;
  if (candidate.type === 'service') return 3;
  if (candidate.type === 'parts') return 1;
  if (candidate.type === 'operator') return -2;
  return 0;
}

function inferManualType(candidate) {
  const hay = [candidate.title, candidate.url, candidate.description, ...(candidate.snippets || [])].join(' ').toLowerCase();
  if (/operator|operation/.test(hay) && !/service (and )?maintenance|service manual|service repair|parts%20and%20service/.test(hay)) return 'operator';
  if (/service (and )?maintenance|service manual|service repair|maintenance manual|parts%20and%20service/.test(hay)) return 'service';
  if (/parts/.test(hay)) return 'parts';
  if (/operator|operation/.test(hay)) return 'operator';
  return candidate.type || '';
}
