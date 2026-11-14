'use strict';
/* FARMA·LAB móvil · Fórmulas: composición, códigos nacionales por presentación y PNT vinculados. */

const FORMULA_TYPES = { fm: 'Fórmula magistral', fm_tipificada: 'Fórmula magistral tipificada', oficinal: 'Preparado oficinal' };
const ROLE_LABELS = { activo: 'Principio activo', excipiente: 'Excipiente' };
ROUTES.formulas = (arg, extra) => (arg === 'nueva' ? viewFormulaForm() : arg && extra === 'editar' ? viewFormulaForm(arg) : arg ? viewFormula(arg) : viewFormulas());

const isEdo = (c) => Boolean(c.edo || edoMatch(c.ingredient));
const compTags = (c) => `${c.role === 'activo' ? '<span class="doc-tag pa">PA</span>' : ''}${isEdo(c) ? '<span class="doc-tag edo">EDO</span>' : ''}`;

async function viewFormulas() {
  const all = await getAll('formula');
  const items = all.filter((f) => !f.deleted_at).sort(byText('name'));
  const trashed = all.length - items.length;
  const list = items.length
    ? `<ul class="list" data-list>${items.map((f) => `<li data-text="${esc(lc([f.name, f.code, f.form, (f.national_codes || []).map((c) => c.cn).join(' ')].join(' ')))}"><a class="row" href="#formulas--${esc(f.uuid)}"><div class="row-main"><strong>${esc(f.name)}</strong><span class="sub">${f.code ? `<span>${esc(f.code)}</span>` : ''}<span>Versión ${esc(f.version)}</span>${f.form ? `<span>${esc(f.form)}</span>` : ''}<span>${(f.components || []).length} ${(f.components || []).length === 1 ? 'componente' : 'componentes'}</span>${(f.national_codes || []).length ? `<span class="doc-tag">${f.national_codes.length} CN</span>` : ''}</span></div>${pill('formula', f.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Ninguna fórmula coincide con la búsqueda.</p>`
    : empty('Aún no hay fórmulas.', 'Crea la primera con «Nueva fórmula». Para elaborarla, márcala como Aprobada.');
  return `${items.length ? searchBox('Buscar nombre, código, forma o CN') : ''}${list}${trashed ? `<p class="more"><a href="#papelera">Eliminadas (${trashed})</a></p>` : ''}${fab('#formulas--nueva', 'Nueva fórmula')}`;
}

async function viewFormula(id) {
  const f = await getOne('formula', id);
  if (!f) return empty('Esta fórmula no existe.', '');
  const pnts = (await getLive('pnt')).filter((p) => (f.pnt_uuids || []).includes(p.uuid));
  const cns = f.national_codes || [];
  const gone = Boolean(f.deleted_at);
  const tasados = await Promise.all(cns.map((c) => tasadoFor(c.cn)));
  return `${gone ? deletedBanner('formula', f) : ''}<div class="panel">
    <div class="head-row"><h2 class="big">${esc(f.name)}</h2>${pill('formula', f.status)}</div>
    ${facts([
      ['Tipo', esc(FORMULA_TYPES[f.type] || FORMULA_TYPES.fm)],
      ['Código', val(f.code)],
      ['Versión', val(f.version)],
      ['Forma farmacéutica', val(f.form)],
      ['Vía de administración', val(f.route)],
      ['Conservación', val(f.storage)],
      ['Plazo de validez', isNum(f.validity_days) ? `${f.validity_days} días` : '—'],
      ['Conservación de las elaboraciones', esc(RETENTION_CLASSES[f.retention_class] || RETENTION_CLASSES.general)],
      ['Lote de referencia', `${fmtNum(f.target_amount)} ${esc(f.unit)}`],
      ['Referencia', val(f.reference)],
    ])}
    ${gone ? '' : `<div class="actions spaced"><a class="btn secondary small" href="#formulas--${esc(f.uuid)}--editar">Editar fórmula</a><a class="btn secondary small" href="#valoracion--formula--${esc(f.uuid)}">Precio de valoración</a></div>`}
  </div>
  <section><h2>Composición</h2><ul class="list">${(f.components || []).map((c) => `<li><div class="row"><span class="row-main">${esc(c.ingredient)} ${compTags(c)}</span><b class="num">${fmtNum(c.amount)} ${esc(c.unit)}</b></div></li>`).join('')}</ul></section>
  <section><h2>Códigos nacionales</h2>${cns.length
    ? `<ul class="list">${cns.map((c, i) => `<li><div class="row"><div class="row-main"><strong>${esc(c.presentation || '—')}</strong>${c.concentration || tasados[i] ? `<span class="sub">${c.concentration ? `<span>${esc(c.concentration)}</span>` : ''}${tasados[i] ? `<span class="doc-tag pa">PVP tasado ${money(tasados[i].pvp)}</span>` : ''}</span>` : ''}</div><b class="num">CN ${esc(c.cn)}</b></div></li>`).join('')}</ul>`
    : '<p class="hint none-docs">Sin códigos nacionales. Añádelos desde «Editar fórmula».</p>'}</section>
  <section><h2>PNT de elaboración</h2>${pnts.length
    ? `<ul class="list">${pnts.map((p) => `<li><a class="row" href="#pnt--${esc(p.uuid)}"><div class="row-main"><strong><span class="code">${esc(p.code)}</span> ${esc(p.title)}</strong><span class="sub"><span>Versión ${esc(p.version)}</span></span></div>${pill('pnt', p.status)}</a></li>`).join('')}</ul>`
    : '<p class="hint none-docs">Sin PNT vinculado. Vincúlalo desde «Editar fórmula».</p>'}</section>
  ${gone ? '' : `${f.status === 'aprobada' ? `<p><a class="btn block" href="#elaboraciones--nueva--${esc(f.uuid)}">Elaborar con esta fórmula</a></p>` : ''}
  <section><h2>Cambiar estado</h2>${statusButtons('formula', f)}
  <p class="hint">Solo las fórmulas aprobadas aparecen al crear una elaboración.</p></section>
  <section><h2>Eliminar</h2><button class="btn danger-outline block" data-act="deleteRecord" data-store="formula" data-id="${esc(f.uuid)}">Eliminar fórmula</button>
  <p class="hint">Pasa a la papelera y se puede restaurar. Las elaboraciones ya hechas conservan sus datos.</p></section>`}`;
}

DELETE_CHECKS.formula = async (f) => {
  const used = (await getAll('production')).filter((p) => p.formula_uuid === f.uuid);
  const open = used.filter((p) => p.status === 'en_proceso');
  if (open.length) {
    return { block: `Hay ${open.length === 1 ? 'una elaboración en proceso' : `${open.length} elaboraciones en proceso`} con esta fórmula (${open.map((p) => p.record_code).join(', ')}). Termínala${open.length === 1 ? '' : 's'} o recházala${open.length === 1 ? '' : 's'} antes de eliminarla.` };
  }
  return {
    message: used.length
      ? `Se ha usado en ${used.length === 1 ? 'una elaboración' : `${used.length} elaboraciones`}: sus registros, etiquetas y fichas se conservan, pero no se podrá volver a elaborar mientras esté eliminada. Si solo quieres dejar de usarla, márcala como obsoleta.`
      : '',
  };
};

function componentRow(c = {}) {
  return `<div class="comp" data-comp>
    <input type="text" name="ingredient" list="dl-materials" placeholder="Componente" aria-label="Componente" maxlength="160" value="${esc(c.ingredient || '')}">
    <input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="Cantidad" aria-label="Cantidad" value="${esc(inputNum(c.amount))}">
    <select name="cunit" aria-label="Unidad">${options(COMPONENT_UNITS, c.unit || 'g')}</select>
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
    <select name="role" class="comp-role" aria-label="Función">${options(Object.keys(ROLE_LABELS), c.role || 'excipiente', ROLE_LABELS)}</select>
  </div>`;
}
function cnRow(c = {}) {
  return `<div class="cnrow" data-comp>
    <input type="text" name="cn_presentation" placeholder="Presentación (50 g, 30 cápsulas...)" aria-label="Presentación o cantidad" maxlength="80" value="${esc(c.presentation || '')}">
    <input type="text" name="cn_concentration" placeholder="Concentración" aria-label="Concentración" maxlength="60" value="${esc(c.concentration || '')}">
    <input type="text" name="cn_code" inputmode="numeric" list="dl-tasado" autocomplete="off" placeholder="Código nacional" aria-label="Código nacional" maxlength="20" value="${esc(c.cn || '')}">
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
  </div>`;
}
async function viewFormulaForm(id) {
  await loadSettings();   // años de conservación en las opciones de clase
  const f = id ? await getOne('formula', id) : null;
  if (id && !f) return empty('Esta fórmula no existe.', '');
  if (f && f.deleted_at) return `${deletedBanner('formula', f)}<p class="hint">Restáurala para poder editarla.</p>`;
  const v = f || { version: '1', target_amount: 100, unit: 'g', type: 'fm', status: 'borrador' };
  const mats = await getAll('material');
  const names = [...new Set(mats.map((m) => m.name))].sort((a, b) => a.localeCompare(b, 'es'));
  const pnts = (await getLive('pnt')).sort(byText('code'));
  const comps = v.components && v.components.length ? v.components : [{}, {}];
  const cns = v.national_codes && v.national_codes.length ? v.national_codes : [{}];
  let tasado = [];
  try { tasado = (await loadPriceData()).tasado; } catch { /* sin tablas de precios: el CN se escribe a mano */ }
  return `<form class="form" data-form="formula" ${f ? `data-id="${esc(f.uuid)}"` : ''} novalidate>
    ${formMsg()}
    ${field('Nombre', text('name', `value="${esc(v.name || '')}" required maxlength="160"`), 'Si es tipificada u oficinal, la denominación del Formulario Nacional.')}
    <div class="grid2">
      ${field('Código', text('code', `value="${esc(v.code || '')}" maxlength="80"`))}
      ${field('Versión', text('version', `value="${esc(v.version || '1')}" maxlength="30"`))}
    </div>
    ${field('Tipo', `<select name="type">${options(Object.keys(FORMULA_TYPES), v.type || 'fm', FORMULA_TYPES)}</select>`)}
    ${field('Conservación de las elaboraciones', `<select name="retention_class">${options(Object.keys(RETENTION_CLASSES), v.retention_class || 'general', RETENTION_LABELS())}</select>`, 'Cuánto tiempo se guardan sus elaboraciones después de su caducidad. Los años se cambian en Ajustes.')}
    <div class="grid2">
      ${field('Forma farmacéutica', text('form', `value="${esc(v.form || '')}" maxlength="80" placeholder="Crema, solución, cápsulas..."`))}
      ${field('Vía de administración', text('route', `value="${esc(v.route || '')}" maxlength="80" placeholder="Tópica, oral..."`))}
    </div>
    <div class="grid2">
      ${field('Conservación', text('storage', `value="${esc(v.storage || '')}" maxlength="160" placeholder="Temperatura ambiente, nevera..."`))}
      ${field('Plazo de validez (días)', `<input type="text" inputmode="numeric" name="validity_days" value="${esc(v.validity_days ?? '')}" maxlength="4">`)}
    </div>
    <div class="grid2">
      ${field('Lote de referencia', decimal('target_amount', `value="${esc(inputNum(v.target_amount))}" required`))}
      ${field('Unidad', `<select name="unit">${options(FORMULA_UNITS, v.unit || 'g')}</select>`)}
    </div>
    ${field('Referencia bibliográfica o normativa', text('reference', `value="${esc(v.reference || '')}" maxlength="200"`))}
    <fieldset class="comps"><legend>Composición para el lote de referencia</legend>
      <div data-rows="comp">${comps.map((c) => componentRow(c)).join('')}</div>
      <button type="button" class="btn secondary small" data-act="addRow" data-kind="comp">${ICON.plus}Añadir componente</button>
      <p class="hint">Marca los principios activos. Los excipientes de declaración obligatoria se detectan por el nombre y salen en la etiqueta.</p>
    </fieldset>
    <datalist id="dl-materials">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <fieldset class="comps"><legend>Códigos nacionales</legend>
      <div data-rows="cn">${cns.map((c) => cnRow(c)).join('')}</div>
      <button type="button" class="btn secondary small" data-act="addRow" data-kind="cn">${ICON.plus}Añadir código</button>
      <p class="hint">Un código por cada cantidad o concentración que elaboréis. Al escribir 599… se proponen las fórmulas con precio tasado.</p>
      <datalist id="dl-tasado">${tasado.map((x) => `<option value="${esc(x.cn)}">${esc(`${x.producto} · ${money(x.pvp)}`)}</option>`).join('')}</datalist>
    </fieldset>
    <fieldset class="comps"><legend>PNT de elaboración</legend>
      ${pnts.length ? pnts.map((p) => checkbox('pnt_uuids', `<span class="code">${esc(p.code)}</span> ${esc(p.title)}`, (v.pnt_uuids || []).includes(p.uuid), `value="${esc(p.uuid)}"`)).join('') : '<p class="hint">Aún no hay PNT. Regístralos en Documentos y vuelve para vincularlos.</p>'}
    </fieldset>
    ${f ? '' : field('Estado', `<select name="status">${options(Object.keys(STATUS.formula), 'borrador', STATUS.formula)}</select>`)}
    <button class="btn block" type="submit">${f ? 'Guardar cambios' : 'Guardar fórmula'}</button>
  </form>`;
}

// Al elegir un componente registrado como principio activo, se marca su función.
INPUT_HOOKS.push((t) => {
  if (!t.matches('[data-comp] input[name="ingredient"]')) return;
  const role = $('select[name="role"]', t.closest('[data-comp]'));
  if (!role || role.dataset.touched) return;
  const hit = (state.materials || []).find((m) => fold(m.name) === fold(t.value));
  if (hit && ROLE_LABELS[hit.kind]) role.value = hit.kind;   // si se usa como activo o excipiente según la fórmula, se elige a mano
});
CHANGE_HOOKS.push((t) => { if (t.matches('select[name="role"]')) t.dataset.touched = '1'; });
AFTER_RENDER.push(() => { if ($('form[data-form="formula"]')) getAll('material').then((m) => { state.materials = m; }); });

Object.assign(ACTIONS, {
  addRow: (el) => {
    const kind = el.dataset.kind;
    const box = $(`[data-rows="${kind}"]`);
    const build = ROW_BUILDERS[kind] || (kind === 'cn' ? cnRow : kind === 'pack' ? packRow : kind === 'qc' ? qcRow : componentRow);
    box.insertAdjacentHTML('beforeend', build());
    const rows = $$('[data-comp]', box);
    const first = $('input, select', rows[rows.length - 1]);
    if (first) first.focus();
  },
  removeRow: (el) => {
    const row = el.closest('[data-comp]');
    const box = row.parentElement;
    if ($$('[data-comp]', box).length > 1) row.remove();
    else {   // la última fila no se quita: se vacía (también los desplegables, para que no quede nada elegido)
      $$('input', row).forEach((i) => { i.value = ''; });
      $$('select', row).forEach((sel) => { sel.selectedIndex = 0; });
    }
    box.dispatchEvent(new Event('input', { bubbles: true }));   // para que se recalculen los totales que dependan de las filas
  },
});

Object.assign(FORMS, {
  async formula(form) {
    const d = formData(form);
    const all = new FormData(form);
    const prev = form.dataset.id ? await getOne('formula', form.dataset.id) : null;
    if (prev && prev.deleted_at) throw new InputError('Esta fórmula está en la papelera. Restáurala para poder editarla.');
    const trashedPnts = new Set((await getAll('pnt')).filter((x) => x.deleted_at).map((x) => x.uuid));
    const name = str(d.name);
    if (!name) throw new InputError('Escribe el nombre de la fórmula.');
    const target = parseNum(d.target_amount, 'Lote de referencia');
    if (!target || target <= 0) throw new InputError('El lote de referencia debe ser mayor que cero.');
    const ingredients = all.getAll('ingredient'); const amounts = all.getAll('amount'); const units = all.getAll('cunit'); const roles = all.getAll('role');
    const components = [];
    ingredients.forEach((ing, i) => {
      const n = str(ing);
      if (!n && !str(amounts[i])) return;
      if (!n) throw new InputError(`Falta el nombre del componente ${i + 1}.`);
      const amount = parseNum(amounts[i], n);
      if (amount === null || amount <= 0) throw new InputError(`Indica una cantidad mayor que cero para ${n}.`);
      components.push({ ingredient: n.slice(0, 160), amount, unit: COMPONENT_UNITS.includes(units[i]) ? units[i] : 'g', role: ROLE_LABELS[roles[i]] ? roles[i] : 'excipiente', edo: Boolean(edoMatch(n)) });
    });
    if (!components.length) throw new InputError('Añade al menos un componente.');
    const presentations = all.getAll('cn_presentation'); const concs = all.getAll('cn_concentration'); const codes = all.getAll('cn_code');
    const national_codes = [];
    codes.forEach((code, i) => {
      const cn = str(code); const pres = str(presentations[i]); const conc = str(concs[i]);
      if (!cn && !pres && !conc) return;
      if (!cn) throw new InputError(`Falta el código nacional de «${pres || conc}».`);
      if (!/^[0-9.\-\s]{4,20}$/.test(cn)) throw new InputError(`El código nacional «${cn}» solo puede tener cifras.`);
      if (!pres && !conc) throw new InputError(`Indica la presentación o la concentración del CN ${cn}.`);
      national_codes.push({ presentation: pres.slice(0, 80), concentration: conc.slice(0, 60), cn: cn.replace(/\s/g, '') });
    });
    const seen = new Set();
    national_codes.forEach((c) => { if (seen.has(c.cn)) throw new InputError(`El CN ${c.cn} está repetido.`); seen.add(c.cn); });
    const validity = intOrNull(d.validity_days, 'Plazo de validez');
    const rec = {
      ...(prev || { uuid: newId(), status: STATUS.formula[d.status] ? d.status : 'borrador' }),
      name: name.slice(0, 160), code: str(d.code).slice(0, 80), version: str(d.version).slice(0, 30) || '1',
      type: FORMULA_TYPES[d.type] ? d.type : 'fm', form: str(d.form).slice(0, 80), route: str(d.route).slice(0, 80),
      retention_class: RETENTION_CLASSES[d.retention_class] ? d.retention_class : 'general',
      storage: str(d.storage).slice(0, 160), validity_days: validity, reference: str(d.reference).slice(0, 200),
      target_amount: target, unit: FORMULA_UNITS.includes(d.unit) ? d.unit : 'g', components, national_codes,
      // los PNT en la papelera no salen en la lista, pero se conserva el vínculo por si se restauran
      pnt_uuids: [...new Set([...all.getAll('pnt_uuids').filter((x) => ID_RE.test(x)), ...(prev ? (prev.pnt_uuids || []).filter((u) => trashedPnts.has(u)) : [])])],
    };
    await save('formula', rec, prev ? 'edicion_formula' : 'alta_formula', `${rec.code} ${rec.name} v${rec.version}`.trim());
    toast(prev ? 'Fórmula actualizada.' : 'Fórmula guardada.');
    location.hash = `#formulas--${rec.uuid}`;
  },
});

// Casillas de la fórmula que pasan a la ficha de registro (ficha 2) de cada elaboración, en rojo.
NEEDED.formula = {
  goal: 'la ficha de registro de sus elaboraciones (ficha 2)',
  fields: (f) => {
    const rows = $$('[data-rows="comp"] [data-comp]', f);
    const named = rows.filter((r) => str($('[name="ingredient"]', r).value));
    const comps = named.length ? named.map((r) => $('[name="amount"]', r)) : (rows[0] ? [$('[name="ingredient"]', rows[0]), $('[name="amount"]', rows[0])] : []);
    return ['name', 'form', 'storage', 'target_amount', ...comps];
  },
};
