'use strict';
/* FARMA·LAB móvil · Almacén: materias primas (PN/L/PG/005) y material de acondicionamiento (PN/L/PG/006). */

const STORE_TABS = [['#materias', 'Materias primas'], ['#envases', 'Acondicionamiento']];
const KIND_LABELS = { activo: 'Principio activo', excipiente: 'Excipiente', ambos: 'Principio activo o excipiente, según la fórmula' };
const KIND_TAGS = { activo: 'PA', ambos: 'PA / EXC' };
const kindTag = (k) => (KIND_TAGS[k] ? `<span class="doc-tag pa">${KIND_TAGS[k]}</span>` : '');
/** Materias primas cuyo envase sirve de acondicionamiento de la fórmula (vehículos que se elaboran en su propio frasco). */
const packIncluded = (m) => Boolean(m && m.pack_included && str(m.pack_desc));
const PACK_KINDS = { primario: 'Primario', secundario: 'Secundario' };
/** Inspección en la recepción del material de acondicionamiento (PN/L/PG/006, apartado 4.1). */
const PACK_CHECKS = {
  albaran: 'El albarán de entrega coincide con el material pedido',
  material: 'El material recibido se corresponde con el albarán',
  estado: 'El estado de envases, embalajes y etiquetado es correcto',
};
const inspectionDone = (insp) => Boolean(insp && Object.keys(PACK_CHECKS).every((k) => insp[k]));
// PN/L/PG/005/00 (Formulario Nacional): la inspección en la recepción de materias primas es la misma (apartado 4.1).
const MP_RECEPTION_CHECKS = PACK_CHECKS;
/** Origen de las especificaciones (anexo III), por orden de preferencia (apartado 4.2). */
const SPEC_SOURCES = { rfe: 'Cumple RFE', otra: 'Otra farmacopea', fabricante: 'Fabricante o proveedor' };
const specMethods = (m) => str(m.spec_methods ?? (m.qc && m.qc.methods));
/** Especificaciones que faltan según su origen (PN/L/PG/005/00, 4.2). */
function specMissing(m) {
  const miss = [];
  if (!SPEC_SOURCES[m.spec_source]) miss.push('origen de las especificaciones (RFE, otra farmacopea o fabricante)');
  if (m.spec_source === 'rfe' && !str(m.spec_monograph_no)) miss.push('nº de monografía de la RFE');
  if (m.spec_source === 'otra') {
    if (!str(m.spec_pharmacopoeia)) miss.push('farmacopea de referencia');
    if (!str(m.spec_identification)) miss.push('identificación');
    if (!str(m.spec_impurities)) miss.push('impurezas');
    if (!specMethods(m)) miss.push('descripción de los procedimientos analíticos');
  }
  if (!str(m.storage)) miss.push('condiciones de conservación');
  if (!str(m.handling)) miss.push('precauciones al manipular');
  if (!str(m.toxicity)) miss.push('toxicidad y peligrosidad');
  return miss;
}
const DISPOSALS = { devuelto: 'Devuelto al proveedor', eliminado: 'Eliminado' };
// PN/L/PG/006/00, 4.3: la eliminación del acondicionamiento primario o impreso caducado u obsoleto se registra.
const PACK_ELIMINATION = { caducado: 'caducidad', obsoleto: 'obsolescencia', deteriorado: 'deterioro' };
const RECORD_LABEL = { material: 'materia prima', packaging: 'material de acondicionamiento' };
const lastReview = (m) => (Array.isArray(m.reviews) && m.reviews.length ? m.reviews[m.reviews.length - 1] : null);
/** Propone el siguiente nº de registro interno siguiendo el modelo del último lote numerado (MP-0012 → MP-0013). */
function nextInternalNo(list, first = 'MP-0001') {
  const numbered = list.filter((m) => str(m.internal_no));
  if (!numbered.length) return first;
  const pattern = /^(.*?)(\d+)(\D*)$/;
  const latest = numbered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0].internal_no;
  const p = pattern.exec(latest);
  if (!p) return '';
  let max = 0;
  numbered.forEach((m) => { const x = pattern.exec(m.internal_no); if (x && x[1] === p[1] && x[3] === p[3]) max = Math.max(max, Number(x[2])); });
  return `${p[1]}${String(max + 1).padStart(p[2].length, '0')}${p[3]}`;
}
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
    out.push({ name: ref.name, total: round6(total), unit, min: ref.min_stock, low: total <= ref.min_stock, active: lots.some((r) => r.kind === 'activo' || r.kind === 'ambos'), sample: ref.uuid });
  }
  return out;
}
const stockClass = (r) => (isNum(r.min_stock) && r.min_stock > 0 && r.quantity <= r.min_stock ? 'bad' : '');

// ------------------------------------------------------------------ Materias primas
async function viewMaterials() {
  const items = (await getAll('material')).sort(byText('name'));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((m) => `<li data-text="${esc(lc([m.name, m.lot, m.internal_no, m.code, m.supplier, m.qc_no].join(' ')))}"><a class="row" href="#materias--${esc(m.uuid)}"><div class="row-main"><strong>${esc(m.name)}${m.internal_no ? ` <span class="code">${esc(m.internal_no)}</span>` : ''}</strong><span class="sub"><span>Lote ${esc(m.lot)}</span><span>Cad. ${fmtDay(m.expiry)}</span><span class="${stockClass(m)}">${fmtNum(m.quantity)} ${esc(m.unit)}</span>${kindTag(m.kind)}${packIncluded(m) ? '<span class="doc-tag">Envase incluido</span>' : ''}${m.edo ? '<span class="doc-tag edo">EDO</span>' : ''}</span></div>${pill('material', m.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Ningún lote coincide con la búsqueda.</p>`
    : empty('Aún no hay materias primas registradas.', 'Registra la primera recepción con «Nuevo lote».');
  return `${segmented(STORE_TABS, '#materias')}${items.length ? searchBox('Buscar nombre, lote, nº interno o proveedor') : ''}${list}${items.length ? '<p class="more"><a href="#registromp">Registro de materias primas en PDF (anexo II)</a></p>' : ''}${fab('#materias--nueva', 'Nuevo lote')}`;
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
  const retFact = await retentionFact('material', m);
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(m.name)}</h2>${pill('material', m.status)}</div>
    ${facts([
      ['Nº registro interno', m.internal_no ? `<strong>${esc(m.internal_no)}</strong>` : '<span class="warn">Sin asignar</span>'],
      ['Tipo', `${esc(KIND_LABELS[m.kind] || 'Sin indicar')}${m.edo ? ' · <span class="warn">Excipiente de declaración obligatoria</span>' : ''}`],
      ['Proveedor', val(m.supplier)],
      ['Lote', val(m.lot)],
      ['Nº control de calidad', val(m.qc_no)],
      packIncluded(m) ? ['Envase', `${esc(m.pack_desc)} <span class="hint">(sirve de acondicionamiento de la fórmula)</span>`] : null,
      ['Recepción', `${fmtDay(m.received_date)}${m.containers ? ` · ${esc(m.containers)} ${m.containers === 1 ? 'envase' : 'envases'}` : ''}`],
      ['Inspección en la recepción', inspectionDone(m.reception) ? `Conforme${m.reception.date ? ` el ${fmtDay(m.reception.date)}` : ''}${m.reception.by ? ` por ${esc(m.reception.by)}` : ''}` : '<span class="warn">Sin registrar</span> <span class="hint">(en «Editar ficha»)</span>'],
      ['Cantidad recibida', isNum(m.quantity_received) ? `${fmtNum(m.quantity_received)} ${esc(m.unit)}` : '—'],
      ['Stock actual', `<span class="${stockClass(m)}">${fmtNum(m.quantity)} ${esc(m.unit)}</span>${isNum(m.min_stock) ? ` (mínimo ${fmtNum(m.min_stock)} ${esc(m.unit)})` : ''}`],
      ['Caducidad', `${fmtDay(m.expiry)}${expired ? ' <span class="bad">caducado</span>' : ''}`],
      ['Decisión', m.decision_date ? `${esc(STATUS.material[m.status])} el ${fmtDay(m.decision_date)} por ${esc(m.decision_by)}` : '<span class="warn">Pendiente</span>'],
      m.code ? ['Código de artículo', val(m.code)] : null,
      retFact,
    ])}
    ${totalLine}
    <div class="actions spaced"><a class="btn secondary small" href="#materias--${esc(m.uuid)}--editar">Editar ficha</a></div>
  </div>
  <section><h2>Especificaciones (anexo III)</h2><div class="panel">${facts([
    ['Origen', SPEC_SOURCES[m.spec_source] ? `${esc(SPEC_SOURCES[m.spec_source])}${m.spec_source === 'rfe' && m.spec_monograph_no ? ` · monografía n.º ${esc(m.spec_monograph_no)}` : ''}${m.spec_source === 'otra' && m.spec_pharmacopoeia ? ` · ${esc(m.spec_pharmacopoeia)}` : ''}` : '<span class="warn">Sin indicar</span>'],
    ['Monografía', val(m.monograph)],
    ['Identificación', val(m.spec_identification)],
    ['Impurezas', val(m.spec_impurities)],
    ['Procedimientos analíticos', val(specMethods(m))],
    ['Conservación', val(m.storage)],
    ['Precauciones al manipular', val(m.handling)],
    ['Toxicidad y peligrosidad', val(m.toxicity)],
  ])}${specMissing(m).length ? `<p class="hint spaced">Falta: ${esc(specMissing(m).join(', '))}. Se completa en «Editar ficha».</p>` : ''}${m.observations ? `<p class="pre spaced">${esc(m.observations)}</p>` : ''}</div></section>
  ${await materialQcSection(m)}
  <section><h2>Decisión de aceptación o rechazo</h2>${statusButtons('material', m)}
    <p class="hint">Al aceptar o rechazar, la decisión queda fechada y firmada con tu nombre. Al aceptar se le da el nº de registro interno, que se anota en el registro y en la etiqueta del envase.</p>
    ${m.status === 'rechazado' ? disposalForm(m, 'material') : ''}
    ${m.status === 'aceptado' ? reviewBlock(m, 'material') : ''}
    <p><a class="btn block secondary" href="#fichamp--${esc(m.uuid)}">${ICON.doc}Registro y especificaciones en PDF (${esc((await loadSettings()).fn.mp_code)})</a></p></section>
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

/** Ensayos del control de conformidad de un lote (PN/L/PG/005/00, apartado 4.2). */
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
  return `<section><h2>Control de conformidad</h2><form class="panel form" data-form="materialQc" data-id="${esc(m.uuid)}" novalidate>
    ${formMsg()}
    <p class="hint">El lote debe cumplir sus especificaciones (anexo III). Anota los ensayos o comprobaciones hechos, por ejemplo la del boletín de análisis del proveedor.</p>
    <div data-rows="mpqc">${(tests.length ? tests : [{}]).map((t) => mpQcRow(t)).join('')}</div>
    <button type="button" class="btn secondary small" data-act="addRow" data-kind="mpqc">${ICON.plus}Añadir ensayo</button>
    <div class="grid2">
      ${field('Realizado por', text('qc_by', `value="${esc(qc.by ?? state.profile.name ?? '')}" maxlength="120"`))}
      ${field('Fecha del control', dateInput('qc_date', qc.date))}
    </div>
    ${field('Fecha de repetición del control analítico', dateInput('retest_date', m.retest_date), 'Solo si procede (en lugar de la caducidad).')}
    <button class="btn secondary block" type="submit">Guardar control de conformidad</button>
  </form></section>`;
}
/** Lote rechazado: devolución al proveedor o eliminación, que debe registrarse (PN/L/PG/005/00, 4.2). */
function disposalForm(m, store = 'material') {
  const d = m.disposal || {};
  return `<form class="panel form spaced" data-form="recordDisposal" data-store="${store}" data-id="${esc(m.uuid)}" novalidate>
    ${formMsg()}
    <p class="sublabel">Destino del lote rechazado</p>
    <div class="grid2">
      ${field('Destino', `<select name="method">${options(['', ...Object.keys(DISPOSALS)], d.method || '', { '': 'Elegir', ...DISPOSALS })}</select>`)}
      ${field('Fecha', dateInput('date', d.date || todayIso()))}
    </div>
    ${field('Detalle', text('detail', `value="${esc(d.detail || '')}" maxlength="200"`), 'Nº de albarán de devolución o método de eliminación según su peligrosidad.')}
    <button class="btn secondary block" type="submit">Registrar el destino</button>
    <p class="hint">Mientras tanto, mantenlo aparte y etiquetado como rechazado.</p>
  </form>`;
}
/** Revisión anual del estado del producto por el farmacéutico (PN/L/PG/005/00, 4.3). */
function reviewBlock(m, store = 'material') {
  const r = lastReview(m);
  return `<div class="panel stack spaced">
    <p><strong>Revisión anual del estado:</strong> ${r ? `${fmtDay(r.date)} por ${esc(r.by)}` : 'sin registrar'}.</p>
    <button class="btn secondary small" type="button" data-act="recordReview" data-store="${store}" data-id="${esc(m.uuid)}">Registrar revisión de hoy</button>
  </div>`;
}
/** Eliminación de acondicionamiento caducado, obsoleto o deteriorado: se registra y descuenta del stock (PN/L/PG/006/00, 4.3). */
function eliminationForm(p) {
  const list = Array.isArray(p.eliminations) ? p.eliminations : [];
  return `<form class="panel form spaced" data-form="packElimination" data-id="${esc(p.uuid)}" novalidate>
    ${formMsg()}
    <p class="sublabel">Eliminación de material caducado u obsoleto</p>
    ${list.length ? `<ul class="plain">${list.map((e) => `<li>${fmtDay(e.date)}: ${fmtNum(e.qty)} uds. por ${esc(PACK_ELIMINATION[e.reason] || e.reason)}${e.by ? ` (${esc(e.by)})` : ''}</li>`).join('')}</ul>` : ''}
    <div class="grid2">
      ${field('Unidades eliminadas', `<input type="text" inputmode="numeric" name="qty" maxlength="7">`)}
      ${field('Motivo', `<select name="reason">${options(Object.keys(PACK_ELIMINATION), 'caducado', { caducado: 'Caducado', obsoleto: 'Obsoleto', deteriorado: 'Deteriorado' })}</select>`)}
    </div>
    ${field('Fecha', dateInput('date', todayIso()))}
    <button class="btn secondary block" type="submit">Registrar la eliminación</button>
    <p class="hint">Queda en las observaciones del registro y se descuenta del stock.</p>
  </form>`;
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
        ${field('Tipo', `<select name="kind">${options(Object.keys(KIND_LABELS), v.kind || 'excipiente', { ...KIND_LABELS, ambos: 'Activo o excipiente' })}</select>`, 'Uso habitual. Lo que cuenta es la función que se marca en cada fórmula.')}
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
      ${checkbox('pack_included', 'Se elabora en su propio envase, que sirve de acondicionamiento de la fórmula', Boolean(v.pack_included), 'data-pack-incl')}
      <div data-pack-desc${v.pack_included ? '' : ' hidden'}>${field('Descripción del envase', text('pack_desc', `value="${esc(v.pack_desc || '')}" maxlength="160" placeholder="Frasco de plástico de 100 ml con aplicadores"`), 'Por ejemplo, vehículos como Finastopic: el frasco con sus aplicadores es el envase final. Aparece en la guía y en la ficha 2.')}</div>
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
    <fieldset class="group"><legend>Inspección en la recepción</legend>
      ${Object.entries(MP_RECEPTION_CHECKS).map(([k, label]) => checkbox(`rc_${k}`, esc(label), Boolean(v.reception && v.reception[k]))).join('')}
      <div class="grid2">
        ${field('Realizada por', text('rc_by', `value="${esc((v.reception && v.reception.by) ?? state.profile.name ?? '')}" maxlength="120"`))}
        ${field('Fecha', dateInput('rc_date', (v.reception && v.reception.date) || v.received_date || todayIso()))}
      </div>
      <p class="hint">Si algo no es correcto, la materia prima no se registra: se devuelve al proveedor. Al registrarla queda en cuarentena, con la etiqueta original del proveedor.</p>
    </fieldset>
    <fieldset class="group"><legend>Especificaciones (anexo III)</legend>
      <p class="hint" data-spec-copied hidden></p>
      ${field('Origen de las especificaciones', `<select name="spec_source">${options(['', ...Object.keys(SPEC_SOURCES)], v.spec_source || '', { '': 'Elegir', ...SPEC_SOURCES })}</select>`, 'Por este orden: RFE; si no está, otra farmacopea de reconocido prestigio; y si no, las del fabricante o proveedor.')}
      <div class="grid2">
        ${field('Monografía n.º', text('spec_monograph_no', `value="${esc(v.spec_monograph_no || '')}" maxlength="40"`), 'Si cumple RFE.')}
        ${field('Farmacopea', text('spec_pharmacopoeia', `value="${esc(v.spec_pharmacopoeia || '')}" maxlength="80"`), 'Si es otra (Ph. Eur., USP...).')}
      </div>
      ${field('Monografía', text('monograph', `value="${esc(v.monograph || '')}" maxlength="160"`), 'Si cumple RFE, su título (sale junto al nº). Si es otra farmacopea, su monografía; si es del fabricante, su documento de especificaciones.')}
      ${field('Identificación', `<textarea name="spec_identification" maxlength="1500">${esc(v.spec_identification || '')}</textarea>`)}
      ${field('Impurezas', `<textarea name="spec_impurities" maxlength="1500">${esc(v.spec_impurities || '')}</textarea>`)}
      ${field('Descripción de los procedimientos analíticos', `<textarea name="spec_methods" maxlength="3000">${esc(specMethods(v))}</textarea>`)}
      ${field('Condiciones de conservación', text('storage', `value="${esc(v.storage || '')}" maxlength="200"`))}
      ${field('Precauciones al manipular', `<textarea name="handling" maxlength="1000">${esc(v.handling || '')}</textarea>`)}
      ${field('Toxicidad y peligrosidad', `<textarea name="toxicity" maxlength="1000">${esc(v.toxicity || '')}</textarea>`)}
    </fieldset>
    ${field('Observaciones', `<textarea name="observations" maxlength="2000">${esc(v.observations || '')}</textarea>`, 'Aparecen en el registro de materias primas.')}
    ${m ? '' : '<p class="hint">Se registra en cuarentena hasta la decisión del farmacéutico.</p>'}
    <button class="btn block" type="submit">${m ? 'Guardar cambios' : 'Registrar lote'}</button>
  </form>`;
}
async function viewMaterialForm(id) {
  const m = id ? await getOne('material', id) : null;
  if (id && !m) return empty('Este lote no existe.', '');
  return viewMaterialFormHtml(m);
}

// El campo de descripción del envase solo aparece si el envase sirve de acondicionamiento.
CHANGE_HOOKS.push((t) => {
  if (!t.matches('[data-pack-incl]')) return;
  const box = $('[data-pack-desc]', t.form);
  if (box) box.hidden = !t.checked;
});

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
    const reception = {
      ...Object.fromEntries(Object.keys(MP_RECEPTION_CHECKS).map((k) => [k, d[`rc_${k}`] === 'on'])),
      by: str(d.rc_by).slice(0, 120), date: isDay(d.rc_date) ? d.rc_date : null,
    };
    if (!prev && !inspectionDone(reception)) throw new InputError('Marca las tres comprobaciones de la recepción. Si alguna no se cumple, la materia prima no se registra: se devuelve al proveedor.');
    if (d.pack_included === 'on' && !str(d.pack_desc)) throw new InputError('Describe el envase que sirve de acondicionamiento (por ejemplo: frasco de plástico de 100 ml con aplicadores).');
    await uniqueInternal('material', internal, prev && prev.uuid);
    if (code && (await getAll('material')).some((m) => m.uuid !== (prev && prev.uuid) && m.code && lc(m.code) === lc(code) && lc(m.lot) === lc(lot))) {
      throw new InputError('Ya existe ese código de artículo con el mismo lote.');
    }
    const rec = {
      ...(prev || { uuid: newId(), status: 'cuarentena', quantity_received: quantity }),
      name: name.slice(0, 160), kind: KIND_LABELS[d.kind] ? d.kind : 'excipiente', edo: d.edo === 'on', internal_no: internal.slice(0, 40),
      pack_included: d.pack_included === 'on', pack_desc: d.pack_included === 'on' ? str(d.pack_desc).slice(0, 160) : '',
      supplier: str(d.supplier).slice(0, 160), lot: lot.slice(0, 100), qc_no: str(d.qc_no).slice(0, 80),
      received_date: isDay(d.received_date) ? d.received_date : null, containers,
      quantity, unit: MATERIAL_UNITS.includes(d.unit) ? d.unit : 'g', min_stock: minStock,
      expiry: isDay(d.expiry) ? d.expiry : null, code: code.slice(0, 80),
      reception,
      spec_source: SPEC_SOURCES[d.spec_source] ? d.spec_source : '', spec_monograph_no: str(d.spec_monograph_no).slice(0, 40), spec_pharmacopoeia: str(d.spec_pharmacopoeia).slice(0, 80),
      spec_identification: str(d.spec_identification).slice(0, 1500), spec_impurities: str(d.spec_impurities).slice(0, 1500), spec_methods: str(d.spec_methods).slice(0, 3000),
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
      methods: (m.qc && m.qc.methods) || '',   // desde la v0.3.14 los procedimientos analíticos van en las especificaciones
    };
    m.retest_date = isDay(all.get('retest_date')) ? all.get('retest_date') : null;
    if (m.qc.tests.some((t) => t.result && t.ok === null)) throw new InputError('Indica si cada ensayo con resultado es conforme o no.');
    await save('material', m, 'control_calidad_materia_prima', `${m.name} / ${m.lot}: ${m.qc.tests.filter((t) => t.result).length} ensayos`);
    toast('Control de conformidad guardado.');
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
    return { title: 'Rechazar materia prima', message: `Se registrará el rechazo de ${m.name} (lote ${m.lot}) con fecha de hoy y a tu nombre. Debe devolverse al proveedor o eliminarse lo antes posible, y mantenerse aparte y etiquetada mientras tanto. Después registra su destino.`, confirmLabel: 'Rechazar', danger: true };
  }
  // PN/L/PG/005/00, 4.2: al aceptarla se le da el nº de registro interno (si aún no lo tiene).
  const proposed = m.internal_no ? '' : nextInternalNo(await getAll('material'));
  const missing = [];
  if (!m.internal_no && !proposed) missing.push('el nº de registro interno');
  if (!inspectionDone(m.reception)) missing.push('la inspección en la recepción');
  const hasBulletin = (await docsOf(m.uuid)).some((f) => f.kind === 'boletin');
  if (!m.qc_no && !hasBulletin) missing.push('el nº de control de calidad o el boletín de análisis');
  if (specMissing(m).length) missing.push(`las especificaciones (${specMissing(m).join(', ')})`);
  if (!((m.qc && m.qc.tests) || []).some((t) => t.result)) missing.push('el resultado del control de conformidad');
  if (((m.qc && m.qc.tests) || []).some((t) => t.ok === false)) missing.push('que todos los ensayos sean conformes (hay alguno no conforme)');
  if (isDay(m.expiry) && daysUntil(m.expiry) < 0) missing.push('una caducidad vigente (el lote está caducado)');
  const numberLine = proposed ? `\n\nSe le asigna el nº de registro interno ${proposed}: anótalo en la etiqueta del envase. Se puede cambiar en «Editar ficha».` : '';
  return {
    title: 'Aceptar materia prima',
    message: missing.length
      ? `Falta ${missing.join('; ')}. Mientras no se compruebe que cumple sus especificaciones, debería seguir en cuarentena.${numberLine}\n\n¿Aceptarla igualmente?`
      : `Se registrará la aceptación de ${m.name} (lote ${m.lot}) con fecha de hoy y a tu nombre.${numberLine}`,
    confirmLabel: missing.length ? 'Aceptar igualmente' : 'Aceptar',
    apply: proposed ? (rec) => { rec.internal_no = proposed; } : null,
  };
};

// Lotes aceptados con existencias cuyo estado no se ha revisado en el último año (PN/L/PG/005/00, 4.3).
ALERT_SOURCES.push(async () => {
  const year = 365 * 864e5;
  const tagged = [
    ...(await getAll('material')).map((r) => ({ r, route: 'materias' })),
    ...(await getAll('packaging')).map((r) => ({ r, route: 'envases' })),
  ];
  const due = tagged.filter(({ r }) => {
    if (r.status !== 'aceptado' || !(r.quantity > 0)) return false;
    const last = lastReview(r);
    const since = Date.parse((last && last.date) || r.decision_date || r.received_date || r.created_at);
    return Number.isFinite(since) && Date.now() - since > year;
  });
  if (!due.length) return [];
  const routes = [...new Set(due.map((d) => d.route))];
  return [{
    tone: 'amber', kind: 'Revisión anual', title: `${due.length} ${due.length === 1 ? 'lote' : 'lotes'} sin revisar en el último año`,
    text: `El farmacéutico debe evaluar el estado de materias primas y acondicionamiento al menos una vez al año: ${due.slice(0, 4).map(({ r }) => `${r.name}${r.lot ? ` (${r.lot})` : ''}`).join(', ')}${due.length > 4 ? '…' : ''}.`,
    href: due.length === 1 ? `#${due[0].route}--${due[0].r.uuid}` : `#${routes[0]}`,
  }];
});

// Lote nuevo de un producto ya registrado: se copian sus especificaciones (anexo III), que son del producto.
const SPEC_FIELDS = ['spec_source', 'spec_monograph_no', 'spec_pharmacopoeia', 'monograph', 'spec_identification', 'spec_impurities', 'spec_methods', 'storage', 'handling', 'toxicity'];
CHANGE_HOOKS.push(async (t) => {
  const form = t.form;
  if (!form || !form.matches('form[data-form="material"]:not([data-id])') || t.name !== 'name') return;
  if (SPEC_FIELDS.some((k) => str(form.elements[k].value))) return;
  const prev = (await getAll('material')).filter((m) => fold(m.name) === fold(t.value) && SPEC_FIELDS.some((k) => str(k === 'spec_methods' ? specMethods(m) : m[k])))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  if (!prev) return;
  SPEC_FIELDS.forEach((k) => { form.elements[k].value = k === 'spec_methods' ? specMethods(prev) : (prev[k] || ''); });
  if (KIND_LABELS[prev.kind]) form.elements.kind.value = prev.kind;
  if (MATERIAL_UNITS.includes(prev.unit)) form.elements.unit.value = prev.unit;
  const note = $('[data-spec-copied]', form);
  if (note) { note.textContent = `Especificaciones copiadas del lote ${prev.lot}. Revísalas por si han cambiado.`; note.hidden = false; }
});

Object.assign(ACTIONS, {
  recordReview: async (el) => {
    const store = el.dataset.store === 'packaging' ? 'packaging' : 'material';
    const m = await getOne(store, el.dataset.id);
    if (!m) return;
    const ok = await ask({
      title: 'Revisión anual',
      message: store === 'material'
        ? `Confirma que has revisado el estado de ${m.name} (lote ${m.lot}): aspecto, envase cerrado y sin daños, etiquetado legible, condiciones de conservación y caducidad.`
        : `Confirma que has revisado el estado de ${m.name}${m.lot ? ` (lote ${m.lot})` : ''}: limpio y sin daños, bien almacenado, etiquetado legible y dentro de caducidad. Si hay material caducado u obsoleto, registra su eliminación.`,
      confirmLabel: 'Registrar revisión',
    });
    if (!ok) return;
    m.reviews = [...(Array.isArray(m.reviews) ? m.reviews : []), { date: todayIso(), by: state.profile.name }].slice(-20);
    await save(store, m, store === 'material' ? 'revision_anual_materia_prima' : 'revision_anual_acondicionamiento', `${m.name}${m.lot ? ` / ${m.lot}` : ''}`);
    toast('Revisión registrada.');
    await route();
  },
});
Object.assign(FORMS, {
  async recordDisposal(form) {
    const store = form.dataset.store === 'packaging' ? 'packaging' : 'material';
    const m = await getOne(store, form.dataset.id);
    if (!m || m.status !== 'rechazado') throw new InputError('Solo se registra el destino de un lote rechazado.');
    const d = formData(form);
    if (!DISPOSALS[d.method]) throw new InputError('Indica si se ha devuelto al proveedor o se ha eliminado.');
    if (!isDay(d.date)) throw new InputError('Indica la fecha.');
    m.disposal = { method: d.method, date: d.date, detail: str(d.detail).slice(0, 200), by: state.profile.name };
    await save(store, m, store === 'material' ? 'destino_rechazo_materia_prima' : 'destino_rechazo_acondicionamiento', `${m.name}${m.lot ? ` / ${m.lot}` : ''}: ${lc(DISPOSALS[d.method])} el ${fmtDay(d.date)}`);
    toast('Destino registrado.');
    await route();
  },
  async packElimination(form) {
    const p = await getOne('packaging', form.dataset.id);
    if (!p) throw new InputError('Este material ya no existe.');
    const d = formData(form);
    const qty = intOrNull(d.qty, 'Unidades eliminadas');
    if (!qty || qty <= 0) throw new InputError('Indica cuántas unidades se eliminan.');
    if (qty > p.quantity) throw new InputError(`Solo quedan ${fmtNum(p.quantity)} unidades en stock.`);
    if (!PACK_ELIMINATION[d.reason]) throw new InputError('Indica el motivo.');
    if (!isDay(d.date)) throw new InputError('Indica la fecha.');
    p.eliminations = [...(Array.isArray(p.eliminations) ? p.eliminations : []), { date: d.date, qty, reason: d.reason, by: state.profile.name }];
    p.quantity -= qty;
    await save('packaging', p, 'eliminacion_acondicionamiento', `${p.name}${p.lot ? ` / ${p.lot}` : ''}: ${qty} uds. por ${PACK_ELIMINATION[d.reason]} (quedan ${p.quantity})`);
    toast('Eliminación registrada.');
    await route();
  },
});
Object.assign(ACTION_LABELS, {
  revision_anual_materia_prima: 'Revisión anual de materia prima',
  destino_rechazo_materia_prima: 'Destino de materia prima rechazada',
  registro_mp_generado: 'Registro de materias primas generado',
  registro_ac_generado: 'Registro de material de acondicionamiento generado',
  revision_anual_acondicionamiento: 'Revisión anual de acondicionamiento',
  destino_rechazo_acondicionamiento: 'Destino de acondicionamiento rechazado',
  eliminacion_acondicionamiento: 'Eliminación de acondicionamiento caducado u obsoleto',
});

// ------------------------------------------------------------------ Material de acondicionamiento
async function viewPackagings() {
  const items = (await getAll('packaging')).sort(byText('name'));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((p) => `<li data-text="${esc(lc([p.name, p.lot, p.internal_no, p.supplier, p.capacity].join(' ')))}"><a class="row" href="#envases--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.name)}${p.internal_no ? ` <span class="code">${esc(p.internal_no)}</span>` : ''}</strong><span class="sub"><span>${esc(PACK_KINDS[p.kind] || 'Primario')}</span>${p.lot ? `<span>Lote ${esc(p.lot)}</span>` : ''}<span class="${stockClass(p)}">${fmtNum(p.quantity)} uds.</span>${isDay(p.expiry) ? `<span>Cad. ${fmtDay(p.expiry)}</span>` : ''}</span></div>${pill('packaging', p.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Nada coincide con la búsqueda.</p>`
    : empty('Aún no hay material de acondicionamiento.', 'Registra tarros, frascos, cápsulas, cajas o prospectos con «Nuevo envase».');
  const registerLink = items.length ? '<p class="more"><a href="#registroac">Registro de material de acondicionamiento en PDF (anexo II)</a></p>' : '';
  return `${segmented(STORE_TABS, '#envases')}${items.length ? searchBox('Buscar envase, lote o nº interno') : ''}${list}${registerLink}${fab('#envases--nuevo', 'Nuevo envase')}`;
}

async function viewPackaging(id) {
  const p = await getOne('packaging', id);
  if (!p) return empty('Este material no existe.', '');
  const used = (await getAll('production')).filter((x) => (x.packaging_used || []).some((u) => u.packaging_uuid === p.uuid));
  const retFact = await retentionFact('packaging', p);
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
      retFact,
    ])}
    ${p.observations ? `<p class="pre spaced">${esc(p.observations)}</p>` : ''}
    <div class="actions spaced"><a class="btn secondary small" href="#envases--${esc(p.uuid)}--editar">Editar ficha</a></div>
  </div>
  <section><h2>Decisión de aceptación o rechazo</h2>${statusButtons('packaging', p)}
    ${p.status === 'rechazado' ? disposalForm(p, 'packaging') : ''}
    ${p.status === 'aceptado' ? reviewBlock(p, 'packaging') + eliminationForm(p) : ''}
    <p><a class="btn block secondary" href="#fichaenv--${esc(p.uuid)}">${ICON.doc}Registro en PDF (${esc((await loadSettings()).fn.pack_code)})</a></p></section>
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
    let internal = str(d.internal_no);
    // PN/L/PG/006/00, 4.1 y 4.2: tras la inspección se registra con su nº de registro interno.
    if (!prev && !internal) internal = nextInternalNo(await getAll('packaging'), 'AC-0001');
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
    toast(prev ? 'Ficha guardada.' : `Envase registrado con el nº ${rec.internal_no}.`);
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
