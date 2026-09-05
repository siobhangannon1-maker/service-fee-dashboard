const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const pdfLib = require('pdf-lib');
const sharp = require('sharp');

// Run the actual route with synthetic database/storage responses. No environment,
// server, network calls or patient data; PDFs are serialized only in memory.
const routePath = path.resolve('app/api/report-writing/generate-pdf/route.ts');
const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const image = { id: 'fixture-image', storage_path: 'fixture.png', display_width_percent: 45,
  display_alignment: 'left', crop_aspect: 'square', caption: null };
const filler = (n) => Array(n).fill('Earlier body paragraph.').join('\n');
const prose = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

async function render(body, images = [], options = {}) {
  const events = [];
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const draft = { id: 'fixture', provider_id: 'fixture', patient_name: 'Synthetic Fixture',
    edited_text: body, report_type: 'consultation_report', appointment_date: '2026-09-05' };
  const provider = { name: 'Fixture Provider', report_qualifications: 'Fixture Qualifications',
    report_signature_path: options.signatureImage ? 'signature.png' : null };
  const db = {
    from(table) {
      const rows = table === 'report_drafts' ? draft : table === 'providers' ? provider : table === 'report_draft_images' ? images : [];
      const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        single() { return Promise.resolve({ data: rows }); }, then(resolve) { return Promise.resolve({ data: rows }).then(resolve); } };
      return query;
    },
    storage: { from() { return { async download() { return { data: new Blob([png]) }; } }; } },
  };
  const instrumented = { ...pdfLib, PDFDocument: { async create() {
    const doc = await pdfLib.PDFDocument.create();
    const addPage = doc.addPage.bind(doc);
    doc.addPage = (...args) => {
      const p = addPage(...args), pageIndex = doc.getPageCount() - 1;
      for (const method of ['drawText', 'drawImage', 'drawLine']) {
        const original = p[method].bind(p);
        p[method] = (...params) => {
          const opts = method === 'drawLine' ? params[0] : params[1];
          events.push({ method, page: pageIndex, ...(method === 'drawText' ? { text: params[0], font: opts.font?.name } : {}),
            x: opts.x, y: opts.y, width: opts.width, start: opts.start, end: opts.end });
          return original(...params);
        };
      }
      return p;
    };
    return doc;
  } } };
  const exports = {};
  const errors = [];
  const fixtureRequire = (name) => {
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name === 'pdf-lib') return instrumented;
      if (name === 'next/server') return { NextResponse: Response };
      return require(name);
  };
  new Function('require', 'exports', 'process', 'console', compiled)(
    fixtureRequire, exports, { cwd: () => process.cwd(), env: {} },
    { error(error) { errors.push(error.message); } },
  );
  const response = await exports.POST({ json: async () => ({ draftId: 'fixture' }) });
  if (response.status !== 200) return { events, error: (await response.json()).error, errors };
  assert.ok((await response.arrayBuffer()).byteLength > 0);
  return { events };
}
function signature(result) {
  assert.equal(result.error, undefined, result.errors?.join('; '));
  return result.events.find(e => e.text === 'Warm Regards,');
}
function bodyLines(result, page) {
  return [...new Set(result.events.filter(e => e.method === 'drawText' && e.page === page && /^word\d+$/.test(e.text)).map(e => e.y))];
}
function assertSignatureTogether(result) {
  const sig = signature(result);
  for (const text of ['Fixture Provider', 'Fixture Qualifications']) {
    assert.equal(result.events.find(e => e.text === text).page, sig.page);
  }
  assert.ok(result.events.some(e => e.page === sig.page && e.y > sig.y && (/^word\d+$/.test(e.text || '') || e.text === 'Final' || (e.method === 'drawImage' && e.width < 500 && e.width !== 120))));
  return sig;
}

test('A: buffered bold, italic and underline survive both staying and relocation', async () => {
  for (const n of [0, 18]) {
    const r = await render(`${filler(n)}\nFinal ${prose(20)} **boldword** _italicword_ __underword__.`);
    const sig = signature(r);
    assert.match(r.events.find(e => e.text === 'boldword').font, /Bold/);
    assert.match(r.events.find(e => e.text === 'italicword').font, /Italic/);
    const under = r.events.find(e => e.text === 'underword');
    assert.ok(r.events.some(e => e.method === 'drawLine' && e.page === under.page && e.start.y === under.y - 2));
    assert.equal(under.page, sig.page);
    assert.equal(sig.page, n === 0 ? 0 : 1);
    assert.equal(under.y - sig.y, 32); // lineHeight + one paragraphGap + signature lead-in
  }
});
test('B/G: trailing marker flushes preceding text; final image stays with signature', async () => {
  const r = await render(`${filler(10)}\nFinal **boldword**\n[[IMAGE:1]]`, [{ ...image, display_alignment: 'center' }]);
  const sig = assertSignatureTogether(r);
  const before = r.events.findIndex(e => e.text === 'boldword');
  const picture = r.events.findIndex(e => e.method === 'drawImage' && e.width < 500);
  assert.ok(before < picture);
  assert.equal(r.events[picture].page, sig.page);
  assert.ok(r.events[before].page < sig.page || r.events[before].y > r.events[picture].y);
});
test('C: partly image-side final paragraph moves only trailing lines with signature', async () => {
  const r = await render(`${filler(7)}\n[[IMAGE:1]]\n${prose(115)}`, [image]);
  const sig = assertSignatureTogether(r);
  assert.ok(r.events.some(e => /^word\d+$/.test(e.text || '') && e.page < sig.page && e.x > 72));
  assert.equal(bodyLines(r, sig.page).length, 2);
  assert.equal(r.events.filter(e => /^word\d+$/.test(e.text || '')).length, 115);
});
test('D: entirely image-side paragraph participates in orphan protection', async () => {
  const r = await render(`${filler(9)}\n[[IMAGE:1]]\n${prose(12)}`, [image]);
  const sig = assertSignatureTogether(r);
  const picture = r.events.find(e => e.method === 'drawImage' && e.width < 500);
  assert.ok(sig.page > picture.page);
  assert.equal(bodyLines(r, sig.page).length, 2);
});
test('E: long full-width final paragraph moves two lines, not the whole paragraph', async () => {
  const r = await render(`${filler(8)}\n${prose(190)}`);
  const sig = assertSignatureTogether(r);
  assert.equal(bodyLines(r, sig.page).length, 2);
  assert.ok(r.events.some(e => /^word\d+$/.test(e.text || '') && e.page < sig.page));
});
test('F: short final paragraph moves intact and signature image stays in block', async () => {
  const r = await render(`${filler(18)}\nFinal short paragraph.`, [], { signatureImage: true });
  const sig = assertSignatureTogether(r);
  assert.equal(r.events.find(e => e.text === 'Final').page, sig.page);
  assert.equal(r.events.find(e => e.method === 'drawImage' && e.width === 120).page, sig.page);
});
test('G: oversized final image/signature combination fails without reordering', async () => {
  const r = await render('Final paragraph.\n[[IMAGE:1]]', [{ ...image, display_alignment: 'center', display_width_percent: 100 }]);
  assert.match(r.error, /Final image and signature cannot fit together/);
  assert.ok(!r.events.some(e => e.text === 'Warm Regards,'));
});
test('H: image followed by full-width final paragraph retains marker order', async () => {
  const r = await render(`${filler(6)}\n[[IMAGE:1]]\n${prose(80)}`, [{ ...image, display_alignment: 'center' }]);
  assertSignatureTogether(r);
  assert.ok(r.events.findIndex(e => e.method === 'drawImage' && e.width < 500) < r.events.findIndex(e => e.text === 'word0'));
});

test('side-column styles and positions are retained when the signature fits', async () => {
  const r = await render('[[IMAGE:1]]\nFinal **boldword** _italicword_ __underword__.', [image]);
  const sig = assertSignatureTogether(r);
  const bold = r.events.find(e => e.text === 'boldword');
  assert.match(bold.font, /Bold/);
  assert.ok(bold.x > 72);
  assert.equal(bold.page, sig.page);
  assert.match(r.events.find(e => e.text === 'italicword').font, /Italic/);
});
test('ordinary and buffered wrapped lines retain 14-point spacing', async () => {
  const r = await render(`${prose(70)}\n${prose(60)}`);
  signature(r);
  const lines = [...new Set(r.events.filter(e => /^word\d+$/.test(e.text || '')).map(e => e.y))];
  const gaps = lines.slice(1).map((y, i) => lines[i] - y);
  assert.equal(gaps.filter(g => g === 22).length, 1);
  assert.ok(gaps.every(g => g === 14 || g === 22));
});
