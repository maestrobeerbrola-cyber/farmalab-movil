'use strict';
/* FARMA·LAB móvil · Elaborar: guía de elaboración (RD 175/2001), estados, lote, consumo de stock y etiquetas. */

ROUTES.elaboraciones = (arg, extra) => (arg === 'nueva' ? viewProductionNew(extra) : arg ? viewProduction(arg) : viewProductions());
ROUTES.etiqueta = (arg) => viewLabel(arg);

const makeLot = (settings, n, ymd) => {
  const [y, m] = (isDay(ymd) ? ymd : todayIso()).split('-');
  return `${y}-${settings.lot.letter || 'J'}-${m}-FM-${n}`;
};
const addDays = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};

/** Datos de la guía de elaboración que faltan para completar la ficha (RD 175/2001, capítulo III). */
function pendingItems(p) {
  const miss = [];
  const ws = p.weighings || [];
  if (!ws.length || ws.some((w) => !isNum(w.actual) || !w.material_lot)) miss.push('pesadas o lotes de materias primas');
  if (p.status === 'en_proceso' || p.status === 'rechazada') return miss;
  if (!p.lot) miss.push('número de lote');
  if (!str(p.form)) miss.push('forma farmacéutica');
  if (!(p.pnt_refs || []).length && !str(p.method_notes)) miss.push('modus operandi (PNT o descripción)');
  if (!(p.equipment || []).length) miss.push('utillaje utilizado');
  if (!((p.qc && p.qc.tests) || []).some((t) => str(t.result))) miss.push('resultados del control de calidad');
  if (!str(p.qc && p.qc.by)) miss.push('personal del control de calidad');
  if (!(p.packaging_used || []).length) miss.push('material de acondicionamiento');
  if (!isDay(p.elaborated_date)) miss.push('fecha de elaboración');
  if (!isDay(p.expiry_date)) miss.push('fecha de caducidad');
  if (!str(p.storage)) miss.push('condiciones de conservación');
  if (p.decision !== 'aceptada') miss.push('decisión de aceptación del farmacéutico');
  if (p.status === 'dispensada') {
    if (!str(p.recetario_no)) miss.push('nº del libro recetario');
    if (!isDay(p.dispensed_date)) miss.push('fecha de dispensación');
    if (!isNum(p.dispensed_qty)) miss.push('cantidad dispensada');
  }
  return miss;
}
const staleDays = (p) => (p.status === 'en_proceso' ? Math.floor((Date.now() - Date.parse(p.status_changed_at || p.created_at)) / 864e5) : 0);

// ------------------------------------------------------------------ lista y alta
const STATUS_ORDER = { en_proceso: 0, elaborada: 1, dispensada: 2, rechazada: 3 };
async function viewProductions() {
  const items = (await getAll('production')).sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || String(b.created_at).localeCompare(String(a.created_at)));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((p) => {
      const warn = (['elaborada', 'dispensada'].includes(p.status) && pendingItems(p).length) || staleDays(p) >= STALE_PRODUCTION_DAYS;
      return `<li data-text="${esc(lc([p.lot, p.record_code, p.formula_name, p.recetario_no, STATUS.production[p.status]].join(' ')))}"><a class="row" href="#elaboraciones--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.lot || p.record_code)}</strong><span class="sub"><span>${esc(p.formula_name)}</span><span>${fmtNum(p.target_amount)} ${esc(p.unit)}</span><span>${esc(fmtStamp(p.created_at).slice(0, 10))}</span>${warn ? '<span class="warn">Pendiente</span>' : ''}</span></div>${pill('production', p.status)}</a></li>`;
    }).join('')}</ul><p class="none" data-none hidden>Ninguna elaboración coincide con la búsqueda.</p>`
    : empty('Aún no hay elaboraciones.', 'Crea una con «Nueva elaboración» a partir de una fórmula aprobada.');
  return `${items.length ? searchBox('Buscar lote, fórmula o nº de recetario') : ''}${list}${fab('#elaboraciones--nueva', 'Nueva elaboración')}`;
}

async function suggestRecordCode() {
  const day = todayIso().replaceAll('-', '');
  const prods = await getAll('production');
  const prefix = `E-${day}-`;
  let n = prods.filter((p) => String(p.record_code).startsWith(prefix)).length + 1;
  const used = new Set(prods.map((p) => lc(p.record_code)));
  while (used.has(lc(`${prefix}${pad2(n)}`))) n += 1;
  return `${prefix}${pad2(n)}`;
}
const presentationAmount = (text) => { const m = String(text || '').match(/(\d+(?:[.,]\d+)?)/); return m ? Number(m[1].replace(',', '.')) : null; };

async function viewProductionNew(preselect) {
  const formulas = (await getAll('formula')).filter((f) => f.status === 'aprobada').sort(byText('name'));
  state.formulaCache = Object.fromEntries(formulas.map((f) => [f.uuid, f]));
  if (!formulas.length) {
    return `<div class="empty"><strong>No hay fórmulas aprobadas.</strong>Solo se puede elaborar a partir de una fórmula en estado Aprobada.<a class="btn secondary small" href="#formulas">Ir a Fórmulas</a></div>`;
  }
  const code = await suggestRecordCode();
  return `<form class="form" data-form="productionNew" novalidate>
    ${formMsg()}
    ${field('Fórmula aprobada', `<select name="formula_uuid" required>${formulas.map((f) => `<option value="${esc(f.uuid)}"${f.uuid === preselect ? ' selected' : ''}>${esc(f.code ? `${f.code} ` : '')}${esc(f.name)} (v${esc(f.version)})</option>`).join('')}</select>`)}
    <div data-cn-box></div>
    <div class="grid2">
      ${field('Cantidad a elaborar', decimal('target_amount', 'required'))}
      ${field('Unidad', '<input type="text" name="unit_view" readonly tabindex="-1">')}
    </div>
    ${field('Código de registro', text('record_code', `value="${esc(code)}" required maxlength="80"`), 'Identifica la elaboración hasta que se le asigne el lote. No puede repetirse.')}
    ${field('Observaciones', '<textarea name="notes" maxlength="2000"></textarea>')}
    <section><h2>Cantidades teóricas</h2><div id="preview"></div>
    <p class="hint">Escalado proporcional de la composición aprobada. No contempla densidad, mermas, sobrellenado ni conversiones de unidades: usa la calculadora si lo necesitas.</p></section>
    <button class="btn block" type="submit">Empezar elaboración</button>
  </form>`;
}
function updatePreview(form) {
  const f = state.formulaCache[form.formula_uuid.value];
  const box = $('#preview');
  if (!f || !box) return;
  form.unit_view.value = f.unit;
  const cnBox = $('[data-cn-box]', form);
  if (cnBox && cnBox.dataset.formula !== f.uuid) {
    cnBox.dataset.formula = f.uuid;
    const cns = f.national_codes || [];
    cnBox.innerHTML = cns.length ? field('Presentación y código nacional', `<select name="cn"><option value="">Sin código nacional</option>${cns.map((c, i) => `<option value="${i}">${esc([c.presentation, c.concentration].filter(Boolean).join(' · '))} · CN ${esc(c.cn)}</option>`).join('')}</select>`, 'Al elegirla se propone su cantidad.') : '';
  }
  let target = null;
  try { target = parseNum(form.target_amount.value, 'Cantidad'); } catch { target = null; }
  if (!target || target <= 0 || !(f.target_amount > 0)) {
    box.innerHTML = `<p class="hint">Escribe la cantidad para ver la de cada componente (la fórmula está definida para ${fmtNum(f.target_amount)} ${esc(f.unit)}).</p>`;
    return;
  }
  const factor = target / f.target_amount;
  box.innerHTML = `<ul class="list">${(f.components || []).map((c) => `<li><div class="row"><span class="row-main">${esc(c.ingredient)} ${compTags(c)}</span><b class="num">${fmtNum(round6(c.amount * factor))} ${esc(c.unit)}</b></div></li>`).join('')}</ul>`;
}
INPUT_HOOKS.push((t) => { const f = t.closest('form[data-form="productionNew"]'); if (f) updatePreview(f); });
CHANGE_HOOKS.push((t) => {
  const f = t.closest('form[data-form="productionNew"]');
  if (!f) return;
  if (t.name === 'cn' && t.value !== '') {
    const formula = state.formulaCache[f.formula_uuid.value];
    const c = formula && (formula.national_codes || [])[Number(t.value)];
    const amount = c && presentationAmount(c.presentation);
    if (amount) f.target_amount.value = fmtNum(amount);
  }
  updatePreview(f);
});
AFTER_RENDER.push(() => { const f = $('form[data-form="productionNew"]'); if (f) updatePreview(f); });

// ------------------------------------------------------------------ guía de elaboración
function packRow(u = {}, packs = state.packs || []) {
  const opts = packs.filter((p) => p.status === 'aceptado' || p.uuid === u.packaging_uuid);
  return `<div class="packrow" data-comp>
    <select name="pack_uuid" aria-label="Envase"><option value="">Elegir envase</option>${opts.map((p) => `<option value="${esc(p.uuid)}"${p.uuid === u.packaging_uuid ? ' selected' : ''}>${esc(p.name)}${p.capacity ? ` ${esc(p.capacity)}` : ''}${p.lot ? `, lote ${esc(p.lot)}` : ''} (quedan ${fmtNum(p.quantity)})</option>`).join('')}</select>
    <input type="text" inputmode="numeric" name="pack_qty" aria-label="Unidades" placeholder="Uds." maxlength="5" value="${esc(u.qty ?? '1')}">
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
  </div>`;
}
function qcRow(t = {}) {
  return `<div class="qcrow" data-comp>
    <input type="text" name="qc_test" aria-label="Prueba" placeholder="Prueba" maxlength="120" value="${esc(t.test || '')}">
    <input type="text" name="qc_result" aria-label="Resultado" placeholder="Resultado" maxlength="160" value="${esc(t.result || '')}">
    <select name="qc_ok" aria-label="Conforme">${options(['', 'si', 'no'], t.ok === true ? 'si' : t.ok === false ? 'no' : '', { '': 'Conforme', si: 'Conforme: sí', no: 'Conforme: no' })}</select>
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
  </div>`;
}

async function viewProduction(id) {
  const p = await getOne('production', id);
  if (!p) return empty('Este registro no existe.', '');
  const s = await loadSettings();
  state.materials = await getAll('material');
  state.packs = (await getAll('packaging')).sort(byText('name'));
  const open = p.status === 'en_proceso';
  const editableGuide = ['en_proceso', 'elaborada', 'dispensada'].includes(p.status);
  const ws = p.weighings || [];
  const done = ws.filter((w) => isNum(w.actual) && w.material_lot).length;
  const missing = pendingItems(p);
  const stale = staleDays(p);
  const qc = p.qc || {};
  const tests = (qc.tests && qc.tests.length) ? qc.tests : s.qc_tests.map((t) => ({ test: t }));
  const equipment = [...new Set([...(s.equipment || []), ...(p.equipment || [])])];
  const tasado = p.cn ? await tasadoFor(p.cn.cn) : null;

  const header = `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(p.lot || p.record_code)}</h2>${pill('production', p.status)}</div>
    ${facts([
      ['Fórmula', `<a href="#formulas--${esc(p.formula_uuid)}">${esc(p.formula_name)}</a> (versión ${esc(p.formula_version)})`],
      p.lot ? ['Registro', esc(p.record_code)] : ['Lote', '<span class="hint">Se asigna al marcarla como elaborada</span>'],
      ['Tipo', esc(FORMULA_TYPES[p.formula_type] || FORMULA_TYPES.fm)],
      ['Forma y vía', `${val(p.form)}${p.route ? ` · ${esc(p.route)}` : ''}`],
      ['Cantidad', `${fmtNum(p.target_amount)} ${esc(p.unit)}`],
      p.cn ? ['Código nacional', `${esc(p.cn.cn)} (${esc([p.cn.presentation, p.cn.concentration].filter(Boolean).join(', '))})`] : null,
      tasado ? ['PVP tasado', `<strong>${money(tasado.pvp)}</strong>`] : null,
      !tasado && p.valuation ? ['Precio de valoración', `<strong>${money(p.valuation.total)}</strong> <span class="hint">(${fmtDay(p.valuation.date)})</span>`] : null,
      ['Elaborador', val(p.operator)],
      ['Inicio', esc(fmtStamp(p.created_at))],
      p.status === 'dispensada' ? ['Dispensada', `${fmtDay(p.dispensed_date)} · Libro recetario nº ${val(p.recetario_no)}`] : null,
    ])}
  </div>
  ${stale >= STALE_PRODUCTION_DAYS ? `<p class="msg warn">En proceso desde hace ${stale} días sin cambiar de estado.</p>` : ''}
  ${missing.length && p.status !== 'en_proceso' ? `<div class="msg warn"><strong>Faltan datos para completar la guía:</strong> ${esc(missing.join(', '))}.</div>` : ''}
  ${['elaborada', 'dispensada'].includes(p.status) && p.lot ? `<p><a class="btn block secondary" href="#etiqueta--${esc(p.uuid)}">${ICON.tag}Generar etiqueta en PDF</a></p>` : ''}
  ${!tasado && p.status !== 'rechazada' ? `<p><a class="btn block secondary" href="#valoracion--elab--${esc(p.uuid)}">${ICON.calc}${p.valuation ? 'Revisar el precio de valoración' : 'Calcular el precio de valoración'}</a></p>` : ''}
  ${p.status === 'elaborada' && !p.lot ? `<p class="msg warn">Esta elaboración se registró con una versión anterior y no tiene lote. <button class="btn small" data-act="assignLot" data-id="${esc(p.uuid)}">Asignar lote</button></p>` : ''}`;

  const weighBlocks = ws.map((w, i) => {
    const lots = state.materials.filter((m) => fold(m.name) === fold(w.ingredient));
    return `<div class="weigh" role="group" aria-labelledby="w${i}">
      <h3 id="w${i}">${esc(w.ingredient)} ${compTags(w)}</h3>
      <div class="readouts">
        <div class="readout"><span>Teórico</span><div class="display theo"><span class="v">${fmtNum(w.theoretical)}</span><span class="u">${esc(w.unit)}</span></div></div>
        <label class="readout"><span>Real pesado</span><div class="display">${open
          ? `<input class="display-input" type="text" inputmode="decimal" autocomplete="off" name="actual_${i}" value="${esc(inputNum(w.actual))}" data-weigh-actual="${i}" data-theo="${w.theoretical}" aria-label="Cantidad real pesada de ${esc(w.ingredient)}">`
          : `<span class="v">${fmtNum(w.actual)}</span>`}<span class="u">${esc(w.unit)}</span></div></label>
      </div>
      <p class="dev" data-dev="${i}"></p>
      ${open
        ? `<label class="field"><span>Lote de materia prima</span><input type="text" name="lot_${i}" maxlength="100" list="lots${i}" value="${esc(w.material_lot || '')}" data-weigh-lot="${i}" data-ingredient="${esc(w.ingredient)}" autocomplete="off"></label>
           <datalist id="lots${i}">${lots.map((m) => `<option value="${esc(m.lot)}">${esc(`${m.internal_no ? `${m.internal_no}, ` : ''}${STATUS.material[m.status] || m.status}${isDay(m.expiry) ? `, cad. ${fmtDay(m.expiry)}` : ''}, quedan ${fmtNum(m.quantity)} ${m.unit}`)}</option>`).join('')}</datalist>
           <p class="lotwarn" data-lotwarn="${i}"></p>`
        : `<p class="lot-ro">Lote <strong>${esc(w.material_lot || '—')}</strong>${w.supplier ? ` · ${esc(w.supplier)}` : ''}</p>`}
    </div>`;
  }).join('');

  const packUsed = p.packaging_used || [];
  const packSection = open
    ? `<div data-rows="pack">${(packUsed.length ? packUsed : [{}]).map((u) => packRow(u)).join('')}</div>
       <button type="button" class="btn secondary small" data-act="addRow" data-kind="pack">${ICON.plus}Añadir envase</button>
       <p class="hint">Se descuenta del stock al marcarla como elaborada.</p>`
    : (packUsed.length ? `<ul class="list">${packUsed.map((u) => `<li><div class="row"><span class="row-main">${esc(u.name)}${u.lot ? ` <span class="code">lote ${esc(u.lot)}</span>` : ''}</span><b class="num">${fmtNum(u.qty)} uds.</b></div></li>`).join('')}</ul>` : '<p class="hint none-docs">Sin material de acondicionamiento registrado.</p>');

  const pnts = p.pnt_refs || [];
  const guide = `<form class="form" data-form="guide" data-id="${esc(p.uuid)}" novalidate>
    ${formMsg()}
    <section><h2>Pesadas</h2>
      <div class="progress"><progress max="${ws.length}" value="${done}"></progress><span>${done} de ${ws.length} pesadas completas</span></div>
      <div class="weighs">${weighBlocks}</div>
      ${open ? '<p class="hint"><a href="#calculadora">Abrir la calculadora</a> para conversiones y concentraciones.</p>' : ''}
    </section>
    <section><h2>Material de acondicionamiento</h2>${packSection}</section>
    <section><h2>Modus operandi</h2>
      ${pnts.length ? `<ul class="list">${pnts.map((r) => `<li><a class="row" href="#pnt--${esc(r.uuid)}"><div class="row-main"><strong><span class="code">${esc(r.code)}</span> ${esc(r.title)}</strong><span class="sub"><span>Versión ${esc(r.version)}</span></span></div></a></li>`).join('')}</ul>` : '<p class="hint">La fórmula no tiene PNT vinculado: describe el procedimiento abajo.</p>'}
      ${field('Descripción o incidencias del procedimiento', `<textarea name="method_notes" maxlength="4000">${esc(p.method_notes || '')}</textarea>`)}
    </section>
    <section><h2>Utillaje utilizado</h2><div class="panel checks">
      ${equipment.map((e) => checkbox('equipment', esc(e), (p.equipment || []).includes(e), `value="${esc(e)}"`)).join('')}
      ${field('Otro utillaje', text('equipment_other', 'maxlength="200" placeholder="Separado por comas"'))}
    </div></section>
    <section><h2>Control de calidad</h2><div class="panel form">
      <div data-rows="qc">${tests.map((t) => qcRow(t)).join('')}</div>
      <button type="button" class="btn secondary small" data-act="addRow" data-kind="qc">${ICON.plus}Añadir prueba</button>
      <div class="grid2">
        ${field('Realizado por', text('qc_by', `value="${esc(qc.by || '')}" maxlength="120"`))}
        ${field('Aparataje', text('qc_apparatus', `value="${esc(qc.apparatus || '')}" maxlength="200"`))}
      </div>
      ${field('Reactivos y su lote', text('qc_reagents', `value="${esc(qc.reagents || '')}" maxlength="200"`))}
    </div></section>
    <section><h2>Fechas y conservación</h2><div class="panel form">
      <div class="grid2">
        ${field('Fecha de elaboración', dateInput('elaborated_date', p.elaborated_date), open ? 'Se pone sola al marcarla como elaborada.' : '')}
        ${field('Fecha de caducidad', dateInput('expiry_date', p.expiry_date), isNum(p.validity_days) ? `Plazo de validez de la fórmula: ${p.validity_days} días.` : '')}
      </div>
      ${field('Condiciones de conservación', text('storage', `value="${esc(p.storage || '')}" maxlength="160"`))}
    </div></section>
    ${p.status !== 'en_proceso' ? `<section><h2>Decisión del farmacéutico</h2><div class="panel">
      ${p.status === 'rechazada'
        ? `<p class="bad">Rechazada el ${fmtDay(p.decision_date)} por ${esc(p.decision_by)}.</p>`
        : checkbox('decision', `Acepto el preparado${p.decision === 'aceptada' && p.decision_date ? ` (aceptado el ${fmtDay(p.decision_date)} por ${esc(p.decision_by)})` : ''}`, p.decision === 'aceptada')}
    </div></section>` : ''}
    ${['elaborada', 'dispensada'].includes(p.status) ? `<section><h2>Dispensación</h2><div class="panel form">
      <div class="grid2">
        ${field('Nº libro recetario', text('recetario_no', `value="${esc(p.recetario_no || '')}" maxlength="40"`))}
        ${field('Fecha de dispensación', dateInput('dispensed_date', p.dispensed_date || (p.status === 'elaborada' ? todayIso() : '')))}
      </div>
      ${field(`Cantidad dispensada (${esc(p.unit)})`, decimal('dispensed_qty', `value="${esc(inputNum(p.dispensed_qty ?? p.target_amount))}"`))}
      <p class="hint">El paciente y el prescriptor constan en el libro recetario; en la app solo se escriben al imprimir la etiqueta y no se guardan.</p>
    </div></section>` : ''}
    ${field('Observaciones', `<textarea name="notes" maxlength="4000">${esc(p.notes || '')}</textarea>`)}
    ${editableGuide ? '<button class="btn secondary block" type="submit" name="intent" value="save">Guardar guía</button>' : ''}
    ${p.status === 'en_proceso' ? '<button class="btn block" type="submit" name="intent" value="elaborate">Marcar como elaborada</button><p class="hint">Asigna el lote, descuenta el stock de materias primas y envases y bloquea las pesadas.</p>' : ''}
    ${p.status === 'elaborada' ? '<button class="btn block" type="submit" name="intent" value="dispense">Marcar como dispensada</button><button class="btn danger block" type="button" data-act="rejectProduction" data-id="' + esc(p.uuid) + '">Rechazar el preparado</button>' : ''}
  </form>`;
  return header + guide;
}

function updateDeviation(input) {
  const out = $(`[data-dev="${input.dataset.weighActual}"]`);
  if (!out) return;
  const theo = Number(input.dataset.theo);
  let v = null;
  try { v = parseNum(input.value, 'Real'); } catch { out.textContent = 'Número no válido'; out.className = 'dev bad'; return; }
  if (v === null || !(theo > 0)) { out.textContent = ''; out.className = 'dev'; return; }
  if (round6(v - theo) === 0) { out.textContent = 'Coincide con el teórico'; out.className = 'dev'; return; }
  const pct = ((v - theo) / theo) * 100;
  out.textContent = `Diferencia ${v - theo >= 0 ? '+' : '−'}${fmtNum(round6(Math.abs(v - theo)))} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %)`;
  out.className = 'dev';
}
/** Busca el lote de materia prima de una pesada (mismo nombre si es posible). */
function findMaterialLot(mats, ingredient, lot) {
  const l = lc(str(lot));
  if (!l) return null;
  const matches = mats.filter((m) => lc(m.lot) === l);
  return matches.find((m) => fold(m.name) === fold(ingredient)) || (matches.length === 1 ? matches[0] : null);
}
function updateLotWarning(input) {
  const out = $(`[data-lotwarn="${input.dataset.weighLot}"]`);
  if (!out) return;
  const lot = lc(str(input.value));
  if (!lot) { out.textContent = ''; return; }
  const matches = state.materials.filter((m) => lc(m.lot) === lot);
  const sameName = matches.filter((m) => fold(m.name) === fold(input.dataset.ingredient));
  const warnings = [];
  if (!matches.length) warnings.push('Este lote no está registrado en Materias primas: no se descontará del stock.');
  else if (!sameName.length) warnings.push(`Ese lote está registrado para ${matches.map((m) => m.name).join(', ')}.`);
  for (const m of sameName.length ? sameName : matches) {
    if (m.status !== 'aceptado') warnings.push(`Lote en estado ${lc(STATUS.material[m.status] || m.status)}.`);
    if (isDay(m.expiry) && daysUntil(m.expiry) < 0) warnings.push(`Lote caducado el ${fmtDay(m.expiry)}.`);
  }
  out.textContent = [...new Set(warnings)].join(' ');
}
INPUT_HOOKS.push((t) => {
  if (t.matches('[data-weigh-actual]')) updateDeviation(t);
  else if (t.matches('[data-weigh-lot]')) updateLotWarning(t);
});
AFTER_RENDER.push(() => {
  $$('[data-weigh-actual]').forEach(updateDeviation);
  $$('[data-weigh-lot]').forEach(updateLotWarning);
});

/** Lee el formulario de la guía y actualiza el registro (sin cambiar de estado). */
function readGuide(form, rec) {
  const all = new FormData(form);
  const el = form.elements;
  if (rec.status === 'en_proceso') {
    const actuals = rec.weighings.map((w, i) => parseNum(el[`actual_${i}`].value, `Real de ${w.ingredient}`));
    rec.weighings.forEach((w, i) => {
      w.actual = actuals[i];
      w.material_lot = str(el[`lot_${i}`].value).slice(0, 100);
      const m = findMaterialLot(state.materials, w.ingredient, w.material_lot);
      w.material_uuid = m ? m.uuid : null;
      w.supplier = m ? m.supplier || '' : '';
    });
    const uuids = all.getAll('pack_uuid'); const qtys = all.getAll('pack_qty');
    rec.packaging_used = [];
    uuids.forEach((u, i) => {
      if (!u) return;
      const pk = (state.packs || []).find((x) => x.uuid === u);
      if (!pk) return;
      const qty = intOrNull(qtys[i], `Unidades de ${pk.name}`) || 1;
      rec.packaging_used.push({ packaging_uuid: pk.uuid, name: `${pk.name}${pk.capacity ? ` ${pk.capacity}` : ''}`, lot: pk.lot || '', qty });
    });
  }
  rec.method_notes = str(el.method_notes.value).slice(0, 4000);
  rec.equipment = [...all.getAll('equipment'), ...str(el.equipment_other.value).split(',').map((x) => x.trim()).filter(Boolean)].map((x) => x.slice(0, 120));
  const tests = all.getAll('qc_test'); const results = all.getAll('qc_result'); const oks = all.getAll('qc_ok');
  rec.qc = {
    tests: tests.map((t, i) => ({ test: str(t).slice(0, 120), result: str(results[i]).slice(0, 160), ok: oks[i] === 'si' ? true : oks[i] === 'no' ? false : null })).filter((t) => t.test || t.result),
    by: str(el.qc_by.value).slice(0, 120), apparatus: str(el.qc_apparatus.value).slice(0, 200), reagents: str(el.qc_reagents.value).slice(0, 200),
  };
  rec.elaborated_date = isDay(el.elaborated_date.value) ? el.elaborated_date.value : rec.elaborated_date || null;
  rec.expiry_date = isDay(el.expiry_date.value) ? el.expiry_date.value : null;
  rec.storage = str(el.storage.value).slice(0, 160);
  if (el.decision && rec.status !== 'rechazada') {
    if (el.decision.checked && rec.decision !== 'aceptada') { rec.decision = 'aceptada'; rec.decision_date = todayIso(); rec.decision_by = state.profile.name; }
    if (!el.decision.checked && rec.decision === 'aceptada') { rec.decision = null; rec.decision_date = null; rec.decision_by = null; }
  }
  if (el.recetario_no) {
    rec.recetario_no = str(el.recetario_no.value).slice(0, 40);
    rec.dispensed_date = isDay(el.dispensed_date.value) ? el.dispensed_date.value : null;
    rec.dispensed_qty = parseNum(el.dispensed_qty.value, 'Cantidad dispensada');
  }
  rec.notes = str(el.notes.value).slice(0, 4000);
}

/** Calcula qué stock se descuenta al elaborar. */
function planConsumption(rec, mats, packs) {
  const totals = new Map(); const notes = [];
  for (const w of rec.weighings) {
    const m = (w.material_uuid && mats.find((x) => x.uuid === w.material_uuid)) || findMaterialLot(mats, w.ingredient, w.material_lot);
    if (!m) { notes.push(`${w.ingredient}: el lote ${w.material_lot} no está registrado, no se descuenta`); continue; }
    const amount = convertQty(w.actual, w.unit, m.unit);
    if (amount === null) { notes.push(`${w.ingredient}: unidades distintas (${w.unit} y ${m.unit}), no se descuenta`); continue; }
    const k = `material:${m.uuid}`;
    totals.set(k, { store: 'material', rec: m, amount: round6((totals.get(k)?.amount || 0) + amount), unit: m.unit });
  }
  for (const u of rec.packaging_used || []) {
    const pk = packs.find((x) => x.uuid === u.packaging_uuid);
    if (!pk) { notes.push(`${u.name}: ya no está registrado, no se descuenta`); continue; }
    const k = `packaging:${pk.uuid}`;
    totals.set(k, { store: 'packaging', rec: pk, amount: (totals.get(k)?.amount || 0) + u.qty, unit: 'uds.' });
  }
  const changes = [...totals.values()].map((c) => ({ ...c, after: round6(Math.max(0, c.rec.quantity - c.amount)), short: c.rec.quantity < c.amount }));
  return { changes, notes };
}

Object.assign(FORMS, {
  async productionNew(form) {
    const d = formData(form);
    const code = str(d.record_code);
    if (!code) throw new InputError('Escribe el código de registro.');
    const f = await getOne('formula', d.formula_uuid);
    if (!f || f.status !== 'aprobada') throw new InputError('Elige una fórmula aprobada.');
    const target = parseNum(d.target_amount, 'Cantidad a elaborar');
    if (!target || target <= 0) throw new InputError('La cantidad debe ser mayor que cero.');
    if (!(f.target_amount > 0)) throw new InputError('La fórmula no tiene un lote de referencia válido.');
    if ((await getAll('production')).some((p) => lc(p.record_code) === lc(code))) throw new InputError('Ya existe un registro de elaboración con ese código.');
    const pnts = (await getAll('pnt')).filter((p) => (f.pnt_uuids || []).includes(p.uuid));
    const factor = target / f.target_amount;
    const cn = d.cn !== undefined && d.cn !== '' ? (f.national_codes || [])[Number(d.cn)] || null : null;
    const now = nowIso();
    const rec = {
      uuid: newId(), record_code: code.slice(0, 80), status: 'en_proceso', status_changed_at: now,
      formula_uuid: f.uuid, formula_code: f.code, formula_name: f.name, formula_version: f.version, formula_type: f.type || 'fm',
      form: f.form || '', route: f.route || '', storage: f.storage || '', validity_days: isNum(f.validity_days) ? f.validity_days : null,
      pnt_refs: pnts.map((p) => ({ uuid: p.uuid, code: p.code, title: p.title, version: p.version })), cn,
      target_amount: target, unit: f.unit, operator: state.profile.name, notes: str(d.notes),
      weighings: (f.components || []).map((c) => ({
        uuid: newId(), ingredient: c.ingredient, role: c.role || 'excipiente', edo: isEdo(c), theoretical: round6(c.amount * factor), actual: null, unit: c.unit, material_lot: '',
      })),
      packaging_used: [], equipment: [], qc: { tests: [] }, decision: null,
    };
    await save('production', rec, 'crear_registro_elaboracion', `${rec.record_code} ${rec.formula_name}`);
    toast('Elaboración en proceso. Completa las pesadas y los lotes.');
    location.hash = `#elaboraciones--${rec.uuid}`;
  },

  async guide(form, submitter) {
    const rec = await getOne('production', form.dataset.id);
    if (!rec) throw new InputError('Este registro ya no existe.');
    if (rec.status === 'rechazada') throw new InputError('Esta elaboración está rechazada y no se puede modificar.');
    const wasStatus = rec.status;
    readGuide(form, rec);
    const intent = submitter ? submitter.value : 'save';

    if (intent === 'elaborate' && wasStatus === 'en_proceso') {
      const missing = rec.weighings.filter((w) => !isNum(w.actual) || !w.material_lot);
      if (!rec.weighings.length || missing.length) {
        await save('production', rec, 'actualizar_pesadas', rec.record_code);
        throw new InputError(`Faltan pesadas reales o lotes de: ${missing.map((w) => w.ingredient).join(', ')}. Lo que has escrito se ha guardado.`);
      }
      const [mats, packs, s] = [await getAll('material'), await getAll('packaging'), await loadSettings()];
      const bad = rec.weighings.map((w) => findMaterialLot(mats, w.ingredient, w.material_lot)).filter((m) => m && (m.status !== 'aceptado' || (isDay(m.expiry) && daysUntil(m.expiry) < 0)));
      const elaborated = rec.elaborated_date || todayIso();
      const used = new Set((await getAll('production')).map((x) => x.lot).filter(Boolean));
      let n = Number(s.lot.next) || 1;
      while (used.has(makeLot(s, n, elaborated))) n += 1;
      const lot = makeLot(s, n, elaborated);
      const plan = planConsumption(rec, mats, packs);
      const lines = plan.changes.map((c) => `${recordLabel(c.store, c.rec)}: −${fmtNum(c.amount)} ${c.unit} (quedan ${fmtNum(c.after)})${c.short ? ' ¡stock insuficiente!' : ''}`);
      const msg = `Se asignará el lote ${lot}.\n\n${lines.length ? `Se descontará del stock:\n${lines.join('\n')}` : 'No hay stock registrado que descontar.'}${plan.notes.length ? `\n\nAvisos:\n${plan.notes.join('\n')}` : ''}${bad.length ? `\n\nAtención: hay lotes no aceptados o caducados (${bad.map((m) => `${m.name} ${m.lot}`).join(', ')}).` : ''}\n\nDespués no se podrán cambiar las pesadas.`;
      if (!(await ask({ title: 'Marcar como elaborada', message: msg, confirmLabel: 'Marcar como elaborada' }))) {
        await save('production', rec, 'actualizar_pesadas', rec.record_code);
        toast('Guía guardada.');
        await route();
        return;
      }
      rec.status = 'elaborada';
      rec.status_changed_at = nowIso();
      rec.lot = lot;
      rec.lot_number = n;
      rec.elaborated_date = elaborated;
      if (!isDay(rec.expiry_date) && isNum(rec.validity_days)) rec.expiry_date = addDays(elaborated, rec.validity_days);
      rec.stock_applied = true;
      rec.consumption = plan.changes.map((c) => ({ store: c.store, uuid: c.rec.uuid, name: recordLabel(c.store, c.rec), amount: c.amount, unit: c.unit }));
      const entries = [['production', rec]];
      const extra = [];
      plan.changes.forEach((c) => {
        c.rec.quantity = c.after;
        entries.push([c.store, c.rec]);
        extra.push(['consumo_stock', `${lot}: ${recordLabel(c.store, c.rec)} −${fmtNum(c.amount)} ${c.unit}`]);
      });
      const ns = { ...s, lot: { ...s.lot, next: n + 1 }, updated_at: nowIso() };
      await saveMany(entries, 'marcar_elaborada', `${lot} ${rec.formula_name} (${rec.record_code})`, extra, { settings: ns });
      state.settings = ns;
      toast(`Elaborada. Lote ${lot}.`);
      await route();
      return;
    }

    if (intent === 'dispense' && wasStatus === 'elaborada') {
      const need = [];
      if (rec.decision !== 'aceptada') need.push('marca la aceptación del farmacéutico');
      if (!rec.recetario_no) need.push('escribe el nº del libro recetario');
      if (!isDay(rec.dispensed_date)) need.push('indica la fecha de dispensación');
      if (!isNum(rec.dispensed_qty)) need.push('indica la cantidad dispensada');
      if (need.length) {
        await save('production', rec, 'actualizar_pesadas', rec.lot || rec.record_code);
        throw new InputError(`Para dispensarla: ${need.join(', ')}. Lo demás se ha guardado.`);
      }
      if (isDay(rec.expiry_date) && rec.dispensed_date > rec.expiry_date) throw new InputError('La fecha de dispensación es posterior a la caducidad del preparado.');
      rec.status = 'dispensada';
      rec.status_changed_at = nowIso();
      await save('production', rec, 'marcar_dispensada', `${rec.lot}: libro recetario nº ${rec.recetario_no}`);
      toast('Dispensada.');
      await route();
      return;
    }

    await save('production', rec, 'actualizar_pesadas', rec.lot || rec.record_code);
    toast('Guía guardada.');
    await route();
  },
});

Object.assign(ACTIONS, {
  rejectProduction: async (el) => {
    const rec = await getOne('production', el.dataset.id);
    if (!rec || rec.status !== 'elaborada') return;
    const ok = await ask({ title: 'Rechazar el preparado', message: `Se registrará el rechazo de ${rec.lot || rec.record_code} con fecha de hoy y a tu nombre. No se podrá dispensar. El stock consumido no se repone.`, confirmLabel: 'Rechazar', danger: true });
    if (!ok) return;
    rec.status = 'rechazada';
    rec.status_changed_at = nowIso();
    rec.decision = 'rechazada';
    rec.decision_date = todayIso();
    rec.decision_by = state.profile.name;
    await save('production', rec, 'rechazar_elaboracion', rec.lot || rec.record_code);
    toast('Preparado rechazado.');
    await route();
  },
  assignLot: async (el) => {
    const rec = await getOne('production', el.dataset.id);
    if (!rec || rec.lot) return;
    const s = await loadSettings();
    const elaborated = rec.elaborated_date || String(rec.submitted_at || rec.updated_at || nowIso()).slice(0, 10);
    const used = new Set((await getAll('production')).map((x) => x.lot).filter(Boolean));
    let n = Number(s.lot.next) || 1;
    while (used.has(makeLot(s, n, elaborated))) n += 1;
    const lot = makeLot(s, n, elaborated);
    if (!(await ask({ title: 'Asignar lote', message: `Se asignará el lote ${lot}. No se descuenta stock, porque esta elaboración es anterior al control de stock.`, confirmLabel: 'Asignar' }))) return;
    rec.lot = lot; rec.lot_number = n; rec.elaborated_date = elaborated;
    const ns = { ...s, lot: { ...s.lot, next: n + 1 }, updated_at: nowIso() };
    await saveMany([['production', rec]], 'asignar_lote', `${lot} (${rec.record_code})`, [], { settings: ns });
    state.settings = ns;
    toast(`Lote ${lot} asignado.`);
    await route();
  },
});

// ------------------------------------------------------------------ etiquetas en PDF (RD 175/2001)
let pdfLibPromise = null;
function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      if (window.PDFLib) { resolve(window.PDFLib); return; }
      const sc = document.createElement('script');
      sc.src = vendorUrl('pdf-lib/pdf-lib.min.js');
      sc.onload = () => resolve(window.PDFLib);
      sc.onerror = () => { pdfLibPromise = null; reject(new Error('no se pudo cargar el generador de PDF')); };
      document.head.append(sc);
    });
  }
  return pdfLibPromise;
}

async function viewLabel(id) {
  const p = await getOne('production', id);
  if (!p) return empty('Este registro no existe.', '');
  state.parent = `#elaboraciones--${p.uuid}`;
  state.label = null;
  const s = await loadSettings();
  const warn = [];
  if (!s.pharmacy.name || !s.pharmacy.address || !s.pharmacy.phone) warn.push('los datos de la farmacia (Ajustes)');
  if (!isDay(p.expiry_date)) warn.push('la fecha de caducidad');
  if (!str(p.storage)) warn.push('las condiciones de conservación');
  if (!str(p.route)) warn.push('la vía de administración');
  const copiesMax = s.label.layout === '2' ? 2 : 8;
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(p.lot)}</h2>${pill('production', p.status)}</div>
      <p>${esc(p.formula_name)} · ${fmtNum(p.target_amount)} ${esc(p.unit)}</p>
    </div>
    ${warn.length ? `<p class="msg warn">Falta ${esc(warn.join(', '))}. La etiqueta se puede generar, pero quedará incompleta.</p>` : ''}
    <form class="form" data-form="label" data-id="${esc(p.uuid)}" novalidate autocomplete="off">
      ${formMsg()}
      ${field('Paciente', text('patient', 'maxlength="120" autocomplete="off"'))}
      <div class="grid2">
        ${field('Prescriptor', text('prescriber', 'maxlength="120" autocomplete="off"'))}
        ${field('Nº de colegiado', text('collegiate', 'maxlength="30" autocomplete="off"'))}
      </div>
      <div class="grid2">
        ${field('Nº libro recetario', text('recetario_no', `value="${esc(p.recetario_no || '')}" maxlength="40"`))}
        ${field(`Cantidad (${esc(p.unit)})`, decimal('qty', `value="${esc(inputNum(p.dispensed_qty ?? p.target_amount))}"`))}
      </div>
      ${field('Copias', `<select name="copies">${Array.from({ length: copiesMax }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}</option>`).join('')}</select>`, `Folio A4 con ${s.label.layout === '2' ? '2 etiquetas grandes' : '8 etiquetas'} para recortar. Se cambia en Ajustes.`)}
      <p class="hint">El paciente, el prescriptor y su nº de colegiado solo se usan para esta etiqueta: no se guardan en la app ni en las copias de seguridad.</p>
      <button class="btn block" type="submit">Generar etiqueta</button>
    </form>
    <div id="labelOut"></div>`;
}

const LAYOUTS = {
  8: { cols: 2, rows: 4, w: 92, h: 66, gx: 6, gy: 5, base: 7.2, title: 9.5 },
  2: { cols: 1, rows: 2, w: 190, h: 135, gx: 0, gy: 7, base: 11, title: 15 },
};
/** Genera el PDF de la etiqueta con los datos del RD 175/2001. */
async function buildLabelPdf(p, extra, s) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle(`Etiqueta ${p.lot}`);
  doc.setCreator('FARMA·LAB');
  doc.setProducer('FARMA·LAB');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const clean = (t) => [...String(t ?? '').replace(/\s+/g, ' ')].map((ch) => (charset.has(ch.codePointAt(0)) ? ch : '?')).join('').trim();
  const mm = (v) => (v * 72) / 25.4;
  const L = LAYOUTS[s.label.layout] || LAYOUTS[8];
  const page = doc.addPage([mm(210), mm(297)]);
  const mx = (210 - (L.cols * L.w + (L.cols - 1) * L.gx)) / 2;
  const my = (297 - (L.rows * L.h + (L.rows - 1) * L.gy)) / 2;

  const ph = s.pharmacy;
  const comps = (p.weighings || []).filter((w) => s.label.all_components || w.role === 'activo' || w.edo || edoMatch(w.ingredient));
  const factor = isNum(extra.qty) && p.target_amount > 0 ? extra.qty / p.target_amount : 1;
  const compText = comps.map((w) => `${w.ingredient} ${fmtNum(round6(w.theoretical * factor))} ${w.unit}`).join('; ');
  const hasOthers = (p.weighings || []).length > comps.length;
  const edos = (p.weighings || []).filter((w) => w.edo || edoMatch(w.ingredient)).map((w) => w.ingredient);
  const qty = isNum(extra.qty) ? extra.qty : p.target_amount;
  const blocks = [
    [bold, 1, clean(ph.name || 'Oficina de farmacia')],
    [font, 0.85, clean([ph.address, ph.phone ? `Tel. ${ph.phone}` : ''].filter(Boolean).join(' · '))],
    ph.pharmacist ? [font, 0.85, clean(`Farmacéutico: ${ph.pharmacist}`)] : null,
    ['gap'],
    [bold, L.title / L.base, clean(p.formula_name)],
    [font, 1, clean(`Composición: ${compText}${hasOthers ? `; excipientes c.s.p. ${fmtNum(qty)} ${p.unit}` : ''}.`)],
    edos.length ? [font, 0.9, clean(`Excipientes de declaración obligatoria: ${edos.join(', ')}.`)] : null,
    [font, 1, clean([p.form && `Forma: ${p.form}`, p.route && `Vía: ${p.route}`, `Cantidad: ${fmtNum(qty)} ${p.unit}`].filter(Boolean).join(' · '))],
    [bold, 1, clean(`Lote: ${p.lot}${extra.recetario_no ? ` · Nº libro recetario: ${extra.recetario_no}` : ''}`)],
    [font, 1, clean(`Elaboración: ${fmtDay(p.elaborated_date)} · Caducidad: ${fmtDay(p.expiry_date)}`)],
    p.storage ? [font, 1, clean(`Conservación: ${p.storage}`)] : null,
    extra.prescriber || extra.collegiate ? [font, 1, clean(`Prescriptor: ${extra.prescriber || '—'}${extra.collegiate ? ` · Nº col. ${extra.collegiate}` : ''}`)] : null,
    extra.patient ? [font, 1, clean(`Paciente: ${extra.patient}`)] : null,
    ['gap'],
    [bold, 1, 'Manténgase fuera del alcance de los niños.'],
  ].filter(Boolean);

  const pad = mm(3);
  const boxW = mm(L.w) - 2 * pad;
  const boxH = mm(L.h) - 2 * pad;
  const wrap = (f, size, t) => {
    const words = t.split(' '); const out = []; let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) <= boxW || !line) line = next; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    return out;
  };
  let size = L.base;
  let laid;
  for (; size >= 4.5; size -= 0.25) {
    laid = []; let h = 0;
    for (const b of blocks) {
      if (b[0] === 'gap') { h += size * 0.5; laid.push({ gap: size * 0.5 }); continue; }
      const [f, k, t] = b;
      const fs = size * k;
      for (const ln of wrap(f, fs, t)) { laid.push({ f, fs, t: ln }); h += fs * 1.22; }
    }
    if (h <= boxH) break;
  }
  const dash = { thickness: 0.5, color: rgb(0.55, 0.55, 0.55), dashArray: [3, 3] };
  const copies = Math.min(extra.copies, L.cols * L.rows);
  for (let i = 0; i < copies; i += 1) {
    const col = i % L.cols; const row = Math.floor(i / L.cols);
    const x0 = mm(mx + col * (L.w + L.gx));
    const yTop = mm(297 - my - row * (L.h + L.gy));
    const x1 = x0 + mm(L.w); const yBot = yTop - mm(L.h);
    page.drawLine({ start: { x: x0, y: yTop }, end: { x: x1, y: yTop }, ...dash });
    page.drawLine({ start: { x: x0, y: yBot }, end: { x: x1, y: yBot }, ...dash });
    page.drawLine({ start: { x: x0, y: yTop }, end: { x: x0, y: yBot }, ...dash });
    page.drawLine({ start: { x: x1, y: yTop }, end: { x: x1, y: yBot }, ...dash });
    let y = yTop - pad;
    for (const l of laid) {
      if (l.gap) { y -= l.gap; continue; }
      y -= l.fs * 1.22;
      page.drawText(l.t, { x: x0 + pad, y: y + l.fs * 0.22, size: l.fs, font: l.f, color: rgb(0, 0, 0) });
    }
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

Object.assign(FORMS, {
  async label(form) {
    const p = await getOne('production', form.dataset.id);
    if (!p || !p.lot) throw new InputError('Esta elaboración aún no tiene lote.');
    const s = await loadSettings();
    const d = formData(form);
    const extra = {
      patient: str(d.patient).slice(0, 120), prescriber: str(d.prescriber).slice(0, 120), collegiate: str(d.collegiate).slice(0, 30),
      recetario_no: str(d.recetario_no).slice(0, 40), qty: parseNum(d.qty, 'Cantidad'), copies: Math.max(1, Number(d.copies) || 1),
    };
    const blob = await buildLabelPdf(p, extra, s);
    const name = `etiqueta-${p.lot}.pdf`;
    state.label = { blob, name };
    if (extra.recetario_no && !p.recetario_no) {
      p.recetario_no = extra.recetario_no;
      await save('production', p, 'actualizar_pesadas', `${p.lot}: nº libro recetario ${p.recetario_no}`);
    }
    await logOnly('etiqueta_generada', `${p.lot} (${extra.copies} ${extra.copies === 1 ? 'copia' : 'copias'})`);
    const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: 'application/pdf' })] });
    const out = $('#labelOut');
    out.innerHTML = `<section><h2>Etiqueta lista</h2>
      <div class="actions"><button class="btn" data-act="downloadLabel">Descargar PDF</button>${canShare ? '<button class="btn secondary" data-act="shareLabel">Compartir o imprimir</button>' : ''}</div>
      <p class="hint">Imprímela al 100 % (tamaño real) y recorta por las líneas discontinuas.</p>
      <div id="docview" class="docview spaced"><p class="hint">Preparando la vista previa...</p></div></section>`;
    renderDocument($('#docview'));
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});
Object.assign(ACTIONS, {
  downloadLabel: () => {
    if (!state.label) return;
    if (PREVIEW) { toast('En la vista previa no se pueden descargar archivos.'); return; }
    downloadBlob(state.label.blob, state.label.name);
    toast(`Guardada en Descargas: ${state.label.name}`);
  },
  shareLabel: async () => {
    if (!state.label) return;
    try {
      await navigator.share({ files: [new File([state.label.blob], state.label.name, { type: 'application/pdf' })], title: state.label.name });
    } catch (err) {
      if (!err || err.name !== 'AbortError') toast('No se pudo compartir. Usa «Descargar PDF».');
    }
  },
});
