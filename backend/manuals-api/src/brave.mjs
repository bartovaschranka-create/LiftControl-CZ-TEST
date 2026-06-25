import { emptyResponse } from './validation.mjs';

const BRAVE_WEB_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export function buildManualQueries({ maker, model }) {
  if (maker === 'Genie') {
    return [
      { type: 'service', q: `site:genielift.com OR site:manuals.genielift.com ${model} service manual filetype:pdf` },
      { type: 'parts', q: `site:genielift.com OR site:manuals.genielift.com ${model} parts manual filetype:pdf` },
      { type: 'operator', q: `site:genielift.com OR site:manuals.genielift.com ${model} operator manual filetype:pdf` }
    ];
  }
  return [
    { type: 'service', q: `site:jlg.com ${model} service maintenance manual filetype:pdf` },
    { type: 'parts', q: `site:jlg.com ${model} parts manual filetype:pdf` },
    { type: 'operator', q: `site:jlg.com ${model} operator manual filetype:pdf` }
  ];
}

export async function searchManualCandidates(request, config, deps = {}) {
  if (!config.braveApiKey) {
    const err = new Error('Chybí BRAVE_SEARCH_API_KEY.');
    err.code = 'missing_brave_key';
    throw err;
  }
  const fetchImpl = deps.fetch || fetch;
  const queries = buildManualQueries(request);
  const results = [];

  for (const query of queries) {
    const url = new URL(BRAVE_WEB_ENDPOINT);
    url.searchParams.set('q', query.q);
    url.searchParams.set('count', String(Math.min(config.maxSearchResults, 10)));
    url.searchParams.set('search_lang', 'en');
    url.searchParams.set('safesearch', 'strict');
    url.searchParams.set('extra_snippets', 'true');

    const res = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': config.braveApiKey
      }
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Brave Search API klíč je neplatný nebo nemá oprávnění.');
      err.code = 'brave_auth';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Brave Search API vrátilo chybu ${res.status}.`);
      err.code = 'brave_error';
      throw err;
    }
    const json = await res.json();
    const webResults = json?.web?.results || [];
    for (const item of webResults) {
      results.push({
        title: item.title || '',
        url: item.url || '',
        description: item.description || '',
        snippets: item.extra_snippets || [],
        type: query.type
      });
    }
  }

  return results;
}

export function braveErrorResponse(error, request) {
  if (error?.code === 'missing_brave_key') {
    return emptyResponse('error', request, 'Backend nemá nastavený BRAVE_SEARCH_API_KEY.');
  }
  if (error?.code === 'brave_auth') {
    return emptyResponse('error', request, 'Brave Search API klíč je neplatný nebo nemá oprávnění.');
  }
  if (error?.name === 'AbortError' || error?.code === 'brave_timeout') {
    return emptyResponse('error', request, 'Brave Search API neodpovědělo v časovém limitu.');
  }
  return emptyResponse('error', request, 'Vyhledání manuálu se nepodařilo.');
}
