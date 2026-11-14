'use strict';
/* FARMA·LAB móvil · Registros del RD 175/2001 en PDF A4:
   materias primas: registro (anexo II) y especificaciones (anexo III) del PN/L/PG/005/00 del Formulario Nacional;
   registro de material de acondicionamiento (apartado 3.3 y PN/L/PG/006, anexo II), y
   ficha 2, registro de formulación magistral (apartado 3.4.2). */

ROUTES.ficha = (arg) => viewRecordSheet(arg);
ROUTES.fichamp = (arg) => viewMaterialSheet(arg);
ROUTES.fichaenv = (arg) => viewPackagingSheet(arg);

async function viewRecordSheet(id) {
  const p = await getOne('production', id);
  if (!p) return empty('Este registro no existe.', '');
  state.parent = `#elaboraciones--${p.uuid}`;
  state.label = null;
  if (!p.lot) return `<p class="msg warn">Esta elaboración aún no tiene lote. La ficha se genera cuando está elaborada.</p>`;
  const s = await loadSettings();
  const missing = pendingItems(p);
  const noPharmacy = !s.pharmacy.name;
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(p.lot)}</h2>${pill('production', p.status)}</div>
      <p>${esc(p.formula_name)} · ${fmtNum(p.target_amount)} ${esc(p.unit)}</p>
    </div>
    ${missing.length
      ? `<div class="msg warn"><strong>Faltan datos:</strong> ${esc(missing.join(', '))}. Se puede generar como borrador; para la ficha definitiva, complétalos en la <a href="#elaboraciones--${esc(p.uuid)}">guía de elaboración</a>.</div>`
      : '<p class="msg ok">La guía de elaboración está completa.</p>'}
    ${p.status === 'elaborada' ? '<p class="hint">Aún no está dispensada: los datos de dispensación saldrán en blanco para rellenarlos a mano.</p>' : ''}
    ${noPharmacy ? '<p class="hint">Escribe los datos de la farmacia en <a href="#ajustes">Ajustes</a> para que aparezcan en la cabecera.</p>' : ''}
    <form class="form" data-form="recordSheet" data-id="${esc(p.uuid)}" novalidate autocomplete="off">
      ${formMsg()}
      <section><h2>Dispensación (opcional)</h2><div class="panel form">
        <div class="grid2">
          ${field('Prescriptor', text('prescriber', 'maxlength="120" autocomplete="off"'))}
          ${field('Nº de colegiado', text('collegiate', 'maxlength="30" autocomplete="off"'))}
        </div>
        ${field('Paciente', text('patient', 'maxlength="120" autocomplete="off"'))}
        <p class="hint">El RD 175/2001 pide en la guía el prescriptor y el paciente. Solo se usan para este PDF: no se guardan en la app ni en las copias. Si los dejas vacíos, salen en blanco para escribirlos a mano.</p>
      </div></section>
      <button class="btn block" type="submit">${missing.length ? 'Generar borrador de la ficha' : 'Generar ficha de registro'}</button>
    </form>
    <div id="sheetOut"></div>`;
}

/** Junta en un objeto todo lo que va en la ficha, a partir del registro de elaboración y del almacén. */
async function recordSheetData(p, extra) {
  const mats = new Map((await getAll('material')).map((m) => [m.uuid, m]));
  const packs = new Map((await getAll('packaging')).map((x) => [x.uuid, x]));
  const ws = p.weighings || [];
  const qc = p.qc || {};
  const yesNo = (v) => (v === true ? 'Sí' : v === false ? 'No' : '—');
  const decision = p.decision === 'aceptada'
    ? `Aceptado el ${fmtDay(p.decision_date)} por ${p.decision_by || '—'}`
    : p.decision === 'rechazada' ? `Rechazado el ${fmtDay(p.decision_date)} por ${p.decision_by || '—'}` : 'Pendiente de decisión';
  return {
    name: [p.formula_name, p.formula_code && `(${p.formula_code}, versión ${p.formula_version || '1'})`].filter(Boolean).join(' '),
    type: FORMULA_TYPES[p.formula_type] || FORMULA_TYPES.fm,
    composition: `${ws.map((w) => `${w.ingredient} ${fmtNum(w.theoretical)} ${w.unit}`).join(' · ')} — para ${fmtNum(p.target_amount)} ${p.unit}`,
    pnts: (p.pnt_refs || []).map((r) => `${r.code} · ${r.title} · versión ${r.version || '1'}`),
    method: str(p.method_notes),
    equipment: (p.equipment || []).join(', '),
    materials: ws.map((w) => {
      const m = w.material_uuid ? mats.get(w.material_uuid) : null;
      const tags = [w.role === 'activo' ? 'PA' : '', w.edo || edoMatch(w.ingredient) ? 'EDO' : ''].filter(Boolean).join(', ');
      return [
        `${w.ingredient}${tags ? ` (${tags})` : ''}`,
        [m && m.internal_no, w.material_lot && `lote ${w.material_lot}`].filter(Boolean).join(' / ') || '—',
        w.supplier || (m && m.supplier) || '—',
        fmtNum(w.theoretical), isNum(w.actual) ? fmtNum(w.actual) : '—', w.unit,
      ];
    }),
    packaging: (p.packaging_used || []).map((u) => {
      const pk = u.packaging_uuid ? packs.get(u.packaging_uuid) : null;
      return [u.name, [pk && pk.internal_no, u.lot && `lote ${u.lot}`].filter(Boolean).join(' / ') || '—', fmtNum(u.qty)];
    }),
    pharmacists: str(p.staff_pharmacists ?? p.operator),
    assistants: str(p.staff_assistants),
    qcTests: (qc.tests || []).filter((t) => str(t.result)).map((t) => [t.test || '—', t.result, yesNo(t.ok)]),   // solo las pruebas realizadas
    qcBy: str(qc.by), qcApparatus: str(qc.apparatus), qcReagents: str(qc.reagents),
    recetario: str(p.recetario_no),
    dispensedDate: isDay(p.dispensed_date) && p.status === 'dispensada' ? fmtDay(p.dispensed_date) : '',
    dispensedQty: isNum(p.dispensed_qty) && p.status === 'dispensada' ? `${fmtNum(p.dispensed_qty)} ${p.unit}` : '',
    prescriber: [extra.prescriber, extra.collegiate && `nº col. ${extra.collegiate}`].filter(Boolean).join(' · '),
    patient: extra.patient,
    notes: str(p.notes),
    decision,
    decisionDate: p.decision ? fmtDay(p.decision_date) : '',
  };
}

/**
 * Motor de maquetación de las fichas en A4 (pdf-lib, Helvetica): cabecera con la farmacia y el título,
 * rejillas de datos, tablas que continúan en la página siguiente, recuadro de conformidad y firma, y pie numerado.
 */
async function createSheet({ title, subtitle, tag, running, footer, pharmacy, draftMissing = [] }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle(running);
  doc.setSubject(`${title} (RD 175/2001)`);
  doc.setCreator('FARMA·LAB');
  doc.setProducer('FARMA·LAB');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const clean = (t) => [...pdfSymbols(t).replace(/[^\S\n]+/g, ' ')]
    .map((ch) => (ch === '\n' || charset.has(ch.codePointAt(0)) ? ch : '?')).join('').trim();
  const mm = (v) => (v * 72) / 25.4;
  const W = mm(210); const H = mm(297); const M = mm(16); const CW = W - 2 * M;
  const FOOT = mm(12);
  const C = {
    ink: rgb(0.106, 0.165, 0.227), muted: rgb(0.345, 0.408, 0.467), accent: rgb(0.039, 0.361, 0.255),
    line: rgb(0.82, 0.86, 0.85), band: rgb(0.925, 0.957, 0.945), head: rgb(0.953, 0.965, 0.961),
    warn: rgb(0.52, 0.31, 0.04), warnBg: rgb(0.984, 0.933, 0.835), bad: rgb(0.64, 0.14, 0.11),
  };
  const pages = [];
  let page; let y;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (pages.length > 1) {
      page.drawText(clean(running), { x: M, y: y - 8, size: 8, font: bold, color: C.muted });
      y -= 14;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: C.line });
      y -= 8;
    }
  };
  const room = (h) => y - h >= M + FOOT;
  const ensure = (h) => { if (!room(h)) newPage(); };

  const wrap = (f, size, value, width) => {
    const out = [];
    for (const para of clean(value).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width && w.length > 1) {   // palabras más largas que la columna
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const next = line ? `${line} ${w}` : w;
        if (!line || f.widthOfTextAtSize(next, size) <= width) line = next; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  };
  const paragraph = (value, { f = font, size = 9.2, color = C.ink, lh = 1.32 } = {}) => {
    for (const ln of wrap(f, size, value, CW)) {
      ensure(size * lh);
      y -= size * lh;
      page.drawText(ln, { x: M, y: y + size * 0.26, size, font: f, color });
    }
  };
  /** Título de apartado; keep = espacio mínimo para que no quede solo al pie de la página. */
  const section = (name, keep = mm(12)) => {
    ensure(mm(14) + keep);
    y -= mm(4.2);
    page.drawText(clean(name), { x: M, y: y - 10, size: 10.5, font: bold, color: C.accent });
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: C.accent });
    y -= mm(2);
  };

  /** Rejilla de datos: etiqueta pequeña arriba y valor debajo. Un valor vacío deja una línea para escribir a mano. */
  const grid = (cells, cols, { bg = null, pad = 0 } = {}) => {
    const gap = mm(4);
    const colW = (CW - 2 * pad - gap * (cols - 1)) / cols;
    const rows = [];
    let i = 0;
    const list = cells.filter(Boolean);
    while (i < list.length) {
      const row = [];
      let used = 0;
      while (i < list.length && used + (list[i].span || 1) <= cols) { row.push(list[i]); used += list[i].span || 1; i += 1; }
      const laid = row.map((c) => {
        const w = colW * (c.span || 1) + gap * ((c.span || 1) - 1);
        const size = c.big ? 15 : 9.4;
        const lines = c.value === '' ? [] : wrap(c.big || c.strong ? bold : font, size, c.value, w);
        return { ...c, w, size, lines, h: 11 + (c.value === '' ? 16 : lines.length * size * 1.28) };
      });
      rows.push({ laid, h: Math.max(...laid.map((c) => c.h)) + mm(2.2) });
    }
    const total = rows.reduce((n, r) => n + r.h, 0) + 2 * pad;
    if (bg && total < H - 2 * M - FOOT) ensure(total);
    if (bg) page.drawRectangle({ x: M, y: y - total, width: CW, height: total, color: bg });
    y -= pad;
    for (const r of rows) {
      ensure(r.h);
      let x = M + pad;
      for (const c of r.laid) {
        page.drawText(clean(c.label), { x, y: y - 8, size: 7.4, font: bold, color: C.muted });
        let ty = y - 11;
        if (c.value === '') {
          page.drawLine({ start: { x, y: ty - 13 }, end: { x: x + c.w, y: ty - 13 }, thickness: 0.6, color: C.line, dashArray: [2, 2] });
        } else {
          for (const ln of c.lines) {
            ty -= c.size * 1.28;
            page.drawText(ln, { x, y: ty + c.size * 0.26, size: c.size, font: c.big || c.strong ? bold : font, color: c.big ? C.accent : c.bad ? C.bad : C.ink });
          }
        }
        x += c.w + gap;
      }
      y -= r.h;
    }
    y -= pad;
  };

  /** Tabla con cabecera sombreada que se repite si salta de página. */
  const table = (cols, rows) => {
    const widths = cols.map((c) => c.w * CW);
    const cp = 4; const size = 8.8;
    const header = () => {
      const lines = cols.map((c, i) => wrap(bold, 7.6, c.title, widths[i] - 2 * cp));
      const h = Math.max(...lines.map((l) => l.length)) * 7.6 * 1.25 + 2 * cp;
      ensure(h + 18);
      page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: C.head });
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const tw = bold.widthOfTextAtSize(ln, 7.6);
          const tx = cols[i].right ? x + widths[i] - cp - tw : x + cp;
          page.drawText(ln, { x: tx, y: y - cp - (k + 1) * 7.6 * 1.25 + 2, size: 7.6, font: bold, color: C.muted });
        });
        x += widths[i];
      });
      y -= h;
    };
    header();
    const body = rows.length ? rows : [cols.map((_, i) => (i === 0 ? 'Sin registros' : ''))];
    for (const row of body) {
      const lines = row.map((v, i) => wrap(font, size, v, widths[i] - 2 * cp));
      const h = Math.max(...lines.map((l) => l.length)) * size * 1.28 + 2 * cp;
      if (!room(h)) { newPage(); header(); }
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const tw = font.widthOfTextAtSize(ln, size);
          const tx = cols[i].right ? x + widths[i] - cp - tw : x + cp;
          page.drawText(ln, { x: tx, y: y - cp - (k + 1) * size * 1.28 + size * 0.3, size, font, color: rows.length ? C.ink : C.muted });
        });
        x += widths[i];
      });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: C.line });
    }
  };

  /** Recuadro final: decisión a la izquierda, fecha y firma del farmacéutico responsable a la derecha. */
  const signature = ({ decision, rejected = false, signer = '' }) => {
    const boxH = mm(30);
    ensure(boxH + mm(8));
    y -= mm(6);
    const half = CW / 2;
    page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, borderColor: C.ink, borderWidth: 0.8 });
    page.drawLine({ start: { x: M + half, y }, end: { x: M + half, y: y - boxH }, thickness: 0.8, color: C.ink });
    page.drawText('Conformidad', { x: M + mm(4), y: y - mm(4) - 7, size: 7.6, font: bold, color: C.muted });
    wrap(bold, 10, decision, half - mm(8)).forEach((ln, k) => {
      page.drawText(ln, { x: M + mm(4), y: y - mm(10) - 10 - k * 13, size: 10, font: bold, color: rejected ? C.bad : C.ink });
    });
    page.drawText('Fecha y firma del farmacéutico responsable', { x: M + half + mm(4), y: y - mm(4) - 7, size: 7.6, font: bold, color: C.muted });
    const signY = y - boxH + mm(9);
    page.drawLine({ start: { x: M + half + mm(4), y: signY }, end: { x: W - M - mm(4), y: signY }, thickness: 0.6, color: C.line });
    const who = clean(signer);
    if (who) page.drawText(who, { x: M + half + mm(4), y: signY - 11, size: 8.4, font, color: C.muted });
    y -= boxH;
  };

  const finish = async () => {
    const stamp = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    pages.forEach((pg, i) => {
      pg.drawLine({ start: { x: M, y: M + mm(5) }, end: { x: W - M, y: M + mm(5) }, thickness: 0.5, color: C.line });
      pg.drawText(clean(`${footer}${draftMissing.length ? ' · BORRADOR' : ''}`), { x: M, y: M, size: 7.4, font, color: C.muted });
      const right = clean(`Página ${i + 1} de ${pages.length} · Generada el ${stamp}`);
      pg.drawText(right, { x: W - M - font.widthOfTextAtSize(right, 7.4), y: M, size: 7.4, font, color: C.muted });
    });
    return new Blob([await doc.save()], { type: 'application/pdf' });
  };

  // ---------------- cabecera de la primera página
  newPage();
  const ph = pharmacy || {};
  page.drawText(clean(ph.name || 'Oficina de farmacia'), { x: M, y: y - 10, size: 10.5, font: bold, color: C.ink });
  page.drawText(clean(tag), { x: W - M - font.widthOfTextAtSize(clean(tag), 8), y: y - 9, size: 8, font, color: C.muted });
  y -= 13;
  const contact = clean([ph.address, ph.phone && `Tel. ${ph.phone}`].filter(Boolean).join(' · '));
  if (contact) { page.drawText(contact, { x: M, y: y - 9, size: 8.2, font, color: C.muted }); y -= 11; }
  y -= mm(5);
  const titleSize = bold.widthOfTextAtSize(clean(title), 18) > CW ? 15 : 18;
  page.drawText(clean(title), { x: M, y: y - titleSize, size: titleSize, font: bold, color: C.ink });
  y -= titleSize + 5;
  if (subtitle) { page.drawText(clean(subtitle), { x: M, y: y - 10, size: 9.5, font, color: C.muted }); }
  y -= mm(7);
  if (draftMissing.length) {
    const lines = wrap(font, 8.6, `Faltan datos: ${draftMissing.join(', ')}.`, CW - mm(8));
    const h = 14 + lines.length * 8.6 * 1.3 + mm(3);
    page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: C.warnBg });
    page.drawText('Borrador: ficha incompleta', { x: M + mm(4), y: y - mm(2) - 9, size: 9.5, font: bold, color: C.warn });
    let ty = y - mm(2) - 12;
    lines.forEach((ln) => { ty -= 8.6 * 1.3; page.drawText(ln, { x: M + mm(4), y: ty + 2.2, size: 8.6, font, color: C.warn }); });
    y -= h + mm(4);
  }
  const gap = (v) => { y -= v; };
  return { mm, C, bold, grid, table, paragraph, section, signature, finish, gap };
}

/** Ficha 2: guía de elaboración, control y registro de una fórmula magistral. */
async function buildRecordSheetPdf(p, d, s, draftMissing) {
  const sh = await createSheet({
    title: 'Ficha de registro de formulación magistral', subtitle: 'Guía de elaboración, control y registro', tag: 'RD 175/2001 · Ficha 2',
    running: `Ficha de registro de formulación magistral · Lote ${p.lot}`, footer: `FARMA·LAB · Lote ${p.lot}`, pharmacy: s.pharmacy, draftMissing,
  });
  const { mm, C, bold } = sh;
  sh.grid([
    { label: 'Registro / Lote', value: p.lot, big: true, span: 2 },
    { label: 'Registro de elaboración', value: p.record_code },
    { label: 'Nombre', value: d.name, strong: true, span: 3 },
    { label: 'Tipo', value: d.type },
    { label: 'Forma farmacéutica', value: p.form || '—' },
    { label: 'Vía de administración', value: p.route || '—' },
    { label: 'Cantidad elaborada', value: `${fmtNum(p.target_amount)} ${p.unit}` },
    { label: 'Fecha de elaboración', value: fmtDay(p.elaborated_date) },
    { label: 'Fecha de caducidad', value: fmtDay(p.expiry_date) },
    p.cn && p.cn.cn ? { label: 'Código nacional', value: p.cn.cn } : null,
    { label: 'Condiciones de conservación', value: p.storage || '—', span: p.cn && p.cn.cn ? 2 : 3 },
  ], 3, { bg: C.band, pad: mm(4) });

  sh.section('Composición');
  sh.paragraph(d.composition);

  sh.section('Modus operandi');
  if (d.pnts.length) d.pnts.forEach((t) => sh.paragraph(t, { f: bold, size: 9 }));
  if (d.method) { if (d.pnts.length) sh.gap(3); sh.paragraph(d.method); }
  if (!d.pnts.length && !d.method) sh.paragraph('—', { color: C.muted });

  sh.section('Utillaje utilizado');
  sh.paragraph(d.equipment || '—', { color: d.equipment ? C.ink : C.muted });

  sh.section('Datos de las materias primas', mm(22));
  sh.table([
    { title: 'Principios activos / Excipientes', w: 0.29 },
    { title: 'Nº control o lote', w: 0.22 },
    { title: 'Proveedor', w: 0.17 },
    { title: 'Cantidad teórica', w: 0.11, right: true },
    { title: 'Cantidad pesada', w: 0.11, right: true },
    { title: 'Unidad', w: 0.10 },
  ], d.materials);
  sh.gap(3);
  sh.paragraph('PA: principio activo · EDO: excipiente de declaración obligatoria', { size: 7.4, color: C.muted });

  sh.section('Datos del material de acondicionamiento', mm(18));
  sh.table([{ title: 'Tipo', w: 0.55 }, { title: 'Nº control o lote', w: 0.30 }, { title: 'Unidades', w: 0.15, right: true }], d.packaging);

  sh.section('Personal elaborador', mm(14));
  sh.grid([{ label: 'Farmacéutico/s', value: d.pharmacists }, { label: 'Auxiliares (nombre y apellidos)', value: d.assistants || '—' }], 2);

  sh.section('Control de calidad', mm(24));
  sh.table([{ title: 'Prueba realizada', w: 0.38 }, { title: 'Resultado', w: 0.47 }, { title: 'Conforme', w: 0.15 }], d.qcTests);
  sh.gap(mm(2));
  sh.grid([
    { label: 'Número de control', value: p.record_code },
    { label: 'Realizado por', value: d.qcBy || '—' },
    { label: 'Fecha de caducidad', value: fmtDay(p.expiry_date) },
    { label: 'Aparataje', value: d.qcApparatus || '—' },
    { label: 'Reactivos y su lote', value: d.qcReagents || '—', span: 2 },
  ], 3);

  sh.section('Datos de dispensación', mm(26));
  sh.grid([
    { label: 'Nº de registro del Libro Recetario', value: d.recetario },
    { label: 'Fecha de dispensación', value: d.dispensedDate },
    { label: 'Cantidad dispensada', value: d.dispensedQty },
    { label: 'Facultativo prescriptor', value: d.prescriber, span: 2 },
    { label: 'Paciente', value: d.patient },
  ], 3);

  sh.section('Observaciones');
  sh.paragraph(d.notes || '—', { color: d.notes ? C.ink : C.muted });

  sh.signature({
    decision: d.decision, rejected: p.decision === 'rechazada',
    signer: [s.pharmacy.pharmacist || p.decision_by, d.decisionDate && `Fecha: ${d.decisionDate}`].filter(Boolean).join(' · '),
  });
  return sh.finish();
}

/** Signos frecuentes en especificaciones que la fuente del PDF no tiene: se escriben con equivalentes. */
function pdfSymbols(t) {
  return String(t ?? '').replace(/−/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≈/g, '~').replace(/≠/g, '!=')
    .replace(/[\u2009\u202f\u00a0]/g, ' ').replace(/→/g, '->');
}
// ------------------------------------------------------------------ materias primas: PN/L/PG/005/00 del Formulario Nacional
/*
 * Registro de materias primas (anexo II) y especificaciones (anexo III) del procedimiento
 * «Recepción, control de conformidad y almacenamiento de materias primas» del Formulario Nacional,
 * con su cabecera de procedimiento (título, código, página y procedimientos relacionados).
 */
const FN_MP_TITLE = 'Recepción, control de conformidad y almacenamiento de materias primas';

/** Motor de hojas con el formato de los procedimientos del Formulario Nacional (A4 vertical, tablas con bordes). */
async function createFnSheet({ code, related, procTitle, pharmacy, subject, draftMissing = [] }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle(subject);
  doc.setSubject(`${procTitle} (${code})`);
  doc.setCreator('FARMA·LAB');
  doc.setProducer('FARMA·LAB');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const clean = (t) => [...pdfSymbols(t).replace(/[^\S\n]+/g, ' ')]
    .map((ch) => (ch === '\n' || charset.has(ch.codePointAt(0)) ? ch : '?')).join('').trim();
  const mm = (v) => (v * 72) / 25.4;
  const W = mm(210); const H = mm(297); const M = mm(15); const CW = W - 2 * M;
  const FOOT = mm(10);
  const K = {
    ink: rgb(0, 0, 0), mid: rgb(0.33, 0.33, 0.33), rule: rgb(0, 0, 0), fill: rgb(0.88, 0.88, 0.88),
    faint: rgb(0.7, 0.7, 0.7), warn: rgb(0.52, 0.31, 0.04), warnBg: rgb(0.984, 0.933, 0.835),
  };
  const wrap = (f, size, value, width) => {
    const out = [];
    for (const para of clean(value).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const next = line ? `${line} ${w}` : w;
        if (!line || f.widthOfTextAtSize(next, size) <= width) line = next; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  };
  const rect = (pg, x, top, w, h, fill) => pg.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: K.rule, borderWidth: 0.7, ...(fill ? { color: fill } : {}) });
  const vline = (pg, x, top, h) => pg.drawLine({ start: { x, y: top }, end: { x, y: top - h }, thickness: 0.7, color: K.rule });
  const text = (pg, t, x, yy, size, f = font, color = K.ink) => pg.drawText(t, { x, y: yy, size, font: f, color });

  // Cabecera de procedimiento en cada página: título | código y página; procedimientos relacionados.
  const titleLines = wrap(bold, 10.5, procTitle, CW * 0.68 - mm(6));
  const row1H = Math.max(titleLines.length * 13 + mm(5), mm(14));
  const row2H = mm(6.5);
  const HEAD_H = 12 + row1H + row2H;
  const pages = []; const pageSlots = [];
  let page; let y;
  const drawHeader = (pg) => {
    let top = H - M;
    text(pg, clean(pharmacy && pharmacy.name ? pharmacy.name : 'Oficina de farmacia'), M, top - 8, 8.5, bold);
    const pnt = 'PROCEDIMIENTOS NORMALIZADOS DE TRABAJO';
    text(pg, pnt, W - M - font.widthOfTextAtSize(pnt, 7.5), top - 8, 7.5, font, K.mid);
    top -= 12;
    const leftW = CW * 0.68;
    rect(pg, M, top, CW, row1H + row2H);
    vline(pg, M + leftW, top, row1H);
    pg.drawLine({ start: { x: M, y: top - row1H }, end: { x: M + CW, y: top - row1H }, thickness: 0.7, color: K.rule });
    const ty0 = top - (row1H - titleLines.length * 13) / 2 - 10;
    titleLines.forEach((ln, i) => text(pg, ln, M + mm(3), ty0 - i * 13, 10.5, bold));
    text(pg, 'Código:', M + leftW + mm(3), top - mm(5), 7.5, font, K.mid);
    text(pg, clean(code), M + leftW + mm(3) + font.widthOfTextAtSize('Código: ', 7.5), top - mm(5), 9, bold);
    pageSlots.push({ pg, x: M + leftW + mm(3), y: top - row1H + mm(3.2) });
    const rel = clean(`Procedimientos relacionados: ${related || ''}`);
    text(pg, wrap(font, 8, rel, CW - mm(6))[0], M + mm(3), top - row1H - row2H + mm(2.1), 8);
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    drawHeader(page);
    y = H - M - HEAD_H - mm(5);
  };
  const room = (h) => y - h >= M + FOOT;
  const ensure = (h) => { if (!room(h)) { newPage(); return true; } return false; };

  /** «ANEXO II» y el nombre del registro, centrados, como en el Formulario Nacional. */
  const heading = (annex, title) => {
    ensure(mm(30));
    const a = clean(annex); const t = clean(title);
    text(page, a, (W - bold.widthOfTextAtSize(a, 10)) / 2, y - 10, 10, bold);
    text(page, t, (W - bold.widthOfTextAtSize(t, 13)) / 2, y - 27, 13, bold);
    y -= 27 + mm(6);
  };
  /** Tabla con todos los bordes; la cabecera se repite al pasar de página. */
  const table = (cols, rows, { size = 7.2, headSize = 6.6, minH = 0, fill = false } = {}) => {
    const widths = cols.map((c) => c.w * CW);
    const cp = 2.6;
    const header = () => {
      const lines = cols.map((c, i) => wrap(bold, headSize, c.title, widths[i] - 2 * cp));
      const h = Math.max(...lines.map((l) => l.length)) * headSize * 1.2 + 2 * cp + 2;
      ensure(h + Math.max(minH, 20));
      rect(page, M, y, CW, h, K.fill);
      let x = M;
      lines.forEach((ls, i) => {
        if (i) vline(page, x, y, h);
        const block = ls.length * headSize * 1.2;
        ls.forEach((ln, k) => {
          const tw = bold.widthOfTextAtSize(ln, headSize);
          text(page, ln, x + (widths[i] - tw) / 2, y - (h - block) / 2 - (k + 1) * headSize * 1.2 + 2, headSize, bold);
        });
        x += widths[i];
      });
      y -= h;
    };
    const drawRow = (row) => {
      const lines = row.map((v, i) => wrap(i === 0 ? bold : font, size, v, widths[i] - 2 * cp));
      const h = Math.max(minH, Math.max(...lines.map((l) => l.length)) * size * 1.25 + 2 * cp + 1);
      if (!room(h)) { newPage(); header(); }
      rect(page, M, y, CW, h);
      let x = M;
      lines.forEach((ls, i) => {
        if (i) vline(page, x, y, h);
        ls.forEach((ln, k) => text(page, ln, x + cp, y - cp - (k + 1) * size * 1.25 + 2, size, i === 0 ? bold : font));
        x += widths[i];
      });
      y -= h;
    };
    header();
    rows.forEach(drawRow);
    if (fill) {   // filas en blanco hasta el pie, para seguir anotando a mano
      const h = Math.max(minH, size * 1.25 + 2 * cp + 1);
      while (room(h)) drawRow(cols.map(() => ''));
    }
  };
  /** Recuadro con título («Observaciones:») y texto; si no cabe, continúa en la página siguiente. */
  const box = (label, value, { minH = mm(18), size = 8 } = {}) => {
    const lines = wrap(font, size, value, CW - mm(6));
    const lh = size * 1.3;
    let i = 0; let first = true;
    do {
      ensure(Math.min(minH, 40) + 16);
      const avail = Math.floor((y - (M + FOOT) - mm(5) - 14) / lh);
      const chunk = lines.slice(i, i + Math.max(1, avail));
      const h = Math.max(first ? minH : 0, chunk.length * lh + mm(5) + 12);
      rect(page, M, y, CW, h);
      text(page, clean(first ? label : `${label} (continuación)`), M + mm(3), y - mm(2.5) - 7, 8, bold);
      chunk.forEach((ln, k) => text(page, ln, M + mm(3), y - mm(2.5) - 9 - (k + 1) * lh + 2, size));
      y -= h;
      i += chunk.length; first = false;
      if (i < lines.length) newPage();
    } while (i < lines.length);
  };
  /** Fila con bordes: etiqueta en negrita y valor. */
  const field1 = (label, value) => {
    const l = clean(label);
    const lw = bold.widthOfTextAtSize(l, 8.5) + mm(5);
    const lines = wrap(font, 9.5, value, CW - lw - mm(4));
    const h = Math.max(mm(9), lines.length * 12 + mm(4));
    ensure(h);
    rect(page, M, y, CW, h);
    text(page, l, M + mm(3), y - h / 2 - 3, 8.5, bold);
    lines.forEach((ln, k) => text(page, ln, M + lw, y - (h - lines.length * 12) / 2 - 9 - k * 12, 9.5));
    y -= h;
  };
  /** Casillas (☐/☒) con un dato a la derecha, en un recuadro. */
  const checks = (items) => {
    const rh = mm(8.5);
    const h = rh * items.length;
    ensure(h);
    rect(page, M, y, CW, h);
    items.forEach((it, i) => {
      const top = y - i * rh;
      if (i) page.drawLine({ start: { x: M, y: top }, end: { x: M + CW, y: top }, thickness: 0.4, color: K.faint });
      const bx = M + mm(3); const by = top - rh / 2 - 4.5;
      page.drawRectangle({ x: bx, y: by, width: 9, height: 9, borderColor: K.rule, borderWidth: 0.8 });
      if (it.on) {
        page.drawLine({ start: { x: bx + 1.6, y: by + 1.6 }, end: { x: bx + 7.4, y: by + 7.4 }, thickness: 1.1, color: K.ink });
        page.drawLine({ start: { x: bx + 1.6, y: by + 7.4 }, end: { x: bx + 7.4, y: by + 1.6 }, thickness: 1.1, color: K.ink });
      }
      text(page, clean(it.label), bx + 15, by + 1.5, 9.5, it.on ? bold : font);
      if (it.extraLabel) {
        const ex = M + CW * 0.42;
        text(page, clean(it.extraLabel), ex, by + 1.5, 8.5, font, K.mid);
        const vx = ex + font.widthOfTextAtSize(clean(it.extraLabel), 8.5) + 4;
        page.drawLine({ start: { x: vx, y: by - 1 }, end: { x: M + CW - mm(3), y: by - 1 }, thickness: 0.5, color: K.faint, dashArray: [1.5, 1.5] });
        if (it.extra) text(page, wrap(font, 9.5, it.extra, M + CW - mm(3) - vx)[0], vx + 2, by + 1.5, 9.5);
      }
    });
    y -= h;
  };
  /** Tabla de dos columnas: apartado (sombreado) y contenido; un apartado vacío deja sitio para escribir. */
  const kv = (rows, { labelW = 0.34, minH = mm(13) } = {}) => {
    const lw = CW * labelW; const vw = CW - lw;
    for (const [label, value] of rows) {
      const ll = wrap(bold, 8.5, label, lw - mm(5));
      const vl = str(value) ? wrap(font, 9, value, vw - mm(5)) : [];
      const h = Math.max(minH, ll.length * 11 + mm(4), vl.length * 11.5 + mm(4));
      ensure(h);
      rect(page, M, y, lw, h, K.fill);
      rect(page, M + lw, y, vw, h);
      ll.forEach((ln, k) => text(page, ln, M + mm(2.5), y - mm(2.2) - 8 - k * 11, 8.5, bold));
      vl.forEach((ln, k) => text(page, ln, M + lw + mm(2.5), y - mm(2.2) - 8 - k * 11.5, 9));
      y -= h;
    }
  };
  const gap = (v) => { y -= v; };
  const draft = () => {
    if (!draftMissing.length) return;
    const lines = wrap(font, 8.4, `Faltan datos: ${draftMissing.join('; ')}.`, CW - mm(8));
    const h = 13 + lines.length * 8.4 * 1.3 + mm(3);
    ensure(h);
    page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: K.warnBg });
    text(page, 'Borrador: registro incompleto', M + mm(4), y - mm(2) - 9, 9.2, bold, K.warn);
    let ty = y - mm(2) - 11;
    lines.forEach((ln) => { ty -= 8.4 * 1.3; text(page, ln, M + mm(4), ty + 2, 8.4, font, K.warn); });
    y -= h + mm(4);
  };
  const finish = async () => {
    const stamp = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    pageSlots.forEach(({ pg, x, y: py }, i) => {
      text(pg, `Página ${i + 1} de ${pages.length}`, x, py, 9, bold);
      const foot = clean(`${draftMissing.length ? 'BORRADOR · ' : ''}Generado con FARMA·LAB el ${stamp}`);
      text(pg, foot, W - M - font.widthOfTextAtSize(foot, 6.8), M, 6.8, font, K.mid);
    });
    return new Blob([await doc.save()], { type: 'application/pdf' });
  };
  newPage();
  return { mm, heading, table, box, field1, checks, kv, gap, draft, newPage, finish };
}

const MP_DECISION = { aceptado: 'Aceptada', rechazado: 'Rechazada', bloqueado: 'Bloqueada', cuarentena: 'Pendiente (cuarentena)' };
const yesNoMark = (v) => (v === true ? 'conforme' : v === false ? 'NO conforme' : 'sin valorar');
/** Fila del registro de materias primas (anexo II), en el orden de sus columnas. */
function mpRegisterRow(m) {
  const qty = isNum(m.quantity_received) ? m.quantity_received : m.quantity;
  const decided = ['aceptado', 'rechazado', 'bloqueado'].includes(m.status) && isDay(m.decision_date);
  return [
    m.internal_no || '', m.name, m.supplier || '', m.lot, m.qc_no || '', isDay(m.received_date) ? fmtDay(m.received_date) : '',
    isNum(qty) ? `${fmtNum(qty)} ${m.unit}` : '', m.containers ? String(m.containers) : '',
    MP_DECISION[m.status] || m.status, decided ? fmtDay(m.decision_date) : '', decided ? (m.decision_by || '') : '',
  ];
}
/** Observaciones de un lote para el registro: caducidad, recepción, conformidad, destino, revisión y notas. */
function mpObservation(m, bulletins = []) {
  const parts = [];
  if (isDay(m.expiry)) parts.push(`Caducidad: ${fmtDay(m.expiry)}`);
  if (isDay(m.retest_date)) parts.push(`Próximo control analítico: ${fmtDay(m.retest_date)}`);
  const rc = m.reception || {};
  if (inspectionDone(rc)) parts.push(`Recepción conforme (albarán, material y envases)${rc.date ? ` el ${fmtDay(rc.date)}` : ''}${rc.by ? ` por ${rc.by}` : ''}`);
  else parts.push('Inspección en la recepción no registrada');
  const qc = m.qc || {};
  const tests = (qc.tests || []).filter((t) => str(t.result));
  if (tests.length) parts.push(`Control de conformidad${isDay(qc.date) ? ` (${fmtDay(qc.date)}${qc.by ? `, ${qc.by}` : ''})` : ''}: ${tests.map((t) => `${t.test || 'ensayo'}: ${t.result} (${yesNoMark(t.ok)})`).join('; ')}`);
  if (bulletins.length) parts.push(`Boletín de análisis del proveedor archivado`);
  if (packIncluded(m)) parts.push(`Su envase sirve de acondicionamiento: ${m.pack_desc}`);
  if (m.status === 'rechazado') {
    const d = m.disposal;
    parts.push(d && DISPOSALS[d.method] ? `${DISPOSALS[d.method]} el ${fmtDay(d.date)}${d.detail ? ` (${d.detail})` : ''}${d.by ? `, ${d.by}` : ''}` : 'Destino del lote rechazado pendiente de registrar');
  }
  const r = lastReview(m);
  if (r) parts.push(`Revisión anual: ${fmtDay(r.date)} (${r.by})`);
  if (str(m.observations)) parts.push(m.observations);
  return parts.join('. ').replace(/\.\./g, '.');
}
// Anchos en mm sobre los 180 mm útiles: las fechas caben en una línea y la firma tiene sitio para firmar a mano.
const MP_COLS = [
  ['Registro interno', 15], ['Nombre del producto', 24], ['Proveedor', 17], ['Lote', 16], ['Control de calidad', 16],
  ['Fecha de recepción', 17], ['Cantidad', 14], ['Número de envases', 12], ['Decisión final', 15], ['Fecha', 17], ['Firma', 17],
].map(([title, w]) => ({ title, w: w / 180 }));
/** Anexo II: registro de materias primas (uno o varios lotes). */
async function drawMpRegister(sh, lots, bulletinsOf, { fill = false } = {}) {
  sh.heading('ANEXO II', 'Registro de materias primas');
  sh.draft();
  sh.table(MP_COLS, lots.map(mpRegisterRow), { minH: sh.mm(11), fill: false });
  sh.gap(sh.mm(4));
  const notes = lots.map((m) => {
    const o = mpObservation(m, bulletinsOf(m));
    return lots.length > 1 ? `${m.internal_no || 's/n'} · ${m.name} (lote ${m.lot}): ${o}` : o;
  });
  sh.box('Observaciones:', notes.join('\n'), { minH: sh.mm(fill ? 30 : 40) });
}
/** Anexo III: especificaciones de la materia prima. */
function drawMpSpecs(sh, m) {
  sh.heading('ANEXO III', 'Especificaciones');
  sh.field1('Nombre de la materia prima:', m.name);
  sh.gap(sh.mm(3));
  sh.checks([
    { on: m.spec_source === 'rfe', label: 'Cumple RFE', extraLabel: 'Monografía n.º', extra: m.spec_source === 'rfe' ? m.spec_monograph_no : '' },
    { on: m.spec_source === 'otra', label: 'Otra farmacopea', extraLabel: 'Farmacopea', extra: m.spec_source === 'otra' ? m.spec_pharmacopoeia : '' },
    { on: m.spec_source === 'fabricante', label: 'Fabricante o proveedor', extraLabel: '', extra: '' },
  ]);
  sh.gap(sh.mm(3));
  sh.kv([
    ['Monografía', m.monograph],
    ['Identificación', m.spec_identification],
    ['Impurezas', m.spec_impurities],
    ['Descripción de los procedimientos analíticos', specMethods(m)],
    ['Condiciones de conservación', m.storage],
    ['Precauciones al manipular', m.handling],
    ['Toxicidad y peligrosidad', m.toxicity],
  ]);
}

/** Datos que pide el PN/L/PG/005/00 y faltan en un lote. */
function materialSheetMissing(m) {
  const miss = [];
  if (!m.internal_no) miss.push('nº de registro interno');
  if (!str(m.supplier)) miss.push('proveedor');
  if (!str(m.qc_no)) miss.push('nº de control de calidad');
  if (!isDay(m.received_date)) miss.push('fecha de recepción');
  if (!isNum(m.quantity_received) && !isNum(m.quantity)) miss.push('cantidad');
  if (!m.containers) miss.push('número de envases');
  if (!isDay(m.expiry) && !isDay(m.retest_date)) miss.push('fecha de caducidad o del próximo control analítico');
  if (!inspectionDone(m.reception)) miss.push('inspección en la recepción');
  miss.push(...specMissing(m).map((x) => `especificaciones: ${x}`));
  if (!['aceptado', 'rechazado'].includes(m.status) || !isDay(m.decision_date)) miss.push('decisión final (aceptación o rechazo), fecha y firma');
  if (m.status === 'rechazado' && !(m.disposal && DISPOSALS[m.disposal.method])) miss.push('destino del lote rechazado');
  return miss;
}

async function viewMaterialSheet(id) {
  const m = await getOne('material', id);
  if (!m) return empty('Este lote no existe.', '');
  state.parent = `#materias--${m.uuid}`;
  state.label = null;
  const s = await loadSettings();
  const missing = materialSheetMissing(m);
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(m.name)}</h2>${pill('material', m.status)}</div>
      <p>${m.internal_no ? `${esc(m.internal_no)} · ` : ''}Lote ${esc(m.lot)}${m.supplier ? ` · ${esc(m.supplier)}` : ''}</p>
      <p class="hint">Formato del ${esc(s.fn.mp_code)} del Formulario Nacional: anexo II (registro de materias primas) con este lote y anexo III (especificaciones).</p>
    </div>
    ${missing.length
      ? `<div class="msg warn"><strong>Faltan datos:</strong> ${esc(missing.join('; '))}. Se puede generar como borrador; para el definitivo, complétalos en la <a href="#materias--${esc(m.uuid)}">ficha del lote</a>.</div>`
      : '<p class="msg ok">El registro del lote está completo.</p>'}
    <form class="form" data-form="materialSheet" data-id="${esc(m.uuid)}" novalidate>
      ${formMsg()}
      <button class="btn block" type="submit">${missing.length ? 'Generar borrador' : 'Generar registro y especificaciones'}</button>
    </form>
    <p class="more"><a href="#registromp">Registro de todos los lotes (anexo II)</a></p>
    <div id="sheetOut"></div>`;
}

/** Lote: anexo II (su línea del registro y observaciones) y anexo III (especificaciones). */
async function buildMaterialSheetPdf(m, s, bulletins, draftMissing) {
  const sh = await createFnSheet({
    code: s.fn.mp_code, related: s.fn.mp_related, procTitle: FN_MP_TITLE, pharmacy: s.pharmacy,
    subject: `Registro y especificaciones · ${m.name} · lote ${m.lot}`, draftMissing,
  });
  await drawMpRegister(sh, [m], () => bulletins);
  sh.newPage();
  drawMpSpecs(sh, m);
  return sh.finish();
}
/** Registro de materias primas de un periodo: anexo II con todos los lotes. */
async function buildMpRegisterPdf(lots, s, period) {
  const sh = await createFnSheet({
    code: s.fn.mp_code, related: s.fn.mp_related, procTitle: FN_MP_TITLE, pharmacy: s.pharmacy,
    subject: `Registro de materias primas · ${period}`,
  });
  const docs = await getAll(FILE_STORE);
  const bulletinsOf = (m) => docs.filter((f) => f.owner_uuid === m.uuid && f.kind === 'boletin').map((f) => f.name);
  await drawMpRegister(sh, lots, bulletinsOf, { fill: true });
  return sh.finish();
}

ROUTES.registromp = () => viewMpRegister();
async function viewMpRegister() {
  state.parent = '#materias';
  state.label = null;
  const s = await loadSettings();
  const lots = await getAll('material');
  const years = [...new Set(lots.map((m) => String(m.received_date || m.created_at || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse();
  const current = String(new Date().getFullYear());
  if (!years.includes(current)) years.unshift(current);
  return `<div class="panel stack">
      <h2 class="big">Registro de materias primas</h2>
      <p>Anexo II del ${esc(s.fn.mp_code)} del Formulario Nacional: un lote por línea, por fecha de recepción, con sus observaciones (caducidad, recepción, control de conformidad, destino de los rechazados y revisión anual).</p>
    </div>
    <form class="form" data-form="mpRegister" novalidate>
      ${formMsg()}
      ${field('Lotes recibidos en', `<select name="period">${options([...years, 'todos'], current, { todos: 'Todos los años' })}</select>`)}
      <button class="btn block" type="submit">Generar el registro</button>
    </form>
    <div id="sheetOut"></div>`;
}

// ------------------------------------------------------------------ registro de material de acondicionamiento
/** Datos del registro (apartado 3.3) que faltan en un material de acondicionamiento. */
function packagingSheetMissing(p) {
  const miss = [];
  if (!p.internal_no) miss.push('nº de registro interno');
  if (!str(p.supplier)) miss.push('proveedor');
  if ((p.kind || 'primario') === 'primario' && !str(p.lot)) miss.push('nº de lote (acondicionamiento primario)');
  if (!isDay(p.received_date)) miss.push('fecha de recepción');
  if (!inspectionDone(p.inspection)) miss.push('inspección en la recepción');
  if (!['aceptado', 'rechazado'].includes(p.status) || !isDay(p.decision_date)) miss.push('decisión de aceptación o rechazo');
  return miss;
}

async function viewPackagingSheet(id) {
  const p = await getOne('packaging', id);
  if (!p) return empty('Este material no existe.', '');
  state.parent = `#envases--${p.uuid}`;
  state.label = null;
  const missing = packagingSheetMissing(p);
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(p.name)}</h2>${pill('packaging', p.status)}</div>
      <p>${p.internal_no ? `${esc(p.internal_no)} · ` : ''}${esc(PACK_KINDS[p.kind] || 'Primario')}${p.lot ? ` · Lote ${esc(p.lot)}` : ''}${p.supplier ? ` · ${esc(p.supplier)}` : ''}</p>
    </div>
    ${missing.length
      ? `<div class="msg warn"><strong>Faltan datos:</strong> ${esc(missing.join(', '))}. Se puede generar como borrador; para el registro definitivo, complétalos en <a href="#envases--${esc(p.uuid)}--editar">Editar ficha</a>.</div>`
      : '<p class="msg ok">El registro del material está completo.</p>'}
    <form class="form" data-form="packagingSheet" data-id="${esc(p.uuid)}" novalidate>
      ${formMsg()}
      <button class="btn block" type="submit">${missing.length ? 'Generar borrador del registro' : 'Generar registro'}</button>
    </form>
    <div id="sheetOut"></div>`;
}

/** Registro de material de acondicionamiento: identificación, recepción e inspección, uso, observaciones y decisión. */
async function buildPackagingSheetPdf(p, s, used, docs, draftMissing) {
  const sh = await createSheet({
    title: 'Registro de material de acondicionamiento', subtitle: 'Recepción, inspección y decisión de aceptación', tag: 'RD 175/2001 · Apartado 3.3',
    running: `Registro de material de acondicionamiento · ${p.name}${p.lot ? ` · lote ${p.lot}` : ''}`,
    footer: `FARMA·LAB · ${p.internal_no || p.name}`, pharmacy: s.pharmacy, draftMissing,
  });
  const { mm, C } = sh;
  const primary = (p.kind || 'primario') === 'primario';
  const qty = isNum(p.quantity_received) ? p.quantity_received : p.quantity;
  sh.grid([
    { label: 'Número de registro interno', value: p.internal_no || '—', big: true, span: 2 },
    { label: 'Estado', value: STATUS.packaging[p.status] || p.status },
    { label: 'Identificación del producto', value: `${p.name}${p.capacity ? `, ${p.capacity}` : ''}`, strong: true, span: 2 },
    { label: 'Acondicionamiento', value: PACK_KINDS[p.kind] || 'Primario' },
    { label: 'Proveedor', value: p.supplier || '—' },
    { label: 'Lote', value: p.lot || (primary ? '—' : 'No procede') },
    { label: 'Fecha de recepción', value: fmtDay(p.received_date) },
    { label: 'Cantidad', value: isNum(qty) ? `${fmtNum(qty)} unidades` : '—' },
    { label: 'Nº de envases', value: p.containers ? `${p.containers} ${p.containers === 1 ? 'caja o paquete' : 'cajas o paquetes'}` : '—' },
    { label: 'Fecha de caducidad', value: isDay(p.expiry) ? fmtDay(p.expiry) : 'No procede' },
    { label: 'Condiciones de conservación', value: p.storage || 'No procede', span: 3 },
  ], 3, { bg: C.band, pad: mm(4) });

  const insp = p.inspection || {};
  sh.section('Inspección en la recepción', mm(22));
  sh.table([{ title: 'Comprobación', w: 0.78 }, { title: 'Resultado', w: 0.22 }],
    Object.entries(PACK_CHECKS).map(([k, label]) => [label, insp[k] ? 'Correcto' : 'Sin comprobar']));
  sh.gap(mm(2));
  sh.grid([
    { label: 'Realizada por', value: insp.by || '—' },
    { label: 'Fecha', value: isDay(insp.date) ? fmtDay(insp.date) : '—' },
    { label: 'Documentación archivada', value: docs.length ? docs.join(', ') : '—' },
  ], 3);

  if (used.length) {
    sh.section('Utilizado en', mm(20));
    sh.table([{ title: 'Lote de la fórmula', w: 0.26 }, { title: 'Fórmula', w: 0.46 }, { title: 'Elaboración', w: 0.14 }, { title: 'Unidades', w: 0.14, right: true }], used);
  }

  sh.section('Observaciones');
  sh.paragraph(p.observations || '—', { color: p.observations ? C.ink : C.muted });

  const decided = ['aceptado', 'rechazado'].includes(p.status) && isDay(p.decision_date);
  sh.signature({
    decision: decided ? `Decisión final: ${STATUS.packaging[p.status].toLocaleLowerCase('es')} el ${fmtDay(p.decision_date)} por ${p.decision_by || '—'}` : 'En cuarentena: pendiente de decisión',
    rejected: p.status === 'rechazado',
    signer: [p.decision_by || s.pharmacy.pharmacist, decided && `Fecha: ${fmtDay(p.decision_date)}`].filter(Boolean).join(' · '),
  });
  return sh.finish();
}

/** Muestra el PDF generado con los botones de descarga y la vista previa. */
async function showSheet(blob, name, heading) {
  state.label = { blob, name };
  const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: 'application/pdf' })] });
  const out = $('#sheetOut');
  out.innerHTML = `<section><h2>${esc(heading)}</h2>
    <div class="actions"><button class="btn" data-act="downloadLabel">Descargar PDF</button>${canShare ? '<button class="btn secondary" data-act="shareLabel">Compartir o imprimir</button>' : ''}</div>
    <p class="hint">A4 vertical. Imprímela al 100 %, fírmala y archívala.</p>
    <div id="docview" class="docview spaced"><p class="hint">Preparando la vista previa...</p></div></section>`;
  renderDocument($('#docview'));
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

Object.assign(FORMS, {
  async packagingSheet(form) {
    const p = await getOne('packaging', form.dataset.id);
    if (!p) throw new InputError('Este material ya no existe.');
    const s = await loadSettings();
    const missing = packagingSheetMissing(p);
    const used = (await getAll('production'))
      .flatMap((x) => (x.packaging_used || []).filter((u) => u.packaging_uuid === p.uuid).map((u) => [x.lot || x.record_code, x.formula_name, fmtDay(x.elaborated_date), fmtNum(u.qty), x.elaborated_date || '']))
      .sort((a, b) => String(a[4]).localeCompare(String(b[4])))
      .map((r) => r.slice(0, 4));
    const docs = (await docsOf(p.uuid)).map((f) => f.name);
    const blob = await buildPackagingSheetPdf(p, s, used, docs, missing);
    const slug = String(p.internal_no || p.lot || p.name).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
    await logOnly('ficha_env_generada', `${p.name}${p.lot ? ` / ${p.lot}` : ''}${missing.length ? ' (borrador)' : ''}`);
    await showSheet(blob, `registro-acondicionamiento-${slug}.pdf`, missing.length ? 'Borrador listo' : 'Registro listo');
  },

  async materialSheet(form) {
    const m = await getOne('material', form.dataset.id);
    if (!m) throw new InputError('Este lote ya no existe.');
    const s = await loadSettings();
    const missing = materialSheetMissing(m);
    const bulletins = (await docsOf(m.uuid)).filter((f) => f.kind === 'boletin').map((f) => f.name);
    const blob = await buildMaterialSheetPdf(m, s, bulletins, missing);
    const slug = String(m.internal_no || m.lot).replace(/[^A-Za-z0-9._-]+/g, '-');
    await logOnly('ficha_mp_generada', `${m.name} / ${m.lot}${missing.length ? ' (borrador)' : ''}`);
    await showSheet(blob, `registro-mp-${slug}.pdf`, missing.length ? 'Borrador listo' : 'Registro listo');
  },

  async mpRegister(form) {
    const period = form.elements.period.value;
    const s = await loadSettings();
    const lots = (await getAll('material'))
      .filter((m) => period === 'todos' || String(m.received_date || m.created_at || '').startsWith(period))
      .sort((a, b) => String(a.received_date || a.created_at).localeCompare(String(b.received_date || b.created_at)) || String(a.internal_no || '').localeCompare(String(b.internal_no || ''), 'es', { numeric: true }));
    if (!lots.length) throw new InputError('No hay lotes recibidos en ese periodo.');
    const label = period === 'todos' ? 'todos los años' : period;
    const blob = await buildMpRegisterPdf(lots, s, label);
    await logOnly('registro_mp_generado', `${label}: ${lots.length} ${lots.length === 1 ? 'lote' : 'lotes'}`);
    await showSheet(blob, `registro-materias-primas-${period}.pdf`, 'Registro listo');
  },

  async recordSheet(form) {
    const p = await getOne('production', form.dataset.id);
    if (!p || !p.lot) throw new InputError('Esta elaboración aún no tiene lote.');
    const s = await loadSettings();
    const f = formData(form);
    const extra = { prescriber: str(f.prescriber).slice(0, 120), collegiate: str(f.collegiate).slice(0, 30), patient: str(f.patient).slice(0, 120) };
    const missing = pendingItems(p);
    const data = await recordSheetData(p, extra);
    const blob = await buildRecordSheetPdf(p, data, s, missing);
    await logOnly('ficha_generada', `${p.lot} ${p.formula_name}${missing.length ? ' (borrador)' : ''}`);
    await showSheet(blob, `ficha-registro-${p.lot}.pdf`, missing.length ? 'Borrador listo' : 'Ficha lista');
  },
});
