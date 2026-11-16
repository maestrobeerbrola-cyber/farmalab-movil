'use strict';
/*
 * Avisos emergentes, configurables en cada dispositivo (Ajustes → Avisos en este dispositivo):
 *
 * 1. Ventana dentro de la app al abrirla o desbloquearla y cuando aparece un aviso nuevo mientras se usa.
 * 2. Notificaciones del teléfono, también con la app cerrada. La app no tiene servidor: deja en IndexedDB
 *    (meta «alertPlan») los avisos activos y los que se activarán con los días (temperatura del día,
 *    calibraciones de balanzas, caducidades, elaboraciones paradas), y el service worker los comprueba con la
 *    sincronización periódica de Chrome (Android, app instalada), que decide cuándo: una o dos veces al día.
 *
 * Lo ya mostrado se guarda en meta «alertSeen» ({clave: día}): lo nuevo sale en el momento y, en el modo diario,
 * lo que sigue pendiente vuelve a salir una vez al día. Preferencias en meta «alertPrefs» (no se sincronizan).
 */
const ALERT_POPUP_MODES = { daily: 'Los avisos nuevos y, una vez al día, los pendientes', new: 'Solo los avisos nuevos', off: 'No mostrar la ventana' };
const ALERT_POP_MAX = 6;
const ALERT_SYNC_TAG = 'farmalab-avisos';
const alertKey = (a) => [a.tone, a.kind, a.title, a.href].join('|');
const isTempDaily = (a) => a.kind === 'Temperatura' && /sin registrar hoy$/.test(a.title);
const notifySupported = () => 'Notification' in window && 'serviceWorker' in navigator;

async function alertPrefs() {
  const p = (await metaGet('alertPrefs')) || {};
  return { popup: ALERT_POPUP_MODES[p.popup] ? p.popup : (coarsePointer() ? 'daily' : 'off'), notify: Boolean(p.notify), offered: Boolean(p.offered) };
}
const saveAlertPrefs = async (patch) => metaSet('alertPrefs', { ...(await alertPrefs()), ...patch });

// ------------------------------------------------------------------ plan para el service worker
/** Avisos que se activarán con el paso de los días, con la misma clave que tendrán en Inicio. */
async function alertForecasts() {
  const today = todayIso();
  const [mats, packs, prods, balances, checks, s] = await Promise.all([getAll('material'), getAll('packaging'), getLive('production'), getAll('balance'), getAll('balance_check'), loadSettings()]);
  const out = [];
  for (const [sec, r] of [...mats.map((m) => ['materias', m]), ...packs.map((p) => ['envases', p])]) {
    if (!isDay(r.expiry) || r.closure || ['rechazado', 'bloqueado'].includes(r.status) || !((r.quantity ?? 1) > 0)) continue;
    const base = { kind: 'Caducidad', title: r.name, href: `#${sec}--${r.uuid}` };
    const soon = addDays(r.expiry, -EXPIRY_WARNING_DAYS);
    if (r.expiry >= today) out.push({ ...base, tone: 'amber', text: `Lote ${r.lot || '—'}. Caduca el ${fmtDay(r.expiry)}`, from: soon > today ? soon : today, until: r.expiry });
    out.push({ ...base, tone: 'red', text: `Lote ${r.lot || '—'}. Caducó el ${fmtDay(r.expiry)}: retíralo y registra su eliminación`, from: addDays(r.expiry, 1) });
  }
  for (const p of prods.filter((x) => x.status === 'en_proceso')) {
    const since = new Date(Date.parse(p.status_changed_at || p.created_at));
    if (Number.isNaN(since.getTime())) continue;
    const day = `${since.getFullYear()}-${pad2(since.getMonth() + 1)}-${pad2(since.getDate())}`;
    out.push({ tone: 'amber', kind: 'Elaboración pendiente', title: `${p.record_code} ${p.formula_name}`, text: 'En proceso sin cambiar de estado', href: `#elaboraciones--${p.uuid}`, from: addDays(day, STALE_PRODUCTION_DAYS) });
  }
  for (const b of balances.filter((x) => x.active !== false)) {
    const st = balanceState(b, checks);
    out.push({ tone: 'amber', kind: 'Balanza', title: `${b.name}: calibración interna pendiente`, text: `Toca cada ${st.interval} días.`, href: `#balanzas--${b.uuid}--interna`, from: st.lastOk ? addDays(st.lastOk.date, st.interval + 1) : today });
    if (st.extDue) {
      const soon = addDays(st.extDue, -BAL_EXT_WARNING_DAYS);
      if (st.extDue >= today) out.push({ tone: 'amber', kind: 'Balanza', title: `${b.name}: calibración externa el ${fmtDay(st.extDue)}`, text: 'Pide cita a la empresa de calibración.', href: `#balanzas--${b.uuid}`, from: soon > today ? soon : today, until: st.extDue });
      out.push({ tone: 'red', kind: 'Balanza', title: `${b.name}: calibración externa vencida`, text: `Tocaba el ${fmtDay(st.extDue)}. Avisa a la empresa de calibración.`, href: `#balanzas--${b.uuid}`, from: addDays(st.extDue, 1) });
    }
  }
  // Temperatura del día: el service worker mira si hay lectura de hoy de cada punto (a partir de las 12:00).
  if (s.temp && s.temp.points.length) {
    out.push({ rule: 'temp', points: s.temp.points.map((p) => ({ id: p.id, name: p.name })), text: 'Anota la temperatura actual, la máxima y la mínima (PN/L/PG/009/00).' });
  }
  return out;
}
let lastPlanJson = '';
async function saveAlertPlan(active) {
  const today = todayIso();
  const items = [];
  const keys = new Set();
  const add = (a) => { const k = a.rule ? `rule:${a.rule}` : alertKey(a); if (!keys.has(k)) { keys.add(k); items.push(a); } };
  (await alertForecasts()).forEach(add);
  active.filter((a) => !isTempDaily(a)).forEach((a) => add({ tone: a.tone, kind: a.kind, title: a.title, text: a.text, href: a.href, from: today }));
  const json = JSON.stringify(items);
  if (json === lastPlanJson) return;
  lastPlanJson = json;
  await metaSet('alertPlan', { saved_at: nowIso(), items });
}

// ------------------------------------------------------------------ ventana de avisos
let alertTimer = 0;
let alertRunning = false;
/** Calcula los avisos, guarda el plan y muestra la ventana (o una notificación si la app está en segundo plano). */
async function checkAlerts({ retry = 0 } = {}) {
  if (!state.unlocked || !$('#shell') || alertRunning) return;
  alertRunning = true;
  try {
    const prefs = await alertPrefs();
    const alerts = await computeAlerts();
    await saveAlertPlan(alerts);
    const today = todayIso();
    const seen = (await metaGet('alertSeen')) || {};
    const live = new Set(alerts.map(alertKey));
    Object.keys(seen).forEach((k) => { if (!live.has(k)) delete seen[k]; });   // si vuelve a aparecer, se avisa otra vez
    const mode = prefs.popup === 'new' ? 'new' : 'daily';
    const fresh = alerts.filter((a) => !(alertKey(a) in seen) || (mode === 'daily' && seen[alertKey(a)] < today));
    const busy = $('dialog[open]');
    if (fresh.length && document.hidden && prefs.notify && notifySupported() && Notification.permission === 'granted') {
      fresh.forEach((a) => { seen[alertKey(a)] = today; });
      await metaSet('alertSeen', seen);
      await showPhoneNotification(fresh);
    } else if (fresh.length && prefs.popup !== 'off' && !document.hidden && !busy && !window.FARMALAB_TEST_NO_POPUP) {   // (las pruebas automáticas la apagan)
      fresh.forEach((a) => { seen[alertKey(a)] = today; });
      await metaSet('alertSeen', seen);
      showAlertPopup(fresh, prefs);
    } else {
      await metaSet('alertSeen', seen);
      if (fresh.length && busy && retry < 10 && prefs.popup !== 'off') { clearTimeout(alertTimer); alertTimer = setTimeout(() => checkAlerts({ retry: retry + 1 }).catch((e) => console.error(e)), 2500); }
    }
  } finally { alertRunning = false; }
}
const scheduleAlertCheck = (ms = 1500) => { clearTimeout(alertTimer); alertTimer = setTimeout(() => checkAlerts().catch((e) => console.error(e)), ms); };

function showAlertPopup(list, prefs) {
  const shown = list.slice(0, ALERT_POP_MAX);
  const more = list.length - shown.length;
  const offer = !prefs.notify && !prefs.offered && notifySupported() && Notification.permission === 'default' && coarsePointer();
  const d = document.createElement('dialog');
  d.className = 'dialog alert-pop';
  d.setAttribute('aria-labelledby', 'ap-title');
  d.innerHTML = `<div class="dialog-body">
      <h2 id="ap-title">${list.length === 1 ? 'Aviso' : `${list.length} avisos`}</h2>
      <ul class="list alerts">${shown.map((a) => `<li><a class="row" href="${esc(a.href)}" data-ap-go><span class="dot ${a.tone}" aria-hidden="true"></span><div class="row-main"><span class="kind">${esc(a.kind)}</span><strong>${esc(a.title)}</strong><span class="sub">${esc(a.text)}</span></div></a></li>`).join('')}</ul>
      ${more > 0 ? `<p class="hint">Y ${more} más en Inicio.</p>` : ''}
      ${offer ? '<div class="ap-offer"><p>¿Quieres recibir también estos avisos como notificación del teléfono, aunque la app esté cerrada?</p><button type="button" class="btn secondary small" data-ap="notify">Activar notificaciones</button></div>' : ''}
      <div class="dialog-actions">
        <button type="button" class="btn secondary" data-ap="close">Cerrar</button>
        <button type="button" class="btn" data-ap="home">Ver avisos</button>
      </div></div>`;
  document.body.append(d);
  const finish = () => { if (d.open) d.close(); d.remove(); if (offer) saveAlertPrefs({ offered: true }).catch(() => {}); };
  d.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ap-go]')) { finish(); return; }   // el enlace lleva al aviso
    const b = e.target.closest('[data-ap]');
    if (!b) return;
    if (b.dataset.ap === 'notify') {
      const res = await enablePhoneNotifications();
      const box = $('.ap-offer', d);
      if (box) box.innerHTML = `<p class="${res.ok ? '' : 'warn'}">${esc(res.message)}</p>`;
      return;
    }
    finish();
    if (b.dataset.ap === 'home') location.hash = '#inicio';
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
  d.showModal();
  $('[data-ap="home"]', d).focus();
}

// ------------------------------------------------------------------ notificaciones del teléfono
async function showPhoneNotification(list) {
  const reg = await navigator.serviceWorker.ready;
  const title = list.length === 1 ? `${list[0].kind}: ${list[0].title}` : `FARMA·LAB: ${list.length} avisos`;
  const body = list.length === 1 ? list[0].text : `${list.slice(0, 4).map((a) => `• ${a.title}`).join('\n')}${list.length > 4 ? `\ny ${list.length - 4} más` : ''}`;
  await reg.showNotification(title, {
    body, tag: ALERT_SYNC_TAG, renotify: true, icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    data: { href: list.length === 1 ? list[0].href : '#inicio' }, requireInteraction: list.some((a) => a.tone === 'red'),
  });
}
/** Comprobación en segundo plano (sincronización periódica de Chrome): «active», «denied» o «unsupported». */
async function registerBackgroundCheck() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  if (!('periodicSync' in reg)) return 'unsupported';
  let st = 'denied';
  try { st = (await navigator.permissions.query({ name: 'periodic-background-sync' })).state; } catch { /* sin permiso */ }
  if (st !== 'granted') return 'denied';
  try { await reg.periodicSync.register(ALERT_SYNC_TAG, { minInterval: 12 * 3600 * 1000 }); return 'active'; } catch { return 'denied'; }
}
async function enablePhoneNotifications() {
  if (!notifySupported()) return { ok: false, message: 'Este navegador no permite notificaciones.' };
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    await saveAlertPrefs({ notify: false, offered: true });
    return { ok: false, message: 'Las notificaciones están bloqueadas para FARMA·LAB. Actívalas en los ajustes del teléfono (Notificaciones de Chrome o de la app) y vuelve a intentarlo.' };
  }
  await saveAlertPrefs({ notify: true, offered: true });
  lastPlanJson = '';
  await saveAlertPlan(await computeAlerts());
  const bg = await registerBackgroundCheck();
  await logOnly('notificaciones_activadas', bg === 'active' ? 'Con comprobación en segundo plano' : 'Solo con la app abierta');
  return {
    ok: true,
    message: bg === 'active'
      ? 'Notificaciones activadas. Con la app cerrada, Chrome comprobará los avisos una o dos veces al día.'
      : 'Notificaciones activadas con la app abierta. Para recibirlas con la app cerrada, instálala desde Chrome (Añadir a pantalla de inicio).',
  };
}

// ------------------------------------------------------------------ Ajustes
SETTINGS_SECTIONS.push(async () => {
  const prefs = await alertPrefs();
  const perm = notifySupported() ? Notification.permission : 'unsupported';
  let bg = 'unsupported';
  if (prefs.notify && perm === 'granted' && 'serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && 'periodicSync' in reg) {
      try { bg = (await reg.periodicSync.getTags()).includes(ALERT_SYNC_TAG) ? 'active' : 'denied'; } catch { bg = 'denied'; }
    }
  }
  const status = perm === 'unsupported' ? 'Este navegador no permite notificaciones.'
    : perm === 'denied' ? 'Bloqueadas: actívalas en los ajustes del teléfono (Notificaciones de Chrome o de la app).'
      : !prefs.notify || perm !== 'granted' ? 'Desactivadas.'
        : bg === 'active' ? 'Activadas, también con la app cerrada (Chrome las comprueba una o dos veces al día, no a hora fija).'
          : 'Activadas con la app abierta. Para recibirlas con la app cerrada, instala la app desde Chrome (Añadir a pantalla de inicio).';
  return `<section><h2>Avisos en este dispositivo</h2><div class="panel stack">
    <form class="form" data-form="alertPrefs" novalidate>
      ${field('Ventana de avisos', `<select name="popup">${options(Object.keys(ALERT_POPUP_MODES), prefs.popup, ALERT_POPUP_MODES)}</select>`, 'Sale al abrir o desbloquear la app y cuando aparece un aviso nuevo: stock bajo, caducidades, temperaturas, calibraciones…')}
      <button class="btn secondary small" type="submit">Guardar</button>
    </form>
    <p><strong>Notificaciones del teléfono:</strong> <span data-notify-status>${esc(status)}</span></p>
    <div class="actions">
      ${prefs.notify && perm === 'granted'
        ? '<button class="btn secondary small" data-act="notifyTest">Probar ahora</button><button class="btn secondary small" data-act="notifyOff">Desactivar</button>'
        : perm === 'unsupported' ? '' : '<button class="btn small" data-act="notifyOn">Activar notificaciones</button>'}
    </div>
    <p class="hint">Se configuran en cada teléfono u ordenador por separado. Las notificaciones no muestran datos de pacientes.</p>
  </div></section>`;
});
Object.assign(FORMS, {
  async alertPrefs(form) {
    const d = formData(form);
    await saveAlertPrefs({ popup: ALERT_POPUP_MODES[d.popup] ? d.popup : 'daily' });
    toast('Ventana de avisos guardada.');
  },
});
Object.assign(ACTIONS, {
  notifyOn: async () => {
    const res = await enablePhoneNotifications();
    toast(res.message);
    await route();
  },
  notifyOff: async () => {
    await saveAlertPrefs({ notify: false });
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) await reg.periodicSync.unregister(ALERT_SYNC_TAG);
    } catch { /* nada que desactivar */ }
    await logOnly('notificaciones_desactivadas', '');
    toast('Notificaciones desactivadas en este dispositivo.');
    await route();
  },
  notifyTest: async () => {
    lastPlanJson = '';
    await saveAlertPlan(await computeAlerts());
    const reg = await navigator.serviceWorker.ready;
    (reg.active || navigator.serviceWorker.controller).postMessage({ type: 'check-alerts', test: true });
    toast('Enviada. Si no ves la notificación, revisa los permisos de notificaciones del teléfono.');
  },
});

// ------------------------------------------------------------------ cuándo se comprueba
AFTER_UNLOCK.push(async () => {
  await checkAlerts();
  const prefs = await alertPrefs();
  if (prefs.notify && notifySupported() && Notification.permission === 'granted') registerBackgroundCheck().catch(() => {});
});
AFTER_SAVE.push(() => scheduleAlertCheck());
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.unlocked) scheduleAlertCheck(800); });
// Al tocar una notificación con la app abierta, el service worker pide ir al aviso.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'goto' && typeof e.data.href === 'string' && /^#[\w-]*$/.test(e.data.href)) location.hash = e.data.href;
  });
}

Object.assign(ACTION_LABELS, {
  notificaciones_activadas: 'Notificaciones del teléfono activadas',
  notificaciones_desactivadas: 'Notificaciones del teléfono desactivadas',
});
