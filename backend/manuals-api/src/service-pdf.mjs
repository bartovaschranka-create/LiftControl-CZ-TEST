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
  layout.title('Servisni postup z manualu vyrobce');
  layout.kv('Vyrobce', data.result.maker || data.request.maker);
  layout.kv('Model', data.result.model || data.request.model);
  layout.kv('Vyrobni cislo', data.result.serial || data.request.serial || 'neuvedeno');
  layout.kv('Servisni ukon', data.request.task || 'neuvedeno');
  layout.kv('Manual', data.result.manualTitle || 'neuvedeno');
  layout.kv('Typ manualu', data.result.manualType || 'neuvedeno');
  layout.kv('Vydani / rozsah v.c.', data.result.serialRange || 'neuvedeno / neovereno');
  layout.kv('Pouzite strany', data.sourcePages.join(', ') || 'neuvedeno');
  layout.hr();

  layout.heading('Cesky pracovni postup');
  if (data.steps.length) {
    data.steps.forEach((step, index) => {
      layout.paragraph(`${index + 1}. ${step.text}`, { indent: 14 });
      if (step.page || step.sourceQuote) {
        layout.small(`Zdroj: strana ${step.page || '?'}${step.sourceQuote ? ` - "${step.sourceQuote}"` : ''}`);
      }
    });
  } else {
    layout.paragraph('Cesky postup nebyl bezpecne sestaven. Nize je uveden nalezeny zdrojovy text z manualu.');
  }

  if (data.safety.length) {
    layout.heading('Upozorneni vyrobce');
    data.safety.forEach((item, index) => {
      layout.paragraph(`${index + 1}. ${item.text}`, { indent: 14 });
      if (item.page || item.sourceQuote) layout.small(`Zdroj: strana ${item.page || '?'} - "${item.sourceQuote || ''}"`);
    });
  }

  if (data.sources.length) {
    layout.heading('Zdrojove strany a text');
    data.sources.forEach(source => {
      layout.paragraph(`Strana ${source.page}: ${source.quote}`);
    });
  }

  if (data.images.length) {
    layout.heading('Obrazky / schemata z manualu');
    data.images.forEach((image, index) => {
      layout.box(`Obrazek ${index + 1} - strana ${image.page || '?'}\n${image.caption || 'Popis obrazku nebyl uveden.'}`);
    });
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
  const images = Array.isArray(result.images) ? result.images : [];
  const sourcePages = [...new Set([
    ...steps.map(x => x.page).filter(Boolean),
    ...safety.map(x => x.page).filter(Boolean),
    ...sources.map(x => x.page).filter(Boolean)
  ])].sort((a, b) => Number(a) - Number(b));
  return { request, result, steps, safety, sources, images, sourcePages };
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

class PdfDoc {
  constructor() {
    this.pages = [];
    this.current = null;
    this.newPage();
  }
  newPage() {
    this.current = [];
    this.pages.push(this.current);
  }
  text(x, y, text, size = 10, font = FONT) {
    this.current.push(`BT /${font} ${size} Tf ${fmt(x)} ${fmt(y)} Td ${pdfText(clean(text))} Tj ET`);
  }
  line(x1, y1, x2, y2) {
    this.current.push(`0.8 w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`);
  }
  rect(x, y, w, h) {
    this.current.push(`0.8 w ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`);
  }
  finish() {
    const objects = [];
    const pageRefs = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('PAGES_PLACEHOLDER');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    for (const content of this.pages) {
      const pageObj = objects.length + 1;
      const contentObj = pageObj + 1;
      pageRefs.push(`${pageObj} 0 R`);
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /${FONT} 3 0 R /${BOLD} 4 0 R >> >> /Contents ${contentObj} 0 R >>`);
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

function fmt(n) {
  return Number(n).toFixed(2).replace(/\.00$/, '');
}
