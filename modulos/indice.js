'use strict';
/* FARMA·LAB móvil · Índice de materias primas: el nº de cada sustancia y la numeración de sus envases (109.1, 109.2…). */

/*
 * Cada materia prima tiene un nº en el índice (por ejemplo, Finastopic, 109). Cada envase que se recibe toma como
 * nº de registro interno el siguiente de su materia prima: 109.1, 109.2, 109.3… Se asigna al registrar la recepción
 * (PN/L/PG/005/00, 4.1.2: el registro, con su nº, se hace nada más recibirla).
 * Los lotes se enlazan con su entrada del índice (substance_uuid); los registrados antes, por el nombre.
 * Para no repetir nunca un nº, la numeración cuenta todos los lotes con ese prefijo (aunque tengan otro nombre)
 * y los envases que ya se numeraron fuera de la app (prior_count, el último nº del libro).
 */
const SEQ_RE = /^(\d{1,6})\.(\d{1,6})$/;
function parseInternal(no) {
  const x = SEQ_RE.exec(str(no));
  return x ? { n: Number(x[1]), seq: Number(x[2]) } : null;
}
const sameName = (a, b) => Boolean(str(a)) && fold(str(a)) === fold(str(b));
const liveSubs = (subs) => subs.filter((s) => !s.deleted_at);
/** Entrada del índice de un lote: la enlazada o, si no tiene enlace, la del mismo nombre. */
function substanceOf(lot, subs) {
  if (!lot) return null;
  const live = liveSubs(subs);
  return live.find((s) => s.uuid === lot.substance_uuid) || live.find((s) => sameName(s.name, lot.name)) || null;
}
/** Lotes de una materia prima del índice. */
const lotsOf = (sub, lots) => lots.filter((m) => m.substance_uuid === sub.uuid || (!m.substance_uuid && sameName(m.name, sub.name)));
/** Último envase numerado con ese nº de materia prima, en la app o fuera de ella. */
function lastSeq(number, lots, prior = 0) {
  let max = Number(prior) || 0;
  lots.forEach((m) => { const p = parseInternal(m.internal_no); if (p && p.n === number) max = Math.max(max, p.seq); });
  return max;
}
const nextInternalFor = (sub, lots) => `${sub.number}.${lastSeq(sub.number, lots, sub.prior_count) + 1}`;
/** Nº que ya usan los lotes de ese nombre, si se numeraron a mano con el formato 109.3. */
function inferredNumber(name, lots) {
  const counts = new Map();
  lots.filter((m) => sameName(m.name, name)).forEach((m) => { const p = parseInternal(m.internal_no); if (p) counts.set(p.n, (counts.get(p.n) || 0) + 1); });
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return best ? best[0] : null;
}
/** Siguiente nº libre: después del mayor del índice (también de la papelera) y del mayor que ya usan los lotes. */
function nextSubstanceNumber(subs, lots) {
  let max = 0;
  subs.forEach((s) => { if (Number.isInteger(s.number)) max = Math.max(max, s.number); });
  lots.forEach((m) => { const p = parseInternal(m.internal_no); if (p) max = Math.max(max, p.n); });
  return max + 1;
}
/** Nº que se propone para una materia prima nueva en el índice: el que ya usan sus lotes, si está libre, o el siguiente. */
function proposedNumber(name, subs, lots) {
  const n = inferredNumber(name, lots);
  return n && !liveSubs(subs).some((s) => s.number === n) ? n : nextSubstanceNumber(subs, lots);
}
/** Comprueba una entrada del índice antes de guardarla (lanza InputError). */
function checkSubstance(cand, prev, subs, lots) {
  if (!str(cand.name)) throw new InputError('Escribe el nombre de la materia prima.');
  if (!Number.isInteger(cand.number) || cand.number < 1 || cand.number > 999999) throw new InputError('Indica el nº de la materia prima (un número entero).');
  if (cand.prior_count > 999999) throw new InputError('Envases ya numerados: el número es demasiado grande.');
  const others = liveSubs(subs).filter((s) => s.uuid !== cand.uuid);
  const twin = others.find((s) => sameName(s.name, cand.name));
  if (twin) throw new InputError(`${twin.name} ya está en el índice con el nº ${twin.number}.`);
  const owner = others.find((s) => s.number === cand.number);
  if (owner) throw new InputError(`El nº ${cand.number} ya es de ${owner.name}.`);
  const foreign = lots.find((m) => { const p = parseInternal(m.internal_no); return p && p.n === cand.number && m.substance_uuid !== cand.uuid && !sameName(m.name, cand.name) && !(prev && sameName(m.name, prev.name)); });
  if (foreign) throw new InputError(`El nº ${cand.number} ya lo usan envases de ${foreign.name} (${foreign.internal_no}). Elige otro.`);
  if (prev && prev.number !== cand.number) {
    const used = lastSeq(prev.number, lots, 0);
    if (used) throw new InputError(`Ya hay envases numerados con el ${prev.number} (el último, ${prev.number}.${used}): el nº ya no se puede cambiar.`);
  }
}
/** Lotes de esa materia prima que aún no están enlazados con su entrada del índice (se enlazan al guardarla). */
const lotsToLink = (sub, lots) => lotsOf(sub, lots).filter((m) => m.substance_uuid !== sub.uuid).map((m) => ['material', { ...m, substance_uuid: sub.uuid }]);
/** Materias primas con lotes que aún no están en el índice. */
function unindexed(subs, lots) {
  const live = liveSubs(subs);
  const groups = new Map();
  lots.forEach((m) => {
    if (!str(m.name) || substanceOf(m, live)) return;
    const k = fold(str(m.name));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  });
  const taken = new Set(live.map((s) => s.number));
  return [...groups.values()].map((g) => {
    g.sort(byNewest);
    const n = inferredNumber(g[0].name, g);
    return { name: g[0].name, lot: g[0], count: g.length, inferred: n && !taken.has(n) ? n : null };
  }).sort(byText('name'));
}

ROUTES.indicemp = (arg, extra) => (arg === 'nueva' ? viewSubstanceForm(null, extra) : arg && extra === 'editar' ? viewSubstanceForm(arg) : arg ? viewSubstance(arg) : viewSubstances());

// ------------------------------------------------------------------ lista
async function viewSubstances() {   // portada del almacén (v0.3.38): sin botón atrás, como las demás pestañas
  const [subs, lots] = await Promise.all([getAll('substance'), getAll('material')]);
  const live = liveSubs(subs).sort((a, b) => a.number - b.number);
  const missing = unindexed(subs, lots);
  const auto = missing.filter((x) => x.inferred);
  const row = (s) => {
    const last = lastSeq(s.number, lots, s.prior_count);
    const inUse = lotsOf(s, lots).filter((m) => !lotArchived(m)).length;
    return `<li data-text="${esc(lc([s.number, s.name, s.notes].join(' ')))}"><a class="row" href="#indicemp--${esc(s.uuid)}"><span class="subno">${s.number}</span><div class="row-main"><strong>${esc(s.name)}</strong><span class="sub"><span>${last ? `Último envase: ${s.number}.${last}` : 'Sin envases todavía'}</span>${inUse ? `<span>${inUse} ${inUse === 1 ? 'lote en uso' : 'lotes en uso'}</span>` : ''}</span></div></a></li>`;
  };
  const pending = missing.length ? `<div class="panel stack subpending">
      <p><strong>${missing.length === 1 ? 'Una materia prima con lotes no está' : `${missing.length} materias primas con lotes no están`} en el índice.</strong> Dales su nº para que sus próximos envases se numeren solos. Los lotes ya registrados conservan su nº.</p>
      <ul class="plain">${missing.map((x) => `<li><a href="#indicemp--nueva--${esc(x.lot.uuid)}">${esc(x.name)}</a>${x.inferred ? ` <span class="hint">(sus lotes usan el ${x.inferred})</span>` : ''}</li>`).join('')}</ul>
      ${auto.length ? `<button class="btn secondary small" type="button" data-act="indexFromLots">Añadir ${auto.length === 1 ? `${esc(auto[0].name)} con el ${auto[0].inferred}` : `las ${auto.length} que ya tienen nº en sus lotes`}</button>` : ''}
    </div>` : '';
  return `${segmented(STORE_TABS, '#indicemp')}
    ${pending}
    ${live.length > 6 ? searchBox('Buscar nº o nombre') : ''}
    ${live.length
      ? `<ul class="list" data-list>${live.map(row).join('')}</ul><p class="none" data-none hidden>Nada del índice coincide con la búsqueda.</p>`
      : empty('El índice está vacío.', 'Añade las materias primas con el nº que ya les dais, o se añadirán al registrar su primera recepción.')}
    ${fab('#indicemp--nueva', 'Nueva materia prima')}`;
}

// ------------------------------------------------------------------ ficha
async function viewSubstance(id) {
  const s = await getOne('substance', id);
  if (!s) return empty('Esta materia prima no está en el índice.', 'Puede que el enlace no sea correcto.');
  const lots = await getAll('material');
  const seqOf = (m) => { const p = parseInternal(m.internal_no); return p && p.n === s.number ? p.seq : -1; };
  const mine = lotsOf(s, lots).sort((a, b) => seqOf(b) - seqOf(a) || String(b.received_date || b.created_at || '').localeCompare(String(a.received_date || a.created_at || '')));
  const last = lastSeq(s.number, lots, s.prior_count);
  const lotRow = (m) => `<li><a class="row" href="#materias--${esc(m.uuid)}"><div class="row-main"><strong>${m.internal_no ? esc(m.internal_no) : '<span class="warn">Sin nº</span>'}</strong><span class="sub"><span>Lote ${esc(m.lot)}</span>${isDay(m.received_date) ? `<span>Recibido el ${fmtDay(m.received_date)}</span>` : ''}${!sameName(m.name, s.name) ? `<span>${esc(m.name)}</span>` : ''}</span></div>${lotArchived(m) ? archivePill(m, 'material') : pill('material', m.status)}</a></li>`;
  return `${s.deleted_at ? deletedBanner('substance', s) : ''}<div class="panel">
    <div class="head-row"><h2 class="big">${esc(s.name)}</h2><span class="pill green">Nº ${s.number}</span></div>
    ${facts([
      ['Nº de la materia prima', `<strong>${s.number}</strong>`],
      ['Envases numerados', last ? `${last} (el último, ${s.number}.${last})` : 'Ninguno todavía'],
      s.prior_count ? ['Numerados fuera de la app', `Hasta el ${s.number}.${s.prior_count}`] : null,
      ['Próximo envase', `<strong>${s.number}.${last + 1}</strong>`],
      s.notes ? ['Notas', esc(s.notes)] : null,
    ])}
    ${s.deleted_at ? '' : `<div class="actions spaced"><a class="btn small" href="#materias--nueva--${esc(s.uuid)}">${ICON.plus}Registrar la recepción de un envase</a><a class="btn secondary small" href="#indicemp--${esc(s.uuid)}--editar">Editar</a></div>`}
  </div>
  <section><h2>Envases recibidos</h2>${mine.length ? `<ul class="list">${mine.map(lotRow).join('')}</ul>` : empty('Aún no hay envases de esta materia prima en la app.', 'Al registrar su recepción, cada envase toma el nº siguiente.')}</section>
  ${!mine.length && !s.deleted_at ? `<section><h2>Quitar del índice</h2><button class="btn danger-outline block" data-act="deleteRecord" data-store="substance" data-id="${esc(s.uuid)}">Quitar ${esc(s.name)} del índice</button></section>` : ''}`;
}

// ------------------------------------------------------------------ alta y edición
async function viewSubstanceForm(id, fromLot) {
  const s = id ? await getOne('substance', id) : null;
  if (id && (!s || s.deleted_at)) return empty('Esta materia prima no está en el índice.', '');
  const [subs, lots] = await Promise.all([getAll('substance'), getAll('material')]);
  let name = s ? s.name : '';
  if (!s && fromLot) { const lot = await getOne('material', fromLot); if (lot) name = lot.name; }
  if (!s && fromLot) state.parent = '#indicemp';
  const number = s ? s.number : (name ? proposedNumber(name, subs, lots) : nextSubstanceNumber(subs, lots));
  const prior = s ? (s.prior_count || 0) : 0;
  const locked = s ? lastSeq(s.number, lots, 0) : 0;
  const legacy = lots.filter((m) => sameName(m.name, name) && !parseInternal(m.internal_no));
  return `<form class="form" data-form="substance" ${s ? `data-id="${esc(s.uuid)}"` : ''} novalidate>
    ${formMsg()}
    ${field('Nombre (DOE o DCI)', text('name', `value="${esc(name)}" required maxlength="160" autocomplete="off"`))}
    <div class="grid2">
      ${field('Nº de la materia prima', `<input type="text" inputmode="numeric" name="number" value="${number}" maxlength="6" required data-subform${locked ? ' readonly' : ''}>`, locked ? `Ya hay envases numerados con el ${s.number}: no se puede cambiar.` : s ? '' : 'Se propone el siguiente libre. Si ya tiene nº en vuestro libro, pon ese.')}
      ${field('Envases ya numerados', `<input type="text" inputmode="numeric" name="prior_count" value="${prior}" maxlength="6" data-subform>`, 'Fuera de la app. Si el último del libro fue el 109.3, pon 3.')}
    </div>
    <p class="msg plain" data-subform-next>${subNextLine(number, lastSeq(number, lots, prior) + 1)}</p>
    ${legacy.length ? `<p class="hint">${legacy.length === 1 ? 'Hay un lote' : `Hay ${legacy.length} lotes`} de ${esc(name)} en la app con otro nº (${esc(legacy.slice(0, 3).map((m) => m.internal_no || 'sin nº').join(', '))}${legacy.length > 3 ? '…' : ''}): conservan su nº. Si ya contaban en el libro, inclúyelos en «Envases ya numerados».</p>` : ''}
    ${field('Notas', `<textarea name="notes" maxlength="500">${esc(s ? s.notes || '' : '')}</textarea>`, 'Opcional: sinónimos, proveedor habitual…')}
    ${s ? '<p class="hint">Cambiar el nombre aquí no cambia el de los lotes ya registrados.</p>' : ''}
    <button class="btn block" type="submit">${s ? 'Guardar cambios' : 'Añadir al índice'}</button>
  </form>`;
}
const subNextLine = (n, seq) => (Number.isInteger(n) && n > 0 ? `El próximo envase que se reciba será el <strong>${n}.${seq}</strong>.` : 'Escribe el nº de la materia prima.');

// Vista previa del próximo nº al cambiar el nº o los envases ya numerados.
INPUT_HOOKS.push(async (t) => {
  if (!t.matches('[data-subform]')) return;
  const form = t.form;
  const out = $('[data-subform-next]', form);
  if (!out) return;
  const n = /^\d+$/.test(str(form.elements.number.value)) ? Number(str(form.elements.number.value)) : NaN;
  const prior = /^\d+$/.test(str(form.elements.prior_count.value)) ? Number(str(form.elements.prior_count.value)) : 0;
  const lots = await getAll('material');
  out.innerHTML = subNextLine(n, lastSeq(n, lots, prior) + 1);
});

Object.assign(FORMS, {
  async substance(form) {
    const d = formData(form);
    const prev = form.dataset.id ? await getOne('substance', form.dataset.id) : null;
    const [subs, lots] = await Promise.all([getAll('substance'), getAll('material')]);
    const rec = { ...(prev || { uuid: newId() }) };
    const cand = {
      uuid: rec.uuid, name: str(d.name).slice(0, 160),
      number: intOrNull(d.number, 'Nº de la materia prima'),
      prior_count: intOrNull(d.prior_count, 'Envases ya numerados') ?? 0,
    };
    checkSubstance(cand, prev, subs, lots);
    const link = lotsToLink(prev || cand, lots);   // con el nombre anterior: los lotes siguen enlazados aunque se renombre
    Object.assign(rec, cand, { notes: str(d.notes).slice(0, 500) });
    const changed = prev ? [prev.number !== rec.number && `nº ${prev.number} → ${rec.number}`, !sameName(prev.name, rec.name) && `antes ${prev.name}`, (prev.prior_count || 0) !== rec.prior_count && `envases ya numerados: ${rec.prior_count}`].filter(Boolean) : [];
    await saveMany([['substance', rec], ...link], prev ? 'edicion_indice_mp' : 'alta_indice_mp', `${rec.number} ${rec.name}${changed.length ? ` (${changed.join('; ')})` : ''}`);
    toast(prev ? 'Cambios guardados.' : `${rec.name} añadida al índice con el nº ${rec.number}.`);
    location.hash = `#indicemp--${rec.uuid}`;
  },
});

Object.assign(ACTIONS, {
  // Añade al índice las materias primas cuyos lotes ya se numeraron a mano con el formato 109.3.
  indexFromLots: async () => {
    const [subs, lots] = await Promise.all([getAll('substance'), getAll('material')]);
    const taken = new Set(liveSubs(subs).map((s) => s.number));
    const add = [];
    unindexed(subs, lots).forEach((x) => { if (x.inferred && !taken.has(x.inferred)) { taken.add(x.inferred); add.push(x); } });
    if (!add.length) { await route(); return; }
    const ok = await ask({
      title: 'Añadir al índice',
      message: `Se añaden con el nº que ya usan sus lotes:\n\n${add.map((x) => `${x.inferred} ${x.name}`).join('\n')}\n\nSus próximos envases seguirán la numeración de cada una.`,
      confirmLabel: 'Añadir',
    });
    if (!ok) return;
    const entries = [];
    add.forEach((x) => {
      const rec = { uuid: newId(), name: str(x.name).slice(0, 160), number: x.inferred, prior_count: 0, notes: '' };
      entries.push(['substance', rec], ...lotsToLink(rec, lots));
    });
    await saveMany(entries, 'indice_desde_lotes', add.map((x) => `${x.inferred} ${x.name}`).join(', '));
    toast(add.length === 1 ? `${add[0].name} añadida al índice.` : `${add.length} materias primas añadidas al índice.`);
    await route();
  },
});

DELETE_CHECKS.substance = async (s) => {
  const lots = await getAll('material');
  if (lotsOf(s, lots).length || lastSeq(s.number, lots, 0)) return { block: `${s.name} tiene envases registrados con su nº: no se puede quitar del índice.` };
  return { message: '' };
};
RESTORE_CHECKS.substance = async (s) => {
  const live = liveSubs(await getAll('substance')).filter((x) => x.uuid !== s.uuid);
  const owner = live.find((x) => x.number === s.number);
  if (owner) return `El nº ${s.number} ya es de ${owner.name}.`;
  const twin = live.find((x) => sameName(x.name, s.name));
  if (twin) return `${twin.name} ya está en el índice con el nº ${twin.number}.`;
  return null;
};

// Nº repetidos: solo pueden aparecer al sincronizar dos equipos que registraron a la vez.
ALERT_SOURCES.push(async () => {
  const [subs, lots] = await Promise.all([getAll('substance'), getAll('material')]);
  const out = [];
  const dup = (list, key) => {
    const seen = new Map();
    list.forEach((r) => { const k = key(r); if (!k) return; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(r); });
    return [...seen.values()].filter((g) => g.length > 1);
  };
  dup(lots, (m) => lc(str(m.internal_no))).forEach((g) => out.push({
    tone: 'amber', kind: 'Nº repetido', title: `${g[0].internal_no} en ${g.length} lotes`,
    text: `${g.map((m) => `${m.name} (lote ${m.lot})`).join(' y ')}. Corrige uno en «Editar ficha»: si dejas la casilla vacía, toma el siguiente.`,
    href: `#materias--${g[g.length - 1].uuid}`,
  }));
  const live = liveSubs(subs);
  [...dup(live, (s) => String(s.number)), ...dup(live, (s) => fold(str(s.name)))].forEach((g) => out.push({
    tone: 'amber', kind: 'Índice de materias primas', title: `Repetido: ${g.map((s) => `${s.number} ${s.name}`).join(' y ')}`,
    text: 'Se ha añadido en dos equipos a la vez. Quita una de las dos entradas (si no tiene envases) o cambia su nº.',
    href: `#indicemp--${g[g.length - 1].uuid}`,
  }));
  return out;
});

Object.assign(ACTION_LABELS, {
  alta_indice_mp: 'Alta en el índice de materias primas',
  edicion_indice_mp: 'Edición del índice de materias primas',
  indice_desde_lotes: 'Índice de materias primas completado desde los lotes',
  eliminar_substance: 'Materia prima quitada del índice',
  restaurar_substance: 'Materia prima restaurada en el índice',
});
