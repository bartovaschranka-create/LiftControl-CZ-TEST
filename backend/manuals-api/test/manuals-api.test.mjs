import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManualsHandler } from '../src/handler.mjs';
import { validateOfficialUrl } from '../src/official-domains.mjs';
import { validateManualRequest } from '../src/validation.mjs';
import { extractPdfTextPages } from '../src/pdf.mjs';
import { validateAiOutput } from '../src/openai.mjs';
import { evaluateManualFit, parseSerialRange, parseSerialValue } from '../src/manual-fit.mjs';
import { buildManualQueries } from '../src/brave.mjs';
import { rankCandidates } from '../src/candidates.mjs';
import { findRelevantPages, taskIntentDebug, taskTerms } from '../src/manual-text.mjs';

test('valid JLG request returns a JSON result from official PDF candidate', async () => {
  const res = await callApi({ maker: 'JLG', model: '450AJ', serial: '0300123456', task: 'diagnostika zavady' }, { fetch: jlgFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'warn');
  assert.equal(res.json.maker, 'JLG');
  assert.equal(res.json.manualType, 'service');
  assert.match(res.json.originalUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
  assert.match(res.json.serialRange, /0300000000 and up/i);
});

test('valid Genie request accepts official Genie manuals domain', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', serial: 'GS3012345', task: 'kontrola nabijece' }, { fetch: genieFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.maker, 'Genie');
  assert.equal(res.json.manualType, 'service');
  assert.match(res.json.originalUrl, /^https:\/\/manuals\.genielift\.com/);
});

test('Genie search queries prioritize manuals.genielift.com and model variants', () => {
  const queries = buildManualQueries({ maker: 'Genie', model: 'GS-1930' });
  assert.ok(queries.some(q => q.type === 'service' && q.q.includes('site:manuals.genielift.com')));
  assert.ok(queries.some(q => q.q.includes('GS-1930')));
  assert.ok(queries.some(q => q.q.includes('GS1930')));
  assert.ok(queries.some(q => q.q.includes('"GS 1930"')));
});

test('generic calibration expands to service calibration terms', () => {
  const terms = taskTerms('kalibrace');
  for (const term of ['calibration', 'calibration procedure', 'function calibration', 'controller calibration', 'ECM calibration']) {
    assert.ok(terms.includes(term), term);
  }
  for (const term of ['hydraulic filter', 'return filter', 'filter element']) {
    assert.equal(terms.includes(term), false, term);
  }
});

test('JLG request can use a local manual catalog without Brave Search', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liftcontrol-local-manuals-'));
  try {
    await writeFile(join(root, '450AJ local.pdf'), fakePdf([
      'JLG 450AJ service maintenance manual serial number 0300000000 and up',
      'Diagnostic troubleshooting fault code procedure'
    ]));
    await writeFile(join(root, 'index.json'), JSON.stringify({
      manuals: [{
        source: 'local',
        type: 'service',
        title: 'JLG 450AJ Local Service Manual',
        file: '450AJ local.pdf',
        path: '450AJ local.pdf',
        models: ['450 AJ', '450AJ'],
        aliases: ['JLG 450AJ']
      }]
    }));
    const res = await callApi(
      { maker: 'JLG', model: '450 AJ', serial: '0300123456', task: 'diagnostika zavady' },
      {
        env: {
          BRAVE_SEARCH_API_KEY: '',
          LOCAL_MANUALS_ROOT: root,
          LOCAL_MANUALS_INDEX: join(root, 'index.json')
        },
        fetch: async () => { throw new Error('Network should not be used for local catalog fallback.'); }
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.maker, 'JLG');
    assert.equal(res.json.manualType, 'service');
    assert.match(res.json.manualTitle, /Local Service Manual/);
    assert.match(res.json.originalUrl, /^local-manual:/);
    assert.equal(res.json.debug.triedCandidates[0].source, 'local');
    assert.equal(res.json.debug.triedCandidates[0].downloaded, true);
    assert.deepEqual(res.json.debug.triedCandidates[0].matchedPages, [2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JLG catalog prefers Firebase URL over local path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liftcontrol-firebase-manuals-'));
  try {
    await writeFile(join(root, 'index.json'), JSON.stringify({
      manuals: [{
        source: 'local',
        type: 'service',
        title: 'JLG 450AJ Firebase Service Manual',
        storagePath: '450AJ pvc2307.pdf',
        path: 'missing-local-file.pdf',
        models: ['450 AJ', '450AJ'],
        aliases: ['JLG 450AJ']
      }]
    }));
    let fetchedUrl = '';
    const res = await callApi(
      { maker: 'JLG', model: '450 AJ', serial: '0300123456', task: 'diagnostika zavady' },
      {
        env: {
          LOCAL_MANUALS_INDEX: join(root, 'index.json'),
          MAX_PDF_BYTES: String(2 * 1024 * 1024)
        },
        fetch: async url => {
          fetchedUrl = String(url);
          return responseBuffer(fakePdf([
            'JLG 450AJ service maintenance manual serial number 0300000000 and up',
            'Diagnostic troubleshooting fault code procedure'
          ]), 200, { 'content-type': 'application/pdf' });
        }
      }
    );
    assert.match(fetchedUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
    assert.match(fetchedUrl, /doctype-test\.firebasestorage\.app/);
    assert.match(fetchedUrl, /450AJ%20pvc2307\.pdf/);
    assert.equal(res.json.manualType, 'service');
    assert.match(res.json.originalUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
    assert.equal(res.json.debug.triedCandidates[0].source, 'local');
    assert.equal(res.json.debug.triedCandidates[0].downloaded, true);
    assert.deepEqual(res.json.debug.triedCandidates[0].matchedPages, [2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JLG 450AJ service task uses Firebase catalog and rejects unrelated 40H Brave result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liftcontrol-jlg-450aj-catalog-'));
  try {
    await writeFile(join(root, 'index.json'), JSON.stringify({
      manuals: [{
        source: 'local',
        type: 'service',
        title: 'JLG 450AJ Service Manual PVC 2307',
        file: '450AJ pvc2307.pdf',
        storagePath: '450AJ pvc2307.pdf',
        models: ['450 AJ', '450AJ'],
        aliases: ['JLG 450AJ'],
        serialRange: 'B300000000 and up',
        pvc: '2307'
      }]
    }));
    const fetched = [];
    const res = await callApi(
      { maker: 'JLG', model: '450 AJ', serial: 'B300015524', task: 'kalibrace naklonoveho cidla' },
      {
        env: {
          LOCAL_MANUALS_INDEX: join(root, 'index.json'),
          MAX_PDF_BYTES: String(2 * 1024 * 1024)
        },
        fetch: async url => {
          const u = String(url);
          fetched.push(u);
          if (u.includes('api.search.brave.com')) {
            return responseJson({ web: { results: [{
              title: 'JLG 40H/40H+ Service Manual',
              url: 'https://www.jlg.com/manuals/40h-service.pdf',
              description: 'service manual 40H 40H+'
            }] } });
          }
          return responseBuffer(fakePdf([
            'JLG 450AJ service maintenance manual serial number B300000000 and up',
            'Tilt sensor calibration procedure and troubleshooting test'
          ]), 200, { 'content-type': 'application/pdf' });
        }
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.sourceType, 'firebase_catalog');
    assert.equal(res.json.manualType, 'service');
    assert.equal(res.json.selectedManualFile, '450AJ pvc2307.pdf');
    assert.match(res.json.selectedManualUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
    assert.equal(res.json.matchedModel, '450 AJ');
    assert.match(res.json.selectionReason, /Přesná shoda modelu/);
    assert.equal(fetched.some(url => url.includes('api.search.brave.com')), false);
    assert.doesNotMatch(JSON.stringify(res.json), /40H/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('oversized Firebase catalog PDF returns JSON instead of timing out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liftcontrol-large-firebase-manual-'));
  try {
    await writeFile(join(root, 'index.json'), JSON.stringify({
      manuals: [{
        source: 'local',
        type: 'service',
        title: 'JLG 450AJ Huge Service Manual',
        file: '450AJ huge.pdf',
        storagePath: '450AJ huge.pdf',
        models: ['450 AJ', '450AJ'],
        aliases: ['JLG 450AJ']
      }]
    }));
    const res = await callApi(
      { maker: 'JLG', model: '450 AJ', serial: 'B300015524', task: 'kalibrace naklonoveho cidla' },
      {
        env: {
          LOCAL_MANUALS_INDEX: join(root, 'index.json'),
          FIREBASE_MANUALS_PROCESSING_MAX_BYTES: String(10 * 1024 * 1024)
        },
        fetch: async () => responseBuffer(Buffer.from('%PDF-1.7\n%%EOF', 'latin1'), 200, {
          'content-type': 'application/pdf',
          'content-length': String(119 * 1024 * 1024)
        })
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.status, 'not_found');
    assert.match(res.json.message, /prilis velke pro prime serverless zpracovani/);
    assert.equal(res.json.debug.triedCandidates[0].skippedCode, 'pdf_too_large_for_serverless');
    assert.equal(res.json.debug.triedCandidates[0].downloaded, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('task intent keeps calibration separate from hydraulic filter terms', () => {
  const calibration = taskIntentDebug('kalibrace');
  assert.equal(calibration.detectedIntent, 'calibration');
  assert.ok(calibration.taskTerms.includes('calibration'));
  assert.equal(calibration.taskTerms.includes('hydraulic filter'), false);
  assert.equal(calibration.taskTerms.includes('return filter'), false);
  assert.equal(calibration.taskTerms.includes('filter element'), false);

  const angle = taskIntentDebug('kalibrace úhlového senzoru');
  assert.equal(angle.detectedIntent, 'angle_sensor_calibration');
  assert.ok(angle.taskTerms.includes('angle sensor'));
  assert.ok(angle.taskTerms.includes('tilt sensor'));
  assert.ok(angle.taskTerms.includes('level sensor'));
  assert.ok(angle.taskTerms.includes('calibration'));
  assert.equal(angle.taskTerms.includes('hydraulic filter'), false);

  const filter = taskIntentDebug('výměna hydraulického filtru');
  assert.equal(filter.detectedIntent, 'hydraulic_filter');
  assert.ok(filter.taskTerms.includes('hydraulic filter'));
  assert.ok(filter.taskTerms.includes('return filter'));
  assert.ok(filter.taskTerms.includes('filter element'));
});

test('hydraulic filter expands to maintenance terms', () => {
  const terms = taskTerms('vymena hydraulickeho filtru');
  for (const term of ['hydraulic filter', 'hydraulic oil filter', 'return filter', 'filter element', 'maintenance procedure']) {
    assert.ok(terms.includes(term), term);
  }
});

test('service tasks rank service manual before operator and parts fallback', () => {
  const ranked = rankCandidates([
    {
      title: "Operator's Manual GS-3384 CE GS-3390 GS-4390 GS-5390 with Maintenance",
      url: 'https://manuals.genielift.com/operators/english/133553.pdf',
      description: 'operator manual maintenance',
      type: 'service'
    },
    {
      title: 'Genie GS-3390 GS-4390 and GS-5390 Service Manual',
      url: 'https://manuals.genielift.com/Parts%20And%20Service%20Manuals/gs4390-service.pdf',
      description: 'service manual calibration hydraulic filter',
      type: 'service'
    },
    {
      title: 'Genie GS-4390 Parts Manual',
      url: 'https://manuals.genielift.com/parts/gs4390-parts.pdf',
      description: 'parts manual',
      type: 'parts'
    }
  ], { maker: 'Genie', model: 'GS-4390 RT', task: 'kalibrace' });
  assert.match(ranked[0].title, /Service Manual/i);
  assert.equal(ranked[0].type, 'service');
  assert.equal(ranked.find(x => /Operator/.test(x.title))?.type, 'operator');
});

test('JLG angle sensor calibration prioritizes service manual over operator model match', () => {
  const ranked = rankCandidates([
    {
      title: 'JLG 450AJ Operator Manual 450AJ 450AJ 450AJ',
      url: 'https://www.jlg.com/manuals/450aj-operator.pdf',
      description: 'operator manual for model 450AJ operation controls',
      type: 'operator'
    },
    {
      title: 'JLG 450AJ Service and Maintenance Manual',
      url: 'https://www.jlg.com/manuals/450aj-service-maintenance.pdf',
      description: 'service manual maintenance calibration angle sensor troubleshooting adjustment',
      type: 'service'
    }
  ], { maker: 'JLG', model: '450AJ', task: 'kalibrace uhloveho senzoru' });
  assert.equal(ranked[0].type, 'service');
  assert.match(ranked[0].title, /Service and Maintenance/i);
  assert.equal(ranked[1].type, 'operator');
});

test('service findRelevantPages matches word combinations', () => {
  const pages = [
    { page: 1, text: 'General safety only.' },
    { page: 2, text: 'Hydraulic system maintenance includes replacing the return filter element.' },
    { page: 3, text: 'Function calibration procedures are listed in the service menu.' },
    { page: 4, text: 'Platform angle sensor diagnostics.' }
  ];
  assert.ok(findRelevantPages(pages, 'hydraulic filter', { manualType: 'service' }).some(p => p.page === 2));
  assert.ok(findRelevantPages(pages, 'kalibrace', { manualType: 'service' }).some(p => p.page === 3));
  assert.equal(findRelevantPages(pages, 'kalibrace', { manualType: 'service' }).some(p => p.page === 2), false);
  assert.ok(findRelevantPages(pages, 'angle sensor', { manualType: 'service' }).some(p => p.page === 4));
});

test('handler debug matchedTerms follows detected task intent', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-4390 RT', serial: 'GS90D-6564', task: 'kalibrace' }, {
    fetch: genieFetch(fakePdf([
      'Genie GS-4390 service manual serial number GS90D-101 and up',
      'Hydraulic system maintenance includes replacing the return filter element.',
      'Function calibration procedure and controller calibration.'
    ]))
  });
  const tried = res.json.debug.triedCandidates[0];
  assert.equal(res.json.debug.taskIntent.detectedIntent, 'calibration');
  assert.deepEqual(tried.matchedPages, [3]);
  assert.equal(tried.matchedTerms.includes('hydraulic filter'), false);
  assert.equal(tried.matchedTerms.includes('return filter'), false);
  assert.equal(tried.matchedTerms.includes('filter element'), false);
  assert.ok(tried.matchedTerms.some(term => term.includes('calibration')));
});

test('handler continues past operator manual and returns debug for service manual', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-4390 RT', serial: 'GS90D-6564', task: 'kalibrace' }, {
    fetch: async url => {
      const u = String(url);
      if (u.includes('api.search.brave.com')) {
        return responseJson({ web: { results: [
          { title: "Operator's Manual GS-3384 CE GS-3390 GS-4390 GS-5390 with Maintenance", url: 'https://manuals.genielift.com/operators/english/133553.pdf', description: 'operator manual' },
          { title: 'Genie GS-3390 GS-4390 and GS-5390 Service Manual', url: 'https://manuals.genielift.com/Parts%20And%20Service%20Manuals/gs4390-service.pdf', description: 'service manual calibration' }
        ] } });
      }
      if (u.includes('operators')) return responseBuffer(fakePdf(['Operator manual only', 'No service procedure here']), 200, { 'content-type': 'application/pdf' });
      return responseBuffer(fakePdf(['Genie GS-4390 service manual serial number GS90D-101 and up', 'Function calibration procedure']), 200, { 'content-type': 'application/pdf' });
    }
  });
  assert.equal(res.json.status, 'warn');
  assert.match(res.json.manualTitle, /Service Manual/i);
  assert.ok(res.json.debug.triedCandidates.some(x => /Service Manual/.test(x.title) && x.downloaded && x.textPages > 0));
});

test('OpenAI debug explains missing API key', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-4390 RT', serial: 'GS90D-6564', task: 'kalibrace' }, {
    fetch: genieFetch(fakePdf([
      'Genie GS-4390 service manual serial number GS90D-101 and up',
      'Function calibration procedure'
    ]))
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.debug.openai.configured, false);
  assert.equal(res.json.debug.openai.requestSent, false);
  assert.equal(res.json.debug.openai.errorCode, 'openai_missing_key');
  assert.match(res.json.message, /OpenAI API klíč není nastavený/);
});

test('OpenAI debug classifies authentication failure', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-4390 RT', serial: 'GS90D-6564', task: 'kalibrace' }, {
    env: { OPENAI_API_KEY: 'sk-test-secret', OPENAI_MODEL: 'gpt-4.1-mini' },
    fetch: async url => {
      const u = String(url);
      if (u.includes('api.search.brave.com')) {
        return responseJson({ web: { results: [{ title: 'Genie GS-3390 GS-4390 and GS-5390 Service Manual', url: 'https://manuals.genielift.com/Parts%20And%20Service%20Manuals/gs4390-service.pdf', description: 'service manual calibration' }] } });
      }
      if (u.includes('api.openai.com')) {
        return responseJson({ error: { code: 'invalid_api_key', message: 'Incorrect API key provided: BSAICDVM1234567890abcdef' } }, 401);
      }
      return responseBuffer(fakePdf([
        'Genie GS-4390 service manual serial number GS90D-101 and up',
        'Function calibration procedure'
      ]), 200, { 'content-type': 'application/pdf' });
    }
  });
  assert.equal(res.json.debug.openai.configured, true);
  assert.equal(res.json.debug.openai.requestSent, true);
  assert.equal(res.json.debug.openai.responseStatus, 401);
  assert.equal(res.json.debug.openai.errorCode, 'openai_auth_failed');
  assert.doesNotMatch(res.json.debug.openai.errorMessage, /BSAICDVM1234567890abcdef|sk-test-secret/);
  assert.match(res.json.message, /OpenAI API je nastavené/);
});

test('OpenAI debug reports source validation rejection', async () => {
  const res = await callApi({ maker: 'Genie', model: 'GS-4390 RT', serial: 'GS90D-6564', task: 'kalibrace' }, {
    env: { OPENAI_API_KEY: 'sk-test-secret', OPENAI_MODEL: 'gpt-4.1-mini' },
    fetch: async url => {
      const u = String(url);
      if (u.includes('api.search.brave.com')) {
        return responseJson({ web: { results: [{ title: 'Genie GS-3390 GS-4390 and GS-5390 Service Manual', url: 'https://manuals.genielift.com/Parts%20And%20Service%20Manuals/gs4390-service.pdf', description: 'service manual calibration' }] } });
      }
      if (u.includes('api.openai.com')) {
        return responseJson({
          output_text: JSON.stringify({
            steps: [{
              text: 'Proveď kalibraci úhlového senzoru.',
              sourceQuote: 'Battery charger green light indicates charging is complete.',
              page: 2
            }],
            safety: [],
            serialRange: '',
            message: ''
          })
        });
      }
      return responseBuffer(fakePdf([
        'Genie GS-4390 service manual serial number GS90D-101 and up',
        'Battery charger green light indicates charging is complete. Function calibration procedure.'
      ]), 200, { 'content-type': 'application/pdf' });
    }
  });
  assert.equal(res.json.status, 'not_found');
  assert.equal(res.json.debug.openai.configured, true);
  assert.equal(res.json.debug.openai.parsed, true);
  assert.equal(res.json.debug.openai.acceptedSteps, 0);
  assert.equal(res.json.debug.openai.validationRejectedSteps, 1);
  assert.equal(res.json.debug.openai.errorCode, 'openai_validation_rejected');
  assert.match(res.json.message, /žádný krok neprošel zdrojovou validací/);
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
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', task: 'diagnostika' }, { fetch: async () => responseJson({}, 401) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'error');
  assert.doesNotMatch(JSON.stringify(res.json), /test-key/);
});

test('Brave timeout returns safe error', async () => {
  const err = new Error('timeout');
  err.name = 'AbortError';
  const res = await callApi({ maker: 'Genie', model: 'GS-1930', task: 'diagnostika' }, { fetch: async () => { throw err; } });
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

test('serial parser keeps alphanumeric prefix and numeric sequence separate', () => {
  assert.deepEqual(parseSerialValue('GS30D-12345'), {
    original: 'GS30D-12345',
    normalized: 'GS30D12345',
    prefix: 'GS30D',
    number: 12345,
    suffix: '',
    reliable: true
  });
  assert.deepEqual(parseSerialValue('0300123456'), {
    original: '0300123456',
    normalized: '0300123456',
    prefix: '',
    number: 300123456,
    suffix: '',
    reliable: true
  });
});

test('serial range rejects different alphanumeric prefix', () => {
  const pages = [{ page: 1, text: 'Genie GS-1930 service manual serial number GS30D-15000 and up' }];
  const good = evaluateManualFit({ request: { model: 'GS-1930', serial: 'GS30D-16000' }, pages });
  const bad = evaluateManualFit({ request: { model: 'GS-1930', serial: 'GS30E-16000' }, pages });
  assert.equal(good.status, 'ok');
  assert.equal(bad.status, 'not_found');
});

test('numeric serial range still works when no prefix is present', () => {
  const range = parseSerialRange('serial number 0300000000 and up');
  assert.equal(range.reliable, true);
  const fit = evaluateManualFit({
    request: { model: '450AJ', serial: '0300123456' },
    pages: [{ page: 1, text: 'JLG 450AJ service manual serial number 0300000000 and up' }]
  });
  assert.equal(fit.status, 'ok');
});

test('unparseable serial range returns warn rather than ok', () => {
  const fit = evaluateManualFit({
    request: { model: 'GS-1930', serial: 'GS30D-12345' },
    pages: [{ page: 1, text: 'Genie GS-1930 service manual serial number see machine plate for applicable models' }]
  });
  assert.equal(fit.status, 'warn');
});

test('AI validation rejects invented step with unrelated real quote', async () => {
  const pages = [{ page: 2, text: 'Battery charger green light indicates charging is complete.' }];
  const out = await validateAiOutput({
    steps: [{ text: 'Proved kalibraci uhloveho senzoru.', sourceQuote: 'Battery charger green light indicates charging is complete.', page: 2 }],
    safety: [],
    serialRange: '',
    message: ''
  }, pages, { task: 'kalibrace uhloveho senzoru' });
  assert.deepEqual(out.steps, []);
});

test('AI validation rejects correct quote with wrong page number', async () => {
  const pages = [
    { page: 1, text: 'Title page only.' },
    { page: 2, text: 'Use the analyzer to read diagnostic fault codes.' }
  ];
  const out = await validateAiOutput({
    steps: [{ text: 'Nacti diagnosticke chybove kody analyzatorem.', sourceQuote: 'Use the analyzer to read diagnostic fault codes.', page: 1 }],
    safety: [],
    serialRange: '',
    message: ''
  }, pages, { task: 'diagnostika zavady' });
  assert.deepEqual(out.steps, []);
});

test('AI validation rejects step without quote', async () => {
  const out = await validateAiOutput({
    steps: [{ text: 'Nacti diagnosticke chybove kody analyzatorem.', page: 1 }],
    safety: [],
    serialRange: '',
    message: ''
  }, [{ page: 1, text: 'Use the analyzer to read diagnostic fault codes.' }], { task: 'diagnostika zavady' });
  assert.deepEqual(out.steps, []);
});

test('AI validation rejects safety warning that is not in the manual', async () => {
  const out = await validateAiOutput({
    steps: [],
    safety: [{ text: 'Odpoj baterii.', sourceQuote: 'Disconnect the battery before servicing the charger.', page: 1 }],
    serialRange: '',
    message: ''
  }, [{ page: 1, text: 'Use the analyzer to read diagnostic fault codes.' }], { task: 'diagnostika zavady' });
  assert.deepEqual(out.safety, []);
});

test('semantic validation rejects unrelated Czech step even with relevant angle sensor quote', async () => {
  const pages = [{ page: 5, text: 'Angle sensor calibration must be performed with the platform fully lowered.' }];
  const out = await validateAiOutput({
    steps: [{ text: 'Vymen hydraulicky filtr a odvzdusni soustavu.', sourceQuote: 'Angle sensor calibration must be performed with the platform fully lowered.', page: 5 }],
    safety: [],
    serialRange: '',
    message: ''
  }, pages, { task: 'kalibrace uhloveho senzoru' }, {
    semanticValidator: async ({ item }) => item.text.includes('Kalibrace uhlu')
  });
  assert.deepEqual(out.steps, []);
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
      ALLOWED_ORIGINS: 'https://bartovaschranka-create.github.io',
      ...(options.env || {})
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
  const body = JSON.stringify(json);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    async json() { return json; },
    async text() { return body; }
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
