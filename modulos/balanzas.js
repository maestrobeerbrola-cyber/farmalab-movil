'use strict';
/*
 * Balanzas. RD 175/2001 (2.2.4): los aparatos de medida, sobre todo las balanzas, se controlan y calibran
 * periódicamente y se conservan los resultados. PNT de pesada del Formulario Nacional (PN/L/OF/001/00):
 * balanza nivelada y 30 minutos de calentamiento (4.2 y 4.3), ajuste interno o externo según el fabricante
 * con la periodicidad que fije el responsable, y anexo II «Listado de balanzas».
 *
 * Store `balance`: ficha de cada balanza. Store `balance_check`: registro de calibraciones, internas
 * (las de la farmacia, con la pesa incorporada o con una pesa) y externas (empresa, certificado y próxima fecha).
 * Una calibración no conforme deja la balanza fuera de uso hasta que otra salga bien.
 */
const BAL_ADJUST = { interno: 'Interno (pesa incorporada, tecla CAL)', externo: 'Externo (con pesa de ajuste)' };
const BAL_KINDS = { interna: 'Calibración interna', externa: 'Calibración externa' };
const BAL_RESULTS = { conforme: 'Conforme', no_conforme: 'No conforme' };
const BAL_PRECHECKS = {
  level: ['Nivelada (burbuja en el centro)', 'N'],
  clean: ['Plato limpio y vacío', 'L'],
  warm: ['Encendida al menos 30 minutos', 'C'],
  draft: ['Sin corrientes de aire ni vibraciones', 'A'],
};
const BAL_DEFAULT_INTERVAL = 30;
const BAL_DEFAULT_EXT_YEARS = 2;
const BAL_EXT_WARNING_DAYS = 60;
const BAL_GENERIC = 'Balanza de precisión 1 mg';   // utillaje por defecto: se sustituye por las balanzas registradas
const FN_BAL_TITLE = 'Pesada';

const checkStamp = (c) => `${c.date}T${c.time || '00:00'}`;
// a igual fecha y hora (dos calibraciones en el mismo minuto), manda el orden en que se registraron
const byCheck = (a, b) => checkStamp(a).localeCompare(checkStamp(b)) || String(a.created_at || a.updated_at || '').localeCompare(String(b.created_at || b.updated_at || ''));
// addYears (conservacion.js) y addDays (elaborar.js) son comunes.
const fmtG = (n) => (isNum(n) ? `${n.toLocaleString('es-ES', { maximumFractionDigits: 4 })} g` : '—');
const weighRange = (b) => (isNum(b.max_g) ? (isNum(b.min_g) ? `${fmtG(b.min_g)} – ${fmtG(b.max_g)}` : `Hasta ${fmtG(b.max_g)}`) : '');
const makerModel = (b) => [b.maker, b.model].map(str).filter(Boolean).join(' ');
const ago = (days) => (days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`);
const weightDiffMg = (w) => (isNum(w.nominal) && isNum(w.reading) ? Math.round((w.reading - w.nominal) * 1e6) / 1e3 : null);
const fmtMg = (mg) => `${mg > 0 ? '+' : ''}${mg.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mg`;
const weightsText = (c) => (c.weights || []).filter((w) => isNum(w.nominal)).map((w) => `${fmtG(w.nominal)} → ${fmtG(w.reading)}${isNum(weightDiffMg(w)) ? ` (${fmtMg(weightDiffMg(w))})` : ''}`).join('; ');
const precheckLetters = (c) => Object.entries(BAL_PRECHECKS).filter(([k]) => c.prechecks && c.prechecks[k]).map(([, [, l]]) => l).join(', ');

/** Estado de una balanza a partir de su registro: fuera de uso, calibraciones pendientes o vencidas. */
function balanceState(b, checks) {
  const mine = checks.filter((c) => c.balance_uuid === b.uuid).sort(byCheck);
  const last = mine[mine.length - 1] || null;
  const lastOk = [...mine].reverse().find((c) => c.result === 'conforme') || null;
  const lastInternal = [...mine].reverse().find((c) => c.kind === 'interna') || null;
  const lastOkInternal = [...mine].reverse().find((c) => c.kind === 'interna' && c.result === 'conforme') || null;
  const lastExternal = [...mine].reverse().find((c) => c.kind === 'externa') || null;
  const interval = isNum(b.interval_days) && b.interval_days > 0 ? b.interval_days : BAL_DEFAULT_INTERVAL;
  const since = lastOk ? -daysUntil(lastOk.date) : null;
  const extDue = lastExternal && isDay(lastExternal.next_due) ? lastExternal.next_due : null;
  const extDays = extDue ? daysUntil(extDue) : null;
  const st = { mine, last, lastOk, lastInternal, lastOkInternal, lastExternal, interval, since, extDue, extDays };
  st.retired = b.active === false;
  st.out = Boolean(last && last.result === 'no_conforme');
  st.due = !lastOk || since > interval;
  st.nextInternal = lastOk ? addDays(lastOk.date, interval) : null;
  st.extOverdue = isNum(extDays) && extDays < 0;
  st.extSoon = isNum(extDays) && extDays >= 0 && extDays <= BAL_EXT_WARNING_DAYS;
  st.noExternal = !lastExternal;
  if (st.retired) Object.assign(st, { tone: '', label: 'Dada de baja' });
  else if (st.out) Object.assign(st, { tone: 'red', label: 'Fuera de uso' });
  else if (st.extOverdue) Object.assign(st, { tone: 'red', label: 'Calibración externa vencida' });
  else if (st.due) Object.assign(st, { tone: 'amber', label: 'Calibración pendiente' });
  else if (st.extSoon) Object.assign(st, { tone: 'amber', label: 'Calibración externa próxima' });
  else Object.assign(st, { tone: 'green', label: 'En uso' });
  return st;
}
const balPill = (st) => `<span class="pill ${st.tone}">${esc(st.label)}</span>`;
const resultPill = (c) => `<span class="pill ${c.result === 'conforme' ? 'green' : 'red'}">${esc(BAL_RESULTS[c.result] || '—')}</span>`;
/** Última calibración interna conforme; el plazo cuenta desde la última calibración conforme de cualquier tipo. */
function internalLine(st) {
  const c = st.lastOkInternal;
  const due = st.due && !st.retired ? ' <span class="warn">pendiente</span>' : '';
  if (!c) return `<span class="warn">Sin calibraciones internas registradas</span> · cada ${st.interval} días`;
  return `${fmtDay(c.date)} (${ago(-daysUntil(c.date))})${due} · cada ${st.interval} días`;
}
function externalLine(st) {
  const e = st.lastExternal;
  if (!e) return '<span class="warn">Sin registrar</span>';
  const next = st.extDue ? `próxima ${fmtDay(st.extDue)}${st.extOverdue ? ' <span class="bad">vencida</span>' : st.extSoon ? ` <span class="warn">en ${st.extDays} días</span>` : ''}` : '';
  return `${fmtDay(e.date)}${e.company ? ` (${esc(e.company)})` : ''}${next ? ` · ${next}` : ''}`;
}

ROUTES.balanzas = (arg, extra) => {
  if (arg === 'nueva') return viewBalanceForm(null);
  if (arg === 'cal') return viewBalanceCheck(extra);
  if (arg && extra === 'editar') return viewBalanceForm(arg);
  if (arg && (extra === 'interna' || extra === 'externa')) return viewBalanceCheckForm(arg, extra);
  if (arg) return viewBalance(arg);
  return viewBalances();
};
ROUTES.registrobal = () => viewBalanceRegister();

// ------------------------------------------------------------------ lista
async function viewBalances() {
  const all = (await getAll('balance')).sort(byText('name'));
  const checks = await getAll('balance_check');
  const active = all.filter((b) => b.active !== false);
  const retired = all.filter((b) => b.active === false);
  const card = (b) => {
    const st = balanceState(b, checks);
    return `<section class="temp-point"><div class="panel">
      <div class="head-row"><h2 class="big">${esc(b.name)}</h2>${balPill(st)}</div>
      <p class="hint">${esc([makerModel(b), b.serial ? `nº de serie ${b.serial}` : ''].filter(Boolean).join(' · '))}</p>
      ${st.out ? `<p class="msg error">La última calibración (${fmtDay(st.last.date)}) no fue conforme: no la uses hasta que una calibración salga bien.</p>` : ''}
      ${facts([['Calibración interna', internalLine(st)], ['Calibración externa', externalLine(st)]])}
      <p><a class="btn block" href="#balanzas--${esc(b.uuid)}--interna">Registrar calibración interna</a></p>
      <p class="more"><a href="#balanzas--${esc(b.uuid)}">Ficha y registro de calibraciones</a></p>
    </div></section>`;
  };
  return `${segmented(CONTROL_TABS, '#balanzas')}
    <p class="hint intro">RD 175/2001 (2.2.4): las balanzas se controlan y calibran periódicamente y se conservan los resultados. Registra cada calibración interna y cada calibración externa de la empresa, con su certificado.</p>
    ${active.length ? `<div class="temp-cards">${active.map(card).join('')}</div>` : empty('Aún no hay balanzas.', 'Añade la balanza del laboratorio con su modelo y su última calibración externa.')}
    ${retired.length ? `<details class="more-reading"><summary>Dadas de baja (${retired.length})</summary><ul class="list">${retired.map((b) => `<li><a class="row" href="#balanzas--${esc(b.uuid)}"><div class="row-main"><strong>${esc(b.name)}</strong><span class="sub"><span>${esc(makerModel(b))}</span></span></div><span class="pill">Dada de baja</span></a></li>`).join('')}</ul></details>` : ''}
    ${all.length ? `<p><a class="btn block secondary" href="#registrobal">${ICON.doc}Registro de balanzas en PDF</a></p>` : ''}
    ${fab('#balanzas--nueva', 'Nueva balanza')}`;
}

// ------------------------------------------------------------------ ficha de una balanza
async function viewBalance(id) {
  const b = await getOne('balance', id);
  if (!b) return empty('Esta balanza no existe.', '');
  const st = balanceState(b, await getAll('balance_check'));
  const list = [...st.mine].reverse();
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(b.name)}</h2>${balPill(st)}</div>
      ${st.out ? `<p class="msg error">La última calibración (${fmtDay(st.last.date)}) no fue conforme: no la uses hasta que una calibración salga bien.</p>` : ''}
      ${facts([
        ['Fabricante y modelo', esc(makerModel(b) || '—')],
        b.serial ? ['Nº de serie', esc(b.serial)] : null,
        b.location ? ['Ubicación', esc(b.location)] : null,
        ['Intervalo de pesada', esc(weighRange(b) || '—')],
        ['Legibilidad', esc(fmtG(b.d_g))],
        ['Ajuste', esc(b.adjust === 'externo' ? `Externo${b.ext_weight ? `, pesa de ${b.ext_weight}` : ''}` : BAL_ADJUST.interno)],
        isNum(b.tol_mg) ? ['Diferencia admitida con pesas', `± ${esc(b.tol_mg.toLocaleString('es-ES'))} mg`] : null,
        ['Calibración interna', internalLine(st)],
        st.nextInternal && !st.retired ? ['Próxima calibración interna', `${fmtDay(st.nextInternal)} como tarde`] : null,
        ['Calibración externa', externalLine(st)],
        b.notes ? ['Observaciones', esc(b.notes)] : null,
      ])}
    </div>
    ${st.retired ? '' : `<p><a class="btn block" href="#balanzas--${esc(b.uuid)}--interna">Registrar calibración interna</a></p>
    <p><a class="btn block secondary" href="#balanzas--${esc(b.uuid)}--externa">Registrar calibración externa (empresa)</a></p>`}
    <section><h2>Registro de calibraciones</h2>
      ${list.length ? `<ul class="list">${list.map((c) => `<li><a class="row" href="#balanzas--cal--${esc(c.uuid)}"><div class="row-main"><strong>${fmtDay(c.date)} ${esc(c.time || '')} · ${esc(BAL_KINDS[c.kind])}</strong><span class="sub">${c.kind === 'externa' ? `<span>${esc(c.company || '')}</span>${c.certificate ? `<span>Certificado ${esc(c.certificate)}</span>` : ''}` : `<span>${esc(c.by || '')}</span>`}${c.message ? `<span class="bad">${esc(c.message)}</span>` : ''}</span></div>${resultPill(c)}</a></li>`).join('')}</ul>`
        : '<p class="hint">Todavía no hay calibraciones registradas.</p>'}
      <p class="more"><a href="#registrobal">Registro en PDF</a></p>
    </section>
    ${await docsSection('balance', b.uuid, ['certificado', 'manual', 'otro'], 'Certificados de calibración y manual')}
    <p><a class="btn block secondary" href="#balanzas--${esc(b.uuid)}--editar">Editar la ficha</a></p>`;
}

// ------------------------------------------------------------------ alta y edición
async function viewBalanceForm(id) {
  const b = id ? await getOne('balance', id) : null;
  if (id && !b) return empty('Esta balanza no existe.', '');
  const v = b || { d_g: 0.001, adjust: 'interno', interval_days: BAL_DEFAULT_INTERVAL, ext_years: BAL_DEFAULT_EXT_YEARS, active: true };
  if (b) state.parent = `#balanzas--${b.uuid}`;
  const num = (name, value, unit, attrs = '') => `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="${name}" maxlength="10" value="${esc(inputNum(value))}" ${attrs}><span>${unit}</span></div>`;
  return `<form class="form" data-form="balance" ${b ? `data-id="${esc(b.uuid)}"` : ''} novalidate>
    ${formMsg()}
    <fieldset class="group"><legend>Identificación</legend>
      ${field('Nombre', text('name', `value="${esc(v.name || '')}" maxlength="80" placeholder="Balanza de precisión Sartorius…"`), 'Así aparecerá en el utillaje de las elaboraciones.')}
      <div class="grid2">
        ${field('Fabricante', text('maker', `value="${esc(v.maker || '')}" maxlength="60" placeholder="Sartorius"`))}
        ${field('Modelo', text('model', `value="${esc(v.model || '')}" maxlength="60" placeholder="Basic plus BP…"`))}
      </div>
      <div class="grid2">
        ${field('Nº de serie', text('serial', `value="${esc(v.serial || '')}" maxlength="60"`))}
        ${field('Ubicación', text('location', `value="${esc(v.location || '')}" maxlength="60" placeholder="Opcional"`))}
      </div>
    </fieldset>
    <fieldset class="group"><legend>Características</legend>
      <div class="grid3">
        ${field('Capacidad máxima', num('max_g', v.max_g, 'g'))}
        ${field('Peso mínimo', num('min_g', v.min_g, 'g', 'placeholder="Opcional"'))}
        ${field('Legibilidad', num('d_g', v.d_g, 'g'))}
      </div>
      ${field('Ajuste', `<select name="adjust">${options(Object.keys(BAL_ADJUST), v.adjust || 'interno', BAL_ADJUST)}</select>`, 'Los modelos con pesa incorporada se calibran solos al pulsar CAL con el plato vacío.')}
      ${field('Pesa de ajuste', text('ext_weight', `value="${esc(v.ext_weight || '')}" maxlength="60" placeholder="Solo si el ajuste es externo: 100 g, clase F1"`))}
    </fieldset>
    <fieldset class="group"><legend>Calibraciones</legend>
      <div class="grid2">
        ${field('Calibración interna cada', num('interval_days', v.interval_days, 'días'), 'Se avisa en Inicio al cumplirse sin registrar ninguna.')}
        ${field('Calibración externa cada', num('ext_years', v.ext_years, 'años'), 'Para proponer la próxima fecha.')}
      </div>
      ${field('Diferencia admitida al comprobar con pesas', num('tol_mg', v.tol_mg, '± mg', 'placeholder="Opcional"'), 'Solo si además compruebas la balanza con pesas patrón.')}
    </fieldset>
    ${b ? '' : `<fieldset class="group"><legend>Última calibración externa</legend>
      <p class="hint">La de la empresa, con su certificado. Puedes dejarlo para después.</p>
      <div class="grid2">
        ${field('Fecha', dateInput('ext_date', '', `max="${todayIso()}"`))}
        ${field('Próxima', dateInput('ext_next', ''), 'Se propone sola al poner la fecha.')}
      </div>
      <div class="grid2">
        ${field('Empresa', text('ext_company', 'maxlength="80"'))}
        ${field('Nº de certificado', text('ext_certificate', 'maxlength="60"'))}
      </div>
    </fieldset>`}
    ${field('Observaciones', `<textarea name="notes" maxlength="1000">${esc(v.notes || '')}</textarea>`)}
    ${b ? checkbox('retired', 'Dada de baja (ya no se usa). Su ficha y su registro se conservan.', b.active === false) : ''}
    <button class="btn block" type="submit">${b ? 'Guardar cambios' : 'Guardar la balanza'}</button>
  </form>`;
}
// Al poner la fecha de la calibración externa se propone la próxima (según los años indicados).
CHANGE_HOOKS.push((t) => {
  const form = t.form;
  if (!form || !['ext_date', 'date'].includes(t.name)) return;
  if (!(form.matches('form[data-form="balance"]') || form.matches('form[data-form="balanceCheck"][data-kind="externa"]'))) return;
  const next = form.elements[t.name === 'ext_date' ? 'ext_next' : 'next_due'];
  if (!next || !isDay(t.value) || (str(next.value) && next.dataset.auto !== '1')) return;
  let years = BAL_DEFAULT_EXT_YEARS;
  try { years = parseNum(form.elements.ext_years ? form.elements.ext_years.value : form.dataset.years, 'años') || BAL_DEFAULT_EXT_YEARS; } catch { /* se queda en el valor por defecto */ }
  next.value = addYears(t.value, Math.round(years));
  next.dataset.auto = '1';
});

// ------------------------------------------------------------------ registrar o corregir una calibración
function weightRows(c, tol) {
  const rows = [0, 1, 2].map((i) => {
    const w = (c.weights || [])[i] || {};
    const diff = weightDiffMg(w);
    const bad = isNum(diff) && isNum(tol) && Math.abs(diff) > tol;
    return `<div class="grid3 wrow">
      <div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="w_nominal" aria-label="Pesa ${i + 1}, valor nominal" placeholder="Pesa" maxlength="10" value="${esc(inputNum(w.nominal))}"><span>g</span></div>
      <div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="w_reading" aria-label="Pesa ${i + 1}, lectura" placeholder="Lectura" maxlength="10" value="${esc(inputNum(w.reading))}"><span>g</span></div>
      <span class="wdiff ${bad ? 'bad' : ''}" data-diff>${isNum(diff) ? esc(fmtMg(diff)) : ''}</span>
    </div>`;
  }).join('');
  return rows;
}
function checkFields(b, kind, c) {
  if (kind === 'externa') {
    return `<div class="grid2">
        ${field('Fecha de la calibración', dateInput('date', c.date || todayIso(), `max="${todayIso()}"`))}
        ${field('Próxima calibración', dateInput('next_due', c.next_due || addYears(c.date || todayIso(), Math.round(b.ext_years || BAL_DEFAULT_EXT_YEARS)), c.next_due ? '' : 'data-auto="1"'), 'Se propone según cada cuántos años se calibra.')}
      </div>
      <div class="grid2">
        ${field('Empresa', text('company', `value="${esc(c.company || '')}" maxlength="80"`))}
        ${field('Nº de certificado', text('certificate', `value="${esc(c.certificate || '')}" maxlength="60"`))}
      </div>
      <fieldset class="group"><legend>Resultado</legend><div class="checks">
        ${Object.entries(BAL_RESULTS).map(([k, l]) => `<label class="check"><input type="radio" name="result" value="${k}"${c.result === k ? ' checked' : ''}><span>${esc(l)}${k === 'conforme' ? ': apta para el uso' : ': no apta, queda fuera de uso'}</span></label>`).join('')}
      </div></fieldset>
      ${field('Observaciones', `<textarea name="note" maxlength="1000">${esc(c.note || '')}</textarea>`)}
      <p class="hint">Adjunta el certificado en la ficha de la balanza, en «Certificados de calibración y manual».</p>`;
  }
  const tol = isNum(c.tol_mg) ? c.tol_mg : b.tol_mg;
  const withWeights = (c.weights || []).some((w) => isNum(w.nominal));
  return `<div class="grid2">
      ${field('Fecha', dateInput('date', c.date || todayIso(), `max="${todayIso()}"`))}
      ${field('Hora', `<input type="time" name="time" value="${esc(c.time || nowTime())}">`)}
    </div>
    <fieldset class="group"><legend>Comprobaciones previas</legend><div class="checks">
      ${Object.entries(BAL_PRECHECKS).map(([k, [l]]) => checkbox(`pre_${k}`, esc(l), c.uuid ? Boolean(c.prechecks && c.prechecks[k]) : false)).join('')}
    </div></fieldset>
    <fieldset class="group"><legend>Resultado</legend><div class="checks">
      <label class="check"><input type="radio" name="result" value="conforme"${c.result === 'conforme' ? ' checked' : ''}><span>Conforme: termina la calibración y vuelve a cero</span></label>
      <label class="check"><input type="radio" name="result" value="no_conforme"${c.result === 'no_conforme' ? ' checked' : ''}><span>No conforme: da error o no vuelve a cero</span></label>
    </div>
    ${field('Mensaje de la balanza', text('message', `value="${esc(c.message || '')}" maxlength="80" placeholder="Si da error: Err 02…"`))}
    ${field('Medida tomada', `<textarea name="measures" maxlength="1000" placeholder="Si no es conforme: nivelar, limpiar, repetir, avisar al servicio técnico…">${esc(c.measures || '')}</textarea>`)}
    </fieldset>
    <details class="more-reading"${withWeights ? ' open' : ''}><summary>Comprobación con pesas (opcional)</summary>
      <p class="hint">Pesa, lectura de la balanza y diferencia. Se marca en rojo si supera la diferencia admitida.</p>
      ${field('Diferencia admitida', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="tol_mg" maxlength="8" value="${esc(inputNum(tol))}"><span>± mg</span></div>`)}
      <div class="wrows">${weightRows(c, tol)}</div>
    </details>
    ${field('Observaciones', text('note', `value="${esc(c.note || '')}" maxlength="200" placeholder="Opcional"`))}`;
}
function procedureHint(b) {
  return b.adjust === 'externo'
    ? `PN/L/OF/001/00 (4.2 y 4.3): balanza nivelada y encendida 30 minutos antes. Con el plato vacío, pon a cero, pulsa CAL y coloca la pesa${b.ext_weight ? ` de ${esc(b.ext_weight)}` : ''} cuando la pida.`
    : 'PN/L/OF/001/00 (4.2 y 4.3): balanza nivelada y encendida 30 minutos antes. Con el plato vacío, pon a cero y pulsa CAL: la balanza coloca su pesa interna y vuelve a cero.';
}
async function viewBalanceCheckForm(balanceId, kind) {
  const b = await getOne('balance', balanceId);
  if (!b) return empty('Esta balanza no existe.', '');
  state.parent = `#balanzas--${b.uuid}`;
  return `<div class="panel stack"><h2 class="big">${esc(BAL_KINDS[kind])}</h2>
      <p>${esc(b.name)}${makerModel(b) ? ` · ${esc(makerModel(b))}` : ''}</p>
      <p class="hint">${kind === 'externa' ? 'La que hace la empresa de calibración, con su certificado.' : procedureHint(b)}</p></div>
    <form class="form" data-form="balanceCheck" data-balance="${esc(b.uuid)}" data-kind="${kind}" data-years="${esc(String(b.ext_years || BAL_DEFAULT_EXT_YEARS))}" novalidate>
      ${formMsg()}
      ${checkFields(b, kind, {})}
      <p class="hint">Firma: ${esc(state.profile.name)}.</p>
      <button class="btn block" type="submit">Registrar la calibración</button>
    </form>`;
}
async function viewBalanceCheck(id) {
  const c = await getOne('balance_check', id);
  if (!c) return empty('Este registro no existe.', '');
  const b = (await getOne('balance', c.balance_uuid)) || { uuid: c.balance_uuid, name: c.balance_name };
  state.parent = `#balanzas--${b.uuid}`;
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(BAL_KINDS[c.kind])}</h2>${resultPill(c)}</div>
      ${facts([
        ['Balanza', `<a href="#balanzas--${esc(b.uuid)}">${esc(b.name || c.balance_name)}</a>`],
        ['Fecha', `${fmtDay(c.date)} ${esc(c.time || '')}`],
        c.kind === 'externa' ? ['Empresa', esc(c.company || '—')] : null,
        c.kind === 'externa' ? ['Nº de certificado', esc(c.certificate || '—')] : null,
        c.kind === 'externa' ? ['Próxima calibración', fmtDay(c.next_due)] : null,
        c.kind === 'interna' ? ['Comprobaciones previas', esc(Object.entries(BAL_PRECHECKS).filter(([k]) => c.prechecks && c.prechecks[k]).map(([, [l]]) => l).join(' · ') || 'Ninguna marcada')] : null,
        c.message ? ['Mensaje de la balanza', esc(c.message)] : null,
        c.measures ? ['Medida tomada', esc(c.measures)] : null,
        weightsText(c) ? ['Comprobación con pesas', `${esc(weightsText(c))}${isNum(c.tol_mg) ? ` · admitido ± ${esc(c.tol_mg.toLocaleString('es-ES'))} mg` : ''}`] : null,
        c.note ? ['Observaciones', esc(c.note)] : null,
        ['Registrada por', esc(c.by || '—')],
        c.edited_by ? ['Corregida por', esc(c.edited_by)] : null,
      ])}
    </div>
    <section><h2>Corregir el registro</h2>
    <form class="form" data-form="balanceCheck" data-id="${esc(c.uuid)}" data-balance="${esc(c.balance_uuid)}" data-kind="${esc(c.kind)}" data-years="${esc(String(b.ext_years || BAL_DEFAULT_EXT_YEARS))}" novalidate>
      ${formMsg()}
      ${checkFields(b, c.kind, c)}
      <button class="btn block" type="submit">Guardar la corrección</button>
      <p class="hint">La corrección queda en el registro de actividad con los valores anteriores.</p>
    </form></section>`;
}
// Diferencia de cada pesa mientras se escribe.
INPUT_HOOKS.push((t) => {
  if (!t.matches('.wrow input')) return;
  const form = t.form;
  const row = t.closest('.wrow');
  const out = $('[data-diff]', row);
  let nominal = null; let reading = null; let tol = null;
  try { nominal = parseNum($('[name="w_nominal"]', row).value, 'Pesa'); reading = parseNum($('[name="w_reading"]', row).value, 'Lectura'); tol = parseNum(form.elements.tol_mg.value, 'Diferencia'); } catch { out.textContent = ''; return; }
  const diff = weightDiffMg({ nominal, reading });
  out.textContent = isNum(diff) ? fmtMg(diff) : '';
  out.classList.toggle('bad', isNum(diff) && isNum(tol) && Math.abs(diff) > tol);
});

// ------------------------------------------------------------------ registro en PDF
async function viewBalanceRegister() {
  const balances = (await getAll('balance')).sort(byText('name'));
  const checks = await getAll('balance_check');
  const s = await loadSettings();
  state.parent = '#balanzas';
  state.label = null;
  const year = todayIso().slice(0, 4);
  const years = [...new Set([year, ...checks.map((c) => c.date.slice(0, 4))])].sort().reverse();
  return `<div class="panel stack">
      <h2 class="big">Registro de balanzas</h2>
      <p>${esc(s.fn.bal_code)} del Formulario Nacional («Pesada»): listado de balanzas (anexo II) y registro de las calibraciones internas y externas de cada una, por año.</p>
      <p class="hint">Sin calibraciones, sale la hoja en blanco para rellenarla a mano.</p>
    </div>
    <form class="form" data-form="balanceRegisterPdf" novalidate>
      ${formMsg()}
      ${field('Año', `<select name="year">${options(years, year)}</select>`)}
      ${balances.length ? `<fieldset class="group"><legend>Balanzas</legend>
        ${balances.map((b) => checkbox('balances', `${esc(b.name)}${b.active === false ? ' <span class="hint">(dada de baja)</span>' : ''}`, b.active !== false, `value="${esc(b.uuid)}"`)).join('')}
      </fieldset>` : ''}
      ${checkbox('listing', 'Listado de balanzas (anexo II)', true)}
      ${checkbox('log', 'Registro de calibraciones', true)}
      <button class="btn block" type="submit">Generar el registro</button>
    </form>
    <div id="sheetOut"></div>`;
}
/** Filas en blanco al final, para seguir anotando a mano en la hoja impresa. */
const padRows = (rows, cols, min) => [...rows, ...Array.from({ length: Math.max(0, min - rows.length) }, () => Array(cols).fill(''))];
async function buildBalanceRegisterPdf({ year, balances, checks, listing, log, s }) {
  const sh = await createFnSheet({ code: s.fn.bal_code, related: s.fn.bal_related, procTitle: FN_BAL_TITLE, pharmacy: s.pharmacy, subject: `Registro de balanzas · ${year}` });
  if (listing) {
    sh.heading('ANEXO II', 'Listado de balanzas');
    sh.table([{ title: 'Balanza', w: 0.34 }, { title: 'Fabricante', w: 0.2 }, { title: 'Modelo', w: 0.2 }, { title: 'Intervalo de pesada', w: 0.26 }],
      padRows(balances.map((b) => [`${b.name}${b.serial ? ` (nº de serie ${b.serial})` : ''}${b.active === false ? ' (dada de baja)' : ''}`, b.maker || '', b.model || '', [weighRange(b), isNum(b.d_g) ? `d = ${fmtG(b.d_g)}` : ''].filter(Boolean).join(' · ')]), 4, 4));
  }
  if (log) {
    const list = balances.length ? balances : [{ uuid: '', name: '' }];
    list.forEach((b, i) => {
      if (listing || i) sh.newPage();
      const st = balanceState(b, checks);
      sh.heading('REGISTRO', `Calibraciones de la balanza · ${year}`);
      const L = (from, to, label) => ({ from, to, label });
      const V = (from, to, value) => ({ from, to, value: str(value) || '' });
      const ext = st.lastExternal;
      sh.form([
        { h: 20, cells: [L(0, 0.18, 'Balanza'), { ...V(0.18, 1, b.name), strong: true }] },
        { h: 18, cells: [L(0, 0.18, 'Fabricante y modelo'), V(0.18, 0.5, makerModel(b)), L(0.5, 0.68, 'Nº de serie'), V(0.68, 1, b.serial)] },
        { h: 18, cells: [L(0, 0.18, 'Ajuste'), V(0.18, 0.5, b.uuid ? (b.adjust === 'externo' ? `Externo${b.ext_weight ? `, pesa de ${b.ext_weight}` : ''}` : 'Interno (pesa incorporada)') : ''), L(0.5, 0.68, 'Calibración interna'), V(0.68, 1, b.uuid ? `Cada ${st.interval} días` : '')] },
        { h: 18, cells: [L(0, 0.18, 'Calibración externa'), V(0.18, 0.5, ext ? `${fmtDay(ext.date)}${ext.company ? `, ${ext.company}` : ''}${ext.certificate ? `, cert. ${ext.certificate}` : ''}` : ''), L(0.5, 0.68, 'Próxima'), V(0.68, 1, ext ? fmtDay(ext.next_due) : '')] },
      ], { gap: 7 });
      const rows = checks.filter((c) => c.balance_uuid === b.uuid && c.date.slice(0, 4) === year).sort(byCheck).map((c) => [
        fmtDay(c.date), c.time || '', c.kind === 'externa' ? 'Externa' : 'Interna',
        c.kind === 'externa' ? '' : precheckLetters(c),
        BAL_RESULTS[c.result] || '',
        [c.kind === 'externa' ? [c.company, c.certificate ? `cert. ${c.certificate}` : '', isDay(c.next_due) ? `próxima ${fmtDay(c.next_due)}` : ''].filter(Boolean).join(', ') : '',
          c.message, c.measures, weightsText(c) ? `Pesas: ${weightsText(c)}` : '', c.note].filter(Boolean).join('. '),
        c.by || '',
      ]);
      sh.table([
        { title: 'Fecha', w: 0.12 }, { title: 'Hora', w: 0.07 }, { title: 'Tipo', w: 0.09 }, { title: 'Comprob. previas', w: 0.12 },
        { title: 'Resultado', w: 0.13 }, { title: 'Observaciones / medida tomada', w: 0.32 }, { title: 'Firma', w: 0.15 },
      ], padRows(rows, 7, rows.length < 14 ? 14 : rows.length + 4), { note: 'Comprobaciones previas: N nivelada · L plato limpio y vacío · C encendida 30 min · A sin corrientes de aire ni vibraciones' });
    });
  }
  return sh.finish();
}

// ------------------------------------------------------------------ guardar
Object.assign(FORMS, {
  async balance(form) {
    const prev = form.dataset.id ? await getOne('balance', form.dataset.id) : null;
    if (form.dataset.id && !prev) throw new InputError('Esta balanza ya no existe.');
    const d = formData(form);
    const name = str(d.name).slice(0, 80);
    if (!name) throw new InputError('Escribe el nombre de la balanza.');
    const others = (await getAll('balance')).filter((b) => !prev || b.uuid !== prev.uuid);
    if (others.some((b) => fold(b.name) === fold(name))) throw new InputError(`Ya hay una balanza llamada ${name}.`);
    const maxG = parseNum(d.max_g, 'Capacidad máxima');
    const minG = parseNum(d.min_g, 'Peso mínimo');
    const dG = parseNum(d.d_g, 'Legibilidad');
    const interval = parseNum(d.interval_days, 'Calibración interna cada');
    const years = parseNum(d.ext_years, 'Calibración externa cada');
    const tol = parseNum(d.tol_mg, 'Diferencia admitida');
    if (!str(d.maker) || !str(d.model)) throw new InputError('Indica el fabricante y el modelo.');
    if (!isNum(maxG) || maxG <= 0) throw new InputError('Indica la capacidad máxima en gramos.');
    if (isNum(minG) && minG >= maxG) throw new InputError('El peso mínimo tiene que ser menor que la capacidad máxima.');
    if (!isNum(dG) || dG <= 0 || dG > 1) throw new InputError('Indica la legibilidad en gramos (0,001 para 1 mg).');
    if (!isNum(interval) || interval < 1 || interval > 366) throw new InputError('Indica cada cuántos días haces la calibración interna (de 1 a 366).');
    if (isNum(years) && (years < 1 || years > 10)) throw new InputError('La calibración externa: entre 1 y 10 años.');
    const rec = {
      ...(prev || { uuid: newId(), created_by: state.profile.name }),
      name, maker: str(d.maker).slice(0, 60), model: str(d.model).slice(0, 60), serial: str(d.serial).slice(0, 60), location: str(d.location).slice(0, 60),
      max_g: maxG, min_g: minG, d_g: dG, adjust: BAL_ADJUST[d.adjust] ? d.adjust : 'interno', ext_weight: str(d.ext_weight).slice(0, 60),
      interval_days: Math.round(interval), ext_years: isNum(years) ? years : BAL_DEFAULT_EXT_YEARS, tol_mg: tol,
      notes: str(d.notes).slice(0, 1000), active: prev ? !d.retired : true,
    };
    const entries = [['balance', rec]];
    let extNote = '';
    if (!prev && str(d.ext_date)) {
      if (!isDay(d.ext_date)) throw new InputError('Revisa la fecha de la última calibración externa.');
      if (d.ext_date > todayIso()) throw new InputError('La fecha de la calibración externa no puede ser posterior a hoy.');
      if (str(d.ext_next) && (!isDay(d.ext_next) || d.ext_next <= d.ext_date)) throw new InputError('La próxima calibración externa tiene que ser posterior a la última.');
      entries.push(['balance_check', {
        uuid: newId(), balance_uuid: rec.uuid, balance_name: rec.name, kind: 'externa', date: d.ext_date, time: '', by: state.profile.name,
        company: str(d.ext_company).slice(0, 80), certificate: str(d.ext_certificate).slice(0, 60),
        next_due: isDay(d.ext_next) ? d.ext_next : addYears(d.ext_date, Math.round(rec.ext_years)), result: 'conforme', note: '',
      }]);
      extNote = `; calibración externa ${fmtDay(d.ext_date)}`;
    }
    const action = !prev ? 'alta_balanza' : (prev.active !== false && !rec.active) ? 'baja_balanza' : 'edicion_balanza';
    await saveMany(entries, action, `${rec.name} (${makerModel(rec)}${rec.serial ? `, nº ${rec.serial}` : ''})${extNote}`);
    toast(prev ? 'Cambios guardados.' : 'Balanza guardada.');
    location.hash = `#balanzas--${rec.uuid}`;
  },

  async balanceCheck(form) {
    const prev = form.dataset.id ? await getOne('balance_check', form.dataset.id) : null;
    if (form.dataset.id && !prev) throw new InputError('Este registro ya no existe.');
    const b = await getOne('balance', form.dataset.balance);
    if (!b && !prev) throw new InputError('Esta balanza ya no existe.');
    const kind = form.dataset.kind === 'externa' ? 'externa' : 'interna';
    const d = formData(form);
    if (!isDay(d.date)) throw new InputError('Indica la fecha.');
    if (d.date > todayIso()) throw new InputError('La fecha no puede ser posterior a hoy.');
    if (!BAL_RESULTS[d.result]) throw new InputError('Indica el resultado: conforme o no conforme.');
    const rec = {
      ...(prev || { uuid: newId(), by: state.profile.name }),
      balance_uuid: b ? b.uuid : prev.balance_uuid, balance_name: b ? b.name : prev.balance_name, kind, date: d.date, result: d.result,
      note: str(d.note).slice(0, kind === 'externa' ? 1000 : 200),
    };
    if (kind === 'externa') {
      if (!str(d.company)) throw new InputError('Indica la empresa que ha hecho la calibración.');
      if (!isDay(d.next_due) || d.next_due <= d.date) throw new InputError('Indica la fecha de la próxima calibración (posterior a esta).');
      Object.assign(rec, { time: '', company: str(d.company).slice(0, 80), certificate: str(d.certificate).slice(0, 60), next_due: d.next_due });
    } else {
      if (!/^\d{2}:\d{2}$/.test(str(d.time))) throw new InputError('Indica la hora.');
      const all = new FormData(form);
      const noms = all.getAll('w_nominal'); const reads = all.getAll('w_reading');
      const tol = parseNum(d.tol_mg, 'Diferencia admitida');
      const weights = [];
      noms.forEach((n, i) => {
        const nominal = parseNum(n, `Pesa ${i + 1}`);
        const reading = parseNum(reads[i], `Lectura de la pesa ${i + 1}`);
        if (!isNum(nominal) && !isNum(reading)) return;
        if (!isNum(nominal) || !isNum(reading)) throw new InputError(`Pesa ${i + 1}: escribe la pesa y lo que marca la balanza.`);
        weights.push({ nominal, reading });
      });
      if (weights.length && !isNum(tol)) throw new InputError('Indica la diferencia admitida para la comprobación con pesas.');
      const outW = weights.filter((w) => Math.abs(weightDiffMg(w)) > tol);
      if (outW.length && d.result === 'conforme') {
        throw new InputError(`La pesa de ${fmtG(outW[0].nominal)} se desvía ${fmtMg(weightDiffMg(outW[0]))} (admitido ± ${tol.toLocaleString('es-ES')} mg): el resultado no es conforme.`);
      }
      if (d.result === 'no_conforme' && !str(d.measures)) throw new InputError('Si no es conforme, anota la medida tomada.');
      Object.assign(rec, {
        time: str(d.time), prechecks: Object.fromEntries(Object.keys(BAL_PRECHECKS).map((k) => [k, Boolean(d[`pre_${k}`])])),
        message: str(d.message).slice(0, 80), measures: str(d.measures).slice(0, 1000), weights, tol_mg: weights.length ? tol : null,
      });
    }
    if (prev) rec.edited_by = state.profile.name;
    const describe = (c) => `${c.balance_name} ${fmtDay(c.date)}${c.time ? ` ${c.time}` : ''}: ${BAL_KINDS[c.kind].toLowerCase()} ${BAL_RESULTS[c.result].toLowerCase()}${c.message ? ` (${c.message})` : ''}`;
    const action = prev ? 'edicion_calibracion_balanza' : kind === 'externa' ? 'calibracion_externa_balanza' : 'calibracion_interna_balanza';
    await save('balance_check', rec, action, prev ? `${describe(rec)}. Antes: ${describe(prev)}` : describe(rec));
    if (rec.result === 'no_conforme') {
      await ask({
        title: 'Balanza fuera de uso',
        message: `${rec.balance_name} queda fuera de uso hasta que una calibración salga bien. Revisa que esté nivelada, limpia y encendida al menos 30 minutos, y repite la calibración. Si sigue fallando, avisa al servicio técnico.`,
        confirmLabel: 'Entendido', cancelLabel: 'Cerrar', danger: true,
      });
    } else {
      toast(prev ? 'Registro corregido.' : kind === 'externa' ? 'Calibración externa registrada. Adjunta el certificado en la ficha.' : 'Calibración registrada.');
    }
    location.hash = `#balanzas--${rec.balance_uuid}`;
  },

  async balanceRegisterPdf(form) {
    const s = await loadSettings();
    const all = new FormData(form);
    const year = str(all.get('year'));
    if (!/^\d{4}$/.test(year)) throw new InputError('Elige el año.');
    const ids = all.getAll('balances');
    const balances = (await getAll('balance')).filter((b) => ids.includes(b.uuid)).sort(byText('name'));
    const listing = all.get('listing') === 'on';
    const log = all.get('log') === 'on';
    if (!listing && !log) throw new InputError('Elige el listado, el registro de calibraciones o los dos.');
    const checks = await getAll('balance_check');
    const n = checks.filter((c) => ids.includes(c.balance_uuid) && c.date.slice(0, 4) === year).length;
    const blob = await buildBalanceRegisterPdf({ year, balances, checks, listing, log, s });
    await logOnly('registro_balanzas_generado', `${year}: ${balances.length} ${balances.length === 1 ? 'balanza' : 'balanzas'}, ${n} ${n === 1 ? 'calibración' : 'calibraciones'}`);
    await showSheet(blob, `registro-balanzas-${year}.pdf`, 'Registro listo');
  },
});

NEEDED.balance = { goal: 'guardar la balanza', fields: () => ['name', 'maker', 'model', 'max_g', 'd_g', 'interval_days'] };
NEEDED.balanceCheck = {
  goal: 'registrar la calibración', legend: false,
  fields: (form) => (form.dataset.kind === 'externa' ? ['date', 'next_due', 'company', 'result'] : ['date', 'time', 'result']),
};

// ------------------------------------------------------------------ guía de elaboración y ficha 2
/** Balanzas en uso para el utillaje de la guía (sustituyen a la «Balanza de precisión 1 mg» genérica). */
async function balanceEquipment(list) {
  const active = (await getAll('balance')).filter((b) => b.active !== false).sort(byText('name'));
  if (!active.length) return list;
  return [...active.map((b) => b.name), ...list.filter((e) => e !== BAL_GENERIC)];
}
/** Estado de las balanzas bajo el utillaje de la guía. */
async function balanceGuideNotes() {
  const active = (await getAll('balance')).filter((b) => b.active !== false).sort(byText('name'));
  if (!active.length) return '';
  const checks = await getAll('balance_check');
  return active.map((b) => {
    const st = balanceState(b, checks);
    if (st.out) return `<p class="msg error">${esc(b.name)}: fuera de uso (la última calibración, del ${fmtDay(st.last.date)}, no fue conforme). <a href="#balanzas--${esc(b.uuid)}">Ver</a></p>`;
    if (st.due) return `<p class="msg warn">${esc(b.name)}: calibración interna pendiente${st.lastOk ? ` (la última, ${ago(st.since)})` : ''}. <a href="#balanzas--${esc(b.uuid)}--interna">Registrarla</a></p>`;
    if (st.extOverdue) return `<p class="msg error">${esc(b.name)}: calibración externa vencida el ${fmtDay(st.extDue)}.</p>`;
    return `<p class="hint">${esc(b.name)}: calibrada el ${fmtDay(st.lastOk.date)} (${ago(st.since)}).</p>`;
  }).join('');
}
/** Utillaje de la ficha 2: a cada balanza registrada se le añade su última calibración conforme hasta la fecha de elaboración. */
async function balanceEquipmentText(names, dateIso) {
  const balances = await getAll('balance');
  if (!balances.length) return names.join(', ');
  const checks = await getAll('balance_check');
  const until = isDay(dateIso) ? dateIso : todayIso();
  return names.map((n) => {
    const b = balances.find((x) => fold(x.name) === fold(n));
    if (!b) return n;
    const ok = checks.filter((c) => c.balance_uuid === b.uuid && c.result === 'conforme' && c.date <= until).sort(byCheck).pop();
    return ok ? `${n} (calibrada el ${fmtDay(ok.date)})` : n;
  }).join(', ');
}

// ------------------------------------------------------------------ Inicio, pestaña y avisos
/** Tono de las balanzas para el punto de la pestaña Controles. */
async function balanceTabTone() {
  const checks = await getAll('balance_check');
  const states = (await getAll('balance')).filter((b) => b.active !== false).map((b) => balanceState(b, checks));
  return states.some((s) => s.tone === 'red') ? 'red' : states.some((s) => s.tone === 'amber') ? 'amber' : '';
}
ALERT_SOURCES.push(async () => {
  const checks = await getAll('balance_check');
  const out = [];
  (await getAll('balance')).filter((b) => b.active !== false).sort(byText('name')).forEach((b) => {
    const st = balanceState(b, checks);
    if (st.out) out.push({ tone: 'red', kind: 'Balanza', title: `${b.name}: fuera de uso`, text: `La calibración del ${fmtDay(st.last.date)} no fue conforme. No la uses hasta que una calibración salga bien.`, href: `#balanzas--${b.uuid}` });
    else if (st.due) out.push({ tone: 'amber', kind: 'Balanza', title: `${b.name}: calibración interna pendiente`, text: st.lastOk ? `La última calibración fue el ${fmtDay(st.lastOk.date)} (${ago(st.since)}; cada ${st.interval} días).` : 'No hay ninguna calibración registrada.', href: `#balanzas--${b.uuid}--interna` });
    if (st.extOverdue) out.push({ tone: 'red', kind: 'Balanza', title: `${b.name}: calibración externa vencida`, text: `Tocaba el ${fmtDay(st.extDue)}. Avisa a la empresa de calibración.`, href: `#balanzas--${b.uuid}` });
    else if (st.extSoon) out.push({ tone: 'amber', kind: 'Balanza', title: `${b.name}: calibración externa el ${fmtDay(st.extDue)}`, text: `Quedan ${st.extDays} días: pide cita a la empresa.`, href: `#balanzas--${b.uuid}` });
    else if (st.noExternal) out.push({ tone: 'amber', kind: 'Balanza', title: `${b.name}: sin calibración externa registrada`, text: 'Registra la última calibración de la empresa y adjunta su certificado.', href: `#balanzas--${b.uuid}--externa` });
  });
  return out;
});

Object.assign(ACTION_LABELS, {
  alta_balanza: 'Alta de balanza',
  edicion_balanza: 'Balanza modificada',
  baja_balanza: 'Baja de balanza',
  calibracion_interna_balanza: 'Calibración interna de balanza',
  calibracion_externa_balanza: 'Calibración externa de balanza',
  edicion_calibracion_balanza: 'Registro de calibración corregido',
  registro_balanzas_generado: 'Registro de balanzas generado',
});
