'use strict';
/*
 * FARMA·LAB móvil
 * App web instalable (PWA). Todos los datos se guardan en este dispositivo (IndexedDB).
 * Cada registro lleva uuid, created_at, updated_at y device_id para poder
 * sincronizarlo más adelante con la versión de PC.
 */

const APP_VERSION = '0.2.0';
const PREVIEW = document.documentElement.dataset.preview === '1'; // copia de prueba publicada en Claude
const DB_NAME = 'farmalab-movil';
const EXPORT_FORMAT = 'farmalab-datos';
const EXPORT_FORMAT_VERSION = 2;          // 2: incluye los documentos de los PNT
const DB_VERSION = 2;                     // 2: almacén de documentos de PNT
const FILE_STORE = 'pnt_file';
const MAX_DOC_BYTES = 25 * 1048576;
const DOC_TYPES = {
  pdf: { label: 'PDF', mime: 'application/pdf' },
  docx: { label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  doc: { label: 'Word 97-2003', mime: 'application/msword' },
};
const DOC_ACCEPT = '.pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';
const STORES = ['material', 'formula', 'pnt', 'production', 'audit'];
const LOCK_HIDDEN_MS = 5 * 60 * 1000;   // bloqueo tras 5 min con la app en segundo plano
const LOCK_IDLE_MS = 15 * 60 * 1000;    // o tras 15 min sin tocar la pantalla
const PBKDF2_ITERATIONS = 200000;
const BACKUP_REMINDER_DAYS = 7;
const EXPIRY_WARNING_DAYS = 30;

const MATERIAL_UNITS = ['g', 'kg', 'ml', 'l', 'unidades'];
const COMPONENT_UNITS = ['g', 'ml', 'mg', 'unidades'];
const FORMULA_UNITS = ['g', 'ml', 'unidades'];
const STATUS = {
  material: { cuarentena: 'Cuarentena', aceptado: 'Aceptado', bloqueado: 'Bloqueado' },
  formula: { borrador: 'Borrador', aprobada: 'Aprobada', obsoleta: 'Obsoleta' },
  pnt: { borrador: 'Borrador', vigente: 'Vigente', obsoleto: 'Obsoleto' },
  production: { borrador: 'En elaboración', pendiente_revision: 'Pendiente de revisión' },
};
const TONE = { cuarentena: 'amber', aceptado: 'green', bloqueado: 'red', aprobada: 'green', vigente: 'green', pendiente_revision: 'amber' };
const ACTION_LABELS = {
  inicio_sesion: 'Desbloqueo de la app',
  alta_lote_materia_prima: 'Alta de lote de materia prima',
  cambio_estado_materia_prima: 'Cambio de estado de materia prima',
  alta_formula: 'Alta de fórmula',
  cambio_estado_formula: 'Cambio de estado de fórmula',
  alta_pnt: 'Alta de PNT',
  alta_documento_pnt: 'Documento de PNT subido',
  cambio_estado_pnt: 'Cambio de estado de PNT',
  crear_registro_elaboracion: 'Nuevo registro de elaboración',
  actualizar_pesadas: 'Pesadas y lotes guardados',
  enviar_revision: 'Enviado a revisión farmacéutica',
  cambio_pin: 'Cambio de PIN',
  exportar_copia: 'Copia de seguridad exportada',
  importar_copia: 'Copia importada',
  cambio_contrasena: 'Cambio de contraseña',
  crear_usuario: 'Alta de usuario',
  cierre_sesion: 'Cierre de sesión',
};
const SECTIONS = {
  '': { title: 'FARMA·LAB', tab: 0 },
  materias: { title: 'Materias primas', tab: 1 },
  formulas: { title: 'Fórmulas', tab: 2 },
  elaboraciones: { title: 'Elaboraciones', tab: 3 },
  pnt: { title: 'PNT', tab: 4 },
  ajustes: { title: 'Ajustes' },
  auditoria: { title: 'Actividad' },
  documento: { title: 'Documento', tab: 4 },
};

const state = {
  profile: null, deviceId: null, unlocked: false,
  hiddenAt: 0, lastTouch: Date.now(),
  deferredInstall: null, swWaiting: null, updateRequested: false,
  formulaCache: {}, materials: [], prevHash: '', parent: '#inicio', objectUrls: [],
};

// ------------------------------------------------------------------ utilidades
class InputError extends Error {}
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v) => String(v ?? '').trim();
const lc = (v) => String(v ?? '').toLocaleLowerCase('es');
const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const pad2 = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const fmtNum = (n) => (isNum(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: 6, useGrouping: false }) : '—');
const inputNum = (n) => (isNum(n) ? fmtNum(n) : '');
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fmtDay = (v) => (isDay(v) ? v.split('-').reverse().join('/') : '—');
const fmtStamp = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const daysUntil = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 864e5);
};
const options = (list, selected, labels) =>
  list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labels ? labels[v] : v)}</option>`).join('');
const byText = (k) => (a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'es', { numeric: true, sensitivity: 'base' });
const byNewest = (a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at));

/** Número escrito por la persona: admite coma o punto decimal; rechaza el punto de miles ambiguo. */
function parseNum(value, label) {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (raw === '') return null;
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(raw)) {
    throw new InputError(`${label}: «${raw}» es ambiguo. Escribe 1000 para mil o 1,000 si son decimales.`);
  }
  const t = raw.replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) throw new InputError(`${label}: «${raw}» no es un número válido.`);
  return Number(t);
}

const b64e = (u8) => btoa(String.fromCharCode(...u8));
const fmtSize = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hashPin(pin, saltB64, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(saltB64), iterations }, key, 256);
  return b64e(new Uint8Array(bits));
}
function checkPinFormat(pin) {
  if (!/^\d{4,8}$/.test(pin || '')) throw new InputError('El PIN debe tener entre 4 y 8 cifras.');
}

// ------------------------------------------------------------------ base de datos
let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        // Solo crea lo que falta: al pasar de la v1 a la v2 no se toca ningún dato existente.
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'uuid' }); });
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          db.createObjectStore(FILE_STORE, { keyPath: 'uuid' }).createIndex('pnt_uuid', 'pnt_uuid');
        }
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Cierra las otras pestañas de FARMA·LAB y vuelve a abrirla.'));
    });
  }
  return dbPromise;
}
async function tx(stores, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = work(t);
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada'));
  });
}
const getAll = (s) => tx(s, 'readonly', (t) => t.objectStore(s).getAll());
const getOne = (s, id) => tx(s, 'readonly', (t) => t.objectStore(s).get(id));
const metaGet = (k) => tx('meta', 'readonly', (t) => t.objectStore('meta').get(k));
const metaSet = (k, v) => tx('meta', 'readwrite', (t) => t.objectStore('meta').put(v, k));

function auditEntry(action, detail, stamp) {
  return {
    uuid: newId(), created_at: stamp, updated_at: stamp, device_id: state.deviceId,
    user: state.profile ? state.profile.name : '', action, detail: String(detail ?? '').slice(0, 500),
  };
}
/** Guarda uno o varios registros y su línea de auditoría en una sola operación. */
async function saveMany(entries, action, detail) {
  const stamp = nowIso();
  entries.forEach(([, r]) => {
    r.created_at = r.created_at || stamp;
    r.updated_at = stamp;
    r.device_id = r.device_id || state.deviceId;
  });
  const stores = [...new Set(entries.map(([store]) => store)), 'audit', 'meta'];
  await tx(stores, 'readwrite', (t) => {
    entries.forEach(([store, r]) => t.objectStore(store).put(r));
    t.objectStore('audit').put(auditEntry(action, detail, stamp));
    t.objectStore('meta').put(stamp, 'lastChange');
  });
}
async function save(store, record, action, detail) {
  await saveMany([[store, record]], action, detail);
  return record;
}
const filesOf = (pntId) => tx(FILE_STORE, 'readonly', (t) => t.objectStore(FILE_STORE).index('pnt_uuid').getAll(pntId));
const logOnly = (action, detail) => tx('audit', 'readwrite', (t) => t.objectStore('audit').put(auditEntry(action, detail, nowIso())));

// ------------------------------------------------------------------ iconos
const svg = (body) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  cross: '<svg class="i solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
  home: svg('<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
  jar: svg('<path d="M8 3h8v3H8z"/><path d="M7 6h10l1.5 3v10.5A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5V9z"/><path d="M5.5 12h13"/>'),
  flask: svg('<path d="M9 3h6"/><path d="M10 3v6.2L4.8 18.4A1.7 1.7 0 0 0 6.3 21h11.4a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3"/><path d="M7.2 15h9.6"/>'),
  scale: svg('<path d="M12 4v16M7 20h10M5 7h14M12 4l0 3"/><path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0z"/><path d="M19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>'),
  doc: svg('<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9.5 13h6M9.5 17h6"/>'),
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};
const TABS = [['#inicio', 'Inicio', ICON.home], ['#materias', 'Materias', ICON.jar], ['#formulas', 'Fórmulas', ICON.flask], ['#elaboraciones', 'Elaborar', ICON.scale], ['#pnt', 'PNT', ICON.doc]];

// ------------------------------------------------------------------ piezas de interfaz
const pill = (kind, status) => `<span class="pill ${TONE[status] || ''}">${esc(STATUS[kind][status] || status)}</span>`;
const empty = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
const fab = (href, label) => `<a class="fab" href="${href}">${ICON.plus}<span>${esc(label)}</span></a>`;
const searchBox = (placeholder) => `<div class="search"><input type="search" data-filter placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"></div>`;
const formMsg = () => '<div class="msg error" data-formmsg hidden role="alert"></div>';
const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
const text = (name, attrs = '') => `<input type="text" name="${name}" ${attrs}>`;
const decimal = (name, attrs = '') => `<input type="text" inputmode="decimal" autocomplete="off" name="${name}" ${attrs}>`;

function toast(message) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}
function reportError(err, form) {
  if (!(err instanceof InputError)) console.error(err);
  const message = err instanceof InputError ? err.message : `No se pudo completar la operación (${err && err.message ? err.message : err}).`;
  const box = form && $('[data-formmsg]', form);
  if (box) {
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    toast(message);
  }
}

/** Diálogo de confirmación dentro de la app. Si typed tiene valor, hay que escribirlo para confirmar. */
function ask({ title, message, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false, typed = '' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog';
    d.setAttribute('aria-labelledby', 'dlg-title');
    d.innerHTML = `<div class="dialog-body">
      <h2 id="dlg-title">${esc(title)}</h2>
      ${String(message).split('\n\n').map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
      ${typed ? `<label class="field"><span>Escribe ${esc(typed)} para confirmar</span><input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>` : ''}
      <div class="dialog-actions">
        <button type="button" class="btn secondary" data-dlg="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn${danger ? ' danger' : ''}" data-dlg="ok">${esc(confirmLabel)}</button>
      </div></div>`;
    document.body.append(d);
    const ok = $('[data-dlg="ok"]', d);
    const input = $('input', d);
    if (typed) {
      ok.disabled = true;
      input.addEventListener('input', () => { ok.disabled = str(input.value).toUpperCase() !== typed; });
    }
    const finish = (value) => { if (d.open) d.close(); d.remove(); resolve(value); };
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-dlg]'); if (b && !b.disabled) finish(b.dataset.dlg === 'ok'); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    d.showModal();
    (input || ok).focus();
  });
}

// ------------------------------------------------------------------ arranque, PIN y bloqueo
function showGate(html) {
  let gate = $('#gate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'gate';
    gate.className = 'gate';
    document.body.append(gate);
  }
  gate.innerHTML = html;
  const shell = $('#shell');
  if (shell) shell.inert = true;
  setTimeout(() => { const i = $('input', gate); if (i) i.focus(); }, 60);
}
const gateBrand = `<div class="brand">${ICON.cross}<span>FARMA·LAB</span></div>`;

function setupHtml() {
  return `<form class="gate-card" data-form="setup" autocomplete="off">
    ${gateBrand}
    <p>Configura la app en este teléfono. Los datos se guardan solo aquí: exporta copias de seguridad con regularidad.</p>
    ${formMsg()}
    ${field('Tu nombre', text('name', 'required maxlength="80" autocomplete="name"'), 'Aparecerá como operador en los registros.')}
    ${field('PIN de acceso', '<input class="pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" required>', 'Entre 4 y 8 cifras. Si lo olvidas no se puede recuperar.')}
    ${field('Repite el PIN', '<input class="pin" type="password" name="pin2" inputmode="numeric" pattern="[0-9]*" maxlength="8" required>')}
    <button class="btn block" type="submit">Empezar</button>
  </form>`;
}
function lockHtml() {
  return `<form class="gate-card" data-form="unlock" autocomplete="off">
    ${gateBrand}
    <p>${esc(state.profile.name)}</p>
    ${formMsg()}
    ${field('PIN', '<input class="pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" required autocomplete="current-password">')}
    <button class="btn block" type="submit">Desbloquear</button>
    <button class="linklike" type="button" data-act="forgotPin">He olvidado el PIN</button>
  </form>`;
}
function lock() {
  if (!state.profile || !state.unlocked) return;
  state.unlocked = false;
  showGate(lockHtml());
}
async function unlockDone() {
  state.unlocked = true;
  state.lastTouch = Date.now();
  const gate = $('#gate');
  if (gate) gate.remove();
  if (!$('#shell')) {
    renderShell();
    await route();
  } else {
    $('#shell').inert = false;
  }
  logOnly('inicio_sesion', state.profile.name).catch(() => {});
}
function setupLockTimers() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.hiddenAt = Date.now();
    else if (state.unlocked && state.hiddenAt && Date.now() - state.hiddenAt > LOCK_HIDDEN_MS) lock();
  });
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { state.lastTouch = Date.now(); }, { passive: true }));
  setInterval(() => { if (state.unlocked && Date.now() - state.lastTouch > LOCK_IDLE_MS) lock(); }, 30000);
}

async function boot() {
  const app = $('#app');
  if (!window.isSecureContext || !window.crypto || !crypto.subtle || !window.indexedDB) {
    app.innerHTML = `<div class="gate"><div class="gate-card">${gateBrand}<p>Abre FARMA·LAB desde su dirección https (la de GitHub Pages) con Chrome. Así no puede funcionar.</p></div></div>`;
    return;
  }
  try {
    state.deviceId = await metaGet('deviceId');
    if (!state.deviceId) {
      state.deviceId = newId();
      await metaSet('deviceId', state.deviceId);
    }
    state.profile = await metaGet('profile');
  } catch (err) {
    app.innerHTML = `<div class="gate"><div class="gate-card">${gateBrand}<p>No se puede abrir la base de datos del teléfono: ${esc(err.message)}</p></div></div>`;
    return;
  }
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', () => { route(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; });
  window.addEventListener('appinstalled', () => { state.deferredInstall = null; toast('FARMA·LAB instalada en el teléfono.'); });
  setupLockTimers();
  if (!PREVIEW) registerServiceWorker();
  app.innerHTML = '';
  showGate(state.profile ? lockHtml() : setupHtml());
}

// ------------------------------------------------------------------ actualizaciones (service worker)
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const check = () => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        state.swWaiting = reg.waiting;
        showUpdateBanner();
      }
    };
    check();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') check(); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((err) => console.warn('Service worker no registrado:', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (state.updateRequested) location.reload();
  });
}
function showUpdateBanner() {
  const b = $('#banner');
  if (!b || !state.swWaiting) return;
  b.innerHTML = '<div class="banner"><span>Hay una versión nueva de FARMA·LAB. Guarda lo que estés haciendo antes de actualizar.</span><button class="btn small" data-act="update">Actualizar</button></div>';
}

// ------------------------------------------------------------------ armazón y rutas
function renderShell() {
  $('#app').innerHTML = `<div id="shell">
    <header class="topbar">
      <button class="icon-btn" data-act="back" id="backBtn" aria-label="Volver" hidden>${ICON.back}</button>
      <span class="mark" id="mark">${ICON.cross}</span>
      <h1 id="title">FARMA·LAB</h1>
      <a class="icon-btn" href="#ajustes" aria-label="Ajustes y copias de seguridad">${ICON.sliders}</a>
      <button class="icon-btn" data-act="lock" aria-label="Bloquear">${ICON.lock}</button>
    </header>
    ${PREVIEW ? '<div class="banner preview">Vista previa para probar la app. No guardes aquí datos reales: las copias de seguridad y la instalación solo funcionan en la versión publicada.</div>' : ''}
    <div id="banner"></div>
    <main id="view" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Secciones">${TABS.map(([href, label, icon]) => `<a href="${href}"><span class="ind">${icon}</span>${label}</a>`).join('')}</nav>
    <div id="toast" role="status" aria-live="polite"></div>
  </div>`;
  showUpdateBanner();
}

async function route() {
  if (!state.unlocked || !$('#view')) return;
  state.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  state.objectUrls = [];
  const hash = location.hash || '#inicio';
  const parts = hash.slice(1).split('--');
  if (parts[0] === 'inicio') parts[0] = '';
  const [sec = '', arg = '', extra = ''] = parts;
  const info = SECTIONS[sec] || SECTIONS[''];
  state.parent = arg ? `#${sec}` : (sec === 'auditoria' ? '#ajustes' : '#inicio');
  let html;
  try {
    switch (sec) {
      case '': html = await viewHome(); break;
      case 'materias': html = arg === 'nueva' ? viewMaterialForm() : arg ? await viewMaterial(arg) : await viewMaterials(); break;
      case 'formulas': html = arg === 'nueva' ? await viewFormulaForm() : arg ? await viewFormula(arg) : await viewFormulas(); break;
      case 'elaboraciones': html = arg === 'nueva' ? await viewProductionNew(extra) : arg ? await viewProduction(arg) : await viewProductions(); break;
      case 'pnt': html = arg === 'nuevo' ? viewPntForm() : arg ? await viewPnt(arg) : await viewPnts(); break;
      case 'documento': html = await viewDocument(arg); break;
      case 'ajustes': html = await viewSettings(); break;
      case 'auditoria': html = await viewAudit(); break;
      default: html = empty('Página no encontrada', 'Usa las pestañas de abajo para moverte por la app.');
    }
  } catch (err) {
    console.error(err);
    html = `<div class="msg error">No se pudo mostrar esta pantalla: ${esc(err.message)}</div>`;
  }
  $('#view').innerHTML = html;
  $('#title').textContent = info.title;
  const sub = Boolean(arg) || sec === 'ajustes' || sec === 'auditoria';
  $('#backBtn').hidden = !sub;
  $('#mark').hidden = sub;
  $$('.tabbar a').forEach((a, i) => {
    if (i === info.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (state.prevHash !== hash) window.scrollTo(0, 0);
  state.prevHash = hash;
  afterRender();
}

function afterRender() {
  const form = $('form[data-form="productionNew"]');
  if (form) updatePreview(form);
  $$('[data-weigh-actual]').forEach(updateDeviation);
  $$('[data-weigh-lot]').forEach(updateLotWarning);
  const viewer = $('#docview');
  if (viewer) renderDocument(viewer);
}

// ------------------------------------------------------------------ Inicio
async function backupStatus() {
  const [lastExport, lastChange] = await Promise.all([metaGet('lastExport'), metaGet('lastChange')]);
  const pending = Boolean(lastChange) && (!lastExport || lastChange > lastExport);
  const old = !lastExport || Date.now() - Date.parse(lastExport) > BACKUP_REMINDER_DAYS * 864e5;
  return { lastExport, lastChange, remind: pending && old };
}

async function viewHome() {
  const [mats, forms, pnts, prods, audit] = await Promise.all(['material', 'formula', 'pnt', 'production', 'audit'].map(getAll));
  const backup = await backupStatus();
  const open = prods.filter((p) => p.status === 'borrador').sort(byNewest);
  const expiring = mats
    .filter((m) => isDay(m.expiry) && m.status !== 'bloqueado' && daysUntil(m.expiry) <= EXPIRY_WARNING_DAYS)
    .sort(byText('expiry'));
  const recent = audit.sort(byNewest).slice(0, 6);
  const standalone = matchMedia('(display-mode: standalone)').matches;

  let html = '';
  if (backup.remind) {
    html += `<div class="msg warn reminder"><p><strong>Haz una copia de seguridad.</strong> Tus datos solo están en este teléfono${backup.lastExport ? `; la última copia es del ${esc(fmtStamp(backup.lastExport))}` : ' y aún no has hecho ninguna copia'}.</p><button class="btn small" data-act="export">Exportar copia</button></div>`;
  }
  if (state.deferredInstall && !standalone) {
    html += '<div class="msg ok reminder"><p>Instala FARMA·LAB para abrirla desde la pantalla de inicio y usarla sin conexión.</p><button class="btn small" data-act="install">Instalar</button></div>';
  }
  html += '<section><h2>En elaboración</h2>';
  html += open.length
    ? `<ul class="list">${open.map((p) => `<li><a class="row" href="#elaboraciones--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.record_code)}</strong><span class="sub"><span>${esc(p.formula_name)}</span><span>${fmtNum(p.target_amount)} ${esc(p.unit)}</span><span>${progressText(p)}</span></span></div></a></li>`).join('')}</ul>`
    : `<div class="empty"><strong>No hay elaboraciones abiertas.</strong><a class="btn secondary small" href="#elaboraciones--nueva">Nueva elaboración</a></div>`;
  html += '</section>';
  if (expiring.length) {
    html += `<section><h2>Caducidades próximas</h2><ul class="list">${expiring.map((m) => {
      const d = daysUntil(m.expiry);
      const when = d < 0 ? `Caducado el ${fmtDay(m.expiry)}` : d === 0 ? 'Caduca hoy' : `Caduca el ${fmtDay(m.expiry)} (${d} ${d === 1 ? 'día' : 'días'})`;
      return `<li><a class="row" href="#materias--${esc(m.uuid)}"><div class="row-main"><strong>${esc(m.name)}</strong><span class="sub"><span>Lote ${esc(m.lot)}</span><span class="${d < 0 ? 'bad' : 'warn'}">${when}</span></span></div></a></li>`;
    }).join('')}</ul></section>`;
  }
  html += `<section><h2>Registros</h2><ul class="list counts">
    <li><a class="row" href="#materias"><span class="row-main">Lotes de materia prima</span><b>${mats.length}</b></a></li>
    <li><a class="row" href="#formulas"><span class="row-main">Fórmulas</span><b>${forms.length}</b></a></li>
    <li><a class="row" href="#elaboraciones"><span class="row-main">Elaboraciones</span><b>${prods.length}</b></a></li>
    <li><a class="row" href="#pnt"><span class="row-main">PNT</span><b>${pnts.length}</b></a></li>
  </ul></section>`;
  html += `<section><h2>Actividad reciente</h2>${recent.length ? auditList(recent) : empty('Sin actividad todavía.', '')}<p class="more"><a href="#auditoria">Ver toda la actividad</a></p></section>`;
  return html;
}
function progressText(p) {
  const done = (p.weighings || []).filter((w) => isNum(w.actual) && w.material_lot).length;
  return `${done} de ${(p.weighings || []).length} pesadas`;
}
function auditList(items) {
  return `<ul class="list audit">${items.map((a) => `<li><div class="row"><div class="row-main"><strong>${esc(ACTION_LABELS[a.action] || a.action)}</strong><span class="sub"><span>${esc(fmtStamp(a.created_at))}</span>${a.detail ? `<span>${esc(a.detail)}</span>` : ''}</span></div></div></li>`).join('')}</ul>`;
}

// ------------------------------------------------------------------ Materias primas
async function viewMaterials() {
  const items = (await getAll('material')).sort(byText('name'));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((m) => `<li data-text="${esc(lc([m.name, m.lot, m.code, m.supplier].join(' ')))}"><a class="row" href="#materias--${esc(m.uuid)}"><div class="row-main"><strong>${esc(m.name)}</strong><span class="sub"><span>Lote ${esc(m.lot)}</span><span>Cad. ${fmtDay(m.expiry)}</span><span>${fmtNum(m.quantity)} ${esc(m.unit)}</span></span></div>${pill('material', m.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Ningún lote coincide con la búsqueda.</p>`
    : empty('Aún no hay lotes registrados.', 'Registra el primero con «Nuevo lote».');
  return `${items.length ? searchBox('Buscar nombre, lote o código') : ''}${list}${fab('#materias--nueva', 'Nuevo lote')}`;
}

async function viewMaterial(id) {
  const m = await getOne('material', id);
  if (!m) return empty('Este lote no existe.', 'Puede que se haya borrado o que el enlace no sea correcto.');
  const expiry = isDay(m.expiry) ? daysUntil(m.expiry) : null;
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(m.name)}</h2>${pill('material', m.status)}</div>
    <dl class="facts">
      <dt>Lote</dt><dd>${esc(m.lot)}</dd>
      <dt>Código</dt><dd>${esc(m.code || '—')}</dd>
      <dt>Proveedor</dt><dd>${esc(m.supplier || '—')}</dd>
      <dt>Cantidad</dt><dd>${fmtNum(m.quantity)} ${esc(m.unit)}</dd>
      <dt>Caducidad</dt><dd>${fmtDay(m.expiry)}${expiry !== null && expiry < 0 ? ' <span class="bad">caducado</span>' : ''}</dd>
      <dt>Registrado</dt><dd>${esc(fmtStamp(m.created_at))}</dd>
    </dl>
  </div>
  <section><h2>Cambiar estado</h2><div class="actions">${Object.keys(STATUS.material).map((s) => `<button class="btn ${s === m.status ? '' : 'secondary'}" data-act="setStatus" data-store="material" data-id="${esc(m.uuid)}" data-status="${s}" ${s === m.status ? 'disabled' : ''}>${STATUS.material[s]}</button>`).join('')}</div></section>`;
}

function viewMaterialForm() {
  return `<form class="form" data-form="material" novalidate>
    ${formMsg()}
    ${field('Nombre', text('name', 'required maxlength="160"'))}
    ${field('Lote del proveedor', text('lot', 'required maxlength="100"'))}
    <div class="grid2">
      ${field('Cantidad', decimal('quantity', 'required'))}
      ${field('Unidad', `<select name="unit">${options(MATERIAL_UNITS, 'g')}</select>`)}
    </div>
    ${field('Caducidad', '<input type="date" name="expiry">')}
    ${field('Código', text('code', 'maxlength="80"'), 'Opcional. Si lo pones, no puede repetirse.')}
    ${field('Proveedor', text('supplier', 'maxlength="160"'))}
    ${field('Estado', `<select name="status">${options(Object.keys(STATUS.material), 'cuarentena', STATUS.material)}</select>`)}
    <button class="btn block" type="submit">Guardar lote</button>
  </form>`;
}

// ------------------------------------------------------------------ Fórmulas
async function viewFormulas() {
  const items = (await getAll('formula')).sort(byText('name'));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((f) => `<li data-text="${esc(lc([f.name, f.code, f.form].join(' ')))}"><a class="row" href="#formulas--${esc(f.uuid)}"><div class="row-main"><strong>${esc(f.name)}</strong><span class="sub">${f.code ? `<span>${esc(f.code)}</span>` : ''}<span>Versión ${esc(f.version)}</span>${f.form ? `<span>${esc(f.form)}</span>` : ''}<span>${(f.components || []).length} componentes</span></span></div>${pill('formula', f.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Ninguna fórmula coincide con la búsqueda.</p>`
    : empty('Aún no hay fórmulas.', 'Crea la primera con «Nueva fórmula». Para elaborarla, márcala como Aprobada.');
  return `${items.length ? searchBox('Buscar nombre, código o forma') : ''}${list}${fab('#formulas--nueva', 'Nueva fórmula')}`;
}

async function viewFormula(id) {
  const f = await getOne('formula', id);
  if (!f) return empty('Esta fórmula no existe.', '');
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(f.name)}</h2>${pill('formula', f.status)}</div>
    <dl class="facts">
      <dt>Código</dt><dd>${esc(f.code || '—')}</dd>
      <dt>Versión</dt><dd>${esc(f.version)}</dd>
      <dt>Forma</dt><dd>${esc(f.form || '—')}</dd>
      <dt>Lote de referencia</dt><dd>${fmtNum(f.target_amount)} ${esc(f.unit)}</dd>
      <dt>Referencia</dt><dd>${esc(f.reference || '—')}</dd>
    </dl>
  </div>
  <section><h2>Composición</h2><ul class="list">${(f.components || []).map((c) => `<li><div class="row"><span class="row-main">${esc(c.ingredient)}</span><b class="num">${fmtNum(c.amount)} ${esc(c.unit)}</b></div></li>`).join('')}</ul></section>
  ${f.status === 'aprobada' ? `<p><a class="btn block" href="#elaboraciones--nueva--${esc(f.uuid)}">Elaborar con esta fórmula</a></p>` : ''}
  <section><h2>Cambiar estado</h2><div class="actions">${Object.keys(STATUS.formula).map((s) => `<button class="btn ${s === f.status ? '' : 'secondary'}" data-act="setStatus" data-store="formula" data-id="${esc(f.uuid)}" data-status="${s}" ${s === f.status ? 'disabled' : ''}>${STATUS.formula[s]}</button>`).join('')}</div>
  <p class="hint">Solo las fórmulas aprobadas aparecen al crear una elaboración.</p></section>`;
}

function componentRow() {
  return `<div class="comp" data-comp>
    <input type="text" name="ingredient" list="dl-materials" placeholder="Ingrediente" aria-label="Ingrediente" maxlength="160">
    <input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="Cantidad" aria-label="Cantidad">
    <select name="cunit" aria-label="Unidad">${options(COMPONENT_UNITS, 'g')}</select>
    <button type="button" class="icon-btn quiet" data-act="removeComponent" aria-label="Quitar componente">${ICON.x}</button>
  </div>`;
}
async function viewFormulaForm() {
  const names = [...new Set((await getAll('material')).map((m) => m.name))].sort((a, b) => a.localeCompare(b, 'es'));
  return `<form class="form" data-form="formula" novalidate>
    ${formMsg()}
    ${field('Nombre', text('name', 'required maxlength="160"'))}
    <div class="grid2">
      ${field('Código', text('code', 'maxlength="80"'))}
      ${field('Versión', text('version', 'value="1" maxlength="30"'))}
    </div>
    ${field('Forma farmacéutica', text('form', 'maxlength="80"'))}
    <div class="grid2">
      ${field('Lote de referencia', decimal('target_amount', 'value="100" required'))}
      ${field('Unidad', `<select name="unit">${options(FORMULA_UNITS, 'g')}</select>`)}
    </div>
    ${field('Referencia bibliográfica o normativa', text('reference', 'maxlength="200"'))}
    <fieldset class="comps"><legend>Composición para el lote de referencia</legend>
      <div data-comps>${componentRow()}${componentRow()}</div>
      <button type="button" class="btn secondary small" data-act="addComponent">${ICON.plus}Añadir componente</button>
    </fieldset>
    <datalist id="dl-materials">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    ${field('Estado', `<select name="status">${options(Object.keys(STATUS.formula), 'borrador', STATUS.formula)}</select>`)}
    <button class="btn block" type="submit">Guardar fórmula</button>
  </form>`;
}

// ------------------------------------------------------------------ Elaboraciones
async function viewProductions() {
  const items = (await getAll('production')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const list = items.length
    ? `<ul class="list" data-list>${items.map((p) => `<li data-text="${esc(lc([p.record_code, p.formula_name, p.patient_ref].join(' ')))}"><a class="row" href="#elaboraciones--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.record_code)}</strong><span class="sub"><span>${esc(p.formula_name)}</span><span>${fmtNum(p.target_amount)} ${esc(p.unit)}</span><span>${esc(fmtStamp(p.created_at).slice(0, 10))}</span></span></div>${pill('production', p.status)}</a></li>`).join('')}</ul><p class="none" data-none hidden>Ninguna elaboración coincide con la búsqueda.</p>`
    : empty('Aún no hay elaboraciones.', 'Crea una con «Nueva elaboración» a partir de una fórmula aprobada.');
  return `${items.length ? searchBox('Buscar código o fórmula') : ''}${list}${fab('#elaboraciones--nueva', 'Nueva elaboración')}`;
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
    <div class="grid2">
      ${field('Cantidad final', decimal('target_amount', 'required'))}
      ${field('Unidad', '<input type="text" name="unit_view" readonly tabindex="-1">')}
    </div>
    ${field('Código de elaboración', text('record_code', `value="${esc(code)}" required maxlength="80"`), 'Puedes cambiarlo. No puede repetirse.')}
    ${field('Referencia de paciente', text('patient_ref', 'maxlength="100"'), 'Opcional. Usa un código interno, no nombres ni datos identificativos.')}
    ${field('Observaciones', '<textarea name="notes" maxlength="2000"></textarea>')}
    <section><h2>Cantidades teóricas</h2><div id="preview"></div>
    <p class="hint">Escalado proporcional de la composición aprobada. No contempla densidad, mermas, sobrellenado ni conversiones de unidades.</p></section>
    <button class="btn block" type="submit">Crear registro</button>
  </form>`;
}
function updatePreview(form) {
  const f = state.formulaCache[form.formula_uuid.value];
  const box = $('#preview');
  if (!f || !box) return;
  form.unit_view.value = f.unit;
  let target = null;
  try { target = parseNum(form.target_amount.value, 'Cantidad final'); } catch { target = null; }
  if (!target || target <= 0 || !(f.target_amount > 0)) {
    box.innerHTML = `<p class="hint">Escribe la cantidad final para ver las cantidades de cada componente (la fórmula está definida para ${fmtNum(f.target_amount)} ${esc(f.unit)}).</p>`;
    return;
  }
  const factor = target / f.target_amount;
  box.innerHTML = `<ul class="list">${(f.components || []).map((c) => `<li><div class="row"><span class="row-main">${esc(c.ingredient)}</span><b class="num">${fmtNum(round6(c.amount * factor))} ${esc(c.unit)}</b></div></li>`).join('')}</ul>`;
}

async function viewProduction(id) {
  const p = await getOne('production', id);
  if (!p) return empty('Este registro no existe.', '');
  state.materials = await getAll('material');
  const editable = p.status === 'borrador';
  const ws = p.weighings || [];
  const done = ws.filter((w) => isNum(w.actual) && w.material_lot).length;
  const header = `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(p.record_code)}</h2>${pill('production', p.status)}</div>
    <dl class="facts">
      <dt>Fórmula</dt><dd>${esc(p.formula_name)} (versión ${esc(p.formula_version)})</dd>
      <dt>Cantidad final</dt><dd>${fmtNum(p.target_amount)} ${esc(p.unit)}</dd>
      <dt>Operador</dt><dd>${esc(p.operator)}</dd>
      <dt>Creado</dt><dd>${esc(fmtStamp(p.created_at))}</dd>
      ${p.patient_ref ? `<dt>Ref. paciente</dt><dd>${esc(p.patient_ref)}</dd>` : ''}
      ${p.submitted_at ? `<dt>Enviado</dt><dd>${esc(fmtStamp(p.submitted_at))}</dd>` : ''}
    </dl>
  </div>
  <div class="progress"><progress max="${ws.length}" value="${done}"></progress><span>${done} de ${ws.length} pesadas completas</span></div>`;

  const blocks = ws.map((w, i) => {
    const lots = state.materials.filter((m) => lc(m.name) === lc(w.ingredient));
    return `<div class="weigh" role="group" aria-labelledby="w${i}">
      <h3 id="w${i}">${esc(w.ingredient)}</h3>
      <div class="readouts">
        <div class="readout"><span>Teórico</span><div class="display theo"><span class="v">${fmtNum(w.theoretical)}</span><span class="u">${esc(w.unit)}</span></div></div>
        <label class="readout"><span>Real pesado</span><div class="display">${editable
          ? `<input class="display-input" type="text" inputmode="decimal" autocomplete="off" name="actual_${i}" value="${esc(inputNum(w.actual))}" data-weigh-actual="${i}" data-theo="${w.theoretical}" aria-label="Cantidad real pesada de ${esc(w.ingredient)}">`
          : `<span class="v">${fmtNum(w.actual)}</span>`}<span class="u">${esc(w.unit)}</span></div></label>
      </div>
      <p class="dev" data-dev="${i}"></p>
      ${editable
        ? `<label class="field"><span>Lote de materia prima</span><input type="text" name="lot_${i}" maxlength="100" list="lots${i}" value="${esc(w.material_lot || '')}" data-weigh-lot="${i}" data-ingredient="${esc(w.ingredient)}" autocomplete="off"></label>
           <datalist id="lots${i}">${lots.map((m) => `<option value="${esc(m.lot)}">${esc(`${STATUS.material[m.status] || m.status}${isDay(m.expiry) ? `, cad. ${fmtDay(m.expiry)}` : ''}`)}</option>`).join('')}</datalist>
           <p class="lotwarn" data-lotwarn="${i}"></p>`
        : `<p class="lot-ro">Lote: <strong>${esc(w.material_lot || '—')}</strong></p>`}
    </div>`;
  }).join('');

  if (!editable) {
    return `${header}<div class="weighs">${blocks}</div>
      ${p.notes ? `<section><h2>Observaciones</h2><div class="panel pre">${esc(p.notes)}</div></section>` : ''}
      <p class="msg ok">Enviado a revisión farmacéutica. No implica liberación del preparado.</p>`;
  }
  return `${header}
  <form class="form" data-form="weighings" data-id="${esc(p.uuid)}" novalidate>
    ${formMsg()}
    <div class="weighs">${blocks}</div>
    ${field('Observaciones', `<textarea name="notes" maxlength="2000">${esc(p.notes || '')}</textarea>`)}
    <button class="btn block" type="submit" name="intent" value="save">Guardar pesadas</button>
    <button class="btn secondary block" type="submit" name="intent" value="submit">Enviar a revisión</button>
    <p class="hint">Al enviarlo a revisión ya no se podrán cambiar las pesadas. El envío no libera ni autoriza el preparado.</p>
  </form>`;
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
function updateLotWarning(input) {
  const out = $(`[data-lotwarn="${input.dataset.weighLot}"]`);
  if (!out) return;
  const lot = lc(str(input.value));
  if (!lot) { out.textContent = ''; return; }
  const matches = state.materials.filter((m) => lc(m.lot) === lot);
  const sameName = matches.filter((m) => lc(m.name) === lc(input.dataset.ingredient));
  const warnings = [];
  if (!matches.length) warnings.push('Este lote no está registrado en Materias primas.');
  else if (!sameName.length) warnings.push(`Ese lote está registrado para ${matches.map((m) => m.name).join(', ')}.`);
  for (const m of sameName.length ? sameName : matches) {
    if (m.status !== 'aceptado') warnings.push(`Lote en estado ${lc(STATUS.material[m.status] || m.status)}.`);
    if (isDay(m.expiry) && daysUntil(m.expiry) < 0) warnings.push(`Lote caducado el ${fmtDay(m.expiry)}.`);
  }
  out.textContent = [...new Set(warnings)].join(' ');
}

// ------------------------------------------------------------------ PNT
const latestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

async function viewPnts() {
  const items = (await getAll('pnt')).sort(byText('code'));
  const latest = {};
  (await getAll(FILE_STORE)).sort(latestFirst).forEach((f) => { if (!latest[f.pnt_uuid]) latest[f.pnt_uuid] = f; });
  const list = items.length
    ? `<ul class="list" data-list>${items.map((p) => {
      const overdue = p.status === 'vigente' && isDay(p.review_date) && daysUntil(p.review_date) < 0;
      const doc = latest[p.uuid];
      return `<li data-text="${esc(lc([p.code, p.title, p.category, p.file_note].join(' ')))}"><a class="row" href="#pnt--${esc(p.uuid)}"><div class="row-main"><strong><span class="code">${esc(p.code)}</span> ${esc(p.title)}</strong><span class="sub">${p.category ? `<span>${esc(p.category)}</span>` : ''}<span>Versión ${esc(p.version)}</span><span>Revisión ${fmtDay(p.review_date)}</span>${overdue ? '<span class="bad">Revisión vencida</span>' : ''}</span><span class="sub">${doc ? `<span class="doc-tag">${esc(DOC_TYPES[doc.ext].label)}</span>` : '<span>Sin documento</span>'}</span></div>${pill('pnt', p.status)}</a></li>`;
    }).join('')}</ul><p class="none" data-none hidden>Ningún PNT coincide con la búsqueda.</p>`
    : empty('Aún no hay PNT registrados.', 'Registra el primero con «Nuevo PNT».');
  return `${items.length ? searchBox('Buscar código, título o categoría') : ''}${list}${fab('#pnt--nuevo', 'Nuevo PNT')}`;
}

const filePicker = (label) => `<div class="filepick">
    <label class="btn secondary">${esc(label)}<input type="file" name="file" accept="${DOC_ACCEPT}" data-docpick hidden></label>
    <p class="hint" data-file-chosen>Ningún archivo elegido</p>
  </div>`;

function docRow(f, current) {
  return `<li><a class="row" href="#documento--${esc(f.uuid)}"><div class="row-main"><strong>${esc(f.name)}</strong><span class="sub"><span class="doc-tag">${esc(DOC_TYPES[f.ext].label)}</span><span>Versión ${esc(f.version)}</span><span>${esc(fmtStamp(f.created_at).slice(0, 10))}</span><span>${fmtSize(f.size)}</span></span></div>${current ? '<span class="pill green">Vigente</span>' : ''}</a></li>`;
}

async function viewPnt(id) {
  const p = await getOne('pnt', id);
  if (!p) return empty('Este PNT no existe.', 'Puede que el enlace no sea correcto.');
  const docs = (await filesOf(id)).sort(latestFirst);
  const [current, ...older] = docs;
  const overdue = p.status === 'vigente' && isDay(p.review_date) && daysUntil(p.review_date) < 0;
  const canShare = current && current.ext === 'pdf' && navigator.canShare
    && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  return `<div class="panel">
    <div class="head-row"><h2 class="big"><span class="code">${esc(p.code)}</span> ${esc(p.title)}</h2>${pill('pnt', p.status)}</div>
    <dl class="facts">
      <dt>Versión</dt><dd>${esc(p.version)}</dd>
      <dt>Categoría</dt><dd>${esc(p.category || '—')}</dd>
      <dt>En vigor desde</dt><dd>${fmtDay(p.effective_date)}</dd>
      <dt>Próxima revisión</dt><dd>${fmtDay(p.review_date)}${overdue ? ' <span class="bad">vencida</span>' : ''}</dd>
      <dt>Ubicación</dt><dd>${esc(p.file_note || '—')}</dd>
    </dl>
  </div>
  <section><h2>Documento</h2>
  ${current
    ? `<ul class="list">${docRow(current, true)}</ul>
       <div class="actions spaced">
         <a class="btn" href="#documento--${esc(current.uuid)}">Ver documento</a>
         <button class="btn secondary" data-act="downloadDoc" data-id="${esc(current.uuid)}">Descargar</button>
         ${canShare ? `<button class="btn secondary" data-act="shareDoc" data-id="${esc(current.uuid)}">Abrir con otra app</button>` : ''}
       </div>`
    : empty('Este PNT aún no tiene documento.', 'Súbelo en PDF o Word para consultarlo desde aquí, también sin conexión.')}
  </section>
  <section><h2>${current ? 'Subir una versión nueva' : 'Subir documento'}</h2>
  <form class="panel form" data-form="pntDoc" data-id="${esc(p.uuid)}" novalidate>
    ${formMsg()}
    ${filePicker('Elegir PDF o Word')}
    <div class="grid2">
      ${field('Versión del PNT', text('version', `value="${esc(p.version)}" maxlength="30"`))}
      ${field('En vigor desde', `<input type="date" name="effective_date" value="${isDay(p.effective_date) ? p.effective_date : ''}">`)}
    </div>
    ${field('Próxima revisión', `<input type="date" name="review_date" value="${isDay(p.review_date) ? p.review_date : ''}">`)}
    <button class="btn block" type="submit">Guardar documento</button>
    <p class="hint">Máximo 25 MB. Se guarda en este teléfono y entra en las copias de seguridad.${current ? ' El documento actual pasará a versiones anteriores; no se borra.' : ''}</p>
  </form></section>
  ${older.length ? `<section><h2>Versiones anteriores</h2><ul class="list">${older.map((f) => docRow(f, false)).join('')}</ul></section>` : ''}
  <section><h2>Cambiar estado</h2><div class="actions">${Object.keys(STATUS.pnt).map((s) => `<button class="btn ${s === p.status ? '' : 'secondary'}" data-act="setStatus" data-store="pnt" data-id="${esc(p.uuid)}" data-status="${s}" ${s === p.status ? 'disabled' : ''}>${STATUS.pnt[s]}</button>`).join('')}</div></section>`;
}

function viewPntForm() {
  return `<form class="form" data-form="pnt" novalidate>
    ${formMsg()}
    <div class="grid2">
      ${field('Código', text('code', 'required maxlength="80"'))}
      ${field('Versión', text('version', 'value="1" maxlength="30"'))}
    </div>
    ${field('Título', text('title', 'required maxlength="180"'))}
    ${field('Categoría', text('category', 'maxlength="100"'))}
    <div class="grid2">
      ${field('Entrada en vigor', '<input type="date" name="effective_date">')}
      ${field('Próxima revisión', '<input type="date" name="review_date">')}
    </div>
    <div class="field"><span>Documento (opcional)</span>${filePicker('Elegir PDF o Word')}</div>
    ${field('Ubicación del original', text('file_note', 'maxlength="500"'), 'Dónde está el documento en papel: carpeta, archivador...')}
    ${field('Estado', `<select name="status">${options(Object.keys(STATUS.pnt), 'borrador', STATUS.pnt)}</select>`)}
    <button class="btn block" type="submit">Guardar PNT</button>
  </form>`;
}

/** Comprueba el contenido real del archivo (no solo la extensión). */
async function sniffDoc(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ext = String(file.name.split('.').pop() || '').toLowerCase();
  const starts = (sig) => sig.every((b, i) => head[i] === b);
  const pdfAt = new TextDecoder('latin1').decode(head).indexOf('%PDF-');
  if (pdfAt !== -1) return 'pdf';
  if (ext === 'docx' && starts([0x50, 0x4b, 0x03, 0x04])) return 'docx';
  if (ext === 'doc' && starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc';
  return null;
}
async function buildDocRecord(file, pnt, existing, version) {
  if (!file.size) throw new InputError('El archivo está vacío.');
  if (file.size > MAX_DOC_BYTES) throw new InputError(`El archivo ocupa ${fmtSize(file.size)}. El máximo es 25 MB.`);
  const ext = await sniffDoc(file);
  if (!ext) throw new InputError('Solo se admiten documentos PDF (.pdf) o Word (.docx o .doc).');
  const buf = await file.arrayBuffer();
  const sha256 = toHex(await crypto.subtle.digest('SHA-256', buf));
  if (existing.some((f) => f.sha256 === sha256)) throw new InputError('Ese mismo archivo ya está guardado en este PNT.');
  return {
    uuid: newId(), pnt_uuid: pnt.uuid, name: file.name.slice(0, 200), ext, mime: DOC_TYPES[ext].mime,
    size: file.size, version: version || '1', sha256, uploaded_by: state.profile.name,
    blob: new Blob([buf], { type: DOC_TYPES[ext].mime }),
  };
}

// ------------------------------------------------------------------ visor de documentos
async function viewDocument(id) {
  const doc = await getOne(FILE_STORE, id);
  if (!doc) return empty('Este documento no existe.', '');
  const p = await getOne('pnt', doc.pnt_uuid);
  state.parent = `#pnt--${doc.pnt_uuid}`;
  const canShare = doc.ext === 'pdf' && navigator.canShare
    && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  return `<div class="doc-head">
    <strong>${esc(p ? `${p.code} ${p.title}` : doc.name)}</strong>
    <span class="sub"><span>${esc(doc.name)}</span><span>Versión ${esc(doc.version)}</span><span>${fmtSize(doc.size)}</span></span>
    <div class="actions">
      <button class="btn secondary small" data-act="downloadDoc" data-id="${esc(doc.uuid)}">Descargar</button>
      ${canShare ? `<button class="btn secondary small" data-act="shareDoc" data-id="${esc(doc.uuid)}">Abrir con otra app</button>` : ''}
    </div>
  </div>
  <div id="docview" class="docview" data-id="${esc(doc.uuid)}"><p class="hint">Abriendo el documento...</p></div>`;
}

async function renderDocument(container) {
  const doc = await getOne(FILE_STORE, container.dataset.id);
  if (!doc || !container.isConnected) return;
  try {
    if (doc.ext === 'pdf') await renderPdf(container, doc);
    else if (doc.ext === 'docx') await renderDocx(container, doc);
    else {
      container.innerHTML = `<div class="msg warn">Los documentos .doc (Word 97-2003) no se pueden mostrar dentro de la app. Pulsa «Descargar» para abrirlo con Word, o guárdalo como .docx o PDF y súbelo de nuevo.</div>`;
    }
  } catch (err) {
    console.error(err);
    if (container.isConnected) {
      container.innerHTML = `<div class="msg error">No se ha podido mostrar el documento (${esc(err && err.message ? err.message : err)}). Puedes descargarlo y abrirlo con otra app.</div>`;
    }
  }
}

const vendorUrl = (path) => new URL(`vendor/${path}`, document.baseURI).href;
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(vendorUrl('pdfjs/pdf.min.mjs')).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
      return lib;
    }).catch((err) => { pdfjsPromise = null; throw err; });
  }
  return pdfjsPromise;
}

async function renderPdf(container, doc) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await doc.blob.arrayBuffer()),
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
    wasmUrl: vendorUrl('pdfjs/wasm/'),
    iccUrl: vendorUrl('pdfjs/iccs/'),
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
  if (!container.isConnected) { pdf.destroy(); return; }
  container.innerHTML = `<p class="hint pages">${pdf.numPages} ${pdf.numPages === 1 ? 'página' : 'páginas'}. Pellizca para ampliar.</p>`;
  const width = container.clientWidth || 360;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const slots = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const slot = document.createElement('div');
    slot.className = 'pdf-page';
    slot.style.aspectRatio = `${base.width} / ${base.height}`;
    slot.dataset.page = String(n);
    slot.setAttribute('aria-label', `Página ${n}`);
    container.append(slot);
    slots.push({ slot, page, base });
  }
  // Cada página se pinta al acercarse a la pantalla y se guarda como imagen: así no se agota la memoria del móvil.
  const paint = async ({ slot, page, base }) => {
    if (slot.dataset.done) return;
    slot.dataset.done = '1';
    let scale = (width / base.width) * dpr * 1.5;
    const maxPixels = 6e6;
    if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    canvas.width = 0; canvas.height = 0;
    if (!slot.isConnected || !blob) return;
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Página ${slot.dataset.page}`;
    slot.append(img);
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      observer.unobserve(e.target);
      const item = slots.find((x) => x.slot === e.target);
      if (item) paint(item).catch((err) => console.error(err));
    });
  }, { rootMargin: '800px 0px' });
  slots.forEach(({ slot }) => observer.observe(slot));
}

let mammothPromise = null;
function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      if (window.mammoth) { resolve(window.mammoth); return; }
      const script = document.createElement('script');
      script.src = vendorUrl('mammoth/mammoth.browser.min.js');
      script.onload = () => resolve(window.mammoth);
      script.onerror = () => { mammothPromise = null; reject(new Error('no se pudo cargar el lector de Word')); };
      document.head.append(script);
    });
  }
  return mammothPromise;
}

async function renderDocx(container, doc) {
  const mammoth = await loadMammoth();
  const result = await mammoth.convertToHtml({ arrayBuffer: await doc.blob.arrayBuffer() });
  if (!container.isConnected) return;
  const article = document.createElement('article');
  article.className = 'docx';
  article.append(sanitizeDocHtml(result.value));
  container.innerHTML = '<p class="hint pages">Vista de lectura: se muestra el texto, las tablas y las imágenes; el diseño de página puede diferir del original.</p>';
  container.append(article);
}

/** Deja solo etiquetas de texto seguras del HTML generado a partir del Word. */
function sanitizeDocHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'BR',
    'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'A', 'IMG', 'SPAN', 'BLOCKQUOTE', 'PRE', 'CODE']);
  const drop = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'MATH']);
  [...tpl.content.querySelectorAll('*')].forEach((el) => {
    if (drop.has(el.tagName)) { el.remove(); return; }
    if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      const keep = (el.tagName === 'A' && name === 'href' && /^(https?:|mailto:|#)/i.test(a.value))
        || (el.tagName === 'IMG' && name === 'src' && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(a.value))
        || (el.tagName === 'IMG' && name === 'alt')
        || ((el.tagName === 'TD' || el.tagName === 'TH') && (name === 'colspan' || name === 'rowspan') && /^\d{1,3}$/.test(a.value));
      if (!keep) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A' && el.hasAttribute('href')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    if (el.tagName === 'TABLE') {
      const wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      el.replaceWith(wrap);
      wrap.append(el);
    }
  });
  return tpl.content;
}

// ------------------------------------------------------------------ Ajustes, copias y actividad
async function viewSettings() {
  const backup = await backupStatus();
  const docs = await getAll(FILE_STORE);
  const docBytes = docs.reduce((n, f) => n + (f.size || 0), 0);
  let persisted = null; let usage = '';
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      if (isNum(e.usage)) usage = `Espacio usado: ${(e.usage / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB.`;
    }
  } catch { /* sin datos de almacenamiento */ }
  const probe = new File(['{}'], 'copia.json', { type: 'application/json' });
  const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [probe] }));
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return `<section><h2>Copia de seguridad</h2><div class="panel stack">
      <p>Tus datos solo están en este teléfono. Si se pierde, se rompe o se borran los datos de Chrome, solo se podrán recuperar con una copia.</p>
      <p><strong>Última copia:</strong> ${backup.lastExport ? esc(fmtStamp(backup.lastExport)) : 'ninguna todavía'}${backup.remind ? ' <span class="bad">(hay cambios sin copiar)</span>' : ''}</p>
      <div class="actions">
        <button class="btn" data-act="export">Exportar copia</button>
        ${canShare ? '<button class="btn secondary" data-act="share">Compartir copia</button>' : ''}
        <label class="btn secondary">Importar copia<input type="file" accept=".json,application/json" data-import hidden></label>
      </div>
      ${docs.length ? `<p class="hint">La copia incluye ${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'} de PNT (${fmtSize(docBytes)}), así que ocupará algo más.</p>` : ''}
      <p class="hint">La copia es un archivo .json que se guarda en Descargas. Guárdalo también fuera del teléfono (correo, Drive o el PC). Importar añade los registros que no tengas y actualiza los que sean más recientes; no borra nada.</p>
    </div></section>
  <section><h2>Seguridad</h2><form class="panel form" data-form="changePin" novalidate autocomplete="off">
      ${formMsg()}
      ${field('PIN actual', '<input class="pin" type="password" name="current" inputmode="numeric" pattern="[0-9]*" maxlength="8">')}
      ${field('PIN nuevo', '<input class="pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8">')}
      ${field('Repite el PIN nuevo', '<input class="pin" type="password" name="pin2" inputmode="numeric" pattern="[0-9]*" maxlength="8">')}
      <button class="btn secondary" type="submit">Cambiar PIN</button>
      <p class="hint">La app se bloquea sola tras 5 minutos en segundo plano o 15 sin usarla. El PIN impide el acceso desde la app, pero los datos no están cifrados: protege también el teléfono con su propio bloqueo.</p>
    </form></section>
  <section><h2>Almacenamiento</h2><div class="panel stack">
      <p>${persisted === true ? 'Datos protegidos: Chrome no los borrará para liberar espacio.' : 'Datos sin protección permanente: si el teléfono se queda sin espacio, Chrome podría borrarlos.'} ${usage}</p>
      ${persisted === true ? '' : '<button class="btn secondary" data-act="persist">Proteger datos</button><p class="hint">Si Chrome no lo permite, instala primero la app en la pantalla de inicio y vuelve a intentarlo.</p>'}
      ${standalone ? '<p class="hint">App instalada en el teléfono.</p>' : state.deferredInstall ? '<button class="btn secondary" data-act="install">Instalar en el teléfono</button>' : '<p class="hint">Para instalarla: menú de Chrome (⋮) y «Añadir a pantalla de inicio» o «Instalar aplicación».</p>'}
    </div></section>
  <section><h2>Actividad</h2><ul class="list"><li><a class="row" href="#auditoria"><span class="row-main">Ver el registro de actividad</span></a></li></ul></section>
  <section><h2>Acerca de</h2><div class="panel"><dl class="facts">
      <dt>Versión</dt><dd>FARMA·LAB móvil ${APP_VERSION}</dd>
      <dt>Usuario</dt><dd>${esc(state.profile.name)}</dd>
      <dt>Dispositivo</dt><dd><code>${esc(String(state.deviceId).slice(0, 8))}</code></dd>
    </dl><p class="hint">Prototipo de desarrollo. No validado para uso farmacéutico real ni como libro oficial de registro.</p></div></section>
  <section><h2>Borrar todos los datos</h2><div class="panel stack danger">
      <p>Elimina de este teléfono todos los registros, el PIN y la configuración. Exporta una copia antes.</p>
      <button class="btn danger" data-act="wipe">Borrar todos los datos</button>
    </div></section>`;
}
async function viewAudit() {
  const items = (await getAll('audit')).sort(byNewest).slice(0, 300);
  return items.length ? auditList(items) : empty('Sin actividad todavía.', '');
}

async function buildExport() {
  const datos = {};
  for (const s of STORES) datos[s] = await getAll(s);
  datos[FILE_STORE] = [];
  for (const f of await getAll(FILE_STORE)) {
    const { blob, ...meta } = f;
    datos[FILE_STORE].push({ ...meta, data: await blobToBase64(blob) });
  }
  return {
    formato: EXPORT_FORMAT, version_formato: EXPORT_FORMAT_VERSION,
    app: `FARMA·LAB móvil ${APP_VERSION}`, exportado: nowIso(),
    dispositivo: state.deviceId, usuario: state.profile.name, datos,
  };
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportBackup(share) {
  if (PREVIEW) { toast('En la vista previa no se pueden descargar copias. Funciona en la versión publicada.'); return; }
  const payload = await buildExport();
  const d = new Date();
  const name = `farmalab-movil-copia-${todayIso()}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
  const file = new File([JSON.stringify(payload, null, 1)], name, { type: 'application/json' });
  if (share) {
    try {
      await navigator.share({ files: [file], title: 'Copia de FARMA·LAB' });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      throw err;
    }
  } else {
    downloadBlob(file, name);
  }
  await metaSet('lastExport', nowIso());
  await logOnly('exportar_copia', name);
  toast(share ? 'Copia compartida.' : `Copia guardada en Descargas: ${name}`);
  await route();
}

const ID_RE = /^(?=.{8,64}$)[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
/** Documento de PNT de una copia: valida los datos y comprueba que el archivo llega íntegro (SHA-256). */
async function importedDoc(r) {
  if (!r || typeof r !== 'object' || !ID_RE.test(String(r.uuid)) || !ID_RE.test(String(r.pnt_uuid))) return null;
  if (typeof r.updated_at !== 'string' || typeof r.name !== 'string' || !DOC_TYPES[r.ext] || typeof r.data !== 'string') return null;
  if (!/^[0-9a-f]{64}$/.test(String(r.sha256)) || r.data.length > (MAX_DOC_BYTES * 4) / 3 + 8) return null;
  let bytes;
  try { bytes = base64ToBytes(r.data); } catch { return null; }
  if (toHex(await crypto.subtle.digest('SHA-256', bytes)) !== r.sha256) return null;
  const { data, ...meta } = r;
  return { ...meta, name: meta.name.slice(0, 200), mime: DOC_TYPES[r.ext].mime, size: bytes.length, blob: new Blob([bytes], { type: DOC_TYPES[r.ext].mime }) };
}
function validRecord(store, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || !ID_RE.test(String(r.uuid)) || typeof r.updated_at !== 'string') return false;
  const s = (v) => typeof v === 'string';
  const optNum = (v) => v === null || v === undefined || isNum(v);
  switch (store) {
    case 'material': return s(r.name) && s(r.lot) && isNum(r.quantity);
    case 'formula': return s(r.name) && isNum(r.target_amount) && Array.isArray(r.components)
      && r.components.every((c) => c && s(c.ingredient) && isNum(c.amount));
    case 'pnt': return s(r.code) && s(r.title);
    case 'production': return s(r.record_code) && isNum(r.target_amount) && Array.isArray(r.weighings)
      && r.weighings.every((w) => w && s(w.ingredient) && isNum(w.theoretical) && optNum(w.actual));
    case 'audit': return s(r.action);
    default: return false;
  }
}
async function importBackup(file) {
  if (file.size > 600 * 1048576) throw new InputError('El archivo es demasiado grande para ser una copia de FARMA·LAB.');
  let payload;
  try { payload = JSON.parse(await file.text()); } catch { throw new InputError('No se puede leer el archivo: no es una copia de FARMA·LAB.'); }
  if (!payload || payload.formato !== EXPORT_FORMAT || !payload.datos || typeof payload.datos !== 'object') {
    throw new InputError('El archivo no es una copia de FARMA·LAB.');
  }
  if (Number(payload.version_formato) > EXPORT_FORMAT_VERSION) {
    throw new InputError('La copia se hizo con una versión más nueva de FARMA·LAB. Actualiza la app e inténtalo de nuevo.');
  }
  const plan = {};
  let added = 0; let updated = 0; let same = 0; let invalid = 0;
  for (const s of STORES) {
    const incoming = Array.isArray(payload.datos[s]) ? payload.datos[s] : [];
    const existing = new Map((await getAll(s)).map((r) => [r.uuid, r]));
    plan[s] = [];
    for (const r of incoming) {
      if (!validRecord(s, r)) { invalid += 1; continue; }
      const cur = existing.get(r.uuid);
      if (!cur) { plan[s].push(r); added += 1; } else if (r.updated_at > (cur.updated_at || '')) { plan[s].push(r); updated += 1; } else same += 1;
    }
  }
  plan[FILE_STORE] = [];
  let docs = 0;
  const existingDocs = new Map((await getAll(FILE_STORE)).map((r) => [r.uuid, r]));
  for (const raw of Array.isArray(payload.datos[FILE_STORE]) ? payload.datos[FILE_STORE] : []) {
    const cur = existingDocs.get(raw && raw.uuid);
    if (cur && !(String(raw.updated_at) > (cur.updated_at || ''))) { same += 1; continue; }
    const doc = await importedDoc(raw);
    if (!doc) { invalid += 1; continue; }
    plan[FILE_STORE].push(doc); docs += 1;
    if (cur) updated += 1; else added += 1;
  }
  const summary = `Copia de ${payload.usuario || 'origen desconocido'} del ${fmtStamp(payload.exportado)}.\n\nRegistros nuevos: ${added}\nMás recientes que los tuyos: ${updated}${docs ? ` (incluye ${docs} ${docs === 1 ? 'documento' : 'documentos'} de PNT)` : ''}\nIguales o más antiguos (se ignoran): ${same}${invalid ? `\nNo válidos o dañados (se ignoran): ${invalid}` : ''}\n\nNo se borra nada de lo que ya tienes.`;
  if (!(await ask({ title: 'Importar copia', message: summary, confirmLabel: 'Importar' }))) return;
  if (added + updated) {
    await tx([...STORES, FILE_STORE, 'meta'], 'readwrite', (t) => {
      for (const s of [...STORES, FILE_STORE]) plan[s].forEach((r) => t.objectStore(s).put(r));
      t.objectStore('meta').put(nowIso(), 'lastChange');
    });
  }
  await logOnly('importar_copia', `${file.name}: ${added} nuevos, ${updated} actualizados`);
  toast(added + updated ? `Importados: ${added} nuevos y ${updated} actualizados.` : 'La copia no tenía nada nuevo.');
  await route();
}

async function wipeAll() {
  const confirmed = await ask({
    title: 'Borrar todos los datos',
    message: 'Se borrarán de este teléfono todos los registros, el PIN y la configuración de FARMA·LAB. No se puede deshacer.',
    confirmLabel: 'Borrar todo', danger: true, typed: 'BORRAR',
  });
  if (!confirmed) { toast('No se ha borrado nada.'); return; }
  const db = await openDB();
  db.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = resolve; r.onblocked = resolve; r.onerror = () => reject(r.error);
  });
  history.replaceState(null, '', location.pathname);
  location.reload();
}

// ------------------------------------------------------------------ acciones (clics)
const ACTIONS = {
  lock: () => lock(),
  back: () => {
    if (state.prevBack === state.parent) history.back();
    else location.replace(state.parent);
  },
  install: async () => {
    const ev = state.deferredInstall;
    if (!ev) { toast('Usa el menú de Chrome (⋮) y «Instalar aplicación».'); return; }
    ev.prompt();
    await ev.userChoice.catch(() => null);
    state.deferredInstall = null;
    await route();
  },
  update: () => {
    if (!state.swWaiting) return;
    state.updateRequested = true;
    state.swWaiting.postMessage('SKIP_WAITING');
  },
  export: () => exportBackup(false),
  share: () => exportBackup(true),
  persist: async () => {
    const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
    toast(ok ? 'Datos protegidos.' : 'Chrome no lo ha permitido todavía. Instala la app y vuelve a intentarlo.');
    await route();
  },
  addComponent: () => {
    $('[data-comps]').insertAdjacentHTML('beforeend', componentRow());
    const rows = $$('[data-comp]');
    $('input', rows[rows.length - 1]).focus();
  },
  removeComponent: (el) => {
    const rows = $$('[data-comp]');
    const row = el.closest('[data-comp]');
    if (rows.length > 1) row.remove();
    else $$('input', row).forEach((i) => { i.value = ''; });
  },
  setStatus: async (el) => {
    const { store, id, status } = el.dataset;
    if (!STATUS[store] || !STATUS[store][status]) return;
    const rec = await getOne(store, id);
    if (!rec) return;
    rec.status = status;
    const label = store === 'material' ? `${rec.name} / ${rec.lot}` : store === 'pnt' ? `${rec.code} ${rec.title}` : `${rec.code || ''} ${rec.name}`.trim();
    const action = { material: 'cambio_estado_materia_prima', formula: 'cambio_estado_formula', pnt: 'cambio_estado_pnt' }[store];
    await save(store, rec, action, `${label}: ${STATUS[store][status]}`);
    toast(`Estado cambiado a ${STATUS[store][status]}.`);
    await route();
  },
  wipe: () => wipeAll(),
  downloadDoc: async (el) => {
    const doc = await getOne(FILE_STORE, el.dataset.id);
    if (!doc) return;
    if (PREVIEW) { toast('En la vista previa no se pueden descargar archivos.'); return; }
    downloadBlob(doc.blob, doc.name);
    toast(`Guardado en Descargas: ${doc.name}`);
  },
  shareDoc: async (el) => {
    const doc = await getOne(FILE_STORE, el.dataset.id);
    if (!doc) return;
    try {
      await navigator.share({ files: [new File([doc.blob], doc.name, { type: doc.mime })], title: doc.name });
    } catch (err) {
      if (!err || err.name !== 'AbortError') toast('No se pudo compartir. Usa «Descargar» y ábrelo desde Descargas.');
    }
  },
  forgotPin: async () => {
    const go = await ask({
      title: 'PIN olvidado',
      message: 'El PIN no se puede recuperar. La única opción es borrar todos los datos de este teléfono y empezar de nuevo; después podrás importar una copia si la tienes.',
      confirmLabel: 'Continuar', danger: true,
    });
    if (go) await wipeAll();
  },
};

async function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const handler = ACTIONS[el.dataset.act];
  if (!handler) return;
  e.preventDefault();
  try { await handler(el, e); } catch (err) { reportError(err); }
}

// ------------------------------------------------------------------ formularios
const formData = (form) => Object.fromEntries(new FormData(form));

const FORMS = {
  async setup(form) {
    const d = formData(form);
    const name = str(d.name);
    if (!name) throw new InputError('Escribe tu nombre.');
    checkPinFormat(d.pin);
    if (d.pin !== d.pin2) throw new InputError('Los dos PIN no coinciden.');
    const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
    const profile = {
      uuid: newId(), name: name.slice(0, 80), role: 'responsable',
      pin_salt: salt, pin_iterations: PBKDF2_ITERATIONS, pin_hash: await hashPin(d.pin, salt, PBKDF2_ITERATIONS),
      created_at: nowIso(),
    };
    await metaSet('profile', profile);
    state.profile = profile;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await unlockDone();
  },

  async unlock(form) {
    const p = state.profile;
    const fails = (await metaGet('pinFailures')) || { count: 0, until: 0 };
    if (fails.until > Date.now()) throw new InputError(`Demasiados intentos. Espera ${Math.ceil((fails.until - Date.now()) / 1000)} segundos.`);
    const ok = (await hashPin(form.pin.value, p.pin_salt, p.pin_iterations)) === p.pin_hash;
    if (!ok) {
      fails.count += 1;
      if (fails.count >= 5) fails.until = Date.now() + Math.min(30000 * 2 ** (fails.count - 5), 15 * 60000);
      await metaSet('pinFailures', fails);
      form.pin.value = '';
      throw new InputError(fails.count >= 5 ? `PIN incorrecto. Espera ${Math.ceil((fails.until - Date.now()) / 1000)} segundos antes de reintentar.` : 'PIN incorrecto.');
    }
    await metaSet('pinFailures', { count: 0, until: 0 });
    await unlockDone();
  },

  async material(form) {
    const d = formData(form);
    const name = str(d.name); const lot = str(d.lot); const code = str(d.code);
    if (!name || !lot) throw new InputError('El nombre y el lote son obligatorios.');
    const quantity = parseNum(d.quantity, 'Cantidad');
    if (quantity === null) throw new InputError('Indica la cantidad.');
    if (code && (await getAll('material')).some((m) => m.code && lc(m.code) === lc(code))) {
      throw new InputError('Ya existe una materia prima con ese código. Usa otro código o déjalo en blanco.');
    }
    const rec = {
      uuid: newId(), name: name.slice(0, 160), code: code.slice(0, 80) || null, lot: lot.slice(0, 100),
      supplier: str(d.supplier).slice(0, 160), quantity,
      unit: MATERIAL_UNITS.includes(d.unit) ? d.unit : 'g',
      expiry: isDay(d.expiry) ? d.expiry : null,
      status: STATUS.material[d.status] ? d.status : 'cuarentena',
    };
    await save('material', rec, 'alta_lote_materia_prima', `${rec.name} / ${rec.lot}`);
    toast('Lote registrado.');
    location.hash = '#materias';
  },

  async formula(form) {
    const d = formData(form);
    const all = new FormData(form);
    const name = str(d.name);
    if (!name) throw new InputError('Escribe el nombre de la fórmula.');
    const target = parseNum(d.target_amount, 'Lote de referencia');
    if (!target || target <= 0) throw new InputError('El lote de referencia debe ser mayor que cero.');
    const ingredients = all.getAll('ingredient'); const amounts = all.getAll('amount'); const units = all.getAll('cunit');
    const components = [];
    ingredients.forEach((ing, i) => {
      const n = str(ing);
      if (!n && !str(amounts[i])) return;
      if (!n) throw new InputError(`Falta el nombre del componente ${i + 1}.`);
      const amount = parseNum(amounts[i], n);
      if (amount === null || amount <= 0) throw new InputError(`Indica una cantidad mayor que cero para ${n}.`);
      components.push({ ingredient: n.slice(0, 160), amount, unit: COMPONENT_UNITS.includes(units[i]) ? units[i] : 'g' });
    });
    if (!components.length) throw new InputError('Añade al menos un componente.');
    const rec = {
      uuid: newId(), name: name.slice(0, 160), code: str(d.code).slice(0, 80), version: str(d.version).slice(0, 30) || '1',
      form: str(d.form).slice(0, 80), reference: str(d.reference).slice(0, 200), target_amount: target,
      unit: FORMULA_UNITS.includes(d.unit) ? d.unit : 'g', status: STATUS.formula[d.status] ? d.status : 'borrador', components,
    };
    await save('formula', rec, 'alta_formula', `${rec.code} ${rec.name}`.trim());
    toast('Fórmula guardada.');
    location.hash = `#formulas--${rec.uuid}`;
  },

  async pnt(form) {
    const d = formData(form);
    const code = str(d.code); const title = str(d.title);
    if (!code || !title) throw new InputError('El código y el título son obligatorios.');
    if ((await getAll('pnt')).some((x) => lc(x.code) === lc(code))) throw new InputError('Ya existe un PNT con ese código.');
    const rec = {
      uuid: newId(), code: code.slice(0, 80), title: title.slice(0, 180), category: str(d.category).slice(0, 100),
      version: str(d.version).slice(0, 30) || '1',
      effective_date: isDay(d.effective_date) ? d.effective_date : null, review_date: isDay(d.review_date) ? d.review_date : null,
      status: STATUS.pnt[d.status] ? d.status : 'borrador', file_note: str(d.file_note).slice(0, 500),
    };
    const file = form.elements.file && form.elements.file.files[0];
    if (file) {
      const doc = await buildDocRecord(file, rec, [], rec.version);
      await saveMany([['pnt', rec], [FILE_STORE, doc]], 'alta_pnt', `${rec.code} ${rec.title} (con documento ${doc.name})`);
    } else {
      await save('pnt', rec, 'alta_pnt', `${rec.code} ${rec.title}`);
    }
    toast(file ? 'PNT registrado con su documento.' : 'PNT registrado.');
    location.hash = `#pnt--${rec.uuid}`;
  },

  async pntDoc(form) {
    const p = await getOne('pnt', form.dataset.id);
    if (!p) throw new InputError('Este PNT ya no existe.');
    const file = form.elements.file.files[0];
    if (!file) throw new InputError('Elige un archivo PDF o Word.');
    const version = str(form.elements.version.value).slice(0, 30) || p.version || '1';
    const doc = await buildDocRecord(file, p, await filesOf(p.uuid), version);
    p.version = version;
    if (isDay(form.elements.effective_date.value)) p.effective_date = form.elements.effective_date.value;
    if (isDay(form.elements.review_date.value)) p.review_date = form.elements.review_date.value;
    await saveMany([['pnt', p], [FILE_STORE, doc]], 'alta_documento_pnt', `${p.code}: ${doc.name} (versión ${version})`);
    toast('Documento guardado.');
    await route();
  },

  async productionNew(form) {
    const d = formData(form);
    const code = str(d.record_code);
    if (!code) throw new InputError('Escribe el código de elaboración.');
    const f = await getOne('formula', d.formula_uuid);
    if (!f || f.status !== 'aprobada') throw new InputError('Elige una fórmula aprobada.');
    const target = parseNum(d.target_amount, 'Cantidad final');
    if (!target || target <= 0) throw new InputError('La cantidad final debe ser mayor que cero.');
    if (!(f.target_amount > 0)) throw new InputError('La fórmula no tiene un lote de referencia válido.');
    if ((await getAll('production')).some((p) => lc(p.record_code) === lc(code))) {
      throw new InputError('Ya existe un registro de elaboración con ese código.');
    }
    const factor = target / f.target_amount;
    const rec = {
      uuid: newId(), record_code: code.slice(0, 80), patient_ref: str(d.patient_ref).slice(0, 100),
      formula_uuid: f.uuid, formula_code: f.code, formula_name: f.name, formula_version: f.version,
      target_amount: target, unit: f.unit, operator: state.profile.name, status: 'borrador', notes: str(d.notes),
      weighings: (f.components || []).map((c) => ({
        uuid: newId(), ingredient: c.ingredient, theoretical: round6(c.amount * factor), actual: null, unit: c.unit, material_lot: '',
      })),
    };
    await save('production', rec, 'crear_registro_elaboracion', rec.record_code);
    toast('Registro creado. Completa las pesadas reales y los lotes.');
    location.hash = `#elaboraciones--${rec.uuid}`;
  },

  async weighings(form, submitter) {
    const rec = await getOne('production', form.dataset.id);
    if (!rec) throw new InputError('Este registro ya no existe.');
    if (rec.status !== 'borrador') throw new InputError('Este registro ya se envió a revisión y no se puede modificar.');
    const actuals = rec.weighings.map((w, i) => parseNum(form.elements[`actual_${i}`].value, `Real de ${w.ingredient}`));
    rec.weighings.forEach((w, i) => {
      w.actual = actuals[i];
      w.material_lot = str(form.elements[`lot_${i}`].value).slice(0, 100);
    });
    rec.notes = str(form.elements.notes.value);
    if (submitter && submitter.value === 'submit') {
      const missing = rec.weighings.filter((w) => !isNum(w.actual) || !w.material_lot);
      if (!rec.weighings.length || missing.length) {
        await save('production', rec, 'actualizar_pesadas', rec.record_code);
        throw new InputError(`Faltan pesadas reales o lotes de: ${missing.map((w) => w.ingredient).join(', ')}. Lo que has escrito se ha guardado.`);
      }
      const go = await ask({
        title: 'Enviar a revisión',
        message: 'Después ya no podrás modificar las pesadas ni los lotes. El envío no libera ni autoriza el preparado.',
        confirmLabel: 'Enviar',
      });
      if (!go) {
        await save('production', rec, 'actualizar_pesadas', rec.record_code);
        toast('Pesadas y lotes guardados.');
        await route();
        return;
      }
      rec.status = 'pendiente_revision';
      rec.submitted_at = nowIso();
      await save('production', rec, 'enviar_revision', rec.record_code);
      toast('Enviado a revisión farmacéutica. No implica liberación.');
    } else {
      await save('production', rec, 'actualizar_pesadas', rec.record_code);
      toast('Pesadas y lotes guardados.');
    }
    await route();
  },

  async changePin(form) {
    const d = formData(form);
    const p = state.profile;
    if ((await hashPin(d.current || '', p.pin_salt, p.pin_iterations)) !== p.pin_hash) throw new InputError('El PIN actual no es correcto.');
    checkPinFormat(d.pin);
    if (d.pin !== d.pin2) throw new InputError('Los dos PIN nuevos no coinciden.');
    const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
    const profile = { ...p, pin_salt: salt, pin_iterations: PBKDF2_ITERATIONS, pin_hash: await hashPin(d.pin, salt, PBKDF2_ITERATIONS) };
    await metaSet('profile', profile);
    state.profile = profile;
    await logOnly('cambio_pin', profile.name);
    form.reset();
    toast('PIN cambiado.');
  },
};

async function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const handler = FORMS[form.dataset.form];
  if (!handler) return;
  const buttons = $$('button[type="submit"]', form);
  buttons.forEach((b) => { b.disabled = true; });
  const box = $('[data-formmsg]', form);
  if (box) box.hidden = true;
  try {
    await handler(form, e.submitter);
  } catch (err) {
    reportError(err, form);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function onInput(e) {
  const t = e.target;
  if (t.matches('[data-filter]')) {
    const q = lc(str(t.value));
    const rows = $$('[data-list] > li');
    let shown = 0;
    rows.forEach((li) => { const hit = !q || li.dataset.text.includes(q); li.hidden = !hit; if (hit) shown += 1; });
    const none = $('[data-none]');
    if (none) none.hidden = shown > 0;
  } else if (t.matches('[data-weigh-actual]')) {
    updateDeviation(t);
  } else if (t.matches('[data-weigh-lot]')) {
    updateLotWarning(t);
  } else if (t.closest('form[data-form="productionNew"]')) {
    updatePreview(t.closest('form'));
  }
}
async function onChange(e) {
  const t = e.target;
  if (t.matches('input[data-docpick]')) {
    const out = $('[data-file-chosen]', t.closest('form'));
    const f = t.files && t.files[0];
    if (out) out.textContent = f ? `${f.name} (${fmtSize(f.size)})` : 'Ningún archivo elegido';
  } else if (t.matches('input[data-import]')) {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    try { await importBackup(file); } catch (err) { reportError(err); }
  } else if (t.closest('form[data-form="productionNew"]')) {
    updatePreview(t.closest('form'));
  }
}

window.addEventListener('hashchange', (e) => { state.prevBack = e.oldURL.includes('#') ? `#${e.oldURL.split('#')[1]}` : '#inicio'; });
document.addEventListener('DOMContentLoaded', boot);
