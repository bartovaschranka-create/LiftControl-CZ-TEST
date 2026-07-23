#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { extractPdfTextPages } from '../src/pdf.mjs';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];

if (!input || !output) {
  console.error('Usage: node scripts/build-manual-index.mjs <manual.pdf> <manual.pages.json> [--manual "Manual title"]');
  process.exit(1);
}

const manualTitle = optionValue('--manual') || basename(input);
const maker = optionValue('--maker');
const model = optionValue('--model');
const models = listOption('--models');
const manualType = optionValue('--manual-type') || 'service';
const edition = optionValue('--edition');
const issueDate = optionValue('--issue-date');
const serialRange = optionValue('--serial-range');
const shouldEmbed = args.includes('--embeddings');
const embeddingModel = optionValue('--embedding-model') || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const sourcePath = resolve(input);
const outputPath = resolve(output);
const buffer = await readFile(sourcePath);
const debug = {};
let pages = await extractPdfTextPages(buffer, debug);

if (!pages.length) {
  console.error('PDF nema citelnou textovou vrstvu nebo parser nevratil zadne stranky.');
  process.exit(2);
}

pages = pages.map((page, index) => enrichPage(page, pages[index - 1]));

if (shouldEmbed) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY neni nastaveny, embeddingy nelze vytvorit.');
    process.exit(3);
  }
  pages = await addEmbeddings(pages, embeddingModel);
}

const payload = {
  version: 1,
  manual: manualTitle,
  maker,
  model,
  models: models.length ? models : (model ? [model] : []),
  manualType,
  edition,
  issueDate,
  serialRange,
  sourceFile: basename(input),
  generatedAt: new Date().toISOString(),
  pageCount: debug.pdfPages || pages.length,
  textPageCount: pages.length,
  embeddingModel: shouldEmbed ? embeddingModel : '',
  pages
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Index created: ${outputPath}`);
console.log(`Pages with text: ${pages.length}`);

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function listOption(name) {
  return optionValue(name)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function enrichPage(page, previousPage = null) {
  const lines = String(page.text || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
  const title = detectTitle(lines);
  const chapter = detectChapter(lines, previousPage?.chapter || '');
  const keywords = detectKeywords(page.text, title, chapter);
  return {
    page: page.page,
    title,
    chapter,
    keywords,
    text: page.text,
    images: detectFigureCaptions(lines, page.page)
  };
}

function detectTitle(lines) {
  const titleLine = lines.find(line => {
    if (line.length < 6 || line.length > 90) return false;
    if (/^\d+$/.test(line)) return false;
    return /(?:procedure|calibration|adjustment|troubleshooting|diagnostic|maintenance|inspection|replacement|sensor|filter|hydraulic|electrical|control system)/i.test(line);
  });
  return titleLine || '';
}

function detectChapter(lines, fallback = '') {
  const chapterLine = lines.find(line => /^(section|chapter)\s+\d+|^\d+\.\s+[A-Z]/i.test(line));
  return chapterLine || fallback || '';
}

function detectKeywords(...parts) {
  const text = parts.join('\n').toLowerCase();
  const vocabulary = [
    'angle sensor', 'tilt sensor', 'level sensor', 'platform angle sensor',
    'calibration', 'calibrate', 'adjustment', 'zero', 'service mode',
    'diagnostic', 'troubleshooting', 'fault code', 'hydraulic filter',
    'return filter', 'filter element', 'battery charger', 'charger',
    'emergency lowering', 'electrical', 'rcd', 'controller', 'ecm'
  ];
  return vocabulary.filter(term => text.includes(term));
}

function detectFigureCaptions(lines, page) {
  return lines
    .filter(line => /^(figure|fig\.?)\s+\d+/i.test(line))
    .slice(0, 12)
    .map(line => ({
      figure: (line.match(/^(figure|fig\.?)\s+[\w.-]+/i)?.[0] || '').trim(),
      bbox: '',
      caption: line,
      page
    }));
}

async function addEmbeddings(pages, modelName) {
  const out = [];
  for (const page of pages) {
    const input = [
      page.title,
      page.chapter,
      page.keywords.join(', '),
      page.text.slice(0, 7000)
    ].filter(Boolean).join('\n');
    out.push({
      ...page,
      embedding: await createEmbedding(input, modelName)
    });
  }
  return out;
}

async function createEmbedding(input, modelName) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: modelName, input })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const embedding = json?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error('OpenAI embeddings response does not contain data[0].embedding.');
  return embedding;
}
