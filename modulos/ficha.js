'use strict';
/* FARMA·LAB móvil · Ficha de registro de formulación magistral (RD 175/2001, apartado 3.4.2 y ficha 2) en PDF A4. */

ROUTES.ficha = (arg) => viewRecordSheet(arg);

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
    qcTests: (qc.tests || []).filter((t) => t.test || t.result).map((t) => [t.test || '—', t.result || '—', yesNo(t.ok)]),
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

/** Maqueta la ficha en A4: cabecera, bloque de identificación, apartados del 3.4.2 y firma. */
async function buildRecordSheetPdf(p, d, s, draftMissing) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle(`Ficha de registro ${p.lot}`);
  doc.setSubject('Ficha de registro de formulación magistral (RD 175/2001)');
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
    warn: rgb(0.52, 0.31, 0.04), warnBg: rgb(0.984, 0.933, 0.835),
  };
  const pages = [];
  let page; let y;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (pages.length > 1) {
      page.drawText(clean(`Ficha de registro de formulación magistral · Lote ${p.lot}`), { x: M, y: y - 8, size: 8, font: bold, color: C.muted });
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
  const paragraph = (value, { f = font, size = 9.2, color = C.ink, lh = 1.32, indent = 0 } = {}) => {
    for (const ln of wrap(f, size, value, CW - indent)) {
      ensure(size * lh);
      y -= size * lh;
      page.drawText(ln, { x: M + indent, y: y + size * 0.26, size, font: f, color });
    }
  };
  /** Título de apartado; keep = espacio mínimo para que no quede solo al pie de la página. */
  const section = (title, keep = mm(12)) => {
    ensure(mm(14) + keep);
    y -= mm(4.2);
    page.drawText(clean(title), { x: M, y: y - 10, size: 10.5, font: bold, color: C.accent });
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
    while (i < cells.length) {
      const row = [];
      let used = 0;
      while (i < cells.length && used + (cells[i].span || 1) <= cols) { row.push(cells[i]); used += cells[i].span || 1; i += 1; }
      const laid = row.map((c) => {
        const w = colW * (c.span || 1) + gap * ((c.span || 1) - 1);
        const size = c.big ? 15 : 9.4;
        const lines = c.value === '' ? [] : wrap(c.big ? bold : (c.strong ? bold : font), size, c.value, w);
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
            page.drawText(ln, { x, y: ty + c.size * 0.26, size: c.size, font: c.big || c.strong ? bold : font, color: c.big ? C.accent : C.ink });
          }
        }
        x += c.w + mm(4);
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

  // ---------------- cabecera
  newPage();
  const ph = s.pharmacy;
  page.drawText(clean(ph.name || 'Oficina de farmacia'), { x: M, y: y - 10, size: 10.5, font: bold, color: C.ink });
  const tag = 'RD 175/2001 · Ficha 2';
  page.drawText(tag, { x: W - M - font.widthOfTextAtSize(tag, 8), y: y - 9, size: 8, font, color: C.muted });
  y -= 13;
  const contact = clean([ph.address, ph.phone && `Tel. ${ph.phone}`].filter(Boolean).join(' · '));
  if (contact) { page.drawText(contact, { x: M, y: y - 9, size: 8.2, font, color: C.muted }); y -= 11; }
  y -= mm(5);
  page.drawText('Ficha de registro de formulación magistral', { x: M, y: y - 18, size: 18, font: bold, color: C.ink });
  y -= 23;
  page.drawText('Guía de elaboración, control y registro', { x: M, y: y - 10, size: 9.5, font, color: C.muted });
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

  grid([
    { label: 'Registro / Lote', value: p.lot, big: true, span: 2 },
    { label: 'Registro de elaboración', value: p.record_code },
    { label: 'Nombre', value: d.name, strong: true, span: 3 },
    { label: 'Tipo', value: d.type },
    { label: 'Forma farmacéutica', value: p.form || '—' },
    { label: 'Vía de administración', value: p.route || '—' },
    { label: 'Cantidad elaborada', value: `${fmtNum(p.target_amount)} ${p.unit}` },
    { label: 'Fecha de elaboración', value: fmtDay(p.elaborated_date) },
    { label: 'Fecha de caducidad', value: fmtDay(p.expiry_date) },
    { label: 'Condiciones de conservación', value: p.storage || '—', span: 3 },
  ], 3, { bg: C.band, pad: mm(4) });

  // ---------------- apartados del 3.4.2
  section('Composición');
  paragraph(d.composition);

  section('Modus operandi');
  if (d.pnts.length) d.pnts.forEach((t) => paragraph(t, { f: bold, size: 9 }));
  if (d.method) { if (d.pnts.length) y -= 3; paragraph(d.method); }
  if (!d.pnts.length && !d.method) paragraph('—', { color: C.muted });

  section('Utillaje utilizado');
  paragraph(d.equipment || '—', { color: d.equipment ? C.ink : C.muted });

  section('Datos de las materias primas', mm(22));
  table([
    { title: 'Principios activos / Excipientes', w: 0.29 },
    { title: 'Nº control o lote', w: 0.22 },
    { title: 'Proveedor', w: 0.17 },
    { title: 'Cantidad teórica', w: 0.11, right: true },
    { title: 'Cantidad pesada', w: 0.11, right: true },
    { title: 'Unidad', w: 0.10 },
  ], d.materials);
  y -= 3;
  paragraph('PA: principio activo · EDO: excipiente de declaración obligatoria', { size: 7.4, color: C.muted });

  section('Datos del material de acondicionamiento', mm(18));
  table([{ title: 'Tipo', w: 0.55 }, { title: 'Nº control o lote', w: 0.30 }, { title: 'Unidades', w: 0.15, right: true }], d.packaging);

  section('Personal elaborador', mm(14));
  grid([{ label: 'Farmacéutico/s', value: d.pharmacists }, { label: 'Auxiliares (nombre y apellidos)', value: d.assistants || '—' }], 2);

  section('Control de calidad', mm(24));
  table([{ title: 'Prueba realizada', w: 0.38 }, { title: 'Resultado', w: 0.47 }, { title: 'Conforme', w: 0.15 }], d.qcTests);
  y -= mm(2);
  grid([
    { label: 'Número de control', value: p.record_code },
    { label: 'Realizado por', value: d.qcBy || '—' },
    { label: 'Fecha de caducidad', value: fmtDay(p.expiry_date) },
    { label: 'Aparataje', value: d.qcApparatus || '—', span: 1 },
    { label: 'Reactivos y su lote', value: d.qcReagents || '—', span: 2 },
  ], 3);

  section('Datos de dispensación', mm(26));
  grid([
    { label: 'Nº de registro del Libro Recetario', value: d.recetario },
    { label: 'Fecha de dispensación', value: d.dispensedDate },
    { label: 'Cantidad dispensada', value: d.dispensedQty },
    { label: 'Facultativo prescriptor', value: d.prescriber, span: 2 },
    { label: 'Paciente', value: d.patient },
  ], 3);

  section('Observaciones');
  paragraph(d.notes || '—', { color: d.notes ? C.ink : C.muted });

  // ---------------- conformidad y firma
  const boxH = mm(34);
  ensure(boxH + mm(8));
  y -= mm(6);
  const half = CW / 2;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, borderColor: C.ink, borderWidth: 0.8 });
  page.drawLine({ start: { x: M + half, y }, end: { x: M + half, y: y - boxH }, thickness: 0.8, color: C.ink });
  page.drawText('Conformidad', { x: M + mm(4), y: y - mm(4) - 7, size: 7.6, font: bold, color: C.muted });
  wrap(bold, 10, d.decision, half - mm(8)).forEach((ln, k) => {
    page.drawText(ln, { x: M + mm(4), y: y - mm(10) - 10 - k * 13, size: 10, font: bold, color: p.decision === 'rechazada' ? rgb(0.64, 0.14, 0.11) : C.ink });
  });
  page.drawText('Fecha y firma del farmacéutico responsable', { x: M + half + mm(4), y: y - mm(4) - 7, size: 7.6, font: bold, color: C.muted });
  const signY = y - boxH + mm(9);
  page.drawLine({ start: { x: M + half + mm(4), y: signY }, end: { x: W - M - mm(4), y: signY }, thickness: 0.6, color: C.line });
  const signer = clean([ph.pharmacist || p.decision_by, d.decisionDate && `Fecha: ${d.decisionDate}`].filter(Boolean).join(' · '));
  if (signer) page.drawText(signer, { x: M + half + mm(4), y: signY - 11, size: 8.4, font, color: C.muted });
  y -= boxH;

  // ---------------- pie de página
  const stamp = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: M + mm(5) }, end: { x: W - M, y: M + mm(5) }, thickness: 0.5, color: C.line });
    pg.drawText(clean(`FARMA·LAB · Lote ${p.lot}${draftMissing.length ? ' · BORRADOR' : ''}`), { x: M, y: M, size: 7.4, font, color: C.muted });
    const right = clean(`Página ${i + 1} de ${pages.length} · Generada el ${stamp}`);
    pg.drawText(right, { x: W - M - font.widthOfTextAtSize(right, 7.4), y: M, size: 7.4, font, color: C.muted });
  });
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

Object.assign(FORMS, {
  async recordSheet(form) {
    const p = await getOne('production', form.dataset.id);
    if (!p || !p.lot) throw new InputError('Esta elaboración aún no tiene lote.');
    const s = await loadSettings();
    const f = formData(form);
    const extra = { prescriber: str(f.prescriber).slice(0, 120), collegiate: str(f.collegiate).slice(0, 30), patient: str(f.patient).slice(0, 120) };
    const missing = pendingItems(p);
    const data = await recordSheetData(p, extra);
    const blob = await buildRecordSheetPdf(p, data, s, missing);
    const name = `ficha-registro-${p.lot}.pdf`;
    state.label = { blob, name };
    await logOnly('ficha_generada', `${p.lot} ${p.formula_name}${missing.length ? ' (borrador)' : ''}`);
    const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: 'application/pdf' })] });
    const out = $('#sheetOut');
    out.innerHTML = `<section><h2>${missing.length ? 'Borrador listo' : 'Ficha lista'}</h2>
      <div class="actions"><button class="btn" data-act="downloadLabel">Descargar PDF</button>${canShare ? '<button class="btn secondary" data-act="shareLabel">Compartir o imprimir</button>' : ''}</div>
      <p class="hint">A4 vertical. Imprímela al 100 %, fírmala y archívala con la receta.</p>
      <div id="docview" class="docview spaced"><p class="hint">Preparando la vista previa...</p></div></section>`;
    renderDocument($('#docview'));
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});
