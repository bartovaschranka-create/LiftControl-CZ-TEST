export const SUPPORTED_MAKERS = ['JLG', 'Genie'];

export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeMaker(value) {
  const v = normalizeText(value).toLowerCase();
  if (v === 'jlg') return 'JLG';
  if (v === 'genie') return 'Genie';
  return '';
}

export function validateManualRequest(body) {
  const maker = normalizeMaker(body?.maker);
  const model = normalizeText(body?.model);
  const serial = normalizeText(body?.serial);
  const task = normalizeText(body?.task);
  const errors = [];

  if (!maker) errors.push('Podporovaní výrobci jsou pouze JLG nebo Genie.');
  if (!model) errors.push('Chybí typ/model stroje.');
  if (!task) errors.push('Chybí požadovaný úkon nebo dotaz.');
  if (model.length > 80) errors.push('Model je příliš dlouhý.');
  if (serial.length > 80) errors.push('Výrobní číslo je příliš dlouhé.');
  if (task.length > 200) errors.push('Dotaz je příliš dlouhý.');

  return {
    ok: errors.length === 0,
    errors,
    value: { maker, model, serial, task }
  };
}

export function emptyResponse(status, request, message, variants = []) {
  return {
    status,
    maker: request?.maker || '',
    model: request?.model || '',
    serial: request?.serial || '',
    manualTitle: '',
    manualType: '',
    serialRange: '',
    originalUrl: variants[0]?.url || '',
    steps: [],
    safety: [],
    message,
    variants
  };
}
