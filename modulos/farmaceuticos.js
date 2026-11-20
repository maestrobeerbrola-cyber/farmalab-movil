'use strict';
/* FARMA·LAB móvil · Farmacéuticos: fichas con nombre, apellidos y nº de colegiado, cada una con su PIN. */

/*
 * Cada farmacéutico entra con su PIN y firma los registros con signatureOf(): nombre, dos apellidos y nº de colegiado.
 * Quien «gestiona farmacéuticos» (admin) puede añadir fichas, darlas de baja y asignar un PIN nuevo a quien lo olvide.
 * Las fichas no se borran (las firmas de los registros las mencionan): se dan de baja y dejan de poder entrar.
 * Viajan con las copias y la sincronización, así que cada uno entra con el mismo PIN en el móvil y en el PC.
 */
ROUTES.farmaceuticos = (arg, extra) => (arg === 'nuevo' ? viewPharmacistForm(null)
  : arg && extra === 'editar' ? viewPharmacistForm(arg)
    : arg && extra === 'pin' ? viewPharmacistPin(arg)
      : arg ? viewPharmacist(arg) : viewPharmacists());

const missingOf = (p) => [!str(p.last_name1) && 'los apellidos', !str(p.colegiado) && 'el nº de colegiado'].filter(Boolean);
/** «Faltan los apellidos y el nº de colegiado» / «Falta el nº de colegiado». */
const missingText = (miss) => `${miss.length > 1 || miss[0] === 'los apellidos' ? 'Faltan' : 'Falta'} ${miss.join(' y ')}`;
const activeAdmins = (all) => all.filter((p) => p.admin && p.active !== false);

async function viewPharmacists() {
  state.parent = '#ajustes';
  const all = (await getAll('pharmacist')).sort((a, b) => (a.active === false) - (b.active === false) || fullName(a).localeCompare(fullName(b), 'es'));
  const me = state.profile.uuid;
  const row = (p) => {
    const miss = missingOf(p);
    return `<li><a class="row" href="#farmaceuticos--${esc(p.uuid)}"><div class="row-main"><strong>${esc(fullName(p))}</strong><span class="sub">${str(p.colegiado) ? `<span>Nº col. ${esc(p.colegiado)}</span>` : ''}${miss.length ? `<span class="warn">${esc(missingText(miss))}</span>` : ''}${p.uuid === me ? '<span>Tú</span>' : ''}${p.admin ? '<span>Gestiona farmacéuticos</span>' : ''}</span></div>${p.active === false ? '<span class="pill gray">De baja</span>' : ''}</a></li>`;
  };
  return `<p class="hint intro">Cada farmacéutico entra con su PIN y los registros quedan firmados con su nombre, apellidos y nº de colegiado.</p>
    <ul class="list">${all.map(row).join('')}</ul>
    ${isAdmin() ? fab('#farmaceuticos--nuevo', 'Añadir farmacéutico') : '<p class="hint">Solo quien gestiona farmacéuticos puede añadir más.</p>'}`;
}

async function viewPharmacist(id) {
  const p = await getOne('pharmacist', id);
  if (!p) return empty('Esta ficha no existe.', '');
  const me = p.uuid === state.profile.uuid;
  const admin = isAdmin();
  const miss = missingOf(p);
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(fullName(p))}</h2>${p.active === false ? '<span class="pill gray">De baja</span>' : me ? '<span class="pill green">Tú</span>' : ''}</div>
    ${miss.length ? `<p class="msg warn">${esc(missingText(miss))}: ${me ? 'complétalo' : 'que lo complete'} para que salga en la firma.</p>` : ''}
    ${facts([
      ['Nombre', esc(str(p.first_name))],
      ['Apellidos', esc([p.last_name1, p.last_name2].map((x) => str(x)).filter(Boolean).join(' ')) || '<span class="warn">Sin apellidos</span>'],
      ['Nº de colegiado', str(p.colegiado) ? esc(p.colegiado) : '<span class="warn">Sin nº</span>'],
      ['Firma en los registros', esc(signatureOf(p))],
      ['Gestiona farmacéuticos', p.admin ? 'Sí' : 'No'],
      p.active === false ? ['De baja desde', fmtDay(String(p.inactive_at || p.updated_at || '').slice(0, 10))] : null,
    ])}
    <div class="actions spaced">
      ${me || admin ? `<a class="btn small" href="#farmaceuticos--${esc(p.uuid)}--editar">Editar ficha</a>` : ''}
      ${me ? `<a class="btn secondary small" href="#farmaceuticos--${esc(p.uuid)}--pin">Cambiar mi PIN</a>` : admin && p.active !== false ? `<a class="btn secondary small" href="#farmaceuticos--${esc(p.uuid)}--pin">Asignar un PIN nuevo</a>` : ''}
    </div>
  </div>
  ${admin && !me ? `<section><h2>${p.active === false ? 'Volver a dar de alta' : 'Dar de baja'}</h2><div class="panel stack">
    <p class="hint">${p.active === false ? 'Podrá volver a entrar con su PIN.' : 'No podrá entrar en la app. Las firmas que ya hizo se conservan en los registros.'}</p>
    <button class="btn ${p.active === false ? 'secondary' : 'danger-outline'} block" type="button" data-act="pharmacistActive" data-id="${esc(p.uuid)}" data-on="${p.active === false ? '1' : '0'}">${p.active === false ? 'Dar de alta' : `Dar de baja a ${esc(fullName(p))}`}</button>
  </div></section>` : ''}`;
}

/** Reparte un nombre completo antiguo («Ana García López») en nombre y apellidos para revisarlo. */
function splitLegacyName(p) {
  if (!p.migrated || str(p.last_name1)) return p;
  const w = str(p.first_name).split(/\s+/).filter(Boolean);
  if (w.length < 2) return p;
  return w.length === 2 ? { ...p, first_name: w[0], last_name1: w[1] } : { ...p, first_name: w.slice(0, -2).join(' '), last_name1: w[w.length - 2], last_name2: w[w.length - 1] };
}

async function viewPharmacistForm(id) {
  const prev = id ? await getOne('pharmacist', id) : null;
  if (id && !prev) return empty('Esta ficha no existe.', '');
  const me = prev && prev.uuid === state.profile.uuid;
  if (prev ? !(me || isAdmin()) : !isAdmin()) return empty('Solo quien gestiona farmacéuticos puede hacerlo.', '');
  const v = prev ? splitLegacyName(prev) : {};
  const split = prev && v !== prev;
  return `<form class="form" data-form="pharmacist" ${prev ? `data-id="${esc(prev.uuid)}"` : ''} novalidate autocomplete="off">
    ${formMsg()}
    ${split ? '<p class="msg plain">Se ha repartido tu nombre en nombre y apellidos: revísalo y añade tu nº de colegiado.</p>' : ''}
    ${pharmacistFields(v)}
    <p class="msg plain" data-sig-preview>${esc(signatureOf(v)) ? `Firmará así: <strong>${esc(signatureOf(v))}</strong>` : 'Aquí verás cómo queda la firma.'}</p>
    ${isAdmin() ? checkbox('admin', 'Puede gestionar farmacéuticos (añadir, dar de baja y asignar PIN)', prev ? prev.admin : false) : ''}
    ${prev ? '' : `<fieldset class="group"><legend>PIN de acceso</legend>
      ${field('PIN', pinInput('pin'), 'Que lo escriba el propio farmacéutico: entre 4 y 8 cifras.')}
      ${field('Repite el PIN', pinInput('pin2'))}
    </fieldset>`}
    <button class="btn block" type="submit">${prev ? 'Guardar ficha' : 'Añadir farmacéutico'}</button>
  </form>`;
}
INPUT_HOOKS.push((t) => {
  if (!t.matches('[data-sig]')) return;
  const out = $('[data-sig-preview]', t.form);
  if (!out) return;
  const el = t.form.elements;
  const sig = signatureOf({ first_name: el.first_name.value, last_name1: el.last_name1.value, last_name2: el.last_name2.value, colegiado: el.colegiado.value });
  out.innerHTML = sig ? `Firmará así: <strong>${esc(sig)}</strong>` : 'Aquí verás cómo queda la firma.';
});

async function viewPharmacistPin(id) {
  const p = await getOne('pharmacist', id);
  if (!p) return empty('Esta ficha no existe.', '');
  const me = p.uuid === state.profile.uuid;
  if (!me && !isAdmin()) return empty('Solo quien gestiona farmacéuticos puede asignar un PIN.', '');
  return `<form class="form" data-form="pharmacistPin" data-id="${esc(p.uuid)}" novalidate autocomplete="off">
    ${formMsg()}
    ${me ? '' : `<p class="msg plain">PIN nuevo para <strong>${esc(fullName(p))}</strong>. Que lo escriba él o ella: el anterior deja de valer.</p>`}
    ${me ? field('PIN actual', pinInput('current')) : ''}
    ${field('PIN nuevo', pinInput('pin'), 'Entre 4 y 8 cifras.')}
    ${field('Repite el PIN nuevo', pinInput('pin2'))}
    <button class="btn block" type="submit">${me ? 'Cambiar mi PIN' : 'Asignar el PIN'}</button>
  </form>`;
}

Object.assign(FORMS, {
  async pharmacist(form) {
    const d = formData(form);
    const prev = form.dataset.id ? await getOne('pharmacist', form.dataset.id) : null;
    const me = prev && prev.uuid === state.profile.uuid;
    if (prev ? !(me || isAdmin()) : !isAdmin()) throw new InputError('Solo quien gestiona farmacéuticos puede hacerlo.');
    const r = readPharmacist(d);
    const all = await getAll('pharmacist');
    const twin = all.find((x) => x.active !== false && (!prev || x.uuid !== prev.uuid) && colegiadoKey(x.colegiado) === colegiadoKey(r.colegiado));
    if (twin) throw new InputError(`El nº de colegiado ${r.colegiado} ya es de ${fullName(twin)}.${twin.migrated || (prev && prev.migrated) ? ' Si es la misma persona con una ficha de otro equipo, da de baja la que sobre.' : ''}`);
    const admin = isAdmin() ? d.admin === 'on' : Boolean(prev && prev.admin);
    if (prev && prev.admin && !admin && activeAdmins(all).filter((x) => x.uuid !== prev.uuid).length === 0) throw new InputError('Tiene que quedar al menos un farmacéutico que gestione farmacéuticos.');
    let rec;
    if (prev) {
      rec = { ...prev, ...r, admin };
    } else {
      checkPinFormat(d.pin);
      if (d.pin !== d.pin2) throw new InputError('Los dos PIN no coinciden.');
      rec = { uuid: newId(), ...r, admin, active: true, ...(await pinFields(d.pin)) };
    }
    await save('pharmacist', rec, prev ? 'edicion_farmaceutico' : 'alta_farmaceutico', signatureOf(rec));
    if (me) state.profile = asProfile(rec);
    await loadPharmacists();
    toast(prev ? 'Ficha guardada.' : `${fullName(rec)} ya puede entrar con su PIN.`);
    location.hash = `#farmaceuticos--${rec.uuid}`;
  },

  async pharmacistPin(form) {
    const d = formData(form);
    const p = await getOne('pharmacist', form.dataset.id);
    if (!p) throw new InputError('Esta ficha no existe.');
    const me = p.uuid === state.profile.uuid;
    if (!me && !isAdmin()) throw new InputError('Solo quien gestiona farmacéuticos puede asignar un PIN.');
    if (me && !(await pinMatches(p, d.current))) throw new InputError('El PIN actual no es correcto.');
    checkPinFormat(d.pin);
    if (d.pin !== d.pin2) throw new InputError('Los dos PIN nuevos no coinciden.');
    const rec = { ...p, ...(await pinFields(d.pin)) };
    await save('pharmacist', rec, me ? 'cambio_pin' : 'pin_asignado', signatureOf(rec));
    if (me) state.profile = asProfile(rec);
    form.reset();
    toast(me ? 'PIN cambiado.' : `PIN nuevo asignado a ${fullName(rec)}.`);
    location.hash = `#farmaceuticos--${rec.uuid}`;
  },
});

Object.assign(ACTIONS, {
  pharmacistActive: async (el) => {
    if (!isAdmin()) return;
    const p = await getOne('pharmacist', el.dataset.id);
    if (!p || p.uuid === state.profile.uuid) return;
    const on = el.dataset.on === '1';
    if (!on && p.admin && activeAdmins(await getAll('pharmacist')).filter((x) => x.uuid !== p.uuid).length === 0) {
      await ask({ title: 'No se puede dar de baja', message: 'Tiene que quedar al menos un farmacéutico que gestione farmacéuticos.', confirmLabel: 'Entendido', cancelLabel: 'Cerrar' });
      return;
    }
    const ok = await ask({
      title: on ? 'Dar de alta' : 'Dar de baja',
      message: on ? `${fullName(p)} podrá volver a entrar con su PIN.` : `${fullName(p)} no podrá entrar en la app. Las firmas que ya hizo se conservan en los registros.`,
      confirmLabel: on ? 'Dar de alta' : 'Dar de baja', danger: !on,
    });
    if (!ok) return;
    const rec = { ...p, active: on, inactive_at: on ? null : nowIso() };
    await save('pharmacist', rec, on ? 'alta_farmaceutico_de_nuevo' : 'baja_farmaceutico', signatureOf(rec));
    await loadPharmacists();
    toast(on ? `${fullName(p)} vuelve a estar de alta.` : `${fullName(p)} dado de baja.`);
    await route();
  },
});

// Ficha propia incompleta (perfiles de versiones anteriores) y fichas repetidas (un perfil por equipo antes de la v0.3.32).
ALERT_SOURCES.push(async () => {
  if (!state.profile) return [];
  const out = [];
  const miss = missingOf(state.profile);
  if (miss.length) out.push({
    tone: 'amber', kind: 'Tu ficha de farmacéutico', title: missingText(miss),
    text: 'Complétala para que tus firmas en los registros lleven nombre, apellidos y nº de colegiado.',
    href: `#farmaceuticos--${state.profile.uuid}--editar`,
  });
  const seen = new Map();
  (await getAll('pharmacist')).filter((p) => p.active !== false).forEach((p) => {
    const k = fold(fullName(splitLegacyName(p)));
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(p);
  });
  [...seen.values()].filter((g) => g.length > 1).forEach((g) => out.push({
    tone: 'amber', kind: 'Ficha de farmacéutico repetida', title: fullName(g[0]),
    text: 'Puede venir de otro equipo (antes cada uno tenía su propio usuario). Quien gestiona farmacéuticos debe dar de baja la que sobre; esa persona entrará después con el PIN de la que queda.',
    href: '#farmaceuticos',
  }));
  return out;
});

Object.assign(ACTION_LABELS, {
  alta_farmaceutico: 'Alta de farmacéutico',
  edicion_farmaceutico: 'Ficha de farmacéutico modificada',
  pin_asignado: 'PIN nuevo asignado a un farmacéutico',
  baja_farmaceutico: 'Baja de farmacéutico',
  alta_farmaceutico_de_nuevo: 'Farmacéutico dado de alta de nuevo',
});
