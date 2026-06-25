import { isOfficialUrl } from './official-domains.mjs';

const TYPE_PRIORITY = { service: 3, parts: 2, operator: 1 };

export function rankCandidates(rawResults, request) {
  const seen = new Set();
  return rawResults
    .filter(r => r?.url && isOfficialUrl(r.url, request.maker))
    .filter(r => {
      const key = r.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(r => ({ ...r, confidence: scoreCandidate(r, request) }))
    .filter(r => r.confidence >= 0.25)
    .sort((a, b) => {
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
    confidence: Number(candidate.confidence?.toFixed(2) || 0)
  };
}

function scoreCandidate(candidate, request) {
  const hay = [candidate.title, candidate.url, candidate.description, ...(candidate.snippets || [])].join(' ').toLowerCase();
  const modelTokens = String(request.model || '').toLowerCase().split(/[\s/-]+/).filter(Boolean);
  let score = 0.15;
  for (const token of modelTokens) if (token.length >= 2 && hay.includes(token)) score += 0.18;
  if (/service|maintenance/.test(hay)) score += candidate.type === 'service' ? 0.2 : 0.05;
  if (/parts/.test(hay)) score += candidate.type === 'parts' ? 0.2 : 0.04;
  if (/operator|operation/.test(hay)) score += candidate.type === 'operator' ? 0.2 : 0.04;
  if (/\.pdf(\?|$)/i.test(candidate.url)) score += 0.1;
  return Math.min(score, 0.98);
}
