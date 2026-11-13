'use strict';
/*
 * FARMA·LAB móvil · Sincronización entre el móvil y el PC a través de Google Drive.
 *
 * Los datos se guardan en la carpeta oculta de la app en el Drive de la cuenta configurada
 * (appDataFolder, permiso drive.appdata: la app no ve ni toca ningún otro archivo de Drive).
 * Allí hay un archivo con todos los registros y un archivo por cada documento adjunto.
 * Cada equipo sigue funcionando sin conexión; al sincronizar se juntan los cambios de los dos:
 * gana la versión más reciente de cada registro y no se borra nada, salvo lo borrado por
 * fin del plazo de conservación. Las recetas nunca salen del dispositivo.
 *
 * Inicio de sesión: Google Identity Services (ventana de Google). Si la ventana no puede
 * abrirse o no vuelve a la app, se puede abrir Google en la misma ventana (redirección).
 * El permiso dura alrededor de una hora; renovarlo exige tocar un botón.
 * La cuenta y el ID de cliente se escriben en la app: no están en el código publicado.
 */

const SYNC_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SYNC_FILE = 'farmalab-sincronizacion.json';
const SYNC_DOC_PREFIX = 'doc-';
const SYNC_FORMAT = 'farmalab-sincronizacion';
const SYNC_FORMAT_VERSION = 1;
const SYNC_TICK_MS = 30 * 1000;           // cada 30 s se mira si hay cambios que enviar
const SYNC_PULL_MS = 5 * 60 * 1000;       // y cada 5 min se traen los del otro equipo
const SYNC_STALE_MS = 60 * 60 * 1000;     // sin sincronizar en 1 h: el botón se marca
const MULTIPART_MAX = 4 * 1048576;        // por encima, subida reanudable
const CLIENT_ID_RE = /^[0-9]{6,}-[a-z0-9]{8,}\.apps\.googleusercontent\.com$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;

class SyncAuthError extends Error {}      // hay que volver a abrir la sesión de Google (requiere tocar un botón)

const SYNC_SOON_MS = 2500;                // tras guardar, se envía enseguida (sobre todo los lotes)
const sync = { busy: null, lastPull: 0, gis: null, timer: null, soon: null, failures: 0, retryAt: 0, pendingToken: null, flash: null };

Object.assign(ACTION_LABELS, {
  sincronizacion_configurada: 'Sincronización con Google Drive configurada',
  sincronizacion_recibida: 'Cambios recibidos del otro equipo',
  sincronizacion_quitada: 'Sincronización quitada de este dispositivo',
  cambio_lote_repetido: 'Lote repetido sustituido',
});

ROUTES.sincronizacion = () => viewSync();

// ------------------------------------------------------------------ configuración y sesión
async function syncConfig() {
  const c = await metaGet('syncConfig');
  return c && c.account && c.client_id ? c : null;
}
async function syncToken() {
  const t = await metaGet('syncToken');
  return t && t.access_token && t.expires_at - Date.now() > 60000 ? t : null;
}
const syncStateGet = async () => (await metaGet('syncState')) || {};
async function syncStatePatch(patch) {
  const st = { ...(await syncStateGet()), ...patch };
  await metaSet('syncState', st);
  return st;
}
/** Gmail no distingue mayúsculas ni puntos en el nombre. */
function normEmail(v) {
  const e = lc(str(v));
  const [user, domain] = e.split('@');
  return ['gmail.com', 'googlemail.com'].includes(domain) ? `${user.replace(/\./g, '')}@gmail.com` : e;
}
const redirectUri = () => new URL('./', location.href).href;

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!sync.gis) {
    sync.gis = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = GIS_SRC;
      el.async = true;
      el.onload = () => (window.google && google.accounts && google.accounts.oauth2
        ? resolve()
        : reject(new Error('No se ha podido preparar el inicio de sesión de Google.')));
      el.onerror = () => {
        sync.gis = null;
        el.remove();
        reject(new Error('No se ha podido cargar el inicio de sesión de Google. Comprueba la conexión a internet.'));
      };
      document.head.append(el);
    });
  }
  return sync.gis;
}

const GIS_ERRORS = {
  popup_failed_to_open: 'El navegador no ha dejado abrir la ventana de Google. Vuelve a tocar «Sincronizar ahora»; si sigue sin abrirse, usa «Conectar en esta ventana» en Ajustes → Sincronización.',
  popup_closed: 'Se ha cerrado la ventana de Google antes de terminar. Si no volvía sola a la app, usa «Conectar en esta ventana» en Ajustes → Sincronización.',
};
/** Pide a Google permiso para la carpeta de datos de la app (abre la ventana de Google). Debe llamarse al tocar un botón. */
async function requestToken(cfg) {
  await loadGis();
  const res = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: cfg.client_id,
      scope: SYNC_SCOPE,
      login_hint: cfg.account,
      prompt: '',
      callback: resolve,
      error_callback: (e) => reject(new Error(GIS_ERRORS[e && e.type] || 'No se ha podido abrir la sesión de Google.')),
    });
    client.requestAccessToken();
  });
  if (res.error) {
    throw new Error(res.error === 'access_denied'
      ? 'No has dado permiso a FARMA·LAB para guardar sus datos en Google Drive.'
      : `Google no ha permitido la conexión (${res.error}). Revisa el ID de cliente y que la cuenta esté añadida como usuario de prueba.`);
  }
  if (!google.accounts.oauth2.hasGrantedAllScopes(res, SYNC_SCOPE)) {
    throw new Error('Hay que marcar el permiso para que FARMA·LAB guarde sus datos en Google Drive.');
  }
  return acceptToken(cfg, res);
}
/** Comprueba que el permiso es de la cuenta configurada antes de usarlo. */
async function acceptToken(cfg, res) {
  const token = { access_token: res.access_token, expires_at: Date.now() + ((Number(res.expires_in) || 3600) - 60) * 1000 };
  const about = await (await drive(token, `${DRIVE_API}/about?fields=user(emailAddress)`)).json();
  const email = lc(str(about && about.user && about.user.emailAddress));
  if (!email || normEmail(email) !== normEmail(cfg.account)) {
    revokeToken(token.access_token);
    throw new Error(email
      ? `Has entrado con ${email}, pero la sincronización es con ${cfg.account}. Vuelve a intentarlo y elige esa cuenta.`
      : 'No se ha podido comprobar con qué cuenta de Google has entrado. Vuelve a intentarlo.');
  }
  const saved = { ...token, account: email, client_id: cfg.client_id };
  await metaSet('syncToken', saved);
  return saved;
}
function revokeToken(accessToken) {
  // Solo se usa con la cuenta equivocada: retira el permiso concedido por error.
  fetch(GOOGLE_REVOKE, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ token: accessToken }) }).catch(() => {});
}

/** Alternativa a la ventana de Google: se va a Google en esta misma ventana y se vuelve con el permiso. */
async function startRedirect() {
  const cfg = await syncConfig();
  if (!cfg) throw new InputError('Guarda primero la cuenta y el ID de cliente.');
  const nonce = b64e(crypto.getRandomValues(new Uint8Array(18))).replace(/[+/=]/g, '');
  await metaSet('syncRedirect', { state: nonce, at: Date.now() });
  const q = new URLSearchParams({
    client_id: cfg.client_id, redirect_uri: redirectUri(), response_type: 'token', scope: SYNC_SCOPE,
    include_granted_scopes: 'true', login_hint: cfg.account, state: nonce,
  });
  location.assign(`${GOOGLE_AUTH}?${q}`);
}
/** Al volver de Google: se recoge el permiso de la dirección y se quita de ella antes de nada. */
BOOT_HOOKS.push(async () => {
  const hash = location.hash || '';
  if (!/(^#|&)(access_token|error)=/.test(hash)) return;
  const q = new URLSearchParams(hash.slice(1));
  history.replaceState(null, '', `${location.pathname}${location.search}#sincronizacion`);
  const pending = await metaGet('syncRedirect');
  await metaSet('syncRedirect', null);
  if (!pending || q.get('state') !== pending.state || Date.now() - pending.at > 15 * 60000) {
    sync.flash = { tone: 'error', text: 'No se ha podido completar la conexión con Google: la respuesta no corresponde a esta petición. Vuelve a intentarlo.' };
    return;
  }
  if (q.get('error')) {
    sync.flash = { tone: 'error', text: q.get('error') === 'access_denied' ? 'No has dado permiso a FARMA·LAB para guardar sus datos en Google Drive.' : `Google no ha permitido la conexión (${q.get('error')}).` };
    return;
  }
  if (!q.get('access_token') || !String(q.get('scope') || '').split(' ').includes(SYNC_SCOPE)) {
    sync.flash = { tone: 'error', text: 'Hay que marcar el permiso para que FARMA·LAB guarde sus datos en Google Drive.' };
    return;
  }
  sync.pendingToken = { access_token: q.get('access_token'), expires_in: q.get('expires_in') };
});

// ------------------------------------------------------------------ Google Drive (carpeta oculta de la app)
async function drive(token, url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token.access_token}`, ...(opts.headers || {}) } });
  } catch {
    throw new Error('No hay conexión con Google Drive. Se volverá a intentar más tarde.');
  }
  if (res.ok) return res;
  if (res.status === 401) {
    await metaSet('syncToken', null);
    throw new SyncAuthError('La sesión de Google ha caducado. Toca «Sincronizar ahora» para abrirla de nuevo.');
  }
  let reason = '';
  try {
    const j = await res.json();
    const e = (j && j.error) || {};
    reason = String((e.errors && e.errors[0] && e.errors[0].reason) || e.status || e.message || '');
  } catch { /* respuesta sin detalles */ }
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) throw new Error('La API de Google Drive no está activada en el proyecto de Google Cloud (paso 2 de la guía).');
  if (/storageQuota/i.test(reason)) throw new Error('El Google Drive de la cuenta está lleno. Libera espacio para poder sincronizar.');
  if (res.status === 429 || /rateLimit|userRateLimit/i.test(reason) || res.status >= 500) throw new Error('Google Drive está ocupado ahora mismo. Se volverá a intentar en unos minutos.');
  throw new Error(`Google Drive ha respondido con un error (${res.status}${reason ? `: ${reason}` : ''}).`);
}
async function listRemote(token) {
  const files = [];
  let page = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,version,appProperties)', pageSize: '1000' });
    if (page) q.set('pageToken', page);
    const j = await (await drive(token, `${DRIVE_API}/files?${q}`)).json();
    files.push(...((j && j.files) || []));
    page = (j && j.nextPageToken) || '';
  } while (page);
  return files;
}
const downloadBytes = async (token, id) => new Uint8Array(await (await drive(token, `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer());
async function uploadFile(token, { id, name, mime, body, appProperties = {} }) {
  const blob = body instanceof Blob ? body : new Blob([body], { type: mime });
  const meta = id ? { appProperties } : { name, parents: ['appDataFolder'], mimeType: mime, appProperties };
  const method = id ? 'PATCH' : 'POST';
  const base = `${DRIVE_UPLOAD}/files${id ? `/${encodeURIComponent(id)}` : ''}`;
  if (blob.size <= MULTIPART_MAX) {
    const boundary = `farmalab-${newId()}`;
    const parts = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      blob, `\r\n--${boundary}--\r\n`,
    ]);
    return (await drive(token, `${base}?uploadType=multipart&fields=id,version`, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: parts })).json();
  }
  const start = await drive(token, `${base}?uploadType=resumable&fields=id,version`, {
    method, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime }, body: JSON.stringify(meta),
  });
  const session = start.headers.get('Location');
  if (!session || !session.startsWith(DRIVE_UPLOAD)) throw new Error('Google Drive no ha aceptado la subida de un archivo grande.');
  return (await drive(token, session, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob })).json();
}
async function deleteRemote(token, id) {
  try { await drive(token, `${DRIVE_API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (err) { if (err instanceof SyncAuthError) throw err; }
}

// ------------------------------------------------------------------ sincronizar
const byUuid = (a, b) => String(a.uuid).localeCompare(String(b.uuid));
/** Lo que este dispositivo comparte: todo menos las recetas, el PIN y la configuración de la sincronización. */
async function localSyncContent() {
  const datos = {};
  for (const s of STORES) datos[s] = (await getAll(s)).sort(byUuid);
  datos[FILE_STORE] = (await getAll(FILE_STORE)).filter((f) => !isLocalOnly(f)).map(({ blob, ...meta }) => meta).sort(byUuid);
  return { ajustes: await loadSettings(), datos, borrados: cleanTombstones(await metaGet('tombstones')) };
}
/** true si el archivo de Drive no tiene algo de lo que hay en este dispositivo (o lo tiene más antiguo). */
function remoteLacks(payload, local) {
  const d = (payload && payload.datos) || {};
  for (const s of [...STORES, FILE_STORE]) {
    const have = new Map((Array.isArray(d[s]) ? d[s] : []).filter(Boolean).map((r) => [r.uuid, String(r.updated_at || '')]));
    for (const r of local.datos[s]) {
      const u = have.get(r.uuid);
      if (u === undefined || String(r.updated_at || '') > u) return true;
    }
  }
  const remoteTombs = cleanTombstones(payload && payload.borrados);
  for (const [id, t] of Object.entries(local.borrados)) if (!remoteTombs[id] || remoteTombs[id].at < t.at) return true;
  const rs = normalizeSettings(payload && payload.ajustes);
  return JSON.stringify(mergeSettings(rs, local.ajustes)) !== JSON.stringify(rs);
}
async function fetchDoc(token, docFiles, raw) {
  if (!docMetaOk(raw)) return null;
  const f = docFiles.get(raw.uuid);
  if (!f || (f.appProperties && f.appProperties.sha256 && f.appProperties.sha256 !== raw.sha256)) return null;   // aún no ha llegado: la próxima vez
  return docFromBytes(raw, await downloadBytes(token, f.id));
}
/** Una vuelta completa: traer y unir lo de Drive, subir documentos nuevos y, si hace falta, el archivo de datos. */
async function syncOnce(token) {
  const files = await listRemote(token);
  const dataFiles = files.filter((f) => f.name === SYNC_FILE).sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  const docFiles = new Map(files.filter((f) => f.name.startsWith(SYNC_DOC_PREFIX)).map((f) => [f.name.slice(SYNC_DOC_PREFIX.length), f]));
  const out = { received: 0, removed: 0, sent: false, docsSent: 0 };
  let payload = null;
  for (const f of dataFiles) {
    let p = null;
    try { p = JSON.parse(new TextDecoder().decode(await downloadBytes(token, f.id))); } catch (err) { if (err instanceof SyncAuthError) throw err; }
    if (!p || p.formato !== SYNC_FORMAT || !p.datos || typeof p.datos !== 'object') continue;   // archivo dañado: se sustituye
    if (Number(p.version_formato) > SYNC_FORMAT_VERSION) throw new Error('El otro equipo tiene una versión más nueva de FARMA·LAB. Actualiza la app en este dispositivo (Ajustes → Acerca de).');
    const { plan, counts } = await planMerge(p.datos, p.ajustes, p.borrados, (raw) => fetchDoc(token, docFiles, raw));
    await applyMerge(plan);
    out.received += counts.records;
    out.removed += counts.removed;
    if (f === dataFiles[0]) payload = p;
  }
  const changeMark = await metaGet('lastChange');
  const local = await localSyncContent();
  // Primero los documentos: el archivo de datos nunca apunta a un documento que aún no está en Drive.
  for (const meta of local.datos[FILE_STORE]) {
    const f = docFiles.get(meta.uuid);
    if (f && f.appProperties && f.appProperties.sha256 === meta.sha256) continue;
    const doc = await getOne(FILE_STORE, meta.uuid);
    if (!doc || !doc.blob || isLocalOnly(doc)) continue;
    const up = await uploadFile(token, { id: f && f.id, name: `${SYNC_DOC_PREFIX}${doc.uuid}`, mime: doc.mime || 'application/octet-stream', body: doc.blob, appProperties: { sha256: doc.sha256 } });
    docFiles.set(doc.uuid, { id: up.id, appProperties: { sha256: doc.sha256 } });
    out.docsSent += 1;
  }
  for (const [id, f] of docFiles) if (local.borrados[id]) await deleteRemote(token, f.id);
  const main = dataFiles[0];
  if (!payload || dataFiles.length > 1 || remoteLacks(payload, local)) {
    if (main) {
      const now = await (await drive(token, `${DRIVE_API}/files/${encodeURIComponent(main.id)}?fields=version`)).json();
      if (String(now.version) !== String(main.version)) return { ...out, retry: true };   // el otro equipo acaba de subir: otra vuelta
    }
    const body = JSON.stringify({
      formato: SYNC_FORMAT, version_formato: SYNC_FORMAT_VERSION, app: `FARMA·LAB móvil ${APP_VERSION}`,
      actualizado: nowIso(), dispositivo: state.deviceId, usuario: state.profile ? state.profile.name : '', ...local,
    });
    await uploadFile(token, { id: main && main.id, name: SYNC_FILE, mime: 'application/json', body });
    for (const extra of dataFiles.slice(1)) await deleteRemote(token, extra.id);
    out.sent = true;
  }
  out.changeMark = changeMark;
  return out;
}
async function runSync(interactive) {
  const cfg = await syncConfig();
  if (!cfg) throw new InputError('Configura primero la cuenta de Google y el ID de cliente.');
  if (!navigator.onLine) throw new Error('No hay conexión a internet. Se sincronizará cuando vuelva.');
  let token = await syncToken();
  if (token && (token.client_id !== cfg.client_id || normEmail(token.account) !== normEmail(cfg.account))) token = null;
  if (!token) {
    if (!interactive) throw new SyncAuthError('Hay que abrir la sesión de Google.');
    token = await requestToken(cfg);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await syncOnce(token);
    if (!r.retry) return r;
  }
  throw new Error('El otro equipo está sincronizando a la vez. Se volverá a intentar en un momento.');
}
/** Sincroniza (una sola vez a la vez). interactive: se ha tocado un botón y se puede abrir la ventana de Google. */
function syncNow({ interactive = false } = {}) {
  if (sync.busy) return sync.busy;
  sync.busy = (async () => {
    updateSyncButton();
    try {
      const r = await runSync(interactive);
      sync.lastPull = Date.now();
      sync.failures = 0; sync.retryAt = 0;
      await syncStatePatch({ last_ok: nowIso(), synced_change: r.changeMark || '', error: '' });
      if (r.received) await logOnly('sincronizacion_recibida', `${r.received} ${r.received === 1 ? 'cambio' : 'cambios'}${r.removed ? `, de ellos ${r.removed} por fin del plazo de conservación` : ''}`);
      return r;
    } catch (err) {
      if (err instanceof SyncAuthError) {
        await syncStatePatch({ error: '' });
      } else {
        sync.failures += 1;
        sync.retryAt = Date.now() + Math.min(SYNC_TICK_MS * 2 ** sync.failures, 15 * 60000);
        if (!(err instanceof InputError)) await syncStatePatch({ error: err.message, error_at: nowIso() });
      }
      throw err;
    } finally {
      sync.busy = null;
      updateSyncButton();
    }
  })();
  return sync.busy;
}
const syncResultText = (r) => (r.received
  ? `Sincronizado: ${r.received} ${r.received === 1 ? 'cambio recibido' : 'cambios recibidos'} del otro equipo.`
  : r.sent ? 'Sincronizado: cambios enviados al otro equipo.' : 'Sincronizado. No había cambios.');
/** Tras sincronizar sin que se haya pedido: se repinta la pantalla solo si no hay un formulario a medias. */
async function afterBackgroundSync(r) {
  if (location.hash === '#sincronizacion') await route();
  if (!r || !r.received) return;
  updateAlertBadge().catch(() => {});
  if (location.hash !== '#sincronizacion' && !$('#view form')) await route();
  toast(syncResultText(r));
}
AFTER_SAVE.push(() => {
  clearTimeout(sync.soon);
  sync.soon = setTimeout(() => { syncTick().catch(() => {}); }, SYNC_SOON_MS);
});
async function syncTick() {
  if (!state.unlocked || sync.busy || document.hidden || !navigator.onLine || Date.now() < sync.retryAt) { updateSyncButton(); return; }
  const cfg = await syncConfig();
  if (!cfg) return;
  if (cfg.auto === false || !(await syncToken())) { updateSyncButton(); return; }
  const st = await syncStateGet();
  const lastChange = await metaGet('lastChange');
  const due = (lastChange && lastChange > (st.synced_change || '')) || Date.now() - sync.lastPull > SYNC_PULL_MS;
  if (!due) return;
  try { await afterBackgroundSync(await syncNow()); } catch { /* queda anotado en el estado */ }
}

AFTER_UNLOCK.push(async () => {
  if (!sync.timer) {
    sync.timer = setInterval(() => { syncTick().catch(() => {}); }, SYNC_TICK_MS);
    window.addEventListener('online', () => { syncTick().catch(() => {}); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => syncTick().catch(() => {}), 1500); });
  }
  const cfg = await syncConfig();
  if (!cfg) return;
  if (navigator.onLine) loadGis().catch(() => {});   // así la ventana de Google se abre al momento al tocar el botón
  if (sync.pendingToken) {
    const pending = sync.pendingToken;
    sync.pendingToken = null;
    try {
      await acceptToken(cfg, pending);
      sync.flash = { tone: 'ok', text: 'Sesión de Google abierta. Sincronizando…' };
    } catch (err) {
      sync.flash = { tone: 'error', text: err.message };
      if (location.hash === '#sincronizacion') await route();
      return;
    }
    if (location.hash === '#sincronizacion') await route();
  }
  if (cfg.auto !== false && (await syncToken())) {
    syncNow().then(afterBackgroundSync).catch(() => { if (location.hash === '#sincronizacion') route(); });
  }
  updateSyncButton();
});

// ------------------------------------------------------------------ botón de la barra superior
async function syncSnapshot() {
  const cfg = await syncConfig();
  if (!cfg) return null;
  const [token, st, lastChange] = await Promise.all([syncToken(), syncStateGet(), metaGet('lastChange')]);
  const pending = Boolean(lastChange) && lastChange > (st.synced_change || '');
  const stale = !st.last_ok || Date.now() - Date.parse(st.last_ok) > SYNC_STALE_MS;
  return { cfg, token, st, pending, stale };
}
async function updateSyncButton() {
  const btn = $('#syncBtn');
  if (!btn) return;
  const s = await syncSnapshot();
  btn.hidden = !s;
  if (!s) return;
  let stateName; let label;
  if (sync.busy) { stateName = 'busy'; label = 'Sincronizando con Google Drive…'; }
  else if (s.st.error) { stateName = 'error'; label = `Error al sincronizar: ${s.st.error} Toca para reintentar.`; }
  else if (s.pending || s.stale) { stateName = 'pending'; label = s.pending ? 'Hay cambios sin enviar al otro equipo. Toca para sincronizar.' : 'Hace más de una hora que no se sincroniza. Toca para sincronizar.'; }
  else { stateName = 'ok'; label = `Sincronizado (${fmtStamp(s.st.last_ok)}). Toca para sincronizar de nuevo.`; }
  btn.dataset.state = stateName;
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
AFTER_RENDER.push(() => { updateSyncButton().catch(() => {}); });

// ------------------------------------------------------------------ lotes: no repetirlos entre los dos equipos
/** Antes de dar un número de lote se traen los lotes del otro equipo. */
BEFORE_LOT.push(async () => {
  const cfg = await syncConfig();
  if (!cfg) return true;
  const risk = 'Si en el otro equipo se ha elaborado algo desde la última sincronización, el número de lote podría repetirse.';
  if (!navigator.onLine) return ask({ title: 'Sin conexión', message: `No se puede sincronizar antes de asignar el lote. ${risk}`, confirmLabel: 'Asignar el lote igualmente' });
  let interactive = false;
  if (!(await syncToken())) {
    interactive = await ask({
      title: 'Sincronizar antes del lote',
      message: `Para no repetir números de lote con el otro equipo, conviene sincronizar ahora. Google te pedirá confirmar la cuenta.\n\n${risk}`,
      confirmLabel: 'Sincronizar y seguir', cancelLabel: 'Seguir sin sincronizar',
    });
    if (!interactive) return true;
  }
  try {
    const r = await syncNow({ interactive });
    if (r.received) toast(syncResultText(r));
    return true;
  } catch (err) {
    return ask({ title: 'No se ha podido sincronizar', message: `${err.message}\n\n${risk}`, confirmLabel: 'Asignar el lote igualmente' });
  }
});
async function duplicateLots() {
  const groups = new Map();
  for (const p of await getAll('production')) {
    if (!p.lot) continue;
    if (!groups.has(p.lot)) groups.set(p.lot, []);
    groups.get(p.lot).push(p);
  }
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => String(a.status_changed_at || a.created_at).localeCompare(String(b.status_changed_at || b.created_at))));
}
ALERT_SOURCES.push(async () => (await duplicateLots()).map((g) => ({
  tone: 'red', kind: 'Lote repetido', title: g[0].lot,
  text: `${g.length} elaboraciones tienen el mismo lote (se asignó en los dos equipos sin sincronizar). Dale un lote nuevo a una de ellas.`,
  href: '#sincronizacion',
})));

// ------------------------------------------------------------------ pantalla de sincronización
function syncSteps() {
  const origin = location.origin;
  return `<ol class="steps">
    <li>Entra en <strong>console.cloud.google.com</strong> con la cuenta de Google de la sincronización y crea un proyecto (por ejemplo, «FARMA·LAB»).</li>
    <li>En «APIs y servicios» → «Biblioteca», busca <strong>Google Drive API</strong> y pulsa «Habilitar».</li>
    <li>En «Google Auth Platform» (pantalla de consentimiento de OAuth): tipo de usuario <strong>Externo</strong>, nombre de la app y tu correo. En «Público», añade la cuenta de la sincronización como <strong>usuario de prueba</strong>.</li>
    <li>En «Clientes», crea un cliente de tipo <strong>Aplicación web</strong>. En «Orígenes de JavaScript autorizados» añade <code>${esc(origin)}</code> y en «URI de redirección autorizados» añade <code>${esc(redirectUri())}</code>.</li>
    <li>Copia el <strong>ID de cliente</strong> (termina en .apps.googleusercontent.com) y pégalo aquí, en el móvil y en el PC, con la misma cuenta.</li>
  </ol>`;
}
async function viewSync() {
  if (navigator.onLine) loadGis().catch(() => {});   // la ventana de Google se abrirá al momento
  const cfg = (await metaGet('syncConfig')) || {};
  const snap = await syncSnapshot();
  const flash = sync.flash;
  sync.flash = null;
  const dups = await duplicateLots();
  const until = snap && snap.token ? new Date(snap.token.expires_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
  const status = snap ? `<section><h2>Estado</h2><div class="panel stack">
      ${facts([
        ['Cuenta', esc(snap.cfg.account)],
        ['Última sincronización', snap.st.last_ok ? esc(fmtStamp(snap.st.last_ok)) : 'ninguna todavía'],
        ['Sesión de Google', snap.token ? `abierta hasta las ${esc(until)}` : 'cerrada: se abre al tocar «Sincronizar ahora»'],
        ['Cambios sin enviar', snap.pending ? '<span class="bad">sí</span>' : 'no'],
      ])}
      ${snap.st.error ? `<p class="msg error">${esc(snap.st.error)}</p>` : ''}
      <div class="actions">
        <button class="btn" data-act="syncNow">Sincronizar ahora</button>
        ${snap.token ? '<button class="btn secondary" data-act="syncSignOut">Cerrar la sesión de Google</button>' : ''}
      </div>
      <p class="hint">Google pide confirmar la cuenta cada hora más o menos. Con la sesión abierta, los cambios se envían solos en menos de un minuto y los del otro equipo llegan cada 5 minutos. El botón de la nube, arriba, sincroniza en cualquier momento: punto verde, al día; ámbar, pendiente; rojo, error.</p>
    </div></section>` : '';
  const dupHtml = dups.length ? `<section><h2>Lotes repetidos</h2><div class="panel stack">
      <p>Estos lotes se asignaron en los dos equipos a la vez, sin sincronizar. Dale un lote nuevo a la elaboración que corresponda y vuelve a imprimir su etiqueta y su ficha.</p>
      <ul class="list">${dups.map((g) => g.map((p) => `<li><div class="row"><a class="row-main" href="#elaboraciones--${esc(p.uuid)}"><strong>${esc(p.lot)}</strong><span class="sub"><span>${esc(p.formula_name)}</span><span>${esc(p.record_code)}</span><span>${esc(STATUS.production[p.status] || p.status)}</span></span></a><button class="btn secondary small" data-act="reassignLot" data-id="${esc(p.uuid)}">Lote nuevo</button></div></li>`).join('')).join('')}</ul>
    </div></section>` : '';
  return `${flash ? `<div class="msg ${flash.tone === 'error' ? 'error' : 'ok'}" role="alert">${esc(flash.text)}</div>` : ''}
    <p class="hint intro">El móvil y el PC guardan sus datos en una carpeta oculta del Google Drive de la cuenta indicada, a la que solo accede FARMA·LAB. Cada equipo sigue funcionando sin conexión; al sincronizar se juntan los cambios de los dos.</p>
    ${status}
    ${dupHtml}
    <form class="form" data-form="syncConfig" novalidate autocomplete="off">
      <section><h2>${snap ? 'Configuración' : 'Configurar'}</h2><div class="panel form">
        ${formMsg()}
        ${field('Cuenta de Google', `<input type="email" name="account" value="${esc(cfg.account || '')}" maxlength="120" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="nombre@gmail.com" required>`, 'La misma en el móvil y en el PC. Solo se sincroniza si se entra con esta cuenta.')}
        ${field('ID de cliente de Google', `<input type="text" name="client_id" value="${esc(cfg.client_id || '')}" maxlength="200" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="123456789012-abc….apps.googleusercontent.com" required>`, 'Se obtiene una sola vez en Google Cloud: mira los pasos de abajo.')}
        ${checkbox('auto', 'Sincronizar automáticamente mientras la sesión de Google esté abierta', cfg.auto !== false)}
        <button class="btn" type="submit">${snap ? 'Guardar' : 'Guardar y conectar'}</button>
        ${snap ? '<button class="btn danger-outline" type="button" data-act="syncRemove">Quitar la sincronización de este dispositivo</button>' : ''}
      </div></section>
    </form>
    <section><h2>Qué se sincroniza</h2><div class="panel stack">
      <p>Materias primas, acondicionamiento, fórmulas, PNT, bibliografía, elaboraciones, sus documentos adjuntos, los ajustes de la farmacia y el registro de actividad.</p>
      <p><strong>Las recetas no se sincronizan:</strong> llevan datos de pacientes y se quedan solo en el dispositivo donde se adjuntaron. Tampoco el PIN.</p>
      <p>Al sincronizar no se borra nada, salvo lo que el otro equipo haya borrado por fin del plazo de conservación. Si los dos equipos cambian lo mismo, se queda el cambio más reciente.</p>
      <p class="hint">Antes de dar un número de lote, la app sincroniza para no repetirlo con el otro equipo. Las copias de seguridad siguen siendo recomendables.</p>
    </div></section>
    <section><h2>Primera vez: obtener el ID de cliente</h2><div class="panel">${syncSteps()}</div></section>
    ${snap ? `<section><h2>Si la ventana de Google no se abre o no vuelve</h2><div class="panel stack">
      <p>En algunos móviles la ventana de Google no vuelve sola a la app instalada. Entonces conecta abriendo Google en esta misma ventana; al volver tendrás que escribir el PIN.</p>
      <button class="btn secondary" data-act="syncRedirect">Conectar en esta ventana</button>
    </div></section>` : ''}`;
}
SETTINGS_SECTIONS.push(async () => {
  const snap = await syncSnapshot();
  const line = !snap ? 'Sin configurar: los datos solo están en este dispositivo.'
    : snap.st.error ? `Error en la última sincronización.`
      : snap.st.last_ok ? `Con ${snap.cfg.account}. Última: ${fmtStamp(snap.st.last_ok)}${snap.pending ? ' (hay cambios sin enviar)' : ''}.` : `Con ${snap.cfg.account}. Aún no se ha sincronizado.`;
  return `<section><h2>Sincronización móvil y PC</h2><ul class="list"><li><a class="row" href="#sincronizacion"><span class="row-main"><strong>Google Drive</strong><span class="sub"><span>${esc(line)}</span></span></span></a></li></ul></section>`;
});

// ------------------------------------------------------------------ acciones y formulario
Object.assign(ACTIONS, {
  syncNow: async () => {
    if (!(await syncConfig())) { location.hash = '#sincronizacion'; return; }
    let r;
    try {
      r = await syncNow({ interactive: true });
    } catch (err) {
      throw err instanceof InputError ? err : new InputError(err.message);   // los mensajes ya están pensados para leerse tal cual
    } finally {
      if (location.hash === '#sincronizacion') await route();
    }
    if (location.hash !== '#sincronizacion' && r.received && !$('#view form')) await route();
    updateAlertBadge().catch(() => {});
    toast(syncResultText(r));
  },
  syncSignOut: async () => {
    // Solo se olvida aquí: retirar el permiso en Google cerraría también la sesión del otro equipo.
    await metaSet('syncToken', null);
    toast('Sesión de Google cerrada en este dispositivo. Los datos siguen en los dos equipos.');
    await route();
  },
  syncRedirect: () => startRedirect(),
  syncRemove: async () => {
    const ok = await ask({
      title: 'Quitar la sincronización',
      message: 'Este dispositivo dejará de sincronizarse. Sus datos se quedan como están y los de Google Drive también (se pueden borrar desde Google Drive → Configuración → Administrar aplicaciones).',
      confirmLabel: 'Quitar', danger: true,
    });
    if (!ok) return;
    await tx('meta', 'readwrite', (t) => { ['syncConfig', 'syncToken', 'syncState'].forEach((k) => t.objectStore('meta').delete(k)); });
    await logOnly('sincronizacion_quitada', 'Google Drive');
    toast('Sincronización quitada de este dispositivo.');
    await route();
  },
  reassignLot: async (el) => {
    const rec = await getOne('production', el.dataset.id);
    if (!rec || !rec.lot) return;
    if (!(await duplicateLots()).some((g) => g.some((p) => p.uuid === rec.uuid))) { toast('Ese lote ya no está repetido.'); await route(); return; }
    if (!(await beforeLot())) return;
    const s = await loadSettings();
    const used = new Set((await getAll('production')).map((x) => x.lot).filter(Boolean));
    let n = Number(s.lot.next) || 1;
    while (used.has(makeLot(s, n, rec.elaborated_date))) n += 1;
    const lot = makeLot(s, n, rec.elaborated_date);
    const ok = await ask({
      title: 'Dar un lote nuevo',
      message: `${rec.formula_name} (${rec.record_code}) pasará del lote ${rec.lot} al ${lot}. El cambio queda en el registro de actividad. Vuelve a imprimir su etiqueta y su ficha.`,
      confirmLabel: 'Cambiar el lote',
    });
    if (!ok) return;
    const old = rec.lot;
    rec.previous_lots = [...(Array.isArray(rec.previous_lots) ? rec.previous_lots : []), old];
    rec.lot = lot;
    rec.lot_number = n;
    const ns = { ...s, lot: { ...s.lot, next: n + 1 }, updated_at: nowIso() };
    await saveMany([['production', rec]], 'cambio_lote_repetido', `${old} → ${lot} (${rec.record_code} ${rec.formula_name})`, [], { settings: ns });
    state.settings = ns;
    toast(`Nuevo lote: ${lot}.`);
    await route();
  },
});

Object.assign(FORMS, {
  async syncConfig(form) {
    const d = formData(form);
    const account = lc(str(d.account));
    const clientId = str(d.client_id);
    if (!EMAIL_RE.test(account)) throw new InputError('Escribe la dirección completa de la cuenta de Google (por ejemplo, nombre@gmail.com).');
    if (!CLIENT_ID_RE.test(clientId)) throw new InputError('El ID de cliente no es válido. Cópialo entero desde Google Cloud: son números, un guion y termina en .apps.googleusercontent.com.');
    const prev = (await metaGet('syncConfig')) || {};
    const changed = normEmail(prev.account) !== normEmail(account) || prev.client_id !== clientId;
    await tx('meta', 'readwrite', (t) => {
      const meta = t.objectStore('meta');
      meta.put({ account, client_id: clientId, auto: d.auto === 'on', updated_at: nowIso() }, 'syncConfig');
      if (changed) { meta.delete('syncToken'); meta.delete('syncState'); }
    });
    if (changed) await logOnly('sincronizacion_configurada', 'Google Drive');
    if (!prev.account) {
      // Primera vez: se conecta ya, aprovechando que se acaba de tocar un botón.
      try {
        toast(syncResultText(await syncNow({ interactive: true })));
      } catch (err) {
        sync.flash = { tone: 'error', text: err.message };
      }
    } else {
      toast(changed ? 'Configuración guardada. Toca «Sincronizar ahora» para conectar con la nueva cuenta.' : 'Configuración guardada.');
    }
    await route();
  },
});
