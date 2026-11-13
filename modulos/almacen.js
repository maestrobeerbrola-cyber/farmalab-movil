'use strict';
/* FARMA·LAB móvil · Almacén: materias primas (PN/L/PG/005) y material de acondicionamiento (PN/L/PG/006). */

const STORE_TABS = [['#materias', 'Materias primas'], ['#envases', 'Acondicionamiento']];
const KIND_LABELS = { activo: 'Principio activo', excipiente: 'Excipiente' };
const PACK_KINDS = { primario: 'Primario', secundario: 'Secundario' };
/** Inspección en la recepción del material de acondicionamiento (PN/L/PG/006, apartado 4.1). */
const PACK_CHECKS = {
  albaran: 'El albarán de entrega coincide con el material pedido',
  material: 'El material recibido se corresponde con el albarán',
  estado: 'El estado de envases, embalajes y etiquetado es correcto',
};
const inspectionDone = (insp) => Boolean(insp && Object.keys(PACK_CHECKS).every((k) => insp[k]));
const AEMPS_ALERTS_URL = 'https://www.aemps.gob.es/comunicacion/alertas/alertas-farmaceuticas-y-retiradas-de-lotes-de-medicamentos-de-uso-humano-por-defectos-de-calidad/';

ROUTES.materias = (arg, extra) => (arg === 'nueva' ? viewMaterialForm() : arg && extra === 'editar' ? viewMaterialForm(arg) : arg ? viewMaterial(arg) : viewMaterials());
ROUTES.envases = (arg, extra) => (arg === 'nuevo' ? viewPackagingForm() : arg && extra === 'editar' ? viewPackagingForm(arg) : arg ? viewPackaging(arg) : viewPackagings());

// ------------------------------------------------------------------ stock
const usable = (r) => ['aceptado', 'cuarentena'].includes(r.status) && !(isDay(r.expiry) && daysUntil(r.expiry) < 0);
/**
 * Agrupa lotes de la misma sustancia (o del mismo envase) y compara su stock con el mínimo más alto indicado.
 * Solo cuentan los lotes aceptados o en cuarentena y sin caducar.
 */
function stockGroups(records, kind) {
  const groups = new Map();
  for (const r of records) {
    const key = fold(r.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const lots of groups.values()) {
    const withMin = lots.filter((r) => isNum(r.min_stock) && r.min_stock > 0);
    if (!withMin.length) continue;
    const ref = withMin.reduce((a, b) => ((convertQty(b.min_stock, b.unit || 'unidades', a.unit || 'unidades') ?? 0) > a.min_stock ? b : a));
    const unit = kind === 'packaging' ? 'unidades' : ref.unit;
    let total = 0;
    for (const r of lots.filter(usable)) {
      const q = kind === 'packaging' ? r.quantity : convertQty(r.quantity, r.unit, unit);
      if (isNum(q)) total += q;
    }
    out.push({ name: ref.name, total: round6(total), unit, min: ref.min_stock, low: total <= ref.min_stock, active: lots.some((r) => r.kind === 'activo'), sample: ref.uuid });
  }
  return out;
}
const stockClass = (r) => (isNum(r.min_stock) && r.min_stock > 0 && r.quantity <= r.min_stock ? 'bad' : '');

// ------------------------------------------------------------------ Materias primas
async function viewMaterials() {
  const items = (await getAll('material')).sort(byText('name'));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((m) => `<li data-text="${esc(lc([m.name, m.lot, m.internal_no, m.code, m.supplier, m.qc_no].join(' ')))}"><a class="row" href="#materias--${esc(m.uuid)}"><div class="row-main"><strong>${esc(m.name)}${m.internal_no ? ` <span class="code">${esc(m.internal_no)}</span>` : ''}</strong><span class="sub"><span>Lote ${esc(m.lot)}</span><span>Cad. ${fmtDay(m.expiry)}</span><span class="${stockClass(m)}">${fmtNum(m.quantity)} ${esc(m.unit)}</span>${m.kind === 'activo' ? '<span class="doc-tag pa">PA</span>' : ''}${m.edo ? '<span class="doc-tag edo">EDO</span>' : ''}</span></div>${pill('material', m.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Ningún lote coincide con la búsqueda.</p>`
    : empty('Aún no hay materias primas registradas.', 'Registra la primera recepción con «Nuevo lote».');
  return `${segmented(STORE_TABS, '#materias')}${items.length ? searchBox('Buscar nombre, lote, nº interno o proveedor') : ''}${list}${fab('#materias--nueva', 'Nuevo lote')}`;
}

async function viewMaterial(id) {
  const m = await getOne('material', id);
  if (!m) return empty('Este lote no existe.', 'Puede que el enlace no sea correcto.');
  const all = await getAll('material');
  const group = stockGroups(all.filter((x) => fold(x.name) === fold(m.name)), 'material')[0];
  const sameLots = all.filter((x) => fold(x.name) === fold(m.name) && usable(x));
  let totalLine = '';
  if (sameLots.length > 1) {
    let total = 0;
    sameLots.forEach((x) => { const q = convertQty(x.quantity, x.unit, m.unit); if (isNum(q)) total += q; });
    totalLine = `<p class="hint">Stock de ${esc(m.name)} en ${sameLots.length} lotes utilizables: <strong>${fmtNum(round6(total))} ${esc(m.unit)}</strong>.</p>`;
  }
  const expired = isDay(m.expiry) && daysUntil(m.expiry) < 0;
  const used = (await getAll('production')).filter((p) => (p.weighings || []).some((w) => w.material_uuid === m.uuid || (w.material_lot && lc(w.material_lot) === lc(m.lot) && fold(w.ingredient) === fold(m.name))));
  const q = encodeURIComponent(m.name);
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(m.name)}</h2>${pill('material', m.status)}</div>
    ${facts([
      ['Nº registro interno', m.internal_no ? `<strong>${esc(m.internal_no)}</strong>` : '<span class="warn">Sin asignar</span>'],
      ['Tipo', `${esc(KIND_LABELS[m.kind] || 'Sin indicar')}${m.edo ? ' · <span class="warn">Excipiente de declaración obligatoria</span>' : ''}`],
      ['Proveedor', val(m.supplier)],
      ['Lote', val(m.lot)],
      ['Nº control de calidad', val(m.qc_no)],
      ['Recepción', `${fmtDay(m.received_date)}${m.containers ? ` · ${esc(m.containers)} ${m.containers === 1 ? 'envase' : 'envases'}` : ''}`],
      ['Cantidad recibida', isNum(m.quantity_received) ? `${fmtNum(m.quantity_received)} ${esc(m.unit)}` : '—'],
      ['Stock actual', `<span class="${stockClass(m)}">${fmtNum(m.quantity)} ${esc(m.unit)}</span>${isNum(m.min_stock) ? ` (mínimo ${fmtNum(m.min_stock)} ${esc(m.unit)})` : ''}`],
      ['Caducidad', `${fmtDay(m.expiry)}${expired ? ' <span class="bad">caducado</span>' : ''}`],
      ['Decisión', m.decision_date ? `${esc(STATUS.material[m.status])} el ${fmtDay(m.decision_date)} por ${esc(m.decision_by)}` : '<span class="warn">Pendiente</span>'],
      m.code ? ['Código de artículo', val(m.code)] : null,
    ])}
    ${totalLine}
    <div class="actions spaced"><a class="btn secondary small" href="#materias--${esc(m.uuid)}--editar">Editar ficha</a></div>
  </div>
  <section><h2>Especificaciones</h2><div class="panel">${facts([
    ['Monografía', val(m.monograph)],
    ['Conservación', val(m.storage)],
    ['Precauciones', val(m.handling)],
    ['Toxicidad y peligrosidad', val(m.toxicity)],
  ])}${m.observations ? `<p class="pre spaced">${esc(m.observations)}</p>` : ''}</div></section>
  ${await materialQcSection(m)}
  <section><h2>Decisión de aceptación o rechazo</h2>${statusButtons('material', m)}
    <p class="hint">Al aceptar o rechazar, la decisión queda fechada y firmada con tu nombre en la ficha y en el registro de actividad.</p>
    <p><a class="btn block secondary" href="#fichamp--${esc(m.uuid)}">${ICON.doc}Ficha de control de calidad en PDF (RD 175/2001)</a></p></section>
  <section><h2>Regularizar stock</h2>${stockAdjustForm('material', m)}</section>
  ${group && group.low ? `<p class="msg error">Stock bajo de ${esc(m.name)}: quedan ${fmtNum(group.total)} ${esc(group.unit)} y el mínimo es ${fmtNum(group.min)} ${esc(group.unit)}.</p>` : ''}
  ${await docsSection('material', m.uuid, ['boletin', 'fds', 'especificaciones', 'otro'], 'Boletín de análisis, ficha de seguridad y otros documentos')}
  <section><h2>Alertas y retiradas</h2><div class="panel stack">
    <p>Consulta en la AEMPS si hay alertas o retiradas que afecten a esta materia prima o a sus medicamentos.</p>
    <div class="actions">
      <a class="btn secondary small" href="https://www.aemps.gob.es/?s=${q}" target="_blank" rel="noopener noreferrer">${ICON.ext}Buscar «${esc(m.name.slice(0, 30))}» en la AEMPS</a>
      <a class="btn secondary small" href="${AEMPS_ALERTS_URL}" target="_blank" rel="noopener noreferrer">${ICON.ext}Alertas de calidad AEMPS</a>
    </div>
    <p class="hint">Se abren en el navegador; necesitan conexión.</p>
  </div></section>
  ${used.length ? `<section><h2>Usado en</h2><ul class="list">${used.map((p) => `<li><a class="row" href="#elaboraciones--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.lot || p.record_code)}</strong><span class="sub"><span>${esc(p.formula_name)}</span></span></div>${pill('production', p.status)}</a></li>`).join('')}</ul></section>` : ''}`;
}

/** Ensayos de control de calidad de un lote (RD 175/2001, apartado 3.2.3 y ficha 1). */
function mpQcRow(t = {}) {
  return `<div class="mpqcrow" data-comp>
    <input type="text" name="mq_test" aria-label="Ensayo" placeholder="Ensayo" maxlength="120" value="${esc(t.test || '')}">
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
    <input type="text" name="mq_method" aria-label="Técnica o método" placeholder="Técnica o método" maxlength="160" value="${esc(t.method || '')}">
    <input type="text" name="mq_result" aria-label="Resultado" placeholder="Resultado" maxlength="160" value="${esc(t.result || '')}">
    <select name="mq_ok" aria-label="Conforme">${options(['', 'si', 'no'], t.ok === true ? 'si' : t.ok === false ? 'no' : '', { '': 'Conforme', si: 'Conforme: sí', no: 'Conforme: no' })}</select>
  </div>`;
}
ROW_BUILDERS.mpqc = mpQcRow;

async function materialQcSection(m) {
  const s = await loadSettings();
  const qc = m.qc || {};
  const tests = qc.tests && qc.tests.length ? qc.tests : (s.mp_qc_tests || []).map((t) => ({ test: t }));
  return `<section><h2>Control de calidad</h2><form class="panel form" data-form="materialQc" data-id="${esc(m.uuid)}" novalidate>
    ${formMsg()}
    <div data-rows="mpqc">${(tests.length ? tests : [{}]).map((t) => mpQcRow(t)).join('')}</div>
    <button type="button" class="btn secondary small" data-act="addRow" data-kind="mpqc">${ICON.plus}Añadir ensayo</button>
    <div class="grid2">
      ${field('Realizado por', text('qc_by', `value="${esc(qc.by ?? state.profile.name ?? '')}" maxlength="120"`))}
      ${field('Fecha del control', dateInput('qc_date', qc.date))}
    </div>
    ${field('Descripción de los métodos analíticos', `<textarea name="qc_methods" maxlength="3000">${esc(qc.methods || '')}</textarea>`, 'Por ejemplo: según la monografía de la RFE, o comprobación del boletín de análisis del proveedor.')}
    ${field('Fecha de repetición del control analítico', dateInput('retest_date', m.retest_date), 'Solo si procede (en lugar de la caducidad).')}
    <button class="btn secondary block" type="submit">Guardar control de calidad</button>
  </form></section>`;
}

function viewMaterialFormHtml(m) {
  const v = m || { status: 'cuarentena', received_date: todayIso(), unit: 'g', kind: 'excipiente' };
  const detected = edoMatch(v.name);
  return `<form class="form" data-form="material" ${m ? `data-id="${esc(m.uuid)}"` : ''} novalidate>
    ${formMsg()}
    <fieldset class="group"><legend>Identificación</legend>
      ${field('Nombre (DOE o DCI)', text('name', `value="${esc(v.name || '')}" required maxlength="160" data-edo-source`))}
      <p class="hint edo-hint" data-edo-hint>${detected ? `Figura como excipiente de declaración obligatoria: ${esc(detected)}.` : ''}</p>
      <div class="grid2">
        ${field('Tipo', `<select name="kind">${options(Object.keys(KIND_LABELS), v.kind || 'excipiente', KIND_LABELS)}</select>`)}
        ${field('Nº registro interno', text('internal_no', `value="${esc(v.internal_no || '')}" maxlength="40"`), 'Vuestro número de control interno.')}
      </div>
      ${checkbox('edo', 'Excipiente de declaración obligatoria', m ? m.edo : Boolean(detected), 'data-edo-check')}
    </fieldset>
    <fieldset class="group"><legend>Recepción</legend>
      ${field('Proveedor', text('supplier', `value="${esc(v.supplier || '')}" maxlength="160"`))}
      <div class="grid2">
        ${field('Lote del proveedor', text('lot', `value="${esc(v.lot || '')}" required maxlength="100"`))}
        ${field('Nº control de calidad', text('qc_no', `value="${esc(v.qc_no || '')}" maxlength="80"`), 'Nº de boletín de análisis.')}
      </div>
      <div class="grid2">
        ${field('Fecha de recepción', dateInput('received_date', v.received_date))}
        ${field('Nº de envases', `<input type="text" inputmode="numeric" name="containers" value="${esc(v.containers ?? '')}" maxlength="5">`)}
      </div>
      <div class="grid2">
        ${field(m ? 'Stock actual' : 'Cantidad recibida', decimal('quantity', `value="${esc(inputNum(v.quantity))}" required`))}
        ${field('Unidad', `<select name="unit">${options(MATERIAL_UNITS, v.unit || 'g')}</select>`)}
      </div>
      <div class="grid2">
        ${field('Stock mínimo', decimal('min_stock', `value="${esc(inputNum(v.min_stock))}"`), 'Aviso de reposición.')}
        ${field('Caducidad', dateInput('expiry', v.expiry))}
      </div>
      ${field('Código de artículo', text('code', `value="${esc(v.code || '')}" maxlength="80"`), 'Opcional: código del proveedor.')}
    </fieldset>
    <fieldset class="group"><legend>Especificaciones</legend>
      ${field('Monografía (RFE u otra farmacopea)', text('monograph', `value="${esc(v.monograph || '')}" maxlength="160"`), 'Por ejemplo: RFE nº 0435, o «especificaciones del proveedor».')}
      ${field('Condiciones de conservación', text('storage', `value="${esc(v.storage || '')}" maxlength="200"`))}
      ${field('Precauciones al manipular', `<textarea name="handling" maxlength="1000">${esc(v.handling || '')}</textarea>`)}
      ${field('Toxicidad y peligrosidad', `<textarea name="toxicity" maxlength="1000">${esc(v.toxicity || '')}</textarea>`)}
    </fieldset>
    ${field('Observaciones', `<textarea name="observations" maxlength="2000">${esc(v.observations || '')}</textarea>`, 'Incluida la revisión anual del estado del producto.')}
    ${m ? '' : field('Estado', `<select name="status">${options(Object.keys(STATUS.material), 'cuarentena', STATUS.material)}</select>`, 'Tras la recepción queda en cuarentena hasta la decisión del farmacéutico.')}
    <button class="btn block" type="submit">${m ? 'Guardar cambios' : 'Registrar lote'}</button>
  </form>`;
}
async function viewMaterialForm(id) {
  const m = id ? await getOne('material', id) : null;
  if (id && !m) return empty('Este lote no existe.', '');
  return viewMaterialFormHtml(m);
}

// Aviso automático de excipiente de declaración obligatoria al escribir el nombre.
INPUT_HOOKS.push((t) => {
  if (!t.matches('[data-edo-source]')) return;
  const form = t.closest('form');
  const hit = edoMatch(t.value);
  const hint = $('[data-edo-hint]', form);
  if (hint) hint.textContent = hit ? `Figura como excipiente de declaración obligatoria: ${hit}.` : '';
  const check = $('[data-edo-check]', form);
  if (check && hit && !check.dataset.touched) check.checked = true;
});
CHANGE_HOOKS.push((t) => { if (t.matches('[data-edo-check]')) t.dataset.touched = '1'; });

function stockAdjustForm(store, r) {
  return `<form class="panel form" data-form="stockAdjust" data-store="${store}" data-id="${esc(r.uuid)}" novalidate>
    ${formMsg()}
    <div class="grid2">
      ${field(`Stock real (${esc(store === 'packaging' ? 'unidades' : r.unit)})`, decimal('quantity', `value="${esc(inputNum(r.quantity))}"`))}
      ${field('Motivo', text('reason', 'maxlength="160" placeholder="Recuento, merma, rotura..."'))}
    </div>
    <button class="btn secondary" type="submit">Guardar stock</button>
  </form>`;
}

async function uniqueInternal(store, value, selfId) {
  if (!value) return;
  const clash = (await getAll(store)).find((x) => x.uuid !== selfId && x.internal_no && lc(x.internal_no) === lc(value));
  if (clash) throw new InputError(`El nº de registro interno ${value} ya está asignado a ${clash.name}${clash.lot ? ` (lote ${clash.lot})` : ''}.`);
}

Object.assign(FORMS, {
  async material(form) {
    const d = formData(form);
    const prev = form.dataset.id ? await getOne('material', form.dataset.id) : null;
    const name = str(d.name); const lot = str(d.lot); const code = str(d.code); const internal = str(d.internal_no);
    if (!name || !lot) throw new InputError('El nombre y el lote son obligatorios.');
    const quantity = parseNum(d.quantity, prev ? 'Stock actual' : 'Cantidad recibida');
    if (quantity === null || quantity < 0) throw new InputError('Indica la cantidad.');
    const minStock = parseNum(d.min_stock, 'Stock mínimo');
    const containers = intOrNull(d.containers, 'Nº de envases');
    await uniqueInternal('material', internal, prev && prev.uuid);
    if (code && (await getAll('material')).some((m) => m.uuid !== (prev && prev.uuid) && m.code && lc(m.code) === lc(code) && lc(m.lot) === lc(lot))) {
      throw new InputError('Ya existe ese código de artículo con el mismo lote.');
    }
    const rec = {
      ...(prev || { uuid: newId(), status: STATUS.material[d.status] ? d.status : 'cuarentena', quantity_received: quantity }),
      name: name.slice(0, 160), kind: KIND_LABELS[d.kind] ? d.kind : 'excipiente', edo: d.edo === 'on', internal_no: internal.slice(0, 40),
      supplier: str(d.supplier).slice(0, 160), lot: lot.slice(0, 100), qc_no: str(d.qc_no).slice(0, 80),
      received_date: isDay(d.received_date) ? d.received_date : null, containers,
      quantity, unit: MATERIAL_UNITS.includes(d.unit) ? d.unit : 'g', min_stock: minStock,
      expiry: isDay(d.expiry) ? d.expiry : null, code: code.slice(0, 80),
      monograph: str(d.monograph).slice(0, 160), storage: str(d.storage).slice(0, 200),
      handling: str(d.handling).slice(0, 1000), toxicity: str(d.toxicity).slice(0, 1000), observations: str(d.observations).slice(0, 2000),
    };
    await save('material', rec, prev ? 'edicion_materia_prima' : 'alta_lote_materia_prima', `${rec.name} / ${rec.lot}${rec.internal_no ? ` (${rec.internal_no})` : ''}`);
    toast(prev ? 'Ficha guardada.' : 'Lote registrado. Queda en cuarentena hasta su aceptación.');
    location.hash = `#materias--${rec.uuid}`;
  },

  async materialQc(form) {
    const m = await getOne('material', form.dataset.id);
    if (!m) throw new InputError('Esta ficha ya no existe.');
    const all = new FormData(form);
    const tests = all.getAll('mq_test'); const methods = all.getAll('mq_method'); const results = all.getAll('mq_result'); const oks = all.getAll('mq_ok');
    m.qc = {
      tests: tests.map((t, i) => ({ test: str(t).slice(0, 120), method: str(methods[i]).slice(0, 160), result: str(results[i]).slice(0, 160), ok: oks[i] === 'si' ? true : oks[i] === 'no' ? false : null }))
        .filter((t) => t.test || t.result || t.method),
      by: str(all.get('qc_by')).slice(0, 120),
      date: isDay(all.get('qc_date')) ? all.get('qc_date') : null,
      methods: str(all.get('qc_methods')).slice(0, 3000),
    };
    m.retest_date = isDay(all.get('retest_date')) ? all.get('retest_date') : null;
    if (m.qc.tests.some((t) => t.result && t.ok === null)) throw new InputError('Indica si cada ensayo con resultado es conforme o no.');
    await save('material', m, 'control_calidad_materia_prima', `${m.name} / ${m.lot}: ${m.qc.tests.filter((t) => t.result).length} ensayos`);
    toast('Control de calidad guardado.');
    await route();
  },

  async stockAdjust(form) {
    const { store, id } = form.dataset;
    if (!['material', 'packaging'].includes(store)) return;
    const r = await getOne(store, id);
    if (!r) throw new InputError('Esta ficha ya no existe.');
    const q = parseNum(form.elements.quantity.value, 'Stock real');
    if (q === null || q < 0) throw new InputError('Indica el stock real.');
    const reason = str(form.elements.reason.value).slice(0, 160);
    if (!reason) throw new InputError('Indica el motivo de la regularización.');
    const before = r.quantity;
    r.quantity = q;
    const unit = store === 'packaging' ? 'unidades' : r.unit;
    await save(store, r, store === 'material' ? 'edicion_materia_prima' : 'edicion_acondicionamiento', `${r.name} / ${r.lot || '—'}: stock ${fmtNum(before)} → ${fmtNum(q)} ${unit} (${reason})`);
    toast('Stock regularizado.');
    await route();
  },
});

STATUS_CHECKS.material = async (m, status) => {
  if (!['aceptado', 'rechazado'].includes(status)) return null;
  if (status === 'rechazado') {
    return { title: 'Rechazar materia prima', message: `Se registrará el rechazo de ${m.name} (lote ${m.lot}) con fecha de hoy y a tu nombre. Debe devolverse al proveedor o eliminarse, y mantenerse aparte mientras tanto.`, confirmLabel: 'Rechazar', danger: true };
  }
  const missing = [];
  if (!m.internal_no) missing.push('el nº de registro interno');
  const hasBulletin = (await docsOf(m.uuid)).some((f) => f.kind === 'boletin');
  if (!m.qc_no && !hasBulletin) missing.push('el nº de control de calidad o el boletín de análisis');
  if (!((m.qc && m.qc.tests) || []).some((t) => t.result)) missing.push('los resultados del control de calidad');
  if (((m.qc && m.qc.tests) || []).some((t) => t.ok === false)) missing.push('que todos los ensayos sean conformes (hay alguno no conforme)');
  if (isDay(m.expiry) && daysUntil(m.expiry) < 0) missing.push('una caducidad vigente (el lote está caducado)');
  return {
    title: 'Aceptar materia prima',
    message: missing.length
      ? `Falta ${missing.join(', ')}. Sin el boletín de análisis la materia prima debería seguir en cuarentena.\n\n¿Aceptarla igualmente?`
      : `Se registrará la aceptación de ${m.name} (lote ${m.lot}) con fecha de hoy y a tu nombre.`,
    confirmLabel: missing.length ? 'Aceptar igualmente' : 'Aceptar',
  };
};

// ------------------------------------------------------------------ Material de acondicionamiento
async function viewPackagings() {
  const items = (await getAll('packaging')).sort(byText('name'));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((p) => `<li data-text="${esc(lc([p.name, p.lot, p.internal_no, p.supplier, p.capacity].join(' ')))}"><a class="row" href="#envases--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.name)}${p.internal_no ? ` <span class="code">${esc(p.internal_no)}</span>` : ''}</strong><span class="sub"><span>${esc(PACK_KINDS[p.kind] || 'Primario')}</span>${p.lot ? `<span>Lote ${esc(p.lot)}</span>` : ''}<span class="${stockClass(p)}">${fmtNum(p.quantity)} uds.</span>${isDay(p.expiry) ? `<span>Cad. ${fmtDay(p.expiry)}</span>` : ''}</span></div>${pill('packaging', p.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Nada coincide con la búsqueda.</p>`
    : empty('Aún no hay material de acondicionamiento.', 'Registra tarros, frascos, cápsulas, cajas o prospectos con «Nuevo envase».');
  return `${segmented(STORE_TABS, '#envases')}${items.length ? searchBox('Buscar envase, lote o nº interno') : ''}${list}${fab('#envases--nuevo', 'Nuevo envase')}`;
}

async function viewPackaging(id) {
  const p = await getOne('packaging', id);
  if (!p) return empty('Este material no existe.', '');
  const used = (await getAll('production')).filter((x) => (x.packaging_used || []).some((u) => u.packaging_uuid === p.uuid));
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(p.name)}</h2>${pill('packaging', p.status)}</div>
    ${facts([
      ['Nº registro interno', p.internal_no ? `<strong>${esc(p.internal_no)}</strong>` : '<span class="warn">Sin asignar</span>'],
      ['Acondicionamiento', esc(PACK_KINDS[p.kind] || 'Primario')],
      ['Capacidad', val(p.capacity)],
      ['Proveedor', val(p.supplier)],
      ['Lote', val(p.lot)],
      ['Recepción', `${fmtDay(p.received_date)}${p.containers ? ` · ${esc(p.containers)} ${p.containers === 1 ? 'caja o paquete' : 'cajas o paquetes'}` : ''}`],
      ['Stock actual', `<span class="${stockClass(p)}">${fmtNum(p.quantity)} unidades</span>${isNum(p.min_stock) ? ` (mínimo ${fmtNum(p.min_stock)})` : ''}`],
      ['Caducidad', fmtDay(p.expiry)],
      ['Conservación', val(p.storage)],
      ['Inspección', inspectionDone(p.inspection) ? `Correcta${p.inspection.by ? `, por ${esc(p.inspection.by)}` : ''}${isDay(p.inspection.date) ? ` el ${fmtDay(p.inspection.date)}` : ''}` : '<span class="warn">Sin completar</span>'],
      ['Decisión', p.decision_date ? `${esc(STATUS.packaging[p.status])} el ${fmtDay(p.decision_date)} por ${esc(p.decision_by)}` : '<span class="warn">Pendiente</span>'],
    ])}
    ${p.observations ? `<p class="pre spaced">${esc(p.observations)}</p>` : ''}
    <div class="actions spaced"><a class="btn secondary small" href="#envases--${esc(p.uuid)}--editar">Editar ficha</a></div>
  </div>
  <section><h2>Decisión de aceptación o rechazo</h2>${statusButtons('packaging', p)}
    <p><a class="btn block secondary" href="#fichaenv--${esc(p.uuid)}">${ICON.doc}Registro de acondicionamiento en PDF (RD 175/2001)</a></p></section>
  <section><h2>Regularizar stock</h2>${stockAdjustForm('packaging', p)}<p class="hint">El stock baja solo cuando una elaboración que usa este envase se marca como elaborada.</p></section>
  ${await docsSection('packaging', p.uuid, ['especificaciones', 'otro'])}
  ${used.length ? `<section><h2>Usado en</h2><ul class="list">${used.map((x) => `<li><a class="row" href="#elaboraciones--${esc(x.uuid)}"><div class="row-main"><strong>${esc(x.lot || x.record_code)}</strong><span class="sub"><span>${esc(x.formula_name)}</span></span></div>${pill('production', x.status)}</a></li>`).join('')}</ul></section>` : ''}`;
}

async function viewPackagingForm(id) {
  const p = id ? await getOne('packaging', id) : null;
  if (id && !p) return empty('Este material no existe.', '');
  const v = p || { kind: 'primario', received_date: todayIso(), status: 'aceptado' };
  return `<form class="form" data-form="packaging" ${p ? `data-id="${esc(p.uuid)}"` : ''} novalidate>
    ${formMsg()}
    ${field('Identificación (tipo de envase)', text('name', `value="${esc(v.name || '')}" required maxlength="160" placeholder="Tarro de vidrio topacio, frasco PET, cápsulas nº 1..."`))}
    <div class="grid2">
      ${field('Acondicionamiento', `<select name="kind">${options(Object.keys(PACK_KINDS), v.kind || 'primario', PACK_KINDS)}</select>`)}
      ${field('Capacidad', text('capacity', `value="${esc(v.capacity || '')}" maxlength="40" placeholder="50 g, 100 ml..."`))}
    </div>
    <div class="grid2">
      ${field('Nº registro interno', text('internal_no', `value="${esc(v.internal_no || '')}" maxlength="40"`))}
      ${field('Proveedor', text('supplier', `value="${esc(v.supplier || '')}" maxlength="160"`))}
    </div>
    <div class="grid2">
      ${field('Lote', text('lot', `value="${esc(v.lot || '')}" maxlength="100"`), 'Obligatorio en el primario.')}
      ${field('Fecha de recepción', dateInput('received_date', v.received_date))}
    </div>
    <div class="grid2">
      ${field(p ? 'Stock actual (unidades)' : 'Unidades recibidas', `<input type="text" inputmode="numeric" name="quantity" value="${esc(v.quantity ?? '')}" required maxlength="7">`)}
      ${field('Nº de cajas o paquetes', `<input type="text" inputmode="numeric" name="containers" value="${esc(v.containers ?? '')}" maxlength="5">`)}
    </div>
    <div class="grid2">
      ${field('Stock mínimo', `<input type="text" inputmode="numeric" name="min_stock" value="${esc(v.min_stock ?? '')}" maxlength="7">`, 'Aviso de reposición.')}
      ${field('Caducidad', dateInput('expiry', v.expiry), 'Si procede.')}
    </div>
    ${field('Condiciones de conservación', text('storage', `value="${esc(v.storage || '')}" maxlength="200"`), 'Si procede.')}
    <fieldset class="group"><legend>Inspección en la recepción</legend>
      ${Object.entries(PACK_CHECKS).map(([k, label]) => checkbox(`insp_${k}`, esc(label), Boolean(v.inspection && v.inspection[k]))).join('')}
      <div class="grid2">
        ${field('Realizada por', text('insp_by', `value="${esc((v.inspection && v.inspection.by) ?? state.profile.name ?? '')}" maxlength="120"`))}
        ${field('Fecha', dateInput('insp_date', (v.inspection && v.inspection.date) || v.received_date || todayIso()))}
      </div>
      <p class="hint">Si algo no es correcto, no lo aceptes: devuélvelo al proveedor.</p>
    </fieldset>
    ${field('Observaciones', `<textarea name="observations" maxlength="2000">${esc(v.observations || '')}</textarea>`, 'Revisión anual, eliminación de material caducado u obsoleto...')}
    ${p ? '' : field('Estado', `<select name="status">${options(Object.keys(STATUS.packaging), 'aceptado', STATUS.packaging)}</select>`)}
    <button class="btn block" type="submit">${p ? 'Guardar cambios' : 'Registrar envase'}</button>
  </form>`;
}

Object.assign(FORMS, {
  async packaging(form) {
    const d = formData(form);
    const prev = form.dataset.id ? await getOne('packaging', form.dataset.id) : null;
    const name = str(d.name);
    if (!name) throw new InputError('Indica la identificación del envase.');
    const quantity = intOrNull(d.quantity, prev ? 'Stock actual' : 'Unidades recibidas');
    if (quantity === null) throw new InputError('Indica las unidades.');
    const kind = PACK_KINDS[d.kind] ? d.kind : 'primario';
    if (kind === 'primario' && !str(d.lot)) throw new InputError('El acondicionamiento primario necesita el nº de lote.');
    const internal = str(d.internal_no);
    await uniqueInternal('packaging', internal, prev && prev.uuid);
    const status = prev ? prev.status : (STATUS.packaging[d.status] ? d.status : 'aceptado');
    const rec = {
      ...(prev || { uuid: newId(), status, quantity_received: quantity, ...(status === 'aceptado' ? { decision_date: todayIso(), decision_by: state.profile.name } : {}) }),
      name: name.slice(0, 160), kind, capacity: str(d.capacity).slice(0, 40), internal_no: internal.slice(0, 40),
      supplier: str(d.supplier).slice(0, 160), lot: str(d.lot).slice(0, 100), received_date: isDay(d.received_date) ? d.received_date : null,
      quantity, containers: intOrNull(d.containers, 'Nº de cajas'), min_stock: intOrNull(d.min_stock, 'Stock mínimo'),
      expiry: isDay(d.expiry) ? d.expiry : null, storage: str(d.storage).slice(0, 200), observations: str(d.observations).slice(0, 2000),
      inspection: {
        ...Object.fromEntries(Object.keys(PACK_CHECKS).map((k) => [k, d[`insp_${k}`] === 'on'])),
        by: str(d.insp_by).slice(0, 120), date: isDay(d.insp_date) ? d.insp_date : null,
      },
    };
    if (!prev && rec.status === 'aceptado' && !inspectionDone(rec.inspection)) {
      throw new InputError('Para registrarlo como aceptado, marca las tres comprobaciones de la inspección en la recepción, o regístralo en cuarentena.');
    }
    await save('packaging', rec, prev ? 'edicion_acondicionamiento' : 'alta_acondicionamiento', `${rec.name}${rec.lot ? ` / ${rec.lot}` : ''}`);
    toast(prev ? 'Ficha guardada.' : 'Envase registrado.');
    location.hash = `#envases--${rec.uuid}`;
  },
});

STATUS_CHECKS.packaging = async (p, status) => {
  if (status === 'rechazado') return { title: 'Rechazar material', message: `Se registrará el rechazo de ${p.name} con fecha de hoy y a tu nombre. Debe devolverse al proveedor.`, confirmLabel: 'Rechazar', danger: true };
  if (status !== 'aceptado') return null;
  const missing = [];
  if (!p.internal_no) missing.push('el nº de registro interno');
  if (!inspectionDone(p.inspection)) missing.push('la inspección en la recepción (en «Editar ficha»)');
  return missing.length ? { title: 'Aceptar material', message: `Falta ${missing.join(' y ')}. ¿Aceptarlo igualmente?`, confirmLabel: 'Aceptar igualmente' } : null;
};
