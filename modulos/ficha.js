'use strict';
/* FARMA·LAB móvil · Registros del RD 175/2001 en PDF A4:
   ficha 1, control de calidad de materias primas (apartado 3.2.3);
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
  const clean = (t) => [...String(t ?? '').replace(/−/g, '-').replace(/[^\S\n]+/g, ' ')]
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

// ------------------------------------------------------------------ ficha 1: control de calidad de materias primas
/** Datos de la ficha 1 que faltan en un lote. */
function materialSheetMissing(m) {
  const miss = [];
  const tests = (m.qc && m.qc.tests) || [];
  if (!m.internal_no) miss.push('nº de registro de control interno');
  if (!str(m.supplier)) miss.push('proveedor');
  if (!isNum(m.quantity_received) && !isNum(m.quantity)) miss.push('cantidad');
  if (!isDay(m.expiry) && !isDay(m.retest_date)) miss.push('fecha de caducidad o de repetición del control analítico');
  if (!tests.some((t) => str(t.result))) miss.push('ensayos realizados y sus resultados');
  if (tests.some((t) => str(t.result) && t.ok === null)) miss.push('conformidad de cada ensayo');
  if (!str(m.qc && m.qc.methods) && !tests.some((t) => str(t.method))) miss.push('técnicas o métodos analíticos');
  if (!['aceptado', 'rechazado'].includes(m.status) || !isDay(m.decision_date)) miss.push('decisión de aceptación o rechazo');
  return miss;
}

async function viewMaterialSheet(id) {
  const m = await getOne('material', id);
  if (!m) return empty('Este lote no existe.', '');
  state.parent = `#materias--${m.uuid}`;
  state.label = null;
  const missing = materialSheetMissing(m);
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(m.name)}</h2>${pill('material', m.status)}</div>
      <p>${m.internal_no ? `${esc(m.internal_no)} · ` : ''}Lote ${esc(m.lot)}${m.supplier ? ` · ${esc(m.supplier)}` : ''}</p>
    </div>
    ${missing.length
      ? `<div class="msg warn"><strong>Faltan datos:</strong> ${esc(missing.join(', '))}. Se puede generar como borrador; para la ficha definitiva, complétalos en la <a href="#materias--${esc(m.uuid)}">ficha del lote</a>.</div>`
      : '<p class="msg ok">El control de calidad del lote está completo.</p>'}
    <form class="form" data-form="materialSheet" data-id="${esc(m.uuid)}" novalidate>
      ${formMsg()}
      <button class="btn block" type="submit">${missing.length ? 'Generar borrador de la ficha' : 'Generar ficha de control de calidad'}</button>
    </form>
    <div id="sheetOut"></div>`;
}

const MATERIAL_DECISION = { aceptado: 'Aceptado', rechazado: 'Rechazado', bloqueado: 'Bloqueado' };
/** Ficha 1: identificación del lote, controles efectuados, decisión y firma. */
async function buildMaterialSheetPdf(m, s, bulletins, draftMissing) {
  const sh = await createSheet({
    title: 'Ficha de control de calidad de materias primas', subtitle: 'Datos de identificación y controles efectuados', tag: 'RD 175/2001 · Ficha 1',
    running: `Ficha de control de calidad · ${m.name} · lote ${m.lot}`, footer: `FARMA·LAB · ${m.internal_no ? `${m.internal_no} · ` : ''}lote ${m.lot}`,
    pharmacy: s.pharmacy, draftMissing,
  });
  const { mm, C } = sh;
  const qc = m.qc || {};
  const qty = isNum(m.quantity_received) ? m.quantity_received : m.quantity;
  sh.grid([
    { label: 'Nº de registro de control interno', value: m.internal_no || '—', big: true, span: 2 },
    { label: 'Estado', value: STATUS.material[m.status] || m.status },
    { label: 'Nombre de la materia prima', value: m.name, strong: true, span: 2 },
    { label: 'Tipo', value: `${KIND_LABELS[m.kind] || 'Sin indicar'}${m.edo ? ' · excipiente de declaración obligatoria' : ''}` },
    { label: 'Número de lote', value: m.lot },
    { label: 'Proveedor', value: m.supplier || '—' },
    { label: 'Código de artículo', value: m.code || '—' },
    packIncluded(m) ? { label: 'Envase (acondicionamiento de la fórmula)', value: m.pack_desc, span: 3 } : null,
    { label: 'Cantidad recibida', value: `${fmtNum(qty)} ${m.unit}${m.containers ? ` en ${m.containers} ${m.containers === 1 ? 'envase' : 'envases'}` : ''}` },
    { label: 'Fecha de recepción', value: fmtDay(m.received_date) },
    { label: 'Fecha de caducidad', value: fmtDay(m.expiry) },
    isDay(m.retest_date) ? { label: 'Repetición del control analítico', value: fmtDay(m.retest_date) } : null,
  ], 3, { bg: C.band, pad: mm(4) });

  sh.section('Controles efectuados', mm(24));
  const yesNo = (v) => (v === true ? 'Sí' : v === false ? 'No' : '—');
  sh.table([
    { title: 'Ensayo', w: 0.27 }, { title: 'Técnica o método', w: 0.30 }, { title: 'Resultado', w: 0.30 }, { title: 'Conforme', w: 0.13 },
  ], (qc.tests || []).filter((t) => str(t.result) || str(t.method)).map((t) => [t.test || '—', t.method || '—', t.result || '—', yesNo(t.ok)]));
  sh.gap(mm(2));
  sh.grid([
    { label: 'Realizado por', value: qc.by || '—' },
    { label: 'Fecha del control', value: isDay(qc.date) ? fmtDay(qc.date) : '—' },
    { label: 'Monografía de referencia', value: m.monograph || '—' },
    { label: 'Boletín de análisis del proveedor', value: [m.qc_no && `Nº ${m.qc_no}`, bulletins.length && `archivado: ${bulletins.join(', ')}`].filter(Boolean).join(' · ') || '—', span: 3 },
  ], 3);

  sh.section('Descripción de los métodos analíticos');
  sh.paragraph(qc.methods || '—', { color: qc.methods ? C.ink : C.muted });

  sh.section('Datos complementarios', mm(16));
  sh.grid([
    { label: 'Condiciones de conservación', value: m.storage || '—' },
    { label: 'Precauciones de manipulación', value: m.handling || '—' },
    { label: 'Toxicidad y peligrosidad', value: m.toxicity || '—' },
  ], 3);

  sh.section('Observaciones');
  sh.paragraph(m.observations || '—', { color: m.observations ? C.ink : C.muted });

  const decided = MATERIAL_DECISION[m.status] && isDay(m.decision_date);
  sh.signature({
    decision: decided ? `${MATERIAL_DECISION[m.status]} el ${fmtDay(m.decision_date)} por ${m.decision_by || '—'}` : 'En cuarentena: pendiente de decisión',
    rejected: m.status === 'rechazado',
    signer: [m.decision_by || s.pharmacy.pharmacist, decided && `Fecha: ${fmtDay(m.decision_date)}`].filter(Boolean).join(' · '),
  });
  return sh.finish();
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
    await showSheet(blob, `ficha-control-${slug}.pdf`, missing.length ? 'Borrador listo' : 'Ficha lista');
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
