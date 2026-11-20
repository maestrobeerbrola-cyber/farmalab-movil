/* FARMA·LAB móvil — service worker: guarda la app para usarla sin conexión.
   Al publicar una versión nueva, cambia VERSION (y APP_VERSION en app.js). */
const VERSION = '0.3.33';
const CACHE = `farmalab-movil-${VERSION}`;
// Imprescindibles: si falta alguno, no se instala esta versión.
const CORE = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './modulos/documentos.js', './modulos/almacen.js', './modulos/indice.js', './modulos/formulas.js', './modulos/elaborar.js', './modulos/calculadora.js', './modulos/precios.js', './modulos/ficha.js', './modulos/conservacion.js', './modulos/sync.js', './modulos/temperaturas.js', './modulos/balanzas.js', './modulos/estado.js', './modulos/avisos.js', './modulos/farmaceuticos.js',
  './datos/tabla1-principios-activos.json', './datos/precio-tasado-2026.json', './datos/fn-materias-primas.json'];
// Complementos: si alguno falla, la app funciona igual y se guardará cuando se use.
const EXTRA = [
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
  './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/pdfjs/wasm/openjpeg.wasm', './vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js',
  './vendor/pdfjs/wasm/jbig2.wasm', './vendor/pdfjs/wasm/jbig2_nowasm_fallback.js', './vendor/pdfjs/wasm/qcms_bg.wasm',
  './vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc',
  ...['FoxitDingbats.pfb', 'FoxitFixed.pfb', 'FoxitFixedBold.pfb', 'FoxitFixedBoldItalic.pfb', 'FoxitFixedItalic.pfb',
    'FoxitSerif.pfb', 'FoxitSerifBold.pfb', 'FoxitSerifBoldItalic.pfb', 'FoxitSerifItalic.pfb', 'FoxitSymbol.pfb',
    'LiberationSans-Bold.ttf', 'LiberationSans-BoldItalic.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-Regular.ttf']
    .map((f) => `./vendor/pdfjs/standard_fonts/${f}`),
  './vendor/mammoth/mammoth.browser.min.js',
  './vendor/pdf-lib/pdf-lib.min.js',
];
const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(fresh));
    await Promise.allSettled(EXTRA.map((url) => cache.add(fresh(url))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('farmalab-movil-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'check-alerts') event.waitUntil(notifyDueAlerts({ test: Boolean(event.data.test) }));
});

// ------------------------------------------------------------------ avisos con la app cerrada
/*
 * La app deja en IndexedDB (meta «alertPlan») los avisos activos y los que se activarán con los días.
 * Chrome despierta este service worker con la sincronización periódica (Android, app instalada): se miran los
 * avisos que tocan hoy y se muestra una notificación con los nuevos (y, una vez al día, con los que siguen pendientes).
 */
const ALERT_SYNC_TAG = 'farmalab-avisos';
const alertKey = (a) => [a.tone, a.kind, a.title, a.href].join('|');
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function idbOpen() {
  return new Promise((resolve) => {
    let r;
    try { r = indexedDB.open('farmalab-movil'); } catch { resolve(null); return; }
    r.onupgradeneeded = () => r.transaction.abort();   // sin base de datos todavía: no se crea aquí
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); resolve(db); };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}
const idbReq = (db, store, mode, fn) => new Promise((resolve) => {
  try {
    if (!db.objectStoreNames.contains(store)) { resolve(undefined); return; }
    const q = fn(db.transaction(store, mode).objectStore(store));
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => resolve(undefined);
  } catch { resolve(undefined); }
});
async function dueAlerts(db) {
  const plan = await idbReq(db, 'meta', 'readonly', (s) => s.get('alertPlan'));
  if (!plan || !Array.isArray(plan.items)) return [];
  const today = localDay();
  const out = plan.items.filter((a) => !a.rule && a.from <= today && (!a.until || today <= a.until));
  const temp = plan.items.find((a) => a.rule === 'temp');
  if (temp && new Date().getHours() >= 12) {   // la lectura del día se recuerda a partir de mediodía
    const readings = (await idbReq(db, 'temperature', 'readonly', (s) => s.getAll())) || [];
    const pending = temp.points.filter((p) => !readings.some((r) => r.point_id === p.id && r.date === today));
    if (pending.length) out.push({ tone: 'amber', kind: 'Temperatura', title: `${pending.map((p) => p.name).join(', ')}: sin registrar hoy`, text: temp.text, href: '#temperaturas' });
  }
  return out.sort((a, b) => (a.tone === 'red' ? 0 : 1) - (b.tone === 'red' ? 0 : 1));
}
async function notifyDueAlerts({ test = false } = {}) {
  if (!self.registration.showNotification || (self.Notification && self.Notification.permission !== 'granted')) return;
  const db = await idbOpen();
  if (!db) return;
  try {
    const prefs = (await idbReq(db, 'meta', 'readonly', (s) => s.get('alertPrefs'))) || {};
    if (!test && !prefs.notify) return;
    if (!test) {   // con la app a la vista, la ventana de avisos ya se encarga
      const wins = await self.clients.matchAll({ type: 'window' });
      if (wins.some((c) => c.visibilityState === 'visible')) return;
    }
    const today = localDay();
    const seen = (await idbReq(db, 'meta', 'readonly', (s) => s.get('alertSeen'))) || {};
    const all = await dueAlerts(db);
    const fresh = test ? all : all.filter((a) => !(alertKey(a) in seen) || (prefs.popup !== 'new' && seen[alertKey(a)] < today));
    const icon = './icons/icon-192.png';
    if (!fresh.length) {
      if (test) await self.registration.showNotification('FARMA·LAB', { body: 'No hay avisos pendientes. Las notificaciones funcionan.', tag: ALERT_SYNC_TAG, icon, badge: icon, data: { href: '#inicio' } });
      return;
    }
    if (!test) {
      fresh.forEach((a) => { seen[alertKey(a)] = today; });
      await idbReq(db, 'meta', 'readwrite', (s) => s.put(seen, 'alertSeen'));
    }
    const one = fresh.length === 1;
    await self.registration.showNotification(one ? `${fresh[0].kind}: ${fresh[0].title}` : `FARMA·LAB: ${fresh.length} avisos`, {
      body: one ? fresh[0].text : `${fresh.slice(0, 4).map((a) => `• ${a.title}`).join('\n')}${fresh.length > 4 ? `\ny ${fresh.length - 4} más` : ''}`,
      tag: ALERT_SYNC_TAG, renotify: true, icon, badge: icon,
      data: { href: one ? fresh[0].href : '#inicio' }, requireInteraction: fresh.some((a) => a.tone === 'red'),
    });
  } finally { db.close(); }
}
self.addEventListener('periodicsync', (event) => {
  if (event.tag === ALERT_SYNC_TAG) event.waitUntil(notifyDueAlerts());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.href) || '#inicio';
  const href = /^#[\w-]*$/.test(raw) ? raw : '#inicio';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'goto', href });
      return;
    }
    await self.clients.openWindow(new URL(`./${href}`, self.registration.scope).href);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
