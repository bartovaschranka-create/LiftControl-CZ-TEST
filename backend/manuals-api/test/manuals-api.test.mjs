import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createManualsHandler } from '../src/handler.mjs';
import { validateOfficialUrl } from '../src/official-domains.mjs';
import { validateManualRequest } from '../src/validation.mjs';
import { extractPdfTextPages } from '../src/pdf.mjs';
import { validateAiOutput } from '../src/openai.mjs';

test('valid JLG request returns a JSON result from official PDF candidate', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', serial: '0300123456', task: 'diagnostika zavady' }, { fetch: jlgFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'warn');
  assert.equal(res.json.maker, 'JLG');
  assert.equal(res.json.manualType, 'service');
  assert.match(res.json.originalUrl, /^https:\/\/www\.jlg\.com/);
  assert.match(res.json.serialRange, /0300000000 and up/i);
});

test('valid Genie request accepts official Genie manuals domain', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', serial: 'GS3012345', task: 'kontrola nabijece' }, { fetch: genieFetch() });
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
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'unknown procedure' }, { fetch: jlgFetch(fakePdf(['JLG 450AJ service manual serial number 0300000000 and up', 'unrelated manual text'])) });
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
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', task: 'kontrola nabijece' }, { fetch: genieFetch() });
  for (const key of ['status','maker','model','serial','manualTitle','manualType','serialRange','originalUrl','steps','safety','sources','message','variants']) {
    assert.ok(Object.hasOwn(res.json, key), key);
  }
});

test('PDF without text layer returns not_found and empty steps', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', task: 'diagnostika' }, { fetch: jlgFetch(Buffer.from('%PDF-1.7\n%%EOF', 'latin1')) });
  assert.equal(res.json.status, 'not_found');
  assert.deepEqual(res.json.steps, []);
});

test('relevant procedure not found returns not_found', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', task: 'kalibrace uhloveho senzoru' }, { fetch: genieFetch(fakePdf(['GS-1930 service manual serial number GS3000001 and up', 'battery charger only'])) });
  assert.equal(res.json.status, 'not_found');
});

test('page-aware PDF extraction keeps text on the real second page', async () => {
  const pages = await extractPdfTextPages(fakePdf([
    'JLG 450AJ service manual serial number 0300000000 and up',
    'diagnostic troubleshooting fault code procedure'
  ]));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].page, 1);
  assert.equal(pages[1].page, 2);
  assert.match(pages[1].text, /diagnostic troubleshooting/);
  assert.doesNotMatch(pages[0].text, /diagnostic troubleshooting/);
});

test('AI validation rejects invented step with unrelated real quote', () => {
  const pages = [{ page: 2, text: 'Battery charger green light indicates charging is complete.' }];
  const out = validateAiOutput({
    steps: [{ text: 'Proved kalibraci uhloveho senzoru.', sourceQuote: 'Battery charger green light indicates charging is complete.', page: 2 }],
    safety: [],
    serialRange: '',
    message: ''
  }, pages, { task: 'kalibrace uhloveho senzoru' });
  assert.deepEqual(out.steps, []);
});

test('AI validation rejects correct quote with wrong page number', () => {
  const pages = [
    { page: 1, text: 'Title page only.' },
    { page: 2, text: 'Use the analyzer to read diagnostic fault codes.' }
  ];
  const out = validateAiOutput({
    steps: [{ text: 'Nacti diagnosticke chybove kody analyzatorem.', sourceQuote: 'Use the analyzer to read diagnostic fault codes.', page: 1 }],
    safety: [],
    serialRange: '',
    message: ''
  }, pages, { task: 'diagnostika zavady' });
  assert.deepEqual(out.steps, []);
});

test('AI validation rejects step without quote', () => {
  const out = validateAiOutput({
    steps: [{ text: 'Nacti diagnosticke chybove kody analyzatorem.', page: 1 }],
    safety: [],
    serialRange: '',
    message: ''
  }, [{ page: 1, text: 'Use the analyzer to read diagnostic fault codes.' }], { task: 'diagnostika zavady' });
  assert.deepEqual(out.steps, []);
});

test('AI validation rejects safety warning that is not in the manual', () => {
  const out = validateAiOutput({
    steps: [],
    safety: [{ text: 'Odpoj baterii.', sourceQuote: 'Disconnect the battery before servicing the charger.', page: 1 }],
    serialRange: '',
    message: ''
  }, [{ page: 1, text: 'Use the analyzer to read diagnostic fault codes.' }], { task: 'diagnostika zavady' });
  assert.deepEqual(out.safety, []);
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

function jlgFetch(pdf = fakePdf([
  'JLG 450AJ service maintenance manual serial number 0300000000 and up',
  'Diagnostic troubleshooting fault code procedure'
])) {
  return async url => {
    const u = String(url);
    if (u.includes('api.search.brave.com')) {
      return responseJson({ web: { results: [{ title: 'JLG 450AJ Service Maintenance Manual PDF', url: 'https://www.jlg.com/manuals/450aj-service.pdf', description: 'service maintenance manual' }] } });
    }
    return responseBuffer(Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'latin1'), 200, { 'content-type': 'application/pdf' });
  };
}

function genieFetch(pdf = fakePdf([
  'Genie GS-1930 service manual serial number GS3000001 and up',
  'Battery charger charging procedure'
])) {
  return async url => {
    const u = String(url);
    if (u.includes('api.search.brave.com')) {
      return responseJson({ web: { results: [{ title: 'Genie GS-1930 Service Manual PDF', url: 'https://manuals.genielift.com/Parts%20And%20Service%20Manuals/gs1930-service.pdf', description: 'service manual' }] } });
    }
    return responseBuffer(Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'latin1'), 200, { 'content-type': 'application/pdf' });
  };
}

function fakePdf(pageTexts) {
  const pages = Array.isArray(pageTexts) ? pageTexts : [String(pageTexts || '')];
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((text, i) => {
    const pageObj = 3 + i * 2;
    const contentObj = pageObj + 1;
    const stream = `BT /F1 12 Tf 50 760 Td (${escapePdfText(text)}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function escapePdfText(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
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
