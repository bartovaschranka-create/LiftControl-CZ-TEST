import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isServiceTask, isPartsTask } from './manual-text.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INDEX = join(MODULE_DIR, '..', 'manuals', 'jlg', 'index.json');

export async function searchLocalManualCandidates(request, config = {}, deps = {}) {
  if (String(request?.maker || '').toLowerCase() !== 'jlg') return [];
  const indexPath = config.localManualsIndex || DEFAULT_INDEX;
  let index;
  try {
    const text = await (deps.readFile || readFile)(indexPath, 'utf8');
    index = JSON.parse(text);
  } catch {
    return [];
  }
  const manuals = Array.isArray(index?.manuals) ? index.manuals : [];
  return manuals
    .filter(manual => manual.url || manual.storagePath || config.localManualsRoot)
    .map(manual => localCandidateScore(manual, request, config))
    .filter(item => item.confidence >= 0.35)
    .sort((a, b) => {
      const byConfidence = b.confidence - a.confidence;
      if (byConfidence) return byConfidence;
      return manualTypePriority(b.type) - manualTypePriority(a.type);
    });
}

function localCandidateScore(manual, request, config = {}) {
  const model = normalizeModel(request?.model);
  const modelEntries = [...(manual.models || []), ...(manual.aliases || [])]
    .map(value => ({ raw: value, normalized: normalizeModel(value) }))
    .filter(item => item.normalized);
  const aliases = new Set(modelEntries.map(item => item.normalized));
  const matchedEntry = modelEntries.find(item => item.normalized === model);
  let score = 0.15;
  if (matchedEntry) score += 0.7;
  else if ([...aliases].some(alias => alias && model && alias.includes(model) && alias.length <= model.length + 2)) score += 0.12;
  if (isServiceTask(request?.task) && manual.type === 'service') score += 0.35;
  if (isPartsTask(request?.task) && manual.type === 'parts') score += 0.35;
  if (!isPartsTask(request?.task) && manual.type === 'parts') score -= 0.2;
  if (manual.source === 'local') score += 0.1;
  const pvcNumber = Number(String(manual.pvc || '').replace(/\D/g, ''));
  if (Number.isFinite(pvcNumber) && pvcNumber > 0) score += Math.min(pvcNumber / 100000, 0.05);

  return {
    title: manual.title || manual.file || '',
    url: manual.url || buildFirebaseManualUrl(manual.storagePath, config) || `local-manual://${encodeURIComponent(manual.file || '')}`,
    description: manual.description || 'Local JLG manual catalog',
    snippets: manual.pvc ? [`PVC ${manual.pvc}`] : [],
    type: manual.type || 'service',
    maker: 'JLG',
    source: 'local',
    sourceType: 'firebase_catalog',
    localPath: manual.path || manual.file,
    fileName: manual.file || '',
    models: manual.models || [],
    aliases: manual.aliases || [],
    matchedModel: matchedEntry?.raw || '',
    modelMatch: matchedEntry ? 'exact' : 'none',
    serialRange: manual.serialRange || '',
    selectionReason: matchedEntry
      ? `Přesná shoda modelu v JLG katalogu: ${matchedEntry.raw}.`
      : 'Model nebyl přesně potvrzen JLG katalogem.',
    pvc: manual.pvc || '',
    storagePath: manual.storagePath || '',
    confidence: Math.max(0, Math.min(score, 0.99))
  };
}

function buildFirebaseManualUrl(storagePath, config = {}) {
  if (!storagePath) return '';
  const base = String(config.firebaseManualsUrlBase || '').trim();
  if (base) return `${base.replace(/\/+$/, '')}/${encodeURIComponent(storagePath)}`;
  const bucket = String(config.firebaseStorageBucket || '').trim();
  if (!bucket) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

function normalizeModel(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/^JLG\s+/, '')
    .replace(/\bPLUS\b/g, '+')
    .replace(/[-_\s]+/g, '')
    .replace(/RT$/g, '')
    .trim();
}

function manualTypePriority(type) {
  if (type === 'service') return 3;
  if (type === 'parts') return 2;
  if (type === 'operator') return 1;
  return 0;
}
