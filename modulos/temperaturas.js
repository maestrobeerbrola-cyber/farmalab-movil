/* FARMA·LAB · Control y registro de temperaturas, según el PN/L/PG/009/00 del Formulario Nacional.
   Lecturas diarias (actual, máxima y mínima) del local y de la nevera, incidencias cuando se salen del rango
   y los registros en PDF: anexo II a) y b) (local), anexo III (nevera) y anexo IV (incidencias). */

const TEMP_KINDS = { local: 'Local', nevera: 'Nevera' };
const FN_TEMP_TITLE = 'Control y registro de temperaturas';
// Escala de las rejillas del modelo: 10–35 ºC para el local (rango 20–30) y 0–11 ºC para la nevera (rango 2–8).
const TEMP_SCALE = { local: { below: 10, count: 26 }, nevera: { below: 2, count: 12 } };
const TEMP_DECISIONS = { acepta: 'Se acepta', rechaza: 'Se rechaza' };
// Conservación en frío escrita en la ficha de una materia prima o de una fórmula.
const FRIDGE_RE = /nevera|frigor|refrig|\b2\s*(?:-|–|a|y)\s*8\b|5\s*±\s*3/i;

const fmtT = (n) => (isNum(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—');
const tempRange = (r) => `${fmtT(r.min ?? r.range_min)}–${fmtT(r.max ?? r.range_max)} ºC`;
const pointRange = (p) => `${fmtT(p.min)}–${fmtT(p.max)} ºC`;
const readingRange = (r) => `${fmtT(r.range_min)}–${fmtT(r.range_max)} ºC`;
const readingStamp = (r) => `${r.date}T${r.time || '00:00'}`;
const readingMs = (r) => Date.parse(`${readingStamp(r)}:00`);
const byReading = (a, b) => readingStamp(a).localeCompare(readingStamp(b));
const nowTime = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const monthKeyOf = (ymd) => String(ymd || '').slice(0, 7);
const isMonthKey = (k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(k || ''));
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); };
const shiftMonth = (key, delta) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const initials = (name) => str(name).split(/\s+/).filter(Boolean).map((w) => w[0].toLocaleUpperCase('es')).join('').slice(0, 3);
const isOut = (r, v) => isNum(v) && (v < r.range_min || v > r.range_max);
const outOfRange = (r) => [r.actual, r.max, r.min].some((v) => isOut(r, v));
const describeReading = (r) => `${fmtT(r.actual)} ºC${isNum(r.max) ? ` · máx. ${fmtT(r.max)}` : ''}${isNum(r.min) ? ` · mín. ${fmtT(r.min)}` : ''}`;
const annexTitle = (p) => `${p.kind === 'local' ? 'Control de temperatura del local' : 'Control de temperatura de la nevera'}${fold(p.name) === fold(TEMP_KINDS[p.kind]) ? '' : ` (${p.name})`}`;

/** Temperatura escrita: admite signo menos, coma o punto y como mucho un decimal útil. */
function parseTemp(value, label) {
  const raw = str(value).replace(/\s/g, '').replace('−', '-');
  if (!raw) return null;
  if (!/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(raw)) throw new InputError(`${label}: «${raw}» no es una temperatura válida.`);
  const n = Math.round(Number(raw.replace(',', '.')) * 10) / 10;
  if (n < -50 || n > 70) throw new InputError(`${label}: ${fmtT(n)} ºC no parece una lectura posible.`);
  return n;
}
/** Lectura anterior del mismo punto (para calcular las horas de exposición). */
function previousReading(list, r) {
  return list.filter((x) => x.point_id === r.point_id && x.uuid !== r.uuid && readingStamp(x) < readingStamp(r)).sort(byReading).pop() || null;
}
/** Lo que ha superado el rango, para la descripción de la incidencia. */
function reachedText(r) {
  const parts = [];
  if (isOut(r, r.actual)) parts.push(`${fmtT(r.actual)} ºC (actual)`);
  if (isOut(r, r.max) && r.max !== r.actual) parts.push(`${fmtT(r.max)} ºC (máxima)`);
  if (isOut(r, r.min) && r.min !== r.actual) parts.push(`${fmtT(r.min)} ºC (mínima)`);
  return parts.length ? `${parts.join(' y ')}; rango ${readingRange(r)}` : '';
}
function incidentMissing(i) {
  const miss = [];
  if (!str(i.temp_reached)) miss.push('temperatura alcanzada');
  if (!isNum(i.hours)) miss.push('número de horas expuestos');
  if (!str(i.products)) miss.push('productos afectados');
  if (!str(i.causes)) miss.push('análisis de las causas');
  if (!str(i.evaluation)) miss.push('evaluación de la incidencia');
  if (!TEMP_DECISIONS[i.decision]) miss.push('tratamiento (se acepta o se rechaza)');
  if (!isDay(i.decision_date)) miss.push('fecha');
  return miss;
}

ROUTES.temperaturas = (arg, extra) => {
  if (arg === 'lectura') return viewTempReading(extra);
  if (arg === 'incidencias') return viewTempIncidents();
  if (arg === 'incidencia') return viewTempIncident(extra, null);
  if (arg === 'nueva-incidencia') return viewTempIncident(null, extra);
  if (arg === 'puntos') return viewTempPoints();
  return viewTemperatures(arg === 'mes' && isMonthKey(extra) ? extra : monthKeyOf(todayIso()));
};
ROUTES.registrotemp = () => viewTempRegister();

// ------------------------------------------------------------------ pantalla principal
function readingForm(point, last) {
  const gap = last && last.date < todayIso() ? daysUntil(last.date) * -1 : 0;
  return `<form class="form temp-form" data-form="tempReading" data-point="${esc(point.id)}" novalidate>
    ${formMsg()}
    ${gap > 1 ? `<p class="hint">Última lectura: ${fmtDay(last.date)} (hace ${gap} días). Anota la máxima y la mínima alcanzadas desde entonces.</p>` : ''}
    <div class="grid2">
      ${field('Fecha', dateInput('date', todayIso(), `max="${todayIso()}"`))}
      ${field('Hora', `<input type="time" name="time" value="${nowTime()}">`)}
    </div>
    <div class="grid3">
      ${field('Actual', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="actual" maxlength="6"><span>ºC</span></div>`)}
      ${field('Máxima', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="max" maxlength="6"><span>ºC</span></div>`)}
      ${field('Mínima', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="min" maxlength="6"><span>ºC</span></div>`)}
    </div>
    ${field('Observaciones', text('note', 'maxlength="200" placeholder="Opcional"'))}
    <button class="btn block" type="submit">Registrar lectura</button>
  </form>`;
}
function readingLine(r, { link = true, withPoint = false } = {}) {
  const out = outOfRange(r);
  const body = `<div class="row-main"><strong>${withPoint ? `${esc(r.point_name)} · ` : ''}${fmtDay(r.date)} ${esc(r.time || '')}</strong><span class="sub"><span class="${out ? 'bad' : ''}">${esc(describeReading(r))}</span><span>${esc(r.by || '')}</span>${r.note ? `<span>${esc(r.note)}</span>` : ''}</span></div>${out ? `<span class="pill ${r.incident_uuid ? 'red' : 'amber'}">${r.incident_uuid ? 'Fuera de rango' : 'Sin incidencia'}</span>` : ''}`;
  return `<li>${link ? `<a class="row" href="#temperaturas--lectura--${esc(r.uuid)}">${body}</a>` : `<div class="row">${body}</div>`}</li>`;
}
async function viewTemperatures(key) {
  const s = await loadSettings();
  const all = (await getAll('temperature')).sort(byReading);
  const incidents = await getAll('temp_incident');
  const today = todayIso();
  const cards = s.temp.points.map((p) => {
    const mine = all.filter((r) => r.point_id === p.id);
    const todays = mine.filter((r) => r.date === today);
    const last = mine[mine.length - 1];
    return `<section class="temp-point"><div class="panel">
      <div class="head-row"><h2 class="big">${esc(p.name)}</h2><span class="pill ${todays.length ? (todays.some(outOfRange) ? 'red' : 'green') : 'amber'}">${todays.length ? (todays.some(outOfRange) ? 'Fuera de rango' : 'Registrada hoy') : 'Pendiente hoy'}</span></div>
      <p class="hint">${fold(p.name) === fold(TEMP_KINDS[p.kind]) ? 'Rango' : `${esc(TEMP_KINDS[p.kind])} · rango`} ${esc(pointRange(p))}</p>
      ${todays.length ? `<ul class="list">${todays.map((r) => readingLine(r)).join('')}</ul>
        <details class="more-reading"><summary>Añadir otra lectura</summary>${readingForm(p, last)}</details>` : readingForm(p, last)}
    </div></section>`;
  }).join('');
  const open = incidents.filter((i) => i.status !== 'cerrada').sort(byNewest);
  const month = all.filter((r) => monthKeyOf(r.date) === key).reverse();
  const next = shiftMonth(key, 1);
  return `${segmented(STORE_TABS, '#temperaturas')}
    <p class="hint intro">PN/L/PG/009/00: al menos una lectura al día de la temperatura actual, la máxima y la mínima. Los días no laborables se anotan la máxima y la mínima a primera hora del primer día hábil. Después de anotarlas, pon a cero los fiadores del termómetro.</p>
    ${cards}
    <section><h2>Incidencias</h2>
      ${open.length ? `<ul class="list">${open.map((i) => `<li><a class="row" href="#temperaturas--incidencia--${esc(i.uuid)}"><div class="row-main"><strong>Incidencia ${esc(i.code)} · ${esc(i.point_name)}</strong><span class="sub"><span>${fmtDay(i.detected_date)}</span><span>${esc(i.temp_reached || '')}</span></span></div>${pill('temp_incident', i.status)}</a></li>`).join('')}</ul>
        <p class="msg warn">No dispenses los productos afectados hasta que el farmacéutico compruebe que la desviación no afecta a su calidad, seguridad y eficacia.</p>` : '<p class="hint">No hay incidencias abiertas.</p>'}
      <p class="more"><a href="#temperaturas--incidencias">Todas las incidencias (${incidents.length})</a> · <a href="#temperaturas--nueva-incidencia--manual">Registrar una incidencia</a></p>
    </section>
    <section><h2>Lecturas de ${esc(monthLabel(key))}</h2>
      <nav class="month-nav"><a class="btn secondary small" href="#temperaturas--mes--${shiftMonth(key, -1)}">‹ Anterior</a>${next <= monthKeyOf(today) ? `<a class="btn secondary small" href="#temperaturas--mes--${next}">Siguiente ›</a>` : ''}</nav>
      ${month.length ? `<ul class="list">${month.map((r) => readingLine(r, { withPoint: true })).join('')}</ul>` : '<p class="hint">Sin lecturas este mes.</p>'}
    </section>
    <p><a class="btn block secondary" href="#registrotemp">${ICON.doc}Registro mensual en PDF</a></p>
    <p class="more"><a href="#temperaturas--puntos">Puntos de control y rangos</a></p>`;
}

// ------------------------------------------------------------------ una lectura
async function viewTempReading(id) {
  const r = await getOne('temperature', id);
  if (!r) return empty('Esta lectura no existe.', '');
  const s = await loadSettings();
  const points = s.temp.points.some((p) => p.id === r.point_id) ? s.temp.points : [...s.temp.points, { id: r.point_id, name: r.point_name }];
  const inc = r.incident_uuid ? await getOne('temp_incident', r.incident_uuid) : null;
  return `<div class="panel">
      <div class="head-row"><h2 class="big">${esc(r.point_name)}</h2>${outOfRange(r) ? '<span class="pill red">Fuera de rango</span>' : '<span class="pill green">En rango</span>'}</div>
      ${facts([
        ['Fecha y hora', `${fmtDay(r.date)} ${esc(r.time || '')}`],
        ['Lectura', esc(describeReading(r))],
        ['Rango', esc(readingRange(r))],
        ['Registrada por', esc(r.by || '—')],
        r.edited_by ? ['Corregida por', esc(r.edited_by)] : null,
        inc ? ['Incidencia', `<a href="#temperaturas--incidencia--${esc(inc.uuid)}">${esc(inc.code)}</a> ${pill('temp_incident', inc.status)}`] : null,
      ])}
      ${outOfRange(r) && !inc ? `<p><a class="btn block danger" href="#temperaturas--nueva-incidencia--${esc(r.uuid)}">Registrar la incidencia</a></p>` : ''}
    </div>
    <section><h2>Corregir la lectura</h2>
    <form class="form" data-form="tempReading" data-id="${esc(r.uuid)}" novalidate>
      ${formMsg()}
      ${field('Punto de control', `<select name="point">${options(points.map((p) => p.id), r.point_id, Object.fromEntries(points.map((p) => [p.id, p.name])))}</select>`)}
      <div class="grid2">
        ${field('Fecha', dateInput('date', r.date, `max="${todayIso()}"`))}
        ${field('Hora', `<input type="time" name="time" value="${esc(r.time || '')}">`)}
      </div>
      <div class="grid3">
        ${field('Actual', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="actual" maxlength="6" value="${esc(isNum(r.actual) ? fmtT(r.actual) : '')}"><span>ºC</span></div>`)}
        ${field('Máxima', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="max" maxlength="6" value="${esc(isNum(r.max) ? fmtT(r.max) : '')}"><span>ºC</span></div>`)}
        ${field('Mínima', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="min" maxlength="6" value="${esc(isNum(r.min) ? fmtT(r.min) : '')}"><span>ºC</span></div>`)}
      </div>
      ${field('Observaciones', text('note', `maxlength="200" value="${esc(r.note || '')}"`))}
      <button class="btn block" type="submit">Guardar la corrección</button>
      <p class="hint">La corrección queda en el registro de actividad con los valores anteriores.</p>
    </form></section>`;
}

// ------------------------------------------------------------------ incidencias (anexo IV)
async function viewTempIncidents() {
  const list = (await getAll('temp_incident')).sort((a, b) => (b.year - a.year) || (b.number - a.number));
  return `<p class="hint intro">Registro de incidencias de temperatura (anexo IV del PN/L/PG/009/00), numeradas por año.</p>
    ${list.length ? `<ul class="list">${list.map((i) => `<li><a class="row" href="#temperaturas--incidencia--${esc(i.uuid)}"><div class="row-main"><strong>Incidencia ${esc(i.code)} · ${esc(i.point_name)}</strong><span class="sub"><span>${fmtDay(i.detected_date)}</span><span>${esc(i.temp_reached || '')}</span>${TEMP_DECISIONS[i.decision] ? `<span>${esc(TEMP_DECISIONS[i.decision])}</span>` : ''}</span></div>${pill('temp_incident', i.status)}</a></li>`).join('')}</ul>`
      : empty('No hay incidencias registradas.', 'Se registran cuando una lectura se sale del rango.')}
    <p><a class="btn block secondary" href="#temperaturas--nueva-incidencia--manual">Registrar una incidencia</a></p>`;
}
async function viewTempIncident(id, fromReading) {
  const s = await loadSettings();
  let v; let reading = null;
  if (id) {
    v = await getOne('temp_incident', id);
    if (!v) return empty('Esta incidencia no existe.', '');
    reading = v.reading_uuid ? await getOne('temperature', v.reading_uuid) : null;
  } else {
    reading = fromReading && fromReading !== 'manual' ? await getOne('temperature', fromReading) : null;
    if (reading && reading.incident_uuid) { location.hash = `#temperaturas--incidencia--${reading.incident_uuid}`; return ''; }
    const prev = reading ? previousReading(await getAll('temperature'), reading) : null;
    const hours = reading && prev ? Math.ceil((readingMs(reading) - readingMs(prev)) / 36e5) : null;
    const p = reading ? { id: reading.point_id } : s.temp.points[0];
    v = {
      point_id: p.id, detected_date: reading ? reading.date : todayIso(), detected_time: reading ? reading.time : nowTime(),
      temp_reached: reading ? reachedText(reading) : '', hours: isNum(hours) && hours > 0 ? hours : null,
      decision_date: todayIso(), decision_by: state.profile.name, status: 'abierta',
    };
  }
  const points = s.temp.points.some((p) => p.id === v.point_id) ? s.temp.points : [...s.temp.points, { id: v.point_id, name: v.point_name || v.point_id }];
  const closed = v.status === 'cerrada';
  const head = id ? `<div class="panel">
      <div class="head-row"><h2 class="big">Incidencia ${esc(v.code)}</h2>${pill('temp_incident', v.status)}</div>
      ${facts([
        ['Punto de control', `${esc(v.point_name)} (rango ${esc(readingRange(v))})`],
        ['Detectada', `${fmtDay(v.detected_date)} ${esc(v.detected_time || '')}`],
        reading ? ['Lectura', `<a href="#temperaturas--lectura--${esc(reading.uuid)}">${esc(describeReading(reading))}</a>`] : null,
        ['Abierta por', esc(v.created_by || '—')],
        closed ? ['Cerrada', `${fmtStamp(v.closed_at)} por ${esc(v.closed_by || '—')}`] : null,
      ])}
    </div>` : `<div class="panel stack"><h2 class="big">Nueva incidencia de temperatura</h2>
      ${reading ? `<p>${esc(reading.point_name)}, ${fmtDay(reading.date)} ${esc(reading.time || '')}: ${esc(describeReading(reading))}. Rango ${esc(readingRange(reading))}.</p>` : ''}
      <p class="hint">Inventaría los productos afectados, calcula las horas fuera de rango y la temperatura alcanzada. Sin registrador, se considera que estuvieron a la máxima o la mínima desde la última lectura.</p></div>`;
  return `${head}
    <form class="form" data-form="tempIncident" ${id ? `data-id="${esc(id)}"` : ''} ${reading ? `data-reading="${esc(reading.uuid)}"` : ''} novalidate>
      ${formMsg()}
      <fieldset class="group"><legend>1. Descripción de la incidencia</legend>
        ${id || reading ? `<input type="hidden" name="point" value="${esc(v.point_id)}">` : field('Punto de control', `<select name="point">${options(points.map((p) => p.id), v.point_id, Object.fromEntries(points.map((p) => [p.id, p.name])))}</select>`)}
        <div class="grid2">
          ${field('Fecha de detección', dateInput('detected_date', v.detected_date, `max="${todayIso()}"`))}
          ${field('Hora', `<input type="time" name="detected_time" value="${esc(v.detected_time || '')}">`)}
        </div>
        ${field('Temperatura alcanzada', text('temp_reached', `value="${esc(v.temp_reached || '')}" maxlength="160"`))}
        ${field('Número de horas expuestos', `<div class="withunit"><input type="text" inputmode="decimal" autocomplete="off" name="hours" maxlength="6" value="${esc(inputNum(v.hours))}"><span>h</span></div>`, reading ? 'Propuesto: horas desde la lectura anterior.' : '')}
        ${field('Producto/s afectados', `<textarea name="products" maxlength="3000">${esc(v.products || '')}</textarea>`)}
        <button type="button" class="btn secondary small" data-act="tempSuggestProducts">Proponer los productos afectados</button>
        <p class="hint">Añade materias primas y fórmulas de FARMA·LAB según su conservación. Completa la lista con los medicamentos de la farmacia.</p>
      </fieldset>
      <fieldset class="group"><legend>2. Análisis de las causas</legend>
        ${field('Causas', `<textarea name="causes" maxlength="3000">${esc(v.causes || '')}</textarea>`)}
      </fieldset>
      <fieldset class="group"><legend>3. Evaluación de la incidencia</legend>
        ${field('Evaluación', `<textarea name="evaluation" maxlength="3000">${esc(v.evaluation || '')}</textarea>`, 'Si la desviación afecta o no a la calidad, seguridad y eficacia, según la ficha técnica o el fabricante.')}
      </fieldset>
      <fieldset class="group"><legend>4. Tratamiento de la incidencia</legend>
        <div class="checks">${Object.entries(TEMP_DECISIONS).map(([k, l]) => `<label class="check"><input type="radio" name="decision" value="${k}"${v.decision === k ? ' checked' : ''}><span>${esc(l)}.</span></label>`).join('')}</div>
        ${field('Medida correctora / preventiva', `<textarea name="measures" maxlength="3000">${esc(v.measures || '')}</textarea>`)}
        <div class="grid2">
          ${field('Fecha', dateInput('decision_date', v.decision_date))}
          ${field('Firma (farmacéutico)', text('decision_by', `value="${esc(v.decision_by || state.profile.name || '')}" maxlength="120"`))}
        </div>
      </fieldset>
      <button class="btn secondary block" type="submit" name="intent" value="save">${id ? 'Guardar cambios' : 'Guardar la incidencia'}</button>
      ${closed ? '' : '<button class="btn block" type="submit" name="intent" value="close">Cerrar la incidencia</button>'}
    </form>
    ${id ? `<section><h2>Registro en PDF</h2><form class="form" data-form="tempIncidentPdf" data-id="${esc(id)}" novalidate>${formMsg()}<button class="btn block secondary" type="submit">${ICON.doc}Registro de la incidencia (anexo IV)</button></form><div id="sheetOut"></div></section>` : ''}`;
}

// ------------------------------------------------------------------ puntos de control
function tempPointRow(p = {}) {
  return `<div class="tprow" data-comp>
    <input type="hidden" name="tp_id" value="${esc(p.id || '')}">
    <input type="text" name="tp_name" aria-label="Nombre" placeholder="Nombre (Nevera 2...)" maxlength="60" value="${esc(p.name || '')}">
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
    <select name="tp_kind" aria-label="Tipo">${options(Object.keys(TEMP_KINDS), p.kind || 'nevera', TEMP_KINDS)}</select>
    <div class="withunit"><input type="text" inputmode="decimal" name="tp_min" aria-label="Mínima del rango" placeholder="Mín." maxlength="5" value="${esc(isNum(p.min) ? fmtT(p.min) : '')}"><span>ºC</span></div>
    <div class="withunit"><input type="text" inputmode="decimal" name="tp_max" aria-label="Máxima del rango" placeholder="Máx." maxlength="5" value="${esc(isNum(p.max) ? fmtT(p.max) : '')}"><span>ºC</span></div>
  </div>`;
}
ROW_BUILDERS.tpoint = tempPointRow;
async function viewTempPoints() {
  const s = await loadSettings();
  state.parent = '#temperaturas';
  return `<p class="hint intro">PN/L/PG/009/00, 4.2: el local entre 20 y 30 ºC (25 ± 5 ºC, recomendado para elaborar) y la nevera entre 2 y 8 ºC (5 ± 3 ºC). Añade una fila por cada nevera o zona que controles.</p>
    <form class="form" data-form="tempPoints" novalidate>
      ${formMsg()}
      <div data-rows="tpoint">${s.temp.points.map((p) => tempPointRow(p)).join('')}</div>
      <button type="button" class="btn secondary small" data-act="addRow" data-kind="tpoint">${ICON.plus}Añadir punto de control</button>
      <p class="hint">Cambiar un rango no modifica las lecturas ya registradas: cada una conserva el rango con el que se tomó.</p>
      <button class="btn block" type="submit">Guardar</button>
    </form>`;
}
// Al elegir el tipo en una fila nueva se propone el rango del Formulario Nacional.
CHANGE_HOOKS.push((t) => {
  if (!t.matches('.tprow select[name="tp_kind"]')) return;
  const row = t.closest('.tprow');
  const [lo, hi] = [$('[name="tp_min"]', row), $('[name="tp_max"]', row)];
  if (str(lo.value) || str(hi.value)) return;
  const d = DEFAULT_TEMP_POINTS.find((p) => p.kind === t.value);
  if (d) { lo.value = fmtT(d.min); hi.value = fmtT(d.max); }
});

// ------------------------------------------------------------------ registro mensual en PDF
async function viewTempRegister() {
  const s = await loadSettings();
  state.parent = '#temperaturas';
  state.label = null;
  const key = monthKeyOf(todayIso());
  const hasLocal = s.temp.points.some((p) => p.kind === 'local');
  return `<div class="panel stack">
      <h2 class="big">Registro de temperaturas</h2>
      <p>${esc(s.fn.temp_code)} del Formulario Nacional: control de temperatura del local (anexo II a, gráfico, y anexo II b, tabla), de la nevera (anexo III) y registro de incidencias (anexo IV). Un mes por registro.</p>
      <p class="hint">Sin lecturas, sale la hoja en blanco para rellenarla a mano.</p>
    </div>
    <form class="form" data-form="tempRegisterPdf" novalidate>
      ${formMsg()}
      ${field('Mes', `<input type="month" name="month" value="${key}" max="${key}">`)}
      <fieldset class="group"><legend>Puntos de control</legend>
        ${s.temp.points.map((p) => checkbox('points', `${esc(p.name)} <span class="hint">(${esc(TEMP_KINDS[p.kind])}, ${esc(pointRange(p))})</span>`, true, `value="${esc(p.id)}"`)).join('')}
      </fieldset>
      ${hasLocal ? `<fieldset class="group"><legend>Local</legend>
        ${checkbox('local_graph', 'Gráfico (anexo II a)', true)}
        ${checkbox('local_table', 'Tabla de temperatura actual, máxima y mínima (anexo II b)', true)}
      </fieldset>` : ''}
      ${checkbox('incidents', 'Incidencias del mes (anexo IV)', true)}
      <button class="btn block" type="submit">Generar el registro</button>
    </form>
    <div id="sheetOut"></div>`;
}

/** Celda de cabecera azul o lila, con su texto centrado. */
function tempHeadCell(R, x, top, w, h, label, { fill, color, size = 7.4, lines } = {}) {
  const { page, bold, C, clean } = R;
  page.drawRectangle({ x, y: top - h, width: w, height: h, color: fill || C.navy, borderColor: C.white, borderWidth: 0.8 });
  const ls = lines || [label];
  const lh = size * 1.15;
  ls.forEach((ln, k) => {
    const t = clean(ln);
    page.drawText(t, { x: x + (w - bold.widthOfTextAtSize(t, size)) / 2, y: top - (h - ls.length * lh) / 2 - (k + 1) * lh + 2, size, font: bold, color: color || C.white });
  });
}
function tempText(R, t, x, y, { size = 7, f, color, center = false, w = 0 } = {}) {
  const font = f || R.font;
  const s = R.clean(t);
  if (!s) return;
  R.page.drawText(s, { x: center ? x + (w - font.widthOfTextAtSize(s, size)) / 2 : x, y, size, font, color: color || R.C.ink });
}
/** Barra «Mes / Año» del modelo. */
function tempMonthBar(sh, fr, key) {
  const R = sh.raw();
  const { page, C, M, CW } = R;
  const X = (f) => M + f * CW;
  const top = sh.at();
  const h = 13;
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
  tempHeadCell(R, X(fr[0]), top, X(fr[1]) - X(fr[0]), h, 'Mes', { fill: C.mes, size: 7.8 });
  page.drawRectangle({ x: X(fr[1]), y: top - h, width: X(fr[2]) - X(fr[1]), height: h, color: C.white, borderColor: C.navy, borderWidth: 0.8 });
  tempText(R, name.charAt(0).toLocaleUpperCase('es') + name.slice(1), X(fr[1]), top - h + 3.8, { size: 8, center: true, w: X(fr[2]) - X(fr[1]) });
  tempHeadCell(R, X(fr[2]), top, X(fr[3]) - X(fr[2]), h, 'Año', { fill: C.mes, size: 7.8 });
  page.drawRectangle({ x: X(fr[3]), y: top - h, width: X(1) - X(fr[3]), height: h, color: C.white, borderColor: C.navy, borderWidth: 0.8 });
  tempText(R, String(y), X(fr[3]), top - h + 3.8, { size: 8, center: true, w: X(1) - X(fr[3]) });
  sh.moveTo(top - h - 5);
}
/** Texto con salto de página; devuelve nada y deja el cursor debajo. */
function tempParagraph(sh, t, { x = 0, size = 8.6, bold = false, color, gap = 1.3 } = {}) {
  let R = sh.raw();
  const f = bold ? R.bold : R.font;
  const lines = R.wrap(f, size, t, R.CW - x);
  let y = sh.at();
  lines.forEach((ln) => {
    if (y - size * gap < R.bottom) { sh.newPage(); R = sh.raw(); y = sh.at(); }
    y -= size * gap;
    R.page.drawText(ln, { x: R.M + x, y: y + 2, size, font: f, color: color || R.C.text });
  });
  sh.moveTo(y);
}

/** Anexo II a) (local) o anexo III (nevera): rejilla de un mes con la lectura de cada día. */
function drawTempGrid(sh, point, key, readings) {
  const local = point.kind === 'local';
  sh.heading(local ? 'ANEXO II a)' : 'ANEXO III', annexTitle(point));
  tempMonthBar(sh, local ? [0.35, 0.477, 0.672, 0.764] : [0.236, 0.372, 0.552, 0.734], key);
  const R = sh.raw();
  const { page, C, M, CW } = R;
  const X = (f) => M + f * CW;
  const cols = local
    ? { dia: [0, 0.0436], hora: [0.0436, 0.1], scale: [0.1, 0.903], firma: [0.903, 1] }
    : { dia: [0, 0.05], hora: [0.05, 0.135], val: [0.135, 0.188], scale: [0.188, 0.716], firma: [0.716, 1] };
  const sc = TEMP_SCALE[point.kind] || TEMP_SCALE.local;
  const start = Math.round(point.min) - sc.below;
  const scale = Array.from({ length: sc.count }, (_, i) => start + i);
  const last = scale[scale.length - 1];
  const cw = (X(cols.scale[1]) - X(cols.scale[0])) / scale.length;
  const edge = (i) => X(cols.scale[0]) + i * cw;
  const center = (v) => X(cols.scale[0]) + (Math.min(Math.max(v, start), last) - start + 0.5) * cw;
  const top = sh.at();
  const h1 = 13.5; const h2 = 15; const hh = h1 + h2;
  const W = (c) => X(c[1]) - X(c[0]);
  tempHeadCell(R, X(cols.dia[0]), top, W(cols.dia), hh, 'Día');
  tempHeadCell(R, X(cols.hora[0]), top, W(cols.hora), hh, 'Hora');
  if (!local) tempHeadCell(R, X(cols.val[0]), top, W(cols.val), hh, 'ºC', { fill: C.lilac, color: C.text, size: 9 });
  page.drawRectangle({ x: X(cols.scale[0]), y: top - h1, width: W(cols.scale), height: h1, color: C.lilac, borderColor: C.white, borderWidth: 0.8 });
  if (local) tempText(R, 'ºC', X(cols.scale[0]), top - h1 + 4, { size: 7.5, color: C.text, center: true, w: W(cols.scale) });
  else scale.forEach((_, i) => { if (i) page.drawLine({ start: { x: edge(i), y: top }, end: { x: edge(i), y: top - h1 }, thickness: 0.8, color: C.white }); });
  scale.forEach((v, i) => {
    page.drawRectangle({ x: edge(i), y: top - hh, width: cw, height: h2, color: C.white, borderColor: C.navy, borderWidth: 0.45 });
    tempText(R, String(v), edge(i), top - hh + (local ? 5.2 : 4.4), { size: local ? 5.6 : 8.2, color: C.text, center: true, w: cw });
  });
  tempHeadCell(R, X(cols.firma[0]), top, W(cols.firma), hh, '', { lines: local ? ['Firma y', 'fecha'] : ['Firma y fecha'] });
  // filas de los días
  const legendRoom = 30;
  const bodyTop = top - hh;
  const rh = Math.min(16.3, (bodyTop - R.bottom - legendRoom) / 31);
  const n = daysInMonth(key);
  const byDay = new Map();
  readings.forEach((r) => { const d = Number(r.date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) || []), r]); });
  const extra = [];
  for (let d = 1; d <= 31; d += 1) {
    const rowTop = bodyTop - (d - 1) * rh;
    const yMid = rowTop - rh / 2;
    if (d > n) page.drawRectangle({ x: M, y: rowTop - rh, width: CW, height: rh, color: C.lilac, opacity: 0.35 });
    page.drawLine({ start: { x: M, y: rowTop - rh }, end: { x: M + CW, y: rowTop - rh }, thickness: 0.5, color: C.navy });
    tempText(R, String(d), X(cols.dia[0]), yMid - 2.4, { size: 6.8, color: C.text, center: true, w: W(cols.dia) });
    const day = (byDay.get(d) || []).sort(byReading);
    if (!day.length) continue;
    const r = day.find(outOfRange) || day[0];
    day.filter((x) => x !== r).forEach((x) => extra.push(x));
    tempText(R, r.time || '', X(cols.hora[0]), yMid - 2.4, { size: 6.8, center: true, w: W(cols.hora) });
    if (!local) tempText(R, fmtT(r.actual), X(cols.val[0]), yMid - 2.4, { size: 6.8, center: true, w: W(cols.val), color: isOut(r, r.actual) ? C.crimson : C.ink });
    if (isNum(r.min) && isNum(r.max) && r.max > r.min) {
      const x1 = center(r.min); const x2 = center(r.max);
      page.drawRectangle({ x: x1, y: yMid - rh * 0.17, width: Math.max(1, x2 - x1), height: rh * 0.34, color: C.lilac });
      [[r.min, x1], [r.max, x2]].forEach(([v, x]) => page.drawLine({ start: { x, y: yMid - rh * 0.26 }, end: { x, y: yMid + rh * 0.26 }, thickness: 1, color: isOut(r, v) ? C.crimson : C.navy }));
    }
    const ax = center(r.actual);
    const color = isOut(r, r.actual) ? C.crimson : C.ink;
    if (r.actual < start || r.actual > last) {
      tempText(R, r.actual < start ? '<' : '>', ax - 2.5, yMid - 3, { size: 9, f: R.bold, color: C.crimson });
    } else {
      const k = Math.min(3, rh * 0.22);
      page.drawLine({ start: { x: ax - k, y: yMid - k }, end: { x: ax + k, y: yMid + k }, thickness: 1.2, color });
      page.drawLine({ start: { x: ax - k, y: yMid + k }, end: { x: ax + k, y: yMid - k }, thickness: 1.2, color });
    }
    const sign = local ? `${initials(r.by)} ${r.date.slice(8, 10)}/${r.date.slice(5, 7)}` : `${r.by || ''}, ${fmtDay(r.date)}`;
    tempText(R, sign, X(cols.firma[0]) + 3, yMid - 2.4, { size: local ? 5.8 : 6.8 });
  }
  const bottomY = bodyTop - 31 * rh;
  // líneas verticales de las columnas
  const vlines = [cols.dia[1], cols.hora[1], ...(local ? [] : [cols.val[1]]), cols.scale[1]].map(X);
  vlines.forEach((x) => page.drawLine({ start: { x, y: bodyTop }, end: { x, y: bottomY }, thickness: 0.6, color: C.navy }));
  scale.forEach((_, i) => { if (i) page.drawLine({ start: { x: edge(i), y: bodyTop }, end: { x: edge(i), y: bottomY }, thickness: 0.4, color: C.navy }); });
  // rango: líneas gruesas en sus extremos y discontinua en el valor central, como en el modelo
  const lo = edge(Math.round(point.min) - start); const hi = edge(Math.round(point.max) - start + 1);
  [lo, hi].forEach((x) => { if (x >= edge(0) && x <= edge(scale.length)) page.drawLine({ start: { x, y: top - h1 }, end: { x, y: bottomY }, thickness: 2, color: C.navy }); });
  const mid = (point.min + point.max) / 2;
  if (mid >= start && mid <= last) page.drawLine({ start: { x: center(mid), y: bodyTop }, end: { x: center(mid), y: bottomY }, thickness: 1.6, color: C.navy, dashArray: [4, 3] });
  page.drawRectangle({ x: M, y: bottomY, width: CW, height: bodyTop - bottomY, borderColor: C.navy, borderWidth: 0.9 });
  sh.moveTo(bottomY - 4);
  tempParagraph(sh, `X: temperatura actual. Barra: de la mínima a la máxima. Líneas gruesas: rango ${pointRange(point)}; discontinua: ${fmtT(mid)} ºC. En rojo, fuera de rango.`, { size: 6.4, color: C.grey });
  if (extra.length) tempParagraph(sh, `Otras lecturas del mes: ${extra.map((x) => `${fmtDay(x.date)} ${x.time || ''}, ${describeReading(x)} (${x.by || ''})`).join('; ')}.`, { size: 6.4, color: C.grey });
}

/** Anexo II b): tabla con la temperatura actual, la máxima y la mínima de cada lectura del mes. */
function drawTempTable(sh, point, key, readings) {
  const fr = { dia: [0, 0.139], hora: [0.139, 0.286], act: [0.286, 0.452], max: [0.452, 0.626], min: [0.626, 0.781], firma: [0.781, 1] };
  const rows = [...readings].sort(byReading);
  let i = 0;
  let first = true;
  do {
    if (!first) sh.newPage();
    sh.heading('ANEXO II b)', `${annexTitle(point)}${first ? '' : ' (continuación)'}`);
    tempMonthBar(sh, [0.286, 0.452, 0.626, 0.781], key);
    const R = sh.raw();
    const { page, C, M, CW } = R;
    const X = (f) => M + f * CW;
    const W = (c) => X(c[1]) - X(c[0]);
    const top = sh.at();
    const h1 = 13; const h2 = 13; const hh = h1 + h2;
    tempHeadCell(R, X(fr.dia[0]), top, W(fr.dia), hh, 'Día', { size: 8 });
    tempHeadCell(R, X(fr.hora[0]), top, W(fr.hora), hh, 'Hora', { size: 8 });
    tempHeadCell(R, X(fr.act[0]), top, X(fr.min[1]) - X(fr.act[0]), h1, 'Temperatura', { fill: C.lilac, color: C.text, size: 8 });
    [['act', 'Actual'], ['max', 'Máx.'], ['min', 'Mín.']].forEach(([k, l]) => {
      page.drawRectangle({ x: X(fr[k][0]), y: top - hh, width: W(fr[k]), height: h2, color: C.white, borderColor: C.navy, borderWidth: 0.6 });
      tempText(R, l, X(fr[k][0]), top - hh + 4, { size: 7.6, color: C.text, center: true, w: W(fr[k]) });
    });
    tempHeadCell(R, X(fr.firma[0]), top, W(fr.firma), hh, 'Firma', { size: 8 });
    const rh = 16.5;
    let y = top - hh;
    let drawn = 0;
    while ((i < rows.length || drawn < 15) && y - rh >= R.bottom) {
      const r = rows[i];
      Object.values(fr).forEach((c) => page.drawRectangle({ x: X(c[0]), y: y - rh, width: W(c), height: rh, color: C.white, borderColor: C.navy, borderWidth: 0.6 }));
      if (r) {
        const ty = y - rh / 2 - 2.6;
        tempText(R, String(Number(r.date.slice(8, 10))), X(fr.dia[0]), ty, { size: 7.6, center: true, w: W(fr.dia) });
        tempText(R, r.time || '', X(fr.hora[0]), ty, { size: 7.6, center: true, w: W(fr.hora) });
        [['act', r.actual], ['max', r.max], ['min', r.min]].forEach(([k, v]) => tempText(R, isNum(v) ? `${fmtT(v)} ºC` : '', X(fr[k][0]), ty, { size: 7.6, center: true, w: W(fr[k]), color: isOut(r, v) ? C.crimson : C.ink }));
        tempText(R, r.by || '', X(fr.firma[0]) + 3, ty, { size: 7 });
        i += 1;
      }
      y -= rh;
      drawn += 1;
    }
    sh.moveTo(y - 6);
    first = false;
  } while (i < rows.length);
  tempParagraph(sh, `Rango: ${pointRange(point)}. En rojo, fuera de rango.`, { size: 6.4, color: sh.raw().C.grey });
}

/** Anexo IV: registro de una incidencia de temperatura, con el texto del modelo. */
function drawTempIncident(sh, inc) {
  sh.heading('ANEXO IV', 'Registro de incidencia de temperatura');
  sh.draft();
  const mm = sh.mm;
  const label = (t, v, x) => {
    const R = sh.raw();
    const y = sh.at() - 12;
    if (y < R.bottom) { sh.newPage(); return label(t, v, x); }
    const lt = R.clean(t);
    R.page.drawText(lt, { x: R.M + x, y, size: 9, font: R.bold, color: R.C.text });
    sh.moveTo(y - 2);
    const w = R.bold.widthOfTextAtSize(lt, 9) + 4;
    const val = str(v);
    if (!val) return;
    const one = R.wrap(R.font, 9, val, R.CW - x - w);
    if (one.length === 1 && !val.includes('\n')) R.page.drawText(one[0], { x: R.M + x + w, y, size: 9, font: R.font, color: R.C.ink });
    else { sh.moveTo(y - 1.5); tempParagraph(sh, val, { x: x + mm(4), size: 9, color: R.C.ink }); sh.moveTo(sh.at() - 2); }
  };
  label('Código:', `Número correlativo / año: ${inc.code}${inc.status !== 'cerrada' ? ' (abierta)' : ''}`, mm(3.5));
  sh.moveTo(sh.at() - 6);
  label('1.   Descripción de la incidencia:', '', mm(9));
  label('-  Temperatura alcanzada:', [`${inc.point_name ? `${inc.point_name}: ` : ''}${inc.temp_reached || ''}`, isDay(inc.detected_date) ? `Detectada el ${fmtDay(inc.detected_date)}${inc.detected_time ? ` a las ${inc.detected_time}` : ''}` : ''].filter(Boolean).join('. '), mm(14));
  label('-  Número de horas expuestos:', isNum(inc.hours) ? `${fmtNum(inc.hours)} h` : '', mm(14));
  label('-  Producto/s afectados:', inc.products || '', mm(14));
  sh.moveTo(sh.at() - 4);
  label('2.   Análisis de las causas:', inc.causes || '', mm(9));
  sh.moveTo(sh.at() - 4);
  label('3.   Evaluación de la incidencia:', inc.evaluation || '', mm(9));
  sh.moveTo(sh.at() - 4);
  label('4.   Tratamiento de la incidencia:', '', mm(9));
  Object.entries(TEMP_DECISIONS).forEach(([k, l]) => {
    const R = sh.raw();
    const y = sh.at() - 12;
    const bx = R.M + mm(14); const s = 7.5;
    R.page.drawRectangle({ x: bx, y: y - 1, width: s, height: s, borderColor: R.C.navy, borderWidth: 0.8 });
    if (inc.decision === k) {
      R.page.drawLine({ start: { x: bx + 1.4, y: y + 0.4 }, end: { x: bx + s - 1.4, y: y + s - 2.4 }, thickness: 1.1, color: R.C.ink });
      R.page.drawLine({ start: { x: bx + 1.4, y: y + s - 2.4 }, end: { x: bx + s - 1.4, y: y + 0.4 }, thickness: 1.1, color: R.C.ink });
    }
    R.page.drawText(`${l}.`, { x: bx + s + 5, y, size: 9, font: R.font, color: R.C.text });
    sh.moveTo(y - 2);
  });
  label('-  Medida correctora / preventiva:', inc.measures || '', mm(14));
  sh.moveTo(sh.at() - 18);
  label('Fecha:', isDay(inc.decision_date) ? fmtDay(inc.decision_date) : '', mm(9));
  label('Firma:', inc.decision_by || '', mm(9));
  sh.moveTo(sh.at() - mm(6));
}
async function tempSheet(s, subject, draftMissing = []) {
  return createFnSheet({ code: s.fn.temp_code, related: s.fn.temp_related, procTitle: FN_TEMP_TITLE, pharmacy: s.pharmacy, subject, draftMissing });
}
async function buildTempRegisterPdf({ key, points, readings, incidents, graph, table, s }) {
  const sh = await tempSheet(s, `Registro de temperaturas · ${monthLabel(key)}`);
  let first = true;
  const page = () => { if (!first) sh.newPage(); first = false; };
  for (const p of points) {
    const mine = readings.filter((r) => r.point_id === p.id);
    if (p.kind === 'local') {
      if (graph) { page(); drawTempGrid(sh, p, key, mine); }
      if (table || !graph) { page(); drawTempTable(sh, p, key, mine); }
    } else { page(); drawTempGrid(sh, p, key, mine); }
  }
  for (const inc of incidents) { page(); drawTempIncident(sh, inc); }
  return sh.finish();
}

// ------------------------------------------------------------------ guardar
Object.assign(FORMS, {
  async tempReading(form) {
    const s = await loadSettings();
    const prev = form.dataset.id ? await getOne('temperature', form.dataset.id) : null;
    if (form.dataset.id && !prev) throw new InputError('Esta lectura ya no existe.');
    const d = formData(form);
    const pointId = prev ? d.point : form.dataset.point;
    const point = s.temp.points.find((p) => p.id === pointId)
      || (prev && prev.point_id === pointId ? { id: prev.point_id, name: prev.point_name, kind: prev.kind, min: prev.range_min, max: prev.range_max } : null);
    if (!point) throw new InputError('Ese punto de control ya no existe. Revisa los puntos de control.');
    if (!isDay(d.date)) throw new InputError('Indica la fecha de la lectura.');
    if (d.date > todayIso()) throw new InputError('La fecha no puede ser posterior a hoy.');
    if (!/^\d{2}:\d{2}$/.test(str(d.time))) throw new InputError('Indica la hora de la lectura.');
    const actual = parseTemp(d.actual, 'Temperatura actual');
    if (actual === null) throw new InputError('Escribe la temperatura actual.');
    const max = parseTemp(d.max, 'Máxima');
    const min = parseTemp(d.min, 'Mínima');
    if (isNum(max) && max < actual) throw new InputError('La máxima no puede ser menor que la temperatura actual.');
    if (isNum(min) && min > actual) throw new InputError('La mínima no puede ser mayor que la temperatura actual.');
    const keepRange = prev && prev.point_id === point.id;
    const rec = {
      ...(prev || { uuid: newId(), by: state.profile.name }),
      point_id: point.id, point_name: point.name, kind: point.kind,
      range_min: keepRange ? prev.range_min : point.min, range_max: keepRange ? prev.range_max : point.max,
      date: d.date, time: str(d.time), actual, max, min, note: str(d.note).slice(0, 200),
    };
    rec.out_of_range = outOfRange(rec);
    if (prev) rec.edited_by = state.profile.name;
    const detail = `${rec.point_name} ${fmtDay(rec.date)} ${rec.time}: ${describeReading(rec)}${rec.out_of_range ? ` (fuera de rango ${readingRange(rec)})` : ''}`;
    await save('temperature', rec, prev ? 'edicion_temperatura' : 'lectura_temperatura', prev ? `${detail}. Antes: ${prev.point_name} ${fmtDay(prev.date)} ${prev.time}: ${describeReading(prev)}` : detail);
    if (rec.out_of_range && !rec.incident_uuid) {
      const go = await ask({
        title: 'Temperatura fuera de rango',
        message: `${rec.point_name}: ${describeReading(rec)}. El rango es ${readingRange(rec)}.\n\nEl farmacéutico debe analizar la desviación y registrar la incidencia (anexo IV). No dispenses los productos afectados hasta comprobar que su calidad, seguridad y eficacia no se han visto afectadas.`,
        confirmLabel: 'Registrar la incidencia', cancelLabel: 'Más tarde', danger: true,
      });
      if (go) { location.hash = `#temperaturas--nueva-incidencia--${rec.uuid}`; return; }
    } else {
      toast(prev ? 'Lectura corregida.' : 'Lectura registrada. Pon a cero los fiadores del termómetro.');
    }
    if (prev) location.hash = '#temperaturas'; else await route();
  },

  async tempIncident(form, submitter) {
    const s = await loadSettings();
    const prev = form.dataset.id ? await getOne('temp_incident', form.dataset.id) : null;
    if (form.dataset.id && !prev) throw new InputError('Esta incidencia ya no existe.');
    const reading = form.dataset.reading ? await getOne('temperature', form.dataset.reading) : null;
    const d = formData(form);
    const intent = submitter && submitter.value === 'close' ? 'close' : 'save';
    const pointId = d.point || (prev && prev.point_id);
    const point = s.temp.points.find((p) => p.id === pointId)
      || (prev ? { id: prev.point_id, name: prev.point_name, kind: prev.kind, min: prev.range_min, max: prev.range_max } : null)
      || (reading ? { id: reading.point_id, name: reading.point_name, kind: reading.kind, min: reading.range_min, max: reading.range_max } : null);
    if (!point) throw new InputError('Elige el punto de control.');
    if (!isDay(d.detected_date)) throw new InputError('Indica la fecha en que se detectó.');
    const hours = parseNum(d.hours, 'Número de horas');
    if (isNum(hours) && hours > 24 * 366) throw new InputError('Revisa el número de horas.');
    const rec = {
      ...(prev || { uuid: newId(), status: 'abierta', created_by: state.profile.name, reading_uuid: reading ? reading.uuid : null }),
      point_id: point.id, point_name: point.name, kind: point.kind,
      range_min: prev ? prev.range_min : (reading ? reading.range_min : point.min), range_max: prev ? prev.range_max : (reading ? reading.range_max : point.max),
      detected_date: d.detected_date, detected_time: str(d.detected_time),
      temp_reached: str(d.temp_reached).slice(0, 160), hours, products: str(d.products).slice(0, 3000),
      causes: str(d.causes).slice(0, 3000), evaluation: str(d.evaluation).slice(0, 3000),
      decision: TEMP_DECISIONS[d.decision] ? d.decision : '', measures: str(d.measures).slice(0, 3000),
      decision_date: isDay(d.decision_date) ? d.decision_date : null, decision_by: str(d.decision_by).slice(0, 120),
    };
    if (!prev) {
      const year = Number(rec.detected_date.slice(0, 4));
      const number = 1 + Math.max(0, ...(await getAll('temp_incident')).filter((i) => i.year === year).map((i) => Number(i.number) || 0));
      Object.assign(rec, { year, number, code: `${number}/${year}` });
    }
    if (intent === 'close') {
      const miss = incidentMissing(rec);
      if (miss.length) throw new InputError(`Para cerrarla falta: ${miss.join(', ')}.`);
      Object.assign(rec, { status: 'cerrada', closed_at: nowIso(), closed_by: state.profile.name });
    }
    const entries = [['temp_incident', rec]];
    if (reading && !reading.incident_uuid) entries.push(['temperature', { ...reading, incident_uuid: rec.uuid }]);
    const action = intent === 'close' ? 'cierre_incidencia_temperatura' : prev ? 'edicion_incidencia_temperatura' : 'alta_incidencia_temperatura';
    await saveMany(entries, action, `${rec.code} ${rec.point_name}: ${rec.temp_reached || 'sin temperatura'}${rec.decision ? ` · ${TEMP_DECISIONS[rec.decision]}` : ''}`);
    toast(intent === 'close' ? `Incidencia ${rec.code} cerrada.` : `Incidencia ${rec.code} guardada.`);
    if (intent === 'close' && rec.decision === 'rechaza') {
      await ask({ title: 'Productos rechazados', message: 'Retira los productos afectados y no los dispenses. En FARMA·LAB, bloquea o rechaza los lotes de materias primas afectados desde Almacén.', confirmLabel: 'Entendido', cancelLabel: 'Cerrar' });
    }
    if (prev) await route(); else location.hash = `#temperaturas--incidencia--${rec.uuid}`;
  },

  async tempIncidentPdf(form) {
    const inc = await getOne('temp_incident', form.dataset.id);
    if (!inc) throw new InputError('Esta incidencia ya no existe.');
    const s = await loadSettings();
    const missing = incidentMissing(inc);
    const sh = await tempSheet(s, `Incidencia de temperatura ${inc.code}`, missing);
    drawTempIncident(sh, inc);
    const blob = await sh.finish();
    await logOnly('incidencia_temp_pdf', `${inc.code} ${inc.point_name}${missing.length ? ' (borrador)' : ''}`);
    await showSheet(blob, `incidencia-temperatura-${inc.code.replace('/', '-')}.pdf`, missing.length ? 'Borrador listo' : 'Registro listo');
  },

  async tempRegisterPdf(form) {
    const s = await loadSettings();
    const all = new FormData(form);
    const key = str(all.get('month'));
    if (!isMonthKey(key)) throw new InputError('Elige el mes.');
    const ids = all.getAll('points');
    const points = s.temp.points.filter((p) => ids.includes(p.id));
    const withIncidents = all.get('incidents') === 'on';
    if (!points.length && !withIncidents) throw new InputError('Elige al menos un punto de control.');
    const graph = all.get('local_graph') === 'on';
    const table = all.get('local_table') === 'on';
    const readings = (await getAll('temperature')).filter((r) => monthKeyOf(r.date) === key && ids.includes(r.point_id));
    const incidents = withIncidents ? (await getAll('temp_incident')).filter((i) => monthKeyOf(i.detected_date) === key).sort((a, b) => a.number - b.number) : [];
    if (!points.length && !incidents.length) throw new InputError(`No hay incidencias en ${monthLabel(key)}. Elige algún punto de control.`);
    const blob = await buildTempRegisterPdf({ key, points, readings, incidents, graph, table, s });
    await logOnly('registro_temp_generado', `${monthLabel(key)}: ${readings.length} ${readings.length === 1 ? 'lectura' : 'lecturas'}${incidents.length ? `, ${incidents.length} ${incidents.length === 1 ? 'incidencia' : 'incidencias'}` : ''}`);
    await showSheet(blob, `registro-temperaturas-${key}.pdf`, 'Registro listo');
  },

  async tempPoints(form) {
    const s = await loadSettings();
    const all = new FormData(form);
    const ids = all.getAll('tp_id'); const names = all.getAll('tp_name'); const kinds = all.getAll('tp_kind'); const mins = all.getAll('tp_min'); const maxs = all.getAll('tp_max');
    const points = [];
    names.forEach((n, i) => {
      const name = str(n).slice(0, 60);
      if (!name && !str(mins[i]) && !str(maxs[i])) return;
      if (!name) throw new InputError('Cada punto de control necesita un nombre.');
      const min = parseTemp(mins[i], `${name}, mínima del rango`);
      const max = parseTemp(maxs[i], `${name}, máxima del rango`);
      if (!isNum(min) || !isNum(max) || min >= max) throw new InputError(`${name}: indica el rango (la mínima menor que la máxima).`);
      points.push({ id: str(ids[i]) || newId(), name, kind: TEMP_KINDS[kinds[i]] ? kinds[i] : 'nevera', min, max });
    });
    if (!points.length) throw new InputError('Deja al menos un punto de control.');
    const dup = points.find((p, i) => points.findIndex((q) => fold(q.name) === fold(p.name)) !== i);
    if (dup) throw new InputError(`Hay dos puntos de control llamados ${dup.name}.`);
    await saveSettings({ ...s, temp: { points } }, `Puntos de control de temperatura: ${points.map((p) => `${p.name} ${pointRange(p)}`).join(', ')}`);
    toast('Puntos de control guardados.');
    location.hash = '#temperaturas';
  },
});

Object.assign(ACTIONS, {
  /** Propone las materias primas y fórmulas en stock que se conservan en ese punto (nevera o local). */
  tempSuggestProducts: async (el) => {
    const form = el.closest('form');
    const s = await loadSettings();
    const reading = form.dataset.reading ? await getOne('temperature', form.dataset.reading) : null;
    const inc = form.dataset.id ? await getOne('temp_incident', form.dataset.id) : null;
    const pid = form.elements.point ? form.elements.point.value : '';
    const kind = (s.temp.points.find((p) => p.id === pid) || reading || inc || {}).kind || 'local';
    const cold = (x) => FRIDGE_RE.test(String(x || ''));
    const keep = kind === 'nevera' ? cold : (x) => !cold(x);
    const mats = (await getAll('material')).filter((m) => (m.quantity || 0) > 0 && m.status !== 'rechazado' && keep(m.storage));
    const prods = (await getAll('production')).filter((p) => p.status === 'elaborada' && keep(p.storage));
    const lines = [
      ...mats.sort(byText('name')).map((m) => `${m.name}, lote ${m.lot}${m.internal_no ? ` (${m.internal_no})` : ''}`),
      ...prods.map((p) => `${p.formula_name}, lote ${p.lot || p.record_code} (elaborada, sin dispensar)`),
    ];
    const box = form.elements.products;
    const current = str(box.value);
    const fresh = lines.filter((l) => !current.includes(l));
    if (!fresh.length) { toast(lines.length ? 'Ya están todos en la lista.' : `No hay materias primas ni fórmulas elaboradas ${kind === 'nevera' ? 'conservadas en nevera' : 'a temperatura ambiente'} en stock.`); return; }
    box.value = [current, ...fresh, current.includes('Medicamentos de la farmacia') ? '' : 'Medicamentos de la farmacia: '].filter(Boolean).join('\n');
    box.focus();
    toast(`${fresh.length} ${fresh.length === 1 ? 'producto añadido' : 'productos añadidos'}. Revisa la lista.`);
  },
});

// Casillas necesarias (en rojo).
NEEDED.tempReading = { goal: 'el registro de temperaturas', legend: false, fields: () => ['date', 'time', 'actual', 'max', 'min'] };
NEEDED.tempIncident = {
  goal: 'cerrar la incidencia y generar su registro (anexo IV)',
  fields: () => ['detected_date', 'temp_reached', 'hours', 'products', 'causes', 'evaluation', 'decision', 'decision_date', 'decision_by'],
};

// ------------------------------------------------------------------ Inicio y avisos
HOME_BLOCKS.push(async () => {
  const s = await loadSettings();
  const today = todayIso();
  const todays = (await getAll('temperature')).filter((r) => r.date === today).sort(byReading);
  return `<section><h2>Temperaturas de hoy</h2><ul class="list">${s.temp.points.map((p) => {
    const mine = todays.filter((r) => r.point_id === p.id);
    const r = mine.find(outOfRange) || mine[mine.length - 1];
    const tone = !r ? 'amber' : outOfRange(r) ? 'red' : 'green';
    return `<li><a class="row" href="#temperaturas"><div class="row-main"><strong>${esc(p.name)}</strong><span class="sub">${r ? `<span>${esc(describeReading(r))}</span><span>${esc(r.time || '')}</span>` : `<span>Sin registrar · rango ${esc(pointRange(p))}</span>`}</span></div><span class="pill ${tone}">${!r ? 'Pendiente' : outOfRange(r) ? 'Fuera de rango' : 'Registrada'}</span></a></li>`;
  }).join('')}</ul></section>`;
});
ALERT_SOURCES.push(async () => {
  const s = await loadSettings();
  const readings = await getAll('temperature');
  const incidents = await getAll('temp_incident');
  const out = [];
  incidents.filter((i) => i.status !== 'cerrada').forEach((i) => out.push({
    tone: 'red', kind: 'Incidencia de temperatura', title: `Incidencia ${i.code} (${i.point_name}) abierta`,
    text: 'No dispenses los productos afectados hasta evaluar la desviación y cerrar la incidencia.', href: `#temperaturas--incidencia--${i.uuid}`,
  }));
  readings.filter((r) => outOfRange(r) && !r.incident_uuid).sort(byReading).forEach((r) => out.push({
    tone: 'red', kind: 'Temperatura fuera de rango', title: `${r.point_name} ${fmtDay(r.date)}: ${describeReading(r)}`,
    text: `Rango ${readingRange(r)}. Registra la incidencia y no dispenses los productos afectados hasta evaluarla.`, href: `#temperaturas--nueva-incidencia--${r.uuid}`,
  }));
  const today = todayIso();
  const pending = s.temp.points.filter((p) => !readings.some((r) => r.point_id === p.id && r.date === today));
  if (pending.length) out.push({
    tone: 'amber', kind: 'Temperatura', title: `${pending.map((p) => p.name).join(', ')}: sin registrar hoy`,
    text: 'Anota la temperatura actual, la máxima y la mínima (PN/L/PG/009/00).', href: '#temperaturas',
  });
  return out;
});
SETTINGS_SECTIONS.push(async () => {
  const s = await loadSettings();
  return `<section><h2>Temperaturas</h2><div class="panel stack">
    <p>${s.temp.points.map((p) => `${esc(p.name)} (${esc(pointRange(p))})`).join(' · ')}</p>
    <a class="btn secondary block" href="#temperaturas--puntos">Puntos de control y rangos</a>
  </div></section>`;
});

Object.assign(ACTION_LABELS, {
  lectura_temperatura: 'Lectura de temperatura',
  edicion_temperatura: 'Lectura de temperatura corregida',
  alta_incidencia_temperatura: 'Incidencia de temperatura abierta',
  edicion_incidencia_temperatura: 'Incidencia de temperatura modificada',
  cierre_incidencia_temperatura: 'Incidencia de temperatura cerrada',
  registro_temp_generado: 'Registro de temperaturas generado',
  incidencia_temp_pdf: 'Registro de incidencia de temperatura generado',
});
