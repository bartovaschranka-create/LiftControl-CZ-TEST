import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createManualsHandler } from '../src/handler.mjs';
import { validateOfficialUrl } from '../src/official-domains.mjs';
import { validateManualRequest } from '../src/validation.mjs';

test('valid JLG request returns a JSON result from official PDF candidate', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', serial: 'x', task: 'diagnostika závady' }, { fetch: jlgFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'warn');
  assert.equal(res.json.maker, 'JLG');
  assert.equal(res.json.manualType, 'service');
  assert.match(res.json.originalUrl, /^https:\/\/www\.jlg\.com/);
});

test('valid Genie request accepts official Genie manuals domain', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', serial: 'GS30D', task: 'kontrola nabíječe' }, { fetch: genieFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.maker, 'Genie');
  assert.equal(res.json.manualType, 'service');
  assert.match(res.json.originalUrl, /^https:\/\/manuals\.genielift\.com/);
});

test('unsupported maker is rejected', async () => {
  const validation = validateManualRequest({ maker: 'Haulotte', model: 'X', task: 'test' });
  assert.equal(validation.ok, false);
});

test('missing model is rejected', async () => {
  const res = await callApi({ maker: 'JLG', task: 'diagnostika' });
  assert.equal(res.statusCode, 400);
});

test('missing task is rejected', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930' });
  assert.equal(res.statusCode, 400);
});

test('bad Brave API key returns safe error without leaking secrets', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { fetch: async () => responseJson({}, 401) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'error');
  assert.doesNotMatch(JSON.stringify(res.json), /test-key/);
});

test('Brave timeout returns safe error', async () => {
  const err = new Error('timeout');
  err.name = 'AbortError';
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { fetch: async () => { throw err; } });
  assert.equal(res.json.status, 'error');
});

test('manual not found returns not_found', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { fetch: async () => responseJson({ web: { results: [] } }) });
  assert.equal(res.json.status, 'not_found');
});

test('ambiguous manual returns variants and no invented steps', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'unknown procedure' }, { fetch: jlgFetch('unrelated manual text') });
  assert.equal(res.json.status, 'not_found');
  assert.equal(Array.isArray(res.json.variants), true);
  assert.deepEqual(res.json.steps, []);
});

test('non-official domain is rejected by ranking', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { fetch: async () => responseJson({ web: { results: [{ title: 'JLG manual', url: 'https://example.com/jlg.pdf' }] } }) });
  assert.equal(res.json.status, 'not_found');
});

test('fake subdomains are rejected', () => {
  assert.equal(validateOfficialUrl('https://jlg.com.example.com/manual.pdf', 'JLG').ok, false);
  assert.equal(validateOfficialUrl('https://manuals.genielift.com.evil.example/manual.pdf', 'Genie').ok, false);
});

test('CORS allows configured production origin', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { method: 'OPTIONS', origin: 'https://bartovaschranka-create.github.io' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://bartovaschranka-create.github.io');
});

test('CORS rejects forbidden origin', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(res.statusCode, 403);
});

test('result JSON keeps required shape', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', task: 'kontrola nabíječe' }, { fetch: genieFetch() });
  for (const key of ['status','maker','model','serial','manualTitle','manualType','serialRange','originalUrl','steps','safety','message','variants']) {
    assert.ok(Object.hasOwn(res.json, key), key);
  }
});

test('PDF without text layer returns not_found and empty steps', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { fetch: jlgFetch('%PDF-1.7\n%%EOF') });
  assert.equal(res.json.status, 'not_found');
  assert.deepEqual(res.json.steps, []);
});

test('relevant procedure not found returns not_found', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', task: 'kalibrace úhlového senzoru' }, { fetch: genieFetch(fakePdf('battery charger only')) });
  assert.equal(res.json.status, 'not_found');
});

async function callApi(body, options = {}) {
  const req = Readable.from(options.rawBody ? [options.rawBody] : [JSON.stringify(body || {})]);
  req.method = options.method || 'POST';
  req.headers = { origin: options.origin || 'https://bartovaschranka-create.github.io', 'content-type': 'application/json' };
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(chunk = '') { this.body += chunk; }
  };
  const handler = createManualsHandler({
    env: {
      BRAVE_SEARCH_API_KEY: 'test-key',
      ALLOWED_ORIGINS: 'https://bartovaschranka-create.github.io'
    },
    fetch: options.fetch || jlgFetch()
  });
  await handler(req, res);
  try {
    res.json = res.body ? JSON.parse(res.body) : null;
  } catch {
    res.json = null;
  }
  return res;
}

function jlgFetch(pdfText = fakePdf('diagnostic troubleshooting fault code')) {
  return async url => {
    const u = String(url);
    if (u.includes('api.search.brave.com')) {
      return responseJson({ web: { results: [{ title: 'JLG 450AJ Service Maintenance Manual PDF', url: 'https://www.jlg.com/manuals/450aj-service.pdf', description: 'service maintenance manual' }] } });
    }
    return responseBuffer(Buffer.from(pdfText, 'latin1'), 200, { 'content-type': 'application/pdf' });
  };
}

function genieFetch(pdfText = fakePdf('battery charger charging manual')) {
  return async url => {
    const u = String(url);
    if (u.includes('api.search.brave.com')) {
      return responseJson({ web: { results: [{ title: 'Genie GS-1930 Service Manual PDF', url: 'https://manuals.genielift.com/Parts%20And%20Service%20Manuals/gs1930-service.pdf', description: 'service manual' }] } });
    }
    return responseBuffer(Buffer.from(pdfText, 'latin1'), 200, { 'content-type': 'application/pdf' });
  };
}

function fakePdf(text) {
  return `%PDF-1.7\n1 0 obj\n<< /Length 80 >>\nstream\nBT (${text}) Tj ET\nendstream\nendobj\n%%EOF`;
}

function responseJson(json, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    async json() { return json; }
  };
}

function responseBuffer(buffer, status = 200, headers = {}) {
  const map = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => map.get(String(key).toLowerCase()) || map.get(key) || '' },
    async arrayBuffer() { return buffer; }
  };
}
