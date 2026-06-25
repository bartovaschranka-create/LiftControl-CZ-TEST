import net from 'node:net';

const OFFICIAL_ROOTS = {
  Genie: ['genielift.com', 'manuals.genielift.com'],
  JLG: ['jlg.com']
};

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);

export function allowedRootsForMaker(maker) {
  return OFFICIAL_ROOTS[maker] || [];
}

export function validateOfficialUrl(rawUrl, maker) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Neplatná URL.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Povoleno je pouze HTTPS.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || BLOCKED_HOSTS.has(host) || net.isIP(host)) {
    return { ok: false, reason: 'Interní nebo IP adresa není povolena.' };
  }
  const allowed = allowedRootsForMaker(maker).some(root => host === root || host.endsWith(`.${root}`));
  if (!allowed) return { ok: false, reason: 'Doména není oficiální zdroj výrobce.' };
  return { ok: true, url, hostname: host };
}

export function isOfficialUrl(rawUrl, maker) {
  return validateOfficialUrl(rawUrl, maker).ok;
}
