'use strict';
/* FARMA·LAB móvil · Registros del RD 175/2001 en PDF A4:
   materias primas: registro (anexo II) y especificaciones (anexo III) del PN/L/PG/005/00 del Formulario Nacional;
   material de acondicionamiento: registro (anexo II) del PN/L/PG/006/00 del Formulario Nacional, y
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

/*
 * Ficha 2: guía de elaboración, control y registro de una fórmula magistral o preparado oficinal
 * (RD 175/2001, capítulo III), con la estética de los registros del Formulario Nacional:
 * cabecera de procedimiento, celdas azules con su etiqueta y celdas blancas con el dato.
 */
const RECORD_TITLE = { fm: 'Guía de elaboración, control\ny registro de fórmula magistral', oficinal: 'Guía de elaboración, control\ny registro de preparado oficinal' };
async function buildRecordSheetPdf(p, d, s, draftMissing) {
  const po = p.formula_type === 'oficinal';
  const related = [...(p.pnt_refs || []).map((r) => r.code).filter(Boolean), str(s.fn.guide_related)].filter(Boolean).join(', ');
  const sh = await createFnSheet({
    code: s.fn.guide_code, related, procTitle: po ? RECORD_TITLE.oficinal : RECORD_TITLE.fm, pharmacy: s.pharmacy,
    subject: `Ficha de registro ${p.lot} · ${p.formula_name}`, draftMissing,
  });
  const L = (from, to, label) => ({ from, to, label });
  const V = (from, to, value, extra = {}) => ({ from, to, value: str(value) || '—', ...extra });
  const pair = (a, b, c, e) => [L(0, 0.18, a), V(0.18, 0.5, b), L(0.5, 0.68, c), V(0.68, 1, e)];
  sh.heading('FICHA 2', po ? 'Registro de preparado oficinal' : 'Registro de formulación magistral');
  sh.draft();
  sh.form([
    { h: 24, cells: [L(0, 0.18, 'Número de registro / lote'), V(0.18, 0.5, p.lot, { strong: true }), L(0.5, 0.68, 'Registro de elaboración'), V(0.68, 1, p.record_code)] },
    { h: 22, cells: [L(0, 0.18, po ? 'Nombre del preparado' : 'Nombre de la fórmula'), V(0.18, 1, d.name, { strong: true })] },
    { h: 18, cells: pair('Tipo', d.type, 'Forma farmacéutica', p.form) },
    { h: 18, cells: pair('Vía de administración', p.route, 'Cantidad preparada', `${fmtNum(p.target_amount)} ${p.unit}`) },
    { h: 18, cells: pair('Fecha de elaboración', fmtDay(p.elaborated_date), 'Fecha de caducidad', fmtDay(p.expiry_date)) },
    { h: 18, cells: pair('Condiciones de conservación', p.storage, 'Código nacional', p.cn && p.cn.cn) },
  ], { gap: 7 });
  sh.block('Composición', d.composition);
  sh.block('Modus operandi', [...d.pnts, d.method].filter(Boolean).join('\n'));
  sh.section('Datos de las materias primas');
  sh.table([
    { title: 'Principios activos / Excipientes', w: 0.3 }, { title: 'Nº de control o lote', w: 0.22 }, { title: 'Proveedor', w: 0.18 },
    { title: 'Cantidad teórica', w: 0.11, right: true }, { title: 'Cantidad pesada', w: 0.11, right: true }, { title: 'Unidad', w: 0.08 },
  ], d.materials, { note: 'PA: principio activo · EDO: excipiente de declaración obligatoria' });
  sh.section('Material de acondicionamiento');
  sh.table([{ title: 'Tipo', w: 0.55 }, { title: 'Nº de control o lote', w: 0.3 }, { title: 'Unidades', w: 0.15, right: true }], d.packaging);
  sh.section('Personal elaborador y utillaje');
  sh.form([
    { h: 18, cells: pair('Farmacéutico/s', d.pharmacists, 'Auxiliares', d.assistants) },
    { h: 18, cells: [L(0, 0.18, 'Utillaje utilizado'), V(0.18, 1, d.equipment)] },
  ], { gap: 7 });
  sh.section('Control de calidad');
  sh.table([{ title: 'Prueba realizada', w: 0.38 }, { title: 'Resultado', w: 0.47 }, { title: 'Conforme', w: 0.15 }], d.qcTests, { gap: 0 });
  sh.form([
    { h: 18, cells: pair('Realizado por', d.qcBy, 'Aparataje', d.qcApparatus) },
    { h: 18, cells: [L(0, 0.18, 'Reactivos y su lote'), V(0.18, 1, d.qcReagents)] },
  ], { gap: 7 });
  sh.section('Datos de dispensación');
  const blank = (v) => ({ from: v.from, to: v.to, value: v.value === '—' ? '' : v.value });   // en blanco para escribirlo a mano
  sh.form([
    { h: 20, cells: [L(0, 0.18, 'Nº del Libro Recetario'), blank(V(0.18, 0.5, d.recetario)), L(0.5, 0.68, 'Fecha de dispensación'), blank(V(0.68, 1, d.dispensedDate))] },
    { h: 20, cells: [L(0, 0.18, 'Cantidad dispensada'), blank(V(0.18, 0.5, d.dispensedQty)), L(0.5, 0.68, 'Facultativo prescriptor'), blank(V(0.68, 1, d.prescriber))] },
    { h: 20, cells: [L(0, 0.18, 'Paciente'), blank(V(0.18, 1, d.patient))] },
  ], { gap: 6 });
  sh.observations(d.notes || '', { minH: 22 });
  const decided = ['aceptada', 'rechazada'].includes(p.decision);
  sh.form([
    { h: 15, cells: [L(0, 0.5, 'Decisión de aceptación o rechazo:'), L(0.5, 0.68, 'Fecha:'), L(0.68, 1, 'Firma del farmacéutico responsable:')] },
    { h: 36, cells: [
      { from: 0, to: 0.5, value: p.decision === 'aceptada' ? 'Aceptado' : p.decision === 'rechazada' ? 'Rechazado' : '' },
      { from: 0.5, to: 0.68, value: decided ? fmtDay(p.decision_date) : '' },
      { from: 0.68, to: 1, value: decided ? (s.pharmacy.pharmacist || p.decision_by || '') : '' },
    ] },
  ], { gap: 4, keep: true });
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
const FN_MP_TITLE = 'Recepción, control de conformidad\ny almacenamiento de materias primas';   // con el corte de línea del modelo

/**
 * Motor de hojas con el diseño de los procedimientos del Formulario Nacional (3.ª edición):
 * cabecera azul marino con el título del procedimiento, el código y «Página x de y» (en lila),
 * fila de «Procedimientos relacionados», «ANEXO» en rojo y celdas de etiqueta azules con texto blanco.
 */
const FN_COLORS = { navy: [27, 53, 93], lilac: [203, 203, 216], mes: [155, 156, 179], crimson: [194, 7, 52], text: [60, 60, 59], grey: [103, 103, 102] };
async function createFnSheet({ code, related, procTitle, pharmacy, subject, draftMissing = [] }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle(subject);
  doc.setSubject(`${procTitle.replace(/\n/g, ' ')} (${code})`);
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
  const C = Object.fromEntries(Object.entries(FN_COLORS).map(([k, v]) => [k, rgb(v[0] / 255, v[1] / 255, v[2] / 255)]));
  C.white = rgb(1, 1, 1); C.ink = rgb(0.1, 0.1, 0.1);
  C.warn = rgb(0.52, 0.31, 0.04); C.warnBg = rgb(0.984, 0.933, 0.835);
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
    return out.filter((l, i, all) => l || all.length === 1);
  };
  const pages = []; const slots = [];
  let page; let y;
  const LBL = 7; const VAL = 8.6; const PAD = 3.2;
  /** Celda: fondo azul con etiqueta blanca, o blanca con borde azul y su valor. */
  const cell = (x, top, w, h, { label = '', value = '', center = false, right = false, middle = false, fill = null, box = false, mark = false, valueSize = VAL, strong = false, sub = false } = {}) => {
    const isLabel = Boolean(label);
    // sub: cabecera de columna en lila con texto oscuro (como «Temperatura» o «ºC» en los modelos)
    page.drawRectangle({ x, y: top - h, width: w, height: h, color: isLabel ? (sub ? C.lilac : C.navy) : (fill || C.white), borderColor: isLabel ? C.white : C.navy, borderWidth: 0.8 });
    if (isLabel) {
      const ls = wrap(bold, LBL, label, w - 2 * PAD);
      const off = middle ? Math.max(0, (h - 2 * PAD - ls.length * LBL * 1.15) / 2) : 0;   // centrada en vertical, como en el anexo III
      ls.forEach((ln, k) => {
        const lw = bold.widthOfTextAtSize(ln, LBL);
        const tx = center ? x + (w - lw) / 2 : right ? x + w - PAD - lw : x + PAD;
        page.drawText(ln, { x: tx, y: top - PAD - off - (k + 1) * LBL * 1.15 + 1.5, size: LBL, font: bold, color: sub ? C.text : C.white });
      });
    } else if (box) {   // casilla
      const s = 8.5; const bx = x + (w - s) / 2; const by = top - h / 2 - s / 2;
      page.drawRectangle({ x: bx, y: by, width: s, height: s, borderColor: C.navy, borderWidth: 0.9, color: C.white });
      if (mark) {
        page.drawLine({ start: { x: bx + 1.6, y: by + 1.6 }, end: { x: bx + s - 1.6, y: by + s - 1.6 }, thickness: 1.2, color: C.ink });
        page.drawLine({ start: { x: bx + 1.6, y: by + s - 1.6 }, end: { x: bx + s - 1.6, y: by + 1.6 }, thickness: 1.2, color: C.ink });
      }
    } else if (str(value)) {
      const f = strong ? bold : font;
      const size = strong ? valueSize + 1.4 : valueSize;
      const ls = wrap(f, size, value, w - 2 * PAD);
      ls.forEach((ln, k) => {
        const lw = f.widthOfTextAtSize(ln, size);
        const tx = center ? x + (w - lw) / 2 : right ? x + w - PAD - lw : x + PAD;
        page.drawText(ln, { x: tx, y: top - PAD - (k + 1) * size * 1.22 + 2, size, font: f, color: C.ink });
      });
    }
  };
  /** Alto que necesita un texto en una celda de ancho w (como mínimo, el del modelo). */
  const need = (value, w, min, { f = font, size = VAL } = {}) => (str(value) ? Math.max(min, wrap(f, size, value, w - 2 * PAD).length * size * 1.22 + 2 * PAD + 1) : min);
  const needLabel = (label, w, min) => Math.max(min, wrap(bold, LBL, label, w - 2 * PAD).length * LBL * 1.15 + 2 * PAD);

  const drawHeader = (pg) => {
    const ph = clean(pharmacy && pharmacy.name ? pharmacy.name : '');
    const topY = H - mm(13);
    if (ph) pg.drawText(ph, { x: M, y: topY, size: 7, font: bold, color: C.grey });
    const pnt = 'PROCEDIMIENTOS NORMALIZADOS DE TRABAJO'; const fn = 'FORMULARIO NACIONAL';
    const fnW = bold.widthOfTextAtSize(fn, 7); const pntW = font.widthOfTextAtSize(pnt, 6.2);
    pg.drawText(fn, { x: W - M - fnW, y: topY, size: 7, font: bold, color: C.navy });
    pg.drawLine({ start: { x: W - M - fnW - 4, y: topY - 2 }, end: { x: W - M - fnW - 4, y: topY + 8 }, thickness: 1.3, color: C.navy });
    pg.drawText(pnt, { x: W - M - fnW - 8 - pntW, y: topY, size: 6.2, font, color: C.grey });
    // cabecera del procedimiento
    const top = H - mm(25);
    const leftW = CW * 0.639; const rightW = CW - leftW;
    const rowH = 15.5;
    const tl = wrap(bold, 8.4, procTitle, leftW - 2 * PAD - 2);
    const h1 = Math.max(2 * rowH, tl.length * 10 + 2 * PAD);
    pg.drawRectangle({ x: M, y: top - h1, width: leftW, height: h1, color: C.navy });
    tl.forEach((ln, k) => pg.drawText(ln, { x: M + PAD + 1, y: top - (h1 - tl.length * 10) / 2 - (k + 1) * 10 + 2.5, size: 8.4, font: bold, color: C.white }));
    pg.drawRectangle({ x: M + leftW + 1.2, y: top - rowH, width: rightW - 1.2, height: rowH, color: C.navy });
    const cd = clean(code);
    pg.drawText(cd, { x: M + leftW + 1.2 + (rightW - 1.2 - bold.widthOfTextAtSize(cd, 8.6)) / 2, y: top - rowH + 4.6, size: 8.6, font: bold, color: C.white });
    pg.drawRectangle({ x: M + leftW + 1.2, y: top - h1, width: rightW - 1.2, height: h1 - rowH - 1, color: C.lilac });
    slots.push({ pg, cx: M + leftW + 1.2 + (rightW - 1.2) / 2, y: top - h1 + (h1 - rowH - 1) / 2 - 3 });
    const relTop = top - h1;
    const relH = 13;
    pg.drawRectangle({ x: M, y: relTop - relH, width: CW, height: relH, borderColor: C.navy, borderWidth: 0.8 });
    const rel = clean(`Procedimientos relacionados: ${related || ''}`);
    pg.drawText(wrap(font, 6.6, rel, CW - mm(8))[0], { x: M + mm(4), y: relTop - relH + 4, size: 6.6, font, color: C.text });
    return relTop - relH;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = drawHeader(page) - mm(7);
  };
  const room = (h) => y - h >= M + FOOT;

  /** «ANEXO II» en rojo y el nombre del registro debajo, como en el modelo. */
  const heading = (annex, title) => {
    page.drawText(clean(annex), { x: M, y: y - 9, size: 9.5, font: bold, color: C.crimson });
    page.drawText(clean(title), { x: M + mm(3.5), y: y - 27, size: 10, font, color: C.text });
    y -= 27 + mm(4.5);
  };
  const draft = () => {
    if (!draftMissing.length) return;
    const lines = wrap(font, 8, `Faltan datos: ${draftMissing.join('; ')}.`, CW - mm(8));
    const h = 13 + lines.length * 8 * 1.3 + mm(3);
    page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: C.warnBg });
    page.drawText('Borrador: registro incompleto', { x: M + mm(4), y: y - mm(2) - 9, size: 9, font: bold, color: C.warn });
    let ty = y - mm(2) - 11;
    lines.forEach((ln) => { ty -= 8 * 1.3; page.drawText(ln, { x: M + mm(4), y: ty + 2, size: 8, font, color: C.warn }); });
    y -= h + mm(4);
  };

  /**
   * Ficha del modelo: filas de celdas con su posición (fracciones del ancho) y su alto mínimo.
   * Cada celda es una etiqueta (fondo azul, texto blanco) o un valor (blanco, con borde azul).
   */
  const form = (rows, { gap = mm(5) } = {}) => {
    const heights = rows.map((r) => Math.max(r.h, ...r.cells.map((c) => {
      const w = (c.to - c.from) * CW;
      return c.label ? needLabel(c.label, w, 0) : need(c.value, w, 0, c.strong ? { f: bold, size: VAL + 1.4 } : {});
    })));
    if (!room(heights.reduce((a, b) => a + b, 0)) && y < H - mm(60)) newPage();   // la ficha no se parte entre páginas
    const top0 = y;
    let top = y;
    rows.forEach((r, i) => {
      const h = heights[i];
      r.cells.forEach((c) => cell(M + c.from * CW, top, (c.to - c.from) * CW, h, c.label ? { label: c.label, middle: c.middle } : { value: c.value, center: c.center, strong: c.strong }));
      top -= h;
    });
    page.drawRectangle({ x: M, y: top, width: CW, height: top0 - top, borderColor: C.navy, borderWidth: 0.9 });
    y = top - gap;
  };
  /** Apartado: barra azul a todo el ancho con su título, sin quedarse sola al pie de la página. */
  const section = (label, keep = 60) => {
    if (!room(15 + keep)) newPage();
    cell(M, y, CW, 15, { label });
    y -= 15;
  };
  /** Apartado con un texto: barra azul y celda blanca debajo, que sigue en la página siguiente si no cabe. */
  const block = (label, value, { gap = mm(2.5), minH = 22 } = {}) => {
    section(label, 40);
    const lh = VAL * 1.22;
    let lines = wrap(font, VAL, str(value) || '—', CW - 2 * PAD);
    while (lines.length) {
      const fit = Math.max(1, Math.floor((y - M - FOOT - 2 * PAD) / lh));
      const part = lines.slice(0, fit);
      lines = lines.slice(fit);
      const h = Math.max(lines.length ? 0 : minH, part.length * lh + 2 * PAD + 1);
      page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: C.white, borderColor: C.navy, borderWidth: 0.9 });
      part.forEach((ln, k) => page.drawText(ln, { x: M + PAD, y: y - PAD - (k + 1) * lh + 2, size: VAL, font, color: C.ink }));
      y -= h;
      if (lines.length) newPage();
    }
    y -= gap;
  };
  /** Tabla: cabecera lila con el nombre de cada columna y filas blancas; la cabecera se repite si sigue en otra página. */
  const table = (cols, rows, { note = '', gap = mm(2.5), minRows = 1 } = {}) => {
    const X = []; let acc = 0;
    cols.forEach((c) => { X.push(M + acc * CW); acc += c.w; });
    const Wc = cols.map((c) => c.w * CW);
    const headH = Math.max(15, ...cols.map((c, i) => needLabel(c.title, Wc[i], 0)));
    const head = () => { cols.forEach((c, i) => cell(X[i], y, Wc[i], headH, { label: c.title, sub: true, right: c.right })); y -= headH; };
    const body = rows.length ? rows : Array.from({ length: minRows }, () => cols.map(() => ''));
    head();
    let segTop = y + headH;
    body.forEach((r) => {
      const h = Math.max(16, ...r.map((v, i) => need(v, Wc[i], 0)));
      if (!room(h)) {
        page.drawRectangle({ x: M, y, width: CW, height: segTop - y, borderColor: C.navy, borderWidth: 0.9 });
        newPage();
        segTop = y;
        head();
      }
      r.forEach((v, i) => cell(X[i], y, Wc[i], h, { value: v, right: cols[i].right }));
      y -= h;
    });
    page.drawRectangle({ x: M, y, width: CW, height: segTop - y, borderColor: C.navy, borderWidth: 0.9 });
    if (note) { y -= 9; page.drawText(clean(note), { x: M + 1, y: y + 1, size: 6.6, font, color: C.grey }); }
    y -= gap;
  };
  const formHeight = (rows) => rows.reduce((n, r) => n + r.h, 0) + 24;
  /** «Observaciones:» bajo la ficha, como en el modelo, con el texto a continuación. */
  const observations = (text, { minH = mm(16) } = {}) => {
    if (!room(14 + Math.min(minH, 40))) newPage();
    page.drawText('Observaciones:', { x: M + mm(3.5), y: y - 9, size: 9, font, color: C.text });
    y -= 12;
    const lines = wrap(font, 8.4, text, CW - mm(7));
    const start = y;
    lines.forEach((ln) => {
      if (!room(11)) newPage();
      y -= 11;
      page.drawText(ln, { x: M + mm(3.5), y: y + 2, size: 8.4, font, color: C.ink });
    });
    if (start - y < minH) y = start - minH;
    y -= mm(6);   // separación hasta la ficha siguiente
  };

  /** Anexo III: especificaciones, con la misma rejilla del modelo. */
  const specs = (v) => {
    const X = (f) => M + f * CW;
    const W2 = (a, b) => (b - a) * CW;
    const a0 = 0, a1 = 0.124, a2 = 0.313, a3 = 0.489, a4 = 0.65, a5 = 1;
    let top = y;
    cell(X(0), top, CW, 16, { label: 'Nombre de la materia prima', center: true });
    top -= 16;
    const rN = need(v.name, CW, 18);
    cell(X(0), top, CW, rN, { value: v.name, center: true });
    top -= rN + 4;
    const blockTop = top;
    cell(X(a0), top, W2(a0, a1), 16, { label: 'Cumple', center: false });
    cell(X(a1), top, W2(a1, a2), 16, { label: 'RFE', center: true });
    cell(X(a2), top, W2(a2, a5), 16, { label: 'Monografía n.º:', center: true });
    top -= 16;
    const rC = need(v.rfeNo, W2(a2, a5), 20);
    cell(X(a1), top, W2(a1, a2), rC, { box: true, mark: v.rfe });
    cell(X(a2), top, W2(a2, a5), rC, { value: v.rfeNo, center: true });
    top -= rC;
    const rD = Math.max(28, need(v.pharmacopoeia, W2(a3, a4), 0));
    cell(X(a1), top, W2(a1, a2), rD, { label: 'Otra farmacopea', middle: true });
    cell(X(a2), top, W2(a2, a3), rD, { label: 'Farmacopea', middle: true });
    cell(X(a3), top, W2(a3, a4), rD, { value: v.pharmacopoeia });
    cell(X(a4), top, W2(a4, a5), rD, { label: 'Fabricante o proveedor' });
    top -= rD;
    const rE = Math.max(34, need(v.monograph, W2(a3, a4), 0));
    cell(X(a1), top, W2(a1, a2), rE, { box: true, mark: v.other });
    cell(X(a2), top, W2(a2, a3), rE, { label: 'Monografía', middle: true });
    cell(X(a3), top, W2(a3, a4), rE, { value: v.monograph });
    cell(X(a4), top, W2(a4, a5), rE, { box: true, mark: v.maker });
    top -= rE;
    const rF = need(v.identification, W2(a2, a5), 31);
    cell(X(a1), top, W2(a1, a2), rF, { label: 'Identificación', middle: true });
    cell(X(a2), top, W2(a2, a5), rF, { value: v.identification });
    top -= rF;
    const rG = need(v.impurities, W2(a2, a5), 32);
    cell(X(a1), top, W2(a1, a2), rG, { label: 'Impurezas', middle: true });
    cell(X(a2), top, W2(a2, a5), rG, { value: v.impurities });
    top -= rG;
    cell(X(a1), top, W2(a1, a5), 16, { label: 'Descripción de los procedimientos analíticos' });
    top -= 16;
    const rI = need(v.methods, W2(a1, a5), 59);
    cell(X(a1), top, W2(a1, a5), rI, { value: v.methods });
    top -= rI;
    // columna «Cumple»: blanca, desde la fila de las casillas hasta el final del bloque
    page.drawRectangle({ x: X(a0), y: top, width: W2(a0, a1), height: blockTop - 16 - top, color: C.white, borderColor: C.navy, borderWidth: 0.8 });
    page.drawRectangle({ x: M, y: top, width: CW, height: blockTop - top, borderColor: C.navy, borderWidth: 0.9 });
    top -= 5;
    const b0 = 0.363;
    [['Condiciones de conservación', v.storage], ['Precauciones al manipular', v.handling], ['Toxicidad y peligrosidad', v.toxicity]].forEach(([lab, val]) => {
      const h = need(val, W2(b0, 1), 35);
      page.drawRectangle({ x: X(0), y: top - h, width: W2(0, b0), height: h, color: C.navy, borderColor: C.white, borderWidth: 0.8 });
      page.drawText(clean(lab), { x: X(0) + PAD + 1, y: top - h / 2 - 2.5, size: LBL + 0.4, font: bold, color: C.white });
      cell(X(b0), top, W2(b0, 1), h, { value: val });
      top -= h;
    });
    y = top - mm(4);
  };

  const finish = async () => {
    const stamp = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    slots.forEach(({ pg, cx, y: py }, i) => {
      const t = `Página ${i + 1} de ${pages.length}`;
      pg.drawText(t, { x: cx - bold.widthOfTextAtSize(t, 8.4) / 2, y: py, size: 8.4, font: bold, color: C.text });
      const foot = clean(`${draftMissing.length ? 'BORRADOR · ' : ''}Generado con FARMA·LAB el ${stamp}`);
      pg.drawText(foot, { x: W - M - font.widthOfTextAtSize(foot, 6.4), y: mm(9), size: 6.4, font, color: C.grey });
    });
    return new Blob([await doc.save()], { type: 'application/pdf' });
  };
  newPage();
  /** Acceso al dibujo para los registros con rejilla propia (temperaturas): página actual, fuentes, colores y medidas. */
  const raw = () => ({ page, font, bold, C, M, CW, W, H, PAD, LBL, VAL, clean, wrap, cell, mm, bottom: M + FOOT });
  return { mm, heading, draft, form, formHeight, observations, specs, section, block, table, newPage, room: (h) => room(h), finish, raw, at: () => y, moveTo: (v) => { y = v; } };
}

const MP_DECISION = { aceptado: 'Aceptada', rechazado: 'Rechazada', bloqueado: 'Bloqueada', cuarentena: 'Pendiente (cuarentena)' };
const yesNoMark = (v) => (v === true ? 'conforme' : v === false ? 'NO conforme' : 'sin valorar');
/** Datos de la ficha del anexo II de un lote. */
function mpCardValues(m) {
  const qty = isNum(m.quantity_received) ? m.quantity_received : m.quantity;
  const decided = ['aceptado', 'rechazado', 'bloqueado'].includes(m.status) && isDay(m.decision_date);
  return {
    internal: m.internal_no || '', name: m.name, supplier: m.supplier || '', lot: m.lot, qc: m.qc_no || '',
    received: isDay(m.received_date) ? fmtDay(m.received_date) : '', qty: isNum(qty) ? `${fmtNum(qty)} ${m.unit}` : '',
    containers: m.containers ? String(m.containers) : '', decision: MP_DECISION[m.status] || m.status,
    // Casilla propia para la caducidad (PN/L/PG/005/00, 4.1.2); si no tiene, la fecha del próximo control analítico.
    expiry: isDay(m.expiry) ? fmtDay(m.expiry) : isDay(m.retest_date) ? `${fmtDay(m.retest_date)} (próximo control analítico)` : '',
    date: decided ? fmtDay(m.decision_date) : '', signer: decided ? (m.decision_by || '') : '',
  };
}
/** Observaciones de un lote para el registro: recepción, conformidad, destino, revisión y notas (la caducidad tiene su casilla). */
function mpObservation(m, bulletins = []) {
  const parts = [];
  if (isDay(m.expiry) && isDay(m.retest_date)) parts.push(`Próximo control analítico: ${fmtDay(m.retest_date)}`);
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
    parts.push(d && DISPOSALS[d.method] ? `${DISPOSALS[d.method]} el ${fmtDay(d.date)}${d.detail ? ` (${d.detail})` : ''}${d.by ? ` por ${d.by}` : ''}` : 'Destino del lote rechazado pendiente de registrar');
  }
  const r = lastReview(m);
  if (r) parts.push(`Revisión anual: ${fmtDay(r.date)} (${r.by})`);
  if (str(m.observations)) parts.push(m.observations);
  return parts.join('. ').replace(/\.\./g, '.');
}
/** Celdas del anexo II del PN/L/PG/005/00, en el orden y la proporción del modelo. */
function mpCardRows(v) {
  const L = (from, to, label) => ({ from, to, label });
  const V = (from, to, value) => ({ from, to, value });
  return [
    { h: 28, cells: [L(0, 0.161, 'Registro interno'), V(0.161, 0.398, v.internal), L(0.398, 0.645, 'Nombre del producto'), V(0.645, 1, v.name)] },
    { h: 15, cells: [L(0, 0.161, 'Proveedor'), V(0.161, 0.398, v.supplier), L(0.398, 0.645, 'Lote'), V(0.645, 1, v.lot)] },
    { h: 28, cells: [L(0, 0.161, 'Control de calidad'), V(0.161, 0.645, v.qc), L(0.645, 0.782, 'Fecha de caducidad'), V(0.782, 1, v.expiry)] },
    { h: 28, cells: [L(0, 0.161, 'Fecha de recepción'), V(0.161, 0.284, v.received), L(0.284, 0.398, 'Cantidad'), V(0.398, 0.645, v.qty), L(0.645, 0.782, 'Número de envases'), V(0.782, 1, v.containers)] },
    { h: 15, cells: [L(0, 0.398, 'Decisión final'), L(0.398, 0.645, 'Fecha'), L(0.645, 1, 'Firma')] },
    { h: 40, cells: [V(0, 0.398, v.decision), V(0.398, 0.645, v.date), V(0.645, 1, v.signer)] },
  ];
}
/** Anexo II (registro): una ficha por registro, cada una con sus observaciones debajo; varias por página. */
function drawRegisterCards(sh, items, { annex, title, rowsOf, obsOf }) {
  sh.heading(annex, title);
  sh.draft();
  items.forEach((it, i) => {
    const rows = rowsOf(it);
    const obs = obsOf(it);
    const obsLines = Math.ceil(obs.length / 120) + 1;
    if (i && !sh.room(sh.formHeight(rows) + 16 + obsLines * 11)) { sh.newPage(); sh.heading(annex, title); }
    sh.form(rows);
    sh.observations(obs, { minH: items.length > 1 ? sh.mm(8) : sh.mm(30) });
  });
}
async function drawMpRegister(sh, lots, bulletinsOf) {
  drawRegisterCards(sh, lots, {
    annex: 'ANEXO II', title: 'Registro de materias primas',
    rowsOf: (m) => mpCardRows(mpCardValues(m)), obsOf: (m) => mpObservation(m, bulletinsOf(m)),
  });
}
/** Anexo III: especificaciones de la materia prima. */
function drawMpSpecs(sh, m) {
  sh.heading('ANEXO III', 'Especificaciones');
  sh.specs({
    name: m.name, rfe: m.spec_source === 'rfe', other: m.spec_source === 'otra', maker: m.spec_source === 'fabricante',
    // «Monografía n.º» es la de la RFE; «Farmacopea» y «Monografía», las de otra farmacopea (o el documento del fabricante)
    rfeNo: m.spec_source === 'rfe' ? [m.spec_monograph_no, m.monograph].filter((x) => str(x)).join(' · ') : '',
    pharmacopoeia: m.spec_source === 'otra' ? m.spec_pharmacopoeia : '',
    monograph: m.spec_source === 'rfe' ? '' : m.monograph, identification: m.spec_identification, impurities: m.spec_impurities, methods: specMethods(m),
    storage: m.storage, handling: m.handling, toxicity: m.toxicity,
  });
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
  await drawMpRegister(sh, lots, bulletinsOf);
  return sh.finish();
}

const REGISTERS = {
  mp: { store: 'material', back: '#materias', title: 'Registro de materias primas', code: (s) => s.fn.mp_code,
    what: 'una ficha por lote, por fecha de recepción, con su caducidad y sus observaciones (recepción, control de conformidad, destino de los rechazados y revisión anual)', label: 'Lotes recibidos en' },
  ac: { store: 'packaging', back: '#envases', title: 'Registro de material de acondicionamiento', code: (s) => s.fn.pack_code,
    what: 'una ficha por material recibido, por fecha de recepción, con sus observaciones (inspección en la recepción, revisión anual y eliminación de material caducado u obsoleto)', label: 'Material recibido en' },
};
ROUTES.registromp = () => viewRegister('mp');
ROUTES.registroac = () => viewRegister('ac');
async function viewRegister(kind) {
  const R = REGISTERS[kind];
  state.parent = R.back;
  state.label = null;
  const s = await loadSettings();
  const items = await getAll(R.store);
  const years = [...new Set(items.map((m) => String(m.received_date || m.created_at || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse();
  const current = String(new Date().getFullYear());
  if (!years.includes(current)) years.unshift(current);
  return `<div class="panel stack">
      <h2 class="big">${esc(R.title)}</h2>
      <p>Anexo II del ${esc(R.code(s))} del Formulario Nacional: ${esc(R.what)}.</p>
    </div>
    <form class="form" data-form="registerPdf" data-kind="${kind}" novalidate>
      ${formMsg()}
      ${field(R.label, `<select name="period">${options([...years, 'todos'], current, { todos: 'Todos los años' })}</select>`)}
      <button class="btn block" type="submit">Generar el registro</button>
    </form>
    <div id="sheetOut"></div>`;
}

// ------------------------------------------------------------------ material de acondicionamiento: PN/L/PG/006/00
const FN_PACK_TITLE = 'Recepción y almacenamiento del material\nde acondicionamiento';
const PACK_DECISION = { aceptado: 'Aceptado', rechazado: 'Rechazado', cuarentena: 'Pendiente (cuarentena)' };
/** Datos que pide el PN/L/PG/006/00 (apartado 4.2) y faltan en un material. */
function packagingSheetMissing(p) {
  const miss = [];
  if (!p.internal_no) miss.push('nº de registro interno');
  if (!str(p.supplier)) miss.push('proveedor');
  if ((p.kind || 'primario') === 'primario' && !str(p.lot)) miss.push('nº de lote (acondicionamiento primario)');
  if (!isDay(p.received_date)) miss.push('fecha de recepción');
  if (!isNum(p.quantity_received) && !isNum(p.quantity)) miss.push('cantidad');
  if (!p.containers) miss.push('nº de envases (cajas o paquetes)');
  if (!inspectionDone(p.inspection)) miss.push('inspección en la recepción');
  if (!['aceptado', 'rechazado'].includes(p.status) || !isDay(p.decision_date)) miss.push('decisión final (aceptación o rechazo), fecha y firma');
  return miss;
}
/** Celdas del anexo II del PN/L/PG/006/00, en el orden y la proporción del modelo. */
function packCardRows(p) {
  const L = (from, to, label) => ({ from, to, label });
  const V = (from, to, value) => ({ from, to, value });
  const qty = isNum(p.quantity_received) ? p.quantity_received : p.quantity;
  const decided = ['aceptado', 'rechazado'].includes(p.status) && isDay(p.decision_date);
  const ident = `${p.name}${p.capacity ? ` ${p.capacity}` : ''} · acondicionamiento ${lc(PACK_KINDS[p.kind] || 'Primario')}`;
  return [
    { h: 27, cells: [L(0, 0.245, 'Número de registro interno'), V(0.245, 1, p.internal_no || '')] },
    { h: 28, cells: [L(0, 0.245, 'Identificación del producto'), V(0.245, 1, ident)] },
    { h: 15.5, cells: [L(0, 0.245, 'Proveedor'), V(0.245, 0.561, p.supplier || ''), L(0.561, 0.706, 'Lote'), V(0.706, 1, p.lot || '')] },
    { h: 39, cells: [L(0, 0.245, 'Fecha de recepción'), V(0.245, 1, isDay(p.received_date) ? fmtDay(p.received_date) : '')] },
    { h: 17, cells: [L(0, 0.245, 'Cantidad'), V(0.245, 0.444, isNum(qty) ? `${fmtNum(qty)} ${qty === 1 ? 'unidad' : 'unidades'}` : ''), L(0.444, 0.706, 'N.º de envases'), V(0.706, 1, p.containers ? String(p.containers) : '')] },
    { h: 28, cells: [L(0, 0.245, 'Fecha de caducidad'), V(0.245, 0.444, isDay(p.expiry) ? fmtDay(p.expiry) : ''), L(0.444, 0.706, 'Condiciones de conservación'), V(0.706, 1, p.storage || '')] },
    { h: 15, cells: [L(0, 0.561, 'Decisión final:'), L(0.561, 0.706, 'Fecha:'), L(0.706, 1, 'Firma:')] },
    { h: 33, cells: [V(0, 0.561, PACK_DECISION[p.status] || p.status), V(0.561, 0.706, decided ? fmtDay(p.decision_date) : ''), V(0.706, 1, decided ? (p.decision_by || '') : '')] },
  ];
}
/** Observaciones del registro: inspección, revisión anual, eliminación de caducado u obsoleto, devolución, notas y uso. */
function packObservation(p, used = []) {
  const parts = [];
  const insp = p.inspection || {};
  if (inspectionDone(insp)) parts.push(`Inspección en la recepción correcta (albarán, material y envases)${insp.date ? ` el ${fmtDay(insp.date)}` : ''}${insp.by ? ` por ${insp.by}` : ''}`);
  else parts.push('Inspección en la recepción no registrada');
  if (p.status === 'rechazado') {
    const d = p.disposal;
    parts.push(d && DISPOSALS[d.method] ? `${DISPOSALS[d.method]} el ${fmtDay(d.date)}${d.detail ? ` (${d.detail})` : ''}${d.by ? ` por ${d.by}` : ''}` : 'Devolución al proveedor pendiente de registrar');
  }
  (Array.isArray(p.eliminations) ? p.eliminations : []).forEach((e) => parts.push(`Eliminadas ${fmtNum(e.qty)} uds. por ${PACK_ELIMINATION[e.reason] || e.reason} el ${fmtDay(e.date)}${e.by ? ` (${e.by})` : ''}`));
  const r = lastReview(p);
  if (r) parts.push(`Revisión anual: ${fmtDay(r.date)} (${r.by})`);
  if (str(p.observations)) parts.push(p.observations);
  if (used.length) parts.push(`Utilizado en: ${used.slice(0, 12).map((u) => `${u.lot} (${fmtNum(u.qty)} uds.)`).join(', ')}${used.length > 12 ? ` y ${used.length - 12} más` : ''}`);
  return parts.join('. ').replace(/\.\./g, '.');
}
/** Elaboraciones que han usado un material, por fecha. */
async function packUsage() {
  const out = new Map();
  (await getAll('production'))
    .sort((a, b) => String(a.elaborated_date || a.created_at).localeCompare(String(b.elaborated_date || b.created_at)))
    .forEach((x) => (x.packaging_used || []).forEach((u) => {
      if (!u.packaging_uuid) return;
      if (!out.has(u.packaging_uuid)) out.set(u.packaging_uuid, []);
      out.get(u.packaging_uuid).push({ lot: x.lot || x.record_code, qty: u.qty });
    }));
  return out;
}

async function viewPackagingSheet(id) {
  const p = await getOne('packaging', id);
  if (!p) return empty('Este material no existe.', '');
  state.parent = `#envases--${p.uuid}`;
  state.label = null;
  const s = await loadSettings();
  const missing = packagingSheetMissing(p);
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(p.name)}</h2>${pill('packaging', p.status)}</div>
      <p>${p.internal_no ? `${esc(p.internal_no)} · ` : ''}${esc(PACK_KINDS[p.kind] || 'Primario')}${p.lot ? ` · Lote ${esc(p.lot)}` : ''}${p.supplier ? ` · ${esc(p.supplier)}` : ''}</p>
      <p class="hint">Formato del ${esc(s.fn.pack_code)} del Formulario Nacional: anexo II, registro de material de acondicionamiento.</p>
    </div>
    ${missing.length
      ? `<div class="msg warn"><strong>Faltan datos:</strong> ${esc(missing.join('; '))}. Se puede generar como borrador; para el definitivo, complétalos en <a href="#envases--${esc(p.uuid)}--editar">Editar ficha</a>.</div>`
      : '<p class="msg ok">El registro del material está completo.</p>'}
    <form class="form" data-form="packagingSheet" data-id="${esc(p.uuid)}" novalidate>
      ${formMsg()}
      <button class="btn block" type="submit">${missing.length ? 'Generar borrador del registro' : 'Generar registro'}</button>
    </form>
    <p class="more"><a href="#registroac">Registro de todo el material (anexo II)</a></p>
    <div id="sheetOut"></div>`;
}
async function packSheet(s, draftMissing, subject) {
  return createFnSheet({ code: s.fn.pack_code, related: s.fn.pack_related, procTitle: FN_PACK_TITLE, pharmacy: s.pharmacy, subject, draftMissing });
}
/** Anexo II del PN/L/PG/006/00 de un material. */
async function buildPackagingSheetPdf(p, s, used, draftMissing) {
  const sh = await packSheet(s, draftMissing, `Registro de material de acondicionamiento · ${p.name}${p.lot ? ` · lote ${p.lot}` : ''}`);
  drawRegisterCards(sh, [p], { annex: 'ANEXO II', title: 'Registro de material de acondicionamiento', rowsOf: packCardRows, obsOf: (x) => packObservation(x, used) });
  return sh.finish();
}
async function buildPackRegisterPdf(list, s, period) {
  const sh = await packSheet(s, [], `Registro de material de acondicionamiento · ${period}`);
  const usage = await packUsage();
  drawRegisterCards(sh, list, { annex: 'ANEXO II', title: 'Registro de material de acondicionamiento', rowsOf: packCardRows, obsOf: (x) => packObservation(x, usage.get(x.uuid) || []) });
  return sh.finish();
}

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
    const blob = await buildPackagingSheetPdf(p, s, (await packUsage()).get(p.uuid) || [], missing);
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

  async registerPdf(form) {
    const kind = form.dataset.kind;
    const R = REGISTERS[kind];
    if (!R) return;
    const period = form.elements.period.value;
    const s = await loadSettings();
    const items = (await getAll(R.store))
      .filter((m) => period === 'todos' || String(m.received_date || m.created_at || '').startsWith(period))
      .sort((a, b) => String(a.received_date || a.created_at).localeCompare(String(b.received_date || b.created_at)) || String(a.internal_no || '').localeCompare(String(b.internal_no || ''), 'es', { numeric: true }));
    if (!items.length) throw new InputError(kind === 'mp' ? 'No hay lotes recibidos en ese periodo.' : 'No hay material recibido en ese periodo.');
    const label = period === 'todos' ? 'todos los años' : period;
    const blob = kind === 'mp' ? await buildMpRegisterPdf(items, s, label) : await buildPackRegisterPdf(items, s, label);
    await logOnly(kind === 'mp' ? 'registro_mp_generado' : 'registro_ac_generado', `${label}: ${items.length} ${kind === 'mp' ? (items.length === 1 ? 'lote' : 'lotes') : (items.length === 1 ? 'material' : 'materiales')}`);
    await showSheet(blob, `${kind === 'mp' ? 'registro-materias-primas' : 'registro-acondicionamiento'}-${period}.pdf`, 'Registro listo');
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
