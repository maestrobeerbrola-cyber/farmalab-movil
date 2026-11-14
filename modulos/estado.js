'use strict';
/* FARMA·LAB · Etiquetas de estado para los envases del almacén: «En cuarentena» (PN/L/PG/005/00, 4.1.3),
   «Aceptado» con el nº de registro interno (4.2) y «Rechazado» o «Bloqueado». Valen para materias primas
   y material de acondicionamiento. No sustituyen a la etiqueta del proveedor, que se conserva siempre. */

ROUTES.etiquetaestado = (arg, extra) => (arg && extra ? viewStatusLabel(arg, extra) : viewStatusLabels());

const STATUS_LABEL = {
  cuarentena: { word: 'EN CUARENTENA', fill: [245, 191, 38], ink: [58, 42, 0] },
  aceptado: { word: 'ACEPTADO', fill: [31, 125, 51], ink: [255, 255, 255] },
  rechazado: { word: 'RECHAZADO', fill: [194, 7, 52], ink: [255, 255, 255] },
  bloqueado: { word: 'BLOQUEADO', fill: [90, 90, 90], ink: [255, 255, 255] },
};
// Hojas A4 de etiquetas adhesivas sin márgenes: 8 (105 × 74 mm) o 24 (70 × 37 mm).
const STATUS_LAYOUTS = { 8: { cols: 2, rows: 4, w: 105, h: 74.25, pad: 3.5 }, 24: { cols: 3, rows: 8, w: 70, h: 37.125, pad: 2.4 } };
const STATUS_STORES = { material: { route: 'materias', label: 'Materia prima', code: 'PN/L/PG/005/00' }, packaging: { route: 'envases', label: 'Acondicionamiento', code: 'PN/L/PG/006/00' } };
const labelLayoutPref = () => { try { return localStorage.getItem('farmalab-status-layout') === '24' ? '24' : '8'; } catch { return '8'; } };
const saveLayoutPref = (v) => { try { localStorage.setItem('farmalab-status-layout', v); } catch { /* sin almacenamiento */ } };
const statusWord = (status) => (STATUS_LABEL[status] || STATUS_LABEL.cuarentena).word;
/** Botón para la ficha del lote. */
const statusLabelButton = (store, r) => `<p><a class="btn block secondary" href="#etiquetaestado--${store}--${esc(r.uuid)}">${ICON.tag}Etiqueta «${esc(statusWord(r.status).charAt(0) + statusWord(r.status).slice(1).toLocaleLowerCase('es'))}» para el envase</a></p>`;

function statusLayoutFields(max) {
  const layout = labelLayoutPref();
  return `<div class="grid2">
      ${field('Hoja de etiquetas', `<select name="layout">${options(['8', '24'], layout, { 8: '8 por hoja (105 × 74 mm)', 24: '24 por hoja (70 × 37 mm)' })}</select>`)}
      ${field('Empezar en la etiqueta', `<input type="text" inputmode="numeric" name="start" value="1" maxlength="2">`, 'Para aprovechar una hoja ya empezada.')}
    </div>
    ${max ? field('Copias', `<input type="text" inputmode="numeric" name="copies" value="1" maxlength="2">`, 'Una por envase.') : ''}`;
}
async function viewStatusLabel(store, id) {
  if (!STATUS_STORES[store]) return empty('Página no encontrada', '');
  const r = await getOne(store, id);
  if (!r) return empty('Este registro no existe.', '');
  state.parent = `#${STATUS_STORES[store].route}--${r.uuid}`;
  state.label = null;
  const accepted = r.status === 'aceptado';
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(r.name)}</h2>${pill(store, r.status)}</div>
      <p>${r.lot ? `Lote ${esc(r.lot)}` : 'Sin lote'}${r.internal_no ? ` · ${esc(r.internal_no)}` : ''}</p>
    </div>
    <p class="hint intro">${r.status === 'cuarentena' ? 'Pega la etiqueta en el envase mientras esté en la zona de cuarentena, sin tapar la etiqueta del proveedor (PN/L/PG/005/00, 4.1.3).' : accepted ? 'Al aceptarla, se anota en la etiqueta el nº de registro interno (PN/L/PG/005/00, 4.2). Pégala sobre la de cuarentena.' : 'Mantén el envase aparte y etiquetado hasta su devolución o eliminación.'}</p>
    ${accepted && !r.internal_no ? '<p class="msg warn">Este lote aún no tiene nº de registro interno: la etiqueta saldrá sin él.</p>' : ''}
    <form class="form" data-form="statusLabels" data-store="${store}" data-id="${esc(r.uuid)}" novalidate>
      ${formMsg()}
      ${statusLayoutFields(true)}
      <button class="btn block" type="submit">Generar la etiqueta</button>
    </form>
    <div id="sheetOut"></div>`;
}
async function viewStatusLabels() {
  state.parent = '#materias';
  state.label = null;
  const rows = [
    ...(await getAll('material')).map((r) => ({ store: 'material', r })),
    ...(await getAll('packaging')).map((r) => ({ store: 'packaging', r })),
  ].filter(({ store, r }) => ((r.quantity ?? 0) > 0 || r.status === 'rechazado') && !(store === 'material' && lotArchived(r)))
    .sort((a, b) => String(b.r.received_date || b.r.created_at || '').localeCompare(String(a.r.received_date || a.r.created_at || '')));
  const order = ['cuarentena', 'aceptado', 'rechazado', 'bloqueado'];
  const groups = order.map((st) => [st, rows.filter((x) => x.r.status === st)]).filter(([, l]) => l.length);
  return `<p class="hint intro">Elige los envases que necesitan etiqueta: se imprime una por envase. Los lotes en cuarentena vienen marcados.</p>
    ${groups.length ? `<form class="form" data-form="statusLabels" novalidate>
      ${formMsg()}
      ${groups.map(([st, list]) => `<fieldset class="group"><legend>${esc(STATUS.material[st] || st)} (${list.length})</legend>
        ${list.map(({ store, r }) => checkbox('pick', `${esc(r.name)} <span class="hint">${esc(STATUS_STORES[store].label)}${r.lot ? ` · lote ${esc(r.lot)}` : ''}${r.internal_no ? ` · ${esc(r.internal_no)}` : ''}</span>`, st === 'cuarentena', `value="${store}:${esc(r.uuid)}"`)).join('')}
      </fieldset>`).join('')}
      ${statusLayoutFields(false)}
      <button class="btn block" type="submit">Generar las etiquetas</button>
    </form>
    <div id="sheetOut"></div>` : empty('No hay envases con existencias.', 'Las etiquetas se hacen desde la ficha de cada lote.')}`;
}

/** Hoja A4 de etiquetas de estado; items: [{ store, r }], una etiqueta por elemento. */
async function buildStatusLabelsPdf(items, { layout = '8', start = 1, s }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle('Etiquetas de estado');
  doc.setCreator('FARMA·LAB');
  doc.setProducer('FARMA·LAB');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const clean = (t) => [...pdfSymbols(t).replace(/\s+/g, ' ')].map((ch) => (charset.has(ch.codePointAt(0)) ? ch : '?')).join('').trim();
  const mm = (v) => (v * 72) / 25.4;
  const L = STATUS_LAYOUTS[layout] || STATUS_LAYOUTS[8];
  const per = L.cols * L.rows;
  const C = (a) => rgb(a[0] / 255, a[1] / 255, a[2] / 255);
  const pharmacy = clean(s.pharmacy && s.pharmacy.name ? s.pharmacy.name : '');
  const small = layout === '24';
  const wrap = (f, size, t, width) => {
    const out = []; let line = '';
    for (const w of clean(t).split(' ')) {
      const next = line ? `${line} ${w}` : w;
      if (!line || f.widthOfTextAtSize(next, size) <= width) line = next; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    return out;
  };
  const pages = [];
  const slots = Math.max(0, Math.min(per - 1, start - 1));
  items.forEach(({ store, r }, n) => {
    const pos = slots + n;
    while (pages.length <= Math.floor(pos / per)) pages.push(doc.addPage([mm(210), mm(297)]));
    const page = pages[Math.floor(pos / per)];
    const k = pos % per;
    const col = k % L.cols; const row = Math.floor(k / L.cols);
    const x0 = mm(col * L.w); const yTop = mm(297 - row * L.h);
    const W = mm(L.w); const H = mm(L.h); const pad = mm(L.pad);
    page.drawRectangle({ x: x0, y: yTop - H, width: W, height: H, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.4, borderDashArray: [2, 2] });
    const st = STATUS_LABEL[r.status] || STATUS_LABEL.cuarentena;
    // banda con el estado
    const bandH = mm(small ? 7 : 12);
    page.drawRectangle({ x: x0 + pad, y: yTop - pad - bandH, width: W - 2 * pad, height: bandH, color: C(st.fill) });
    const wsz = small ? 11 : 19;
    const ww = bold.widthOfTextAtSize(st.word, wsz);
    page.drawText(st.word, { x: x0 + (W - ww) / 2, y: yTop - pad - bandH / 2 - wsz * 0.35, size: wsz, font: bold, color: C(st.ink) });
    // datos
    const decided = isDay(r.decision_date);
    const lines = [
      [bold, 1.25, r.name + (r.capacity ? ` ${r.capacity}` : '')],
      [font, 1, [r.lot ? `Lote ${r.lot}` : '', r.supplier ? `Proveedor: ${r.supplier}` : ''].filter(Boolean).join(' · ')],
    ];
    if (r.status === 'cuarentena') {
      lines.push([font, 1, `Recibido el ${fmtDay(r.received_date)}`]);
      lines.push([bold, 1, 'No utilizar hasta su aceptación.']);
    } else if (r.status === 'aceptado') {
      lines.push([bold, 1.45, r.internal_no ? `Nº ${r.internal_no}` : 'Nº de registro interno: ______']);
      lines.push([font, 1, `Aceptado${decided ? ` el ${fmtDay(r.decision_date)}` : ''}${r.decision_by ? ` · ${r.decision_by}` : ''}`]);
      const exp = isDay(r.expiry) ? `Caducidad: ${fmtDay(r.expiry)}` : isDay(r.retest_date) ? `Próximo control: ${fmtDay(r.retest_date)}` : '';
      if (exp) lines.push([bold, 1, exp]);
      if (!small && r.storage) lines.push([font, 0.9, `Conservación: ${r.storage}`]);
    } else {
      lines.push([font, 1, `${r.status === 'rechazado' ? 'Rechazado' : 'Bloqueado'}${decided ? ` el ${fmtDay(r.decision_date)}` : ''}${r.decision_by ? ` · ${r.decision_by}` : ''}`]);
      lines.push([bold, 1, r.status === 'rechazado' ? 'No utilizar. Devolver al proveedor o eliminar.' : 'No utilizar hasta nueva evaluación.']);
    }
    const foot = [pharmacy, STATUS_STORES[store].code].filter(Boolean).join(' · ');
    const boxW = W - 2 * pad;
    const top = yTop - pad - bandH - mm(small ? 1.4 : 2.4);
    const bottom = yTop - H + pad + (foot ? 7 : 0);
    let size = small ? 7.4 : 12.5;
    let laid;
    for (; size >= 4.6; size -= 0.2) {
      laid = []; let h = 0;
      lines.filter((l) => str(l[2])).forEach(([f, k, t]) => wrap(f, size * k, t, boxW).forEach((ln) => { laid.push({ f, fs: size * k, t: ln }); h += size * k * 1.2; }));
      if (top - h >= bottom) break;
    }
    let y = top;
    laid.forEach((l) => { y -= l.fs * 1.2; page.drawText(l.t, { x: x0 + pad, y: y + l.fs * 0.2, size: l.fs, font: l.f, color: rgb(0.08, 0.08, 0.08) }); });
    if (foot) page.drawText(clean(foot), { x: x0 + pad, y: yTop - H + pad, size: small ? 5.2 : 6.4, font, color: rgb(0.4, 0.4, 0.4) });
  });
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

Object.assign(FORMS, {
  async statusLabels(form) {
    const s = await loadSettings();
    const all = new FormData(form);
    const layout = all.get('layout') === '24' ? '24' : '8';
    const per = STATUS_LAYOUTS[layout].cols * STATUS_LAYOUTS[layout].rows;
    const start = Number(str(all.get('start')) || 1);
    if (!Number.isInteger(start) || start < 1 || start > per) throw new InputError(`La primera etiqueta debe ser un número del 1 al ${per}.`);
    let items = [];
    if (form.dataset.id) {
      const store = form.dataset.store;
      const r = await getOne(store, form.dataset.id);
      if (!r) throw new InputError('Este registro ya no existe.');
      const copies = Number(str(all.get('copies')) || 1);
      if (!Number.isInteger(copies) || copies < 1 || copies > 48) throw new InputError('Indica cuántas etiquetas (de 1 a 48).');
      items = Array.from({ length: copies }, () => ({ store, r }));
    } else {
      for (const v of all.getAll('pick')) {
        const [store, id] = String(v).split(':');
        const r = STATUS_STORES[store] ? await getOne(store, id) : null;
        if (r) items.push({ store, r });
      }
      if (!items.length) throw new InputError('Marca al menos un envase.');
    }
    saveLayoutPref(layout);
    const blob = await buildStatusLabelsPdf(items, { layout, start, s });
    await logOnly('etiquetas_estado', `${items.length} ${items.length === 1 ? 'etiqueta' : 'etiquetas'}: ${[...new Set(items.map(({ r }) => `${r.name}${r.lot ? ` (${r.lot})` : ''} ${statusWord(r.status).toLocaleLowerCase('es')}`))].slice(0, 6).join(', ')}`);
    await showSheet(blob, `etiquetas-estado-${todayIso()}.pdf`, items.length === 1 ? 'Etiqueta lista' : 'Etiquetas listas');
  },
});
Object.assign(ACTION_LABELS, { etiquetas_estado: 'Etiquetas de estado generadas' });
