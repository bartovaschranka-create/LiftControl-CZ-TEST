const PAGE = { w: 595.28, h: 841.89 };
const M = 42;
const FONT = 'F1';
const BOLD = 'F2';

export function createServiceProcedurePdf(input = {}) {
  const data = normalizeInput(input);
  if (!data.result.manualTitle && !data.result.originalUrl) throw new Error('Chybi overeny vysledek manualu.');
  if (!data.steps.length && !data.sources.length) throw new Error('Chybi postup nebo zdrojove strany pro PDF.');

  const doc = new PdfDoc();
  const layout = new Layout(doc);
  layout.title('Servisni instrukce vyrobce');
  layout.kv('Vyrobce', data.result.maker || data.request.maker);
  layout.kv('Model', data.result.model || data.request.model);
  layout.kv('Vyrobni cislo', data.result.serial || data.request.serial || 'neuvedeno');
  layout.kv('Nazev servisniho ukonu', data.request.task || 'neuvedeno');
  layout.kv('Pouzity manual', conciseManualName(data.result));
  layout.kv('Rozsah pouzitych stran', data.sourcePages.join(', ') || 'neuvedeno');
  layout.hr();

  layout.heading('Cesky servisni postup');
  if (data.steps.length) {
    data.steps.forEach((step, index) => {
      layout.stepBlock(index + 1, step, data);
      imagesForStep(data.images, step).forEach(image => layout.imageBlock(image, data));
    });
  } else {
    layout.paragraph('Cesky postup nebyl bezpecne sestaven. Nize je uveden nalezeny zdrojovy text z manualu.');
  }

  if (data.safety.length) {
    layout.heading('Bezpecnostni upozorneni vyrobce');
    data.safety.forEach((item, index) => {
      layout.callout('BEZPECNOSTNI UPOZORNENI', `${index + 1}. ${item.text}`, data, item);
    });
  }

  if (data.sources.length) {
    layout.heading('Zdrojove citace');
    data.sources.forEach(source => {
      layout.small(`${sourceLabel(data, source.page)} - "${source.quote}"`);
    });
  }

  const unusedImages = data.images.filter(image => !data.steps.some(step => Number(step.page) === Number(image.stepPage || image.page)));
  if (unusedImages.length) {
    layout.heading('Dalsi obrazky / schemata z manualu');
    unusedImages.forEach(image => layout.imageBlock(image, data));
  }

  layout.heading('Originalni manual');
  layout.paragraph(data.result.originalUrl || 'Odkaz neni uveden.');
  layout.notice('Tento dokument byl automaticky vytvoren z overeneho servisniho manualu vyrobce pomoci AI. V pripade rozporu ma vzdy prednost originalni dokumentace vyrobce.');
  return doc.finish();
}

function normalizeInput(input) {
  const request = input.request || {};
  const result = input.result || input || {};
  const steps = normalizeItems(result.steps);
  const safety = normalizeItems(result.safety);
  const sources = normalizeSources(result.sources);
  const images = normalizeImages(result.images);
  const sourcePages = [...new Set([
    ...steps.map(x => x.page).filter(Boolean),
    ...safety.map(x => x.page).filter(Boolean),
    ...sources.map(x => x.page).filter(Boolean)
  ])].sort((a, b) => Number(a) - Number(b));
  return { request, result, steps, safety, sources, images, sourcePages };
}

function conciseManualName(result) {
  return clean(result.manualTitle || result.originalUrl || 'neuvedeno')
    .replace(/\s+/g, ' ')
    .slice(0, 110);
}

function sourceLabel(data, page) {
  const manual = conciseManualName(data.result);
  return `Zdroj: ${manual}, str. ${page || '?'}`;
}

function imagesForStep(images, step) {
  const page = Number(step?.page || 0);
  return (images || []).filter(image => Number(image.stepPage || image.page || 0) === page);
}

function normalizeImages(images) {
  return (Array.isArray(images) ? images : [])
    .map(image => ({
      page: image?.page || '',
      stepPage: image?.stepPage || image?.page || '',
      figure: clean(image?.figure || '').slice(0, 80),
      caption: clean(image?.caption || '').slice(0, 240),
      dataUrl: String(image?.dataUrl || '').trim(),
      mimeType: clean(image?.mimeType || image?.mime || '').slice(0, 60),
      width: Number(image?.width) || 0,
      height: Number(image?.height) || 0
    }))
    .filter(image => image.figure || image.caption || image.dataUrl);
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => typeof item === 'string'
      ? { text: item, sourceQuote: '', page: '' }
      : { text: item?.text || '', sourceQuote: item?.sourceQuote || '', page: item?.page || '' })
    .map(item => ({
      text: clean(item.text).slice(0, 3000),
      sourceQuote: clean(item.sourceQuote).slice(0, 800),
      page: item.page
    }))
    .filter(item => item.text);
}

function normalizeSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map(source => ({ page: source?.page || '', quote: clean(source?.quote || source?.sourceQuote || '').slice(0, 1200) }))
    .filter(source => source.quote);
}

class Layout {
  constructor(doc) {
    this.doc = doc;
    this.x = M;
    this.y = PAGE.h - M;
    this.width = PAGE.w - M * 2;
  }
  ensure(height) {
    if (this.y - height < M + 30) {
      this.doc.newPage();
      this.y = PAGE.h - M;
    }
  }
  title(text) {
    this.ensure(44);
    this.doc.text(this.x, this.y, text, 18, BOLD);
    this.y -= 28;
    this.hr();
  }
  heading(text) {
    this.ensure(28);
    this.y -= 8;
    this.doc.text(this.x, this.y, text, 12, BOLD);
    this.y -= 16;
  }
  kv(label, value) {
    const lines = wrap(`${label}: ${clean(value || '')}`, this.width, 10);
    this.ensure(lines.length * 13 + 3);
    for (const line of lines) {
      this.doc.text(this.x, this.y, line, 10, label && line.startsWith(`${label}:`) ? BOLD : FONT);
      this.y -= 13;
    }
  }
  paragraph(text, options = {}) {
    const indent = options.indent || 0;
    const lines = wrap(clean(text), this.width - indent, 10);
    this.ensure(lines.length * 13 + 5);
    for (const line of lines) {
      this.doc.text(this.x + indent, this.y, line, 10, FONT);
      this.y -= 13;
    }
    this.y -= 4;
  }
  stepBlock(number, step, data) {
    const tags = classifyStep(step.text);
    const source = sourceLabel(data, step.page);
    const menu = extractMenuTerms(step.text);
    const lines = wrap(clean(step.text), this.width - 24, 10);
    const menuLines = menu.length ? wrap(`Menu / hodnoty: ${menu.join('  |  ')}`, this.width - 34, 9) : [];
    const sourceLines = wrap(`${source} - "${clean(step.sourceQuote || '')}"`, this.width - 34, 8);
    const tagLines = tags.length ? wrap(tags.join('   '), this.width - 24, 8) : [];
    const height = 34 + lines.length * 13 + menuLines.length * 12 + sourceLines.length * 10 + tagLines.length * 10;
    this.ensure(height + 12);
    const top = this.y + 8;
    this.doc.rect(this.x, this.y - height, this.width, height + 10, 1.1);
    this.doc.text(this.x + 10, this.y, `Krok ${number}`, 11, BOLD);
    this.y -= 15;
    for (const line of tagLines) {
      this.doc.text(this.x + 10, this.y, line, 8, BOLD);
      this.y -= 10;
    }
    for (const line of lines) {
      this.doc.text(this.x + 12, this.y, line, 10, FONT);
      this.y -= 13;
    }
    if (menuLines.length) {
      this.y -= 2;
      const boxH = menuLines.length * 12 + 8;
      const menuTop = this.y;
      const menuBottom = menuTop - boxH + 6;
      this.doc.rect(this.x + 10, menuBottom, this.width - 20, boxH, 0.45);
      for (const line of menuLines) {
        this.doc.text(this.x + 17, this.y, line, 9, BOLD);
        this.y -= 12;
      }
      this.y = Math.min(this.y - 2, menuBottom - 6);
    }
    this.y -= 2;
    for (const line of sourceLines) {
      this.doc.text(this.x + 12, this.y, line, 8, FONT);
      this.y -= 10;
    }
    this.y = Math.min(this.y - 8, top - height - 8);
  }
  callout(label, text, data, item = {}) {
    const lines = wrap(clean(text), this.width - 20, 10);
    const sourceLines = item.page || item.sourceQuote ? wrap(`${sourceLabel(data, item.page)} - "${clean(item.sourceQuote || '')}"`, this.width - 20, 8) : [];
    const height = 28 + lines.length * 13 + sourceLines.length * 10;
    this.ensure(height + 8);
    const startY = this.y;
    this.doc.rect(this.x, this.y - height, this.width, height + 8, 1.0);
    this.doc.text(this.x + 10, this.y, label, 10, BOLD);
    this.y -= 15;
    for (const line of lines) {
      this.doc.text(this.x + 10, this.y, line, 10, FONT);
      this.y -= 13;
    }
    for (const line of sourceLines) {
      this.doc.text(this.x + 10, this.y, line, 8, FONT);
      this.y -= 10;
    }
    this.y = Math.min(this.y - 10, startY - height - 14);
  }
  imageBlock(image, data) {
    const caption = image.caption || image.figure || 'Obrazek z manualu';
    const title = `${caption} - ${sourceLabel(data, image.page)}`;
    const maxW = this.width - 24;
    const maxH = 210;
    if (image.dataUrl) {
      const size = imageSize(image);
      const scale = Math.min(maxW / size.w, maxH / size.h, 1);
      const w = Math.max(120, size.w * scale);
      const h = Math.max(70, size.h * scale);
      this.ensure(h + 48);
      this.doc.text(this.x + 12, this.y, title, 9, BOLD);
      this.y -= 14;
      if (this.doc.image(this.x + 12, this.y - h, w, h, image)) {
        this.y -= h + 8;
        this.small(sourceLabel(data, image.page));
        return;
      }
    }
    this.box(`${title}\nObrazova data nejsou v indexu ulozena. Otevri originalni manual na uvedene strane.`);
  }
  small(text) {
    const lines = wrap(clean(text), this.width, 8);
    this.ensure(lines.length * 10 + 4);
    for (const line of lines) {
      this.doc.text(this.x + 14, this.y, line, 8, FONT);
      this.y -= 10;
    }
    this.y -= 3;
  }
  notice(text) {
    this.ensure(70);
    const startY = this.y + 8;
    this.doc.rect(this.x, this.y - 54, this.width, 62);
    this.y -= 10;
    for (const line of wrap(clean(text), this.width - 18, 9)) {
      this.doc.text(this.x + 9, this.y, line, 9, BOLD);
      this.y -= 12;
    }
    this.y = Math.min(this.y - 6, startY - 66);
  }
  box(text) {
    this.ensure(80);
    this.doc.rect(this.x, this.y - 62, this.width, 70);
    this.y -= 12;
    for (const line of wrap(clean(text), this.width - 18, 9)) {
      this.doc.text(this.x + 9, this.y, line, 9, FONT);
      this.y -= 12;
    }
    this.y -= 14;
  }
  hr() {
    this.ensure(10);
    this.doc.line(this.x, this.y, this.x + this.width, this.y);
    this.y -= 12;
  }
}

function classifyStep(text) {
  const value = clean(text).toLowerCase();
  const tags = [];
  if (/\b(warning|caution|danger|bezpec|pozor|zajisti|odpoj)\b/.test(value)) tags.push('BEZPECNOSTNI UPOZORNENI');
  if (/\b(calibration|kalibr|adjustment|nastav|seriz|access level|calibrations)\b/.test(value)) tags.push('NASTAVENI');
  if (/\b(display|analyzer|menu|access level|calibrations|platform angle|enter)\b/.test(value)) tags.push('HODNOTY NA DISPLEJI');
  if (/\b(connector|konektor|plug|unplug|electrical|wire|cable)\b/.test(value)) tags.push('ELEKTRICKE KONEKTORY');
  if (/\b(sensor|senzor|cidlo|location|umisteni|platform angle)\b/.test(value)) tags.push('UMISTENI SENZORU');
  return tags.slice(0, 3);
}

function extractMenuTerms(text) {
  const out = new Set();
  const value = clean(text);
  const matches = value.match(/\b[A-Z][A-Z0-9 /-]{3,}\b/g) || [];
  for (const match of matches) {
    const cleaned = match.trim();
    if (cleaned.length >= 4 && !/^(JLG|PDF|PVC)$/.test(cleaned)) out.add(cleaned);
  }
  return [...out].slice(0, 6);
}

function imageSize(image) {
  if (image.width && image.height) return { w: image.width, h: image.height };
  const jpeg = parseJpegDataUrl(image.dataUrl);
  if (jpeg?.width && jpeg?.height) return { w: jpeg.width, h: jpeg.height };
  return { w: 360, h: 180 };
}

class PdfDoc {
  constructor() {
    this.pages = [];
    this.current = null;
    this.images = [];
    this.imageByKey = new Map();
    this.newPage();
  }
  newPage() {
    this.current = [];
    this.pages.push(this.current);
  }
  text(x, y, text, size = 10, font = FONT) {
    this.current.push(`BT /${font} ${size} Tf ${fmt(x)} ${fmt(y)} Td ${pdfText(clean(text))} Tj ET`);
  }
  line(x1, y1, x2, y2, width = 0.8) {
    this.current.push(`${fmt(width)} w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`);
  }
  rect(x, y, w, h, width = 0.8) {
    this.current.push(`${fmt(width)} w ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`);
  }
  image(x, y, w, h, image) {
    const parsed = parseJpegDataUrl(image?.dataUrl || '');
    if (!parsed) return false;
    const key = parsed.buffer.toString('base64');
    let registered = this.imageByKey.get(key);
    if (!registered) {
      registered = {
        name: `Im${this.images.length + 1}`,
        buffer: parsed.buffer,
        width: parsed.width,
        height: parsed.height
      };
      this.images.push(registered);
      this.imageByKey.set(key, registered);
    }
    this.current.push(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm /${registered.name} Do Q`);
    return true;
  }
  finish() {
    const objects = [];
    const pageRefs = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('PAGES_PLACEHOLDER');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imageRefs = new Map();
    for (const image of this.images) {
      const objNumber = objects.length + 1;
      imageRefs.set(image.name, objNumber);
      const stream = image.buffer.toString('latin1');
      objects.push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.buffer.length} >>\nstream\n${stream}\nendstream`);
    }
    const xObject = this.images.length
      ? `/XObject << ${this.images.map(image => `/${image.name} ${imageRefs.get(image.name)} 0 R`).join(' ')} >>`
      : '';
    for (const content of this.pages) {
      const pageObj = objects.length + 1;
      const contentObj = pageObj + 1;
      pageRefs.push(`${pageObj} 0 R`);
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /${FONT} 3 0 R /${BOLD} 4 0 R >> ${xObject} >> /Contents ${contentObj} 0 R >>`);
      const stream = content.join('\n');
      objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    }
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${this.pages.length} >>`;
    return writePdf(objects);
  }
}

function writePdf(objects) {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function wrap(text, width, size) {
  const max = Math.max(20, Math.floor(width / (size * 0.52)));
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function clean(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfText(value) {
  return `(${clean(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function parseJpegDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/jpe?g;base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[1], 'base64');
  const size = jpegSize(buffer);
  if (!size) return null;
  return { buffer, ...size };
}

function jpegSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  return null;
}

function fmt(n) {
  return Number(n).toFixed(2).replace(/\.00$/, '');
}
