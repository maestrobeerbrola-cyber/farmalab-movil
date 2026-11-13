/* FARMA·LAB móvil — service worker: guarda la app para usarla sin conexión.
   Al publicar una versión nueva, cambia VERSION (y APP_VERSION en app.js). */
const VERSION = '0.3.7';
const CACHE = `farmalab-movil-${VERSION}`;
// Imprescindibles: si falta alguno, no se instala esta versión.
const CORE = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './modulos/documentos.js', './modulos/almacen.js', './modulos/formulas.js', './modulos/elaborar.js', './modulos/calculadora.js', './modulos/precios.js', './modulos/ficha.js',
  './datos/tabla1-principios-activos.json', './datos/precio-tasado-2026.json'];
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
