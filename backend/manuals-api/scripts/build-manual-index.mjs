#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { extractPdfTextPages } from '../src/pdf.mjs';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];

if (!input || !output) {
  console.error('Usage: node scripts/build-manual-index.mjs <manual.pdf> <manual.pages.json> [--manual "Manual title"] [--page-images] [--pdftoppm <path>]');
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
const shouldRenderPageImages = args.includes('--page-images');
const pdftoppmPath = optionValue('--pdftoppm') || process.env.PDFTOPPM_PATH || 'pdftoppm';
const imageDpi = numberOption('--image-dpi', 120);
const imageQuality = numberOption('--image-quality', 85);
const imagePages = parsePageSet(optionValue('--image-pages'));
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

let pageImages = new Map();
if (shouldRenderPageImages) {
  pageImages = await renderPageImages(sourcePath, pdftoppmPath, { dpi: imageDpi, quality: imageQuality, pages: imagePages });
}

pages = pages.map((page, index) => enrichPage(page, pages[index - 1], pageImages.get(Number(page.page))));

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

function numberOption(name, fallback) {
  const raw = Number(optionValue(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function parsePageSet(value) {
  const out = new Set();
  for (const part of String(value || '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Math.min(Number(range[1]), Number(range[2]));
      const to = Math.max(Number(range[1]), Number(range[2]));
      for (let page = from; page <= to; page += 1) out.add(page);
      continue;
    }
    const page = Number(trimmed);
    if (Number.isInteger(page) && page > 0) out.add(page);
  }
  return out;
}

function enrichPage(page, previousPage = null, pageImage = null) {
  const lines = String(page.text || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
  const title = detectTitle(lines);
  const chapter = detectChapter(lines, previousPage?.chapter || '');
  const keywords = detectKeywords(page.text, title, chapter);
  const images = detectFigureCaptions(lines, page.page);
  if (pageImage) {
    images.push({
      figure: '',
      bbox: 'page',
      caption: `Originalni strana manualu ${page.page}`,
      page: page.page,
      mimeType: 'image/jpeg',
      dataUrl: pageImage.dataUrl,
      width: pageImage.width,
      height: pageImage.height
    });
  }
  return {
    page: page.page,
    title,
    chapter,
    keywords,
    text: page.text,
    images
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

async function renderPageImages(pdfPath, executable, options = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'liftcontrol-manual-pages-'));
  try {
    const ranges = pageRanges(options.pages);
    if (ranges.length) {
      for (const range of ranges) {
        await run(executable, [
          '-jpeg',
          '-r', String(options.dpi || 120),
          '-jpegopt', `quality=${options.quality || 85}`,
          '-f', String(range.from),
          '-l', String(range.to),
          pdfPath,
          join(tempDir, `page-${range.from}`)
        ]);
      }
    } else {
      await run(executable, [
        '-jpeg',
        '-r', String(options.dpi || 120),
        '-jpegopt', `quality=${options.quality || 85}`,
        pdfPath,
        join(tempDir, 'page')
      ]);
    }
    const files = (await readdir(tempDir))
      .filter(name => /^page(?:-\d+)?-\d+\.jpg$/i.test(name))
      .sort((a, b) => pageNumberFromRenderedName(a) - pageNumberFromRenderedName(b));
    const out = new Map();
    for (const file of files) {
      const page = pageNumberFromRenderedName(file);
      const fullPath = join(tempDir, file);
      const image = await readFile(fullPath);
      const size = jpegSize(image);
      if (!size) continue;
      out.set(page, {
        dataUrl: `data:image/jpeg;base64,${image.toString('base64')}`,
        width: size.width,
        height: size.height
      });
    }
    return out;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function pageNumberFromRenderedName(name) {
  return Number(String(name).match(/-(\d+)\.jpg$/i)?.[1] || 0);
}

function pageRanges(pages) {
  const sorted = [...(pages || [])].sort((a, b) => a - b);
  const ranges = [];
  for (const page of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && page === last.to + 1) last.to = page;
    else ranges.push({ from: page, to: page });
  }
  return ranges;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} failed (${code}): ${stderr.slice(0, 1000)}`));
    });
  });
}

function jpegSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += length;
  }
  return null;
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
