'use strict';
/* FARMA·LAB móvil · Documentos: adjuntos de cualquier ficha, visor, PNT y bibliografía. */

// ------------------------------------------------------------------ adjuntos
const latestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

/** Comprueba el contenido real del archivo (no solo la extensión). */
async function sniffDoc(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ext = String(file.name.split('.').pop() || '').toLowerCase();
  const starts = (sig) => sig.every((b, i) => head[i] === b);
  if (new TextDecoder('latin1').decode(head).indexOf('%PDF-') !== -1) return 'pdf';
  if (ext === 'docx' && starts([0x50, 0x4b, 0x03, 0x04])) return 'docx';
  if (ext === 'doc' && starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && new TextDecoder('latin1').decode(head.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}
const PHOTO_MAX_SIDE = 2400;     // px por el lado largo: un folio fotografiado se sigue leyendo bien
const PHOTO_QUALITY = 0.88;
const PHOTO_MAX_INPUT = 60 * 1048576;
/**
 * Las fotos se guardan como JPG de hasta 2400 px por el lado largo: ocupan mucho menos (copias y sincronización),
 * se ven derechas aunque el móvil las guarde giradas y pierden la ubicación (GPS) y el resto de metadatos.
 */
async function normalizePhoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';   // las imágenes con transparencia quedan sobre blanco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
  canvas.width = 0; canvas.height = 0;
  if (!blob) return null;
  return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'foto'}.jpg`, { type: 'image/jpeg' });
}
const FILE_TYPES_TEXT = 'PDF, Word (.docx o .doc) o foto (JPG, PNG o WebP)';
/** Prepara el registro de un documento adjunto: PNT, materia prima, envase, bibliografía o receta. */
async function buildDocRecord(input, ownerType, ownerUuid, existing, { version = '', kind = 'documento' } = {}) {
  let file = input;
  if (!file.size) throw new InputError('El archivo está vacío.');
  let ext = await sniffDoc(file);
  if (!ext) throw new InputError(`Solo se admiten documentos ${FILE_TYPES_TEXT}. Si la foto es HEIC (iPhone), guárdala como JPG.`);
  if (DOC_TYPES[ext].image) {
    if (file.size > PHOTO_MAX_INPUT) throw new InputError(`La foto ocupa ${fmtSize(file.size)}: es demasiado grande para leerla.`);
    file = await normalizePhoto(file);
    if (!file) throw new InputError('No se ha podido leer la foto. Prueba a hacerla de nuevo o a guardarla como JPG.');
    ext = 'jpg';
  }
  if (file.size > MAX_DOC_BYTES) throw new InputError(`El archivo ocupa ${fmtSize(file.size)}. El máximo es 25 MB.`);
  const local = kind === 'receta';   // las recetas llevan datos del paciente: solo en este dispositivo
  const buf = await file.arrayBuffer();
  const sha256 = toHex(await crypto.subtle.digest('SHA-256', buf));
  if (existing.some((f) => f.sha256 === sha256)) throw new InputError('Ese mismo archivo ya está guardado en esta ficha.');
  return {
    uuid: newId(), owner_type: ownerType, owner_uuid: ownerUuid, ...(ownerType === 'pnt' ? { pnt_uuid: ownerUuid } : {}),
    kind: DOC_KINDS[kind] ? kind : 'documento', name: file.name.slice(0, 200), ext, mime: DOC_TYPES[ext].mime,
    size: file.size, version, sha256, uploaded_by: state.profile.name,
    ...(local ? { local_only: true } : {}),
    blob: new Blob([buf], { type: DOC_TYPES[ext].mime }),
  };
}
/** En el móvil (pantalla táctil) se ofrece también la cámara; en el PC basta con elegir el archivo. */
const hasCamera = () => matchMedia('(pointer: coarse)').matches;
const filePicker = (label = 'Elegir archivo', { accept = DOC_ACCEPT, camera = hasCamera() } = {}) => `<div class="filepick">
    <div class="actions">
      ${camera ? '<label class="btn secondary">Hacer foto<input type="file" name="file_cam" accept="image/*" capture="environment" data-docpick hidden></label>' : ''}
      <label class="btn secondary">${esc(label)}<input type="file" name="file" accept="${accept}" data-docpick hidden></label>
    </div>
    <p class="hint" data-file-chosen>Ningún archivo elegido</p>
    <p class="hint">${FILE_TYPES_TEXT}, hasta 25 MB.</p>
  </div>`;
/** Archivo elegido en el formulario (con el selector o con la cámara). */
const pickedFile = (form) => (form.elements.file && form.elements.file.files[0]) || (form.elements.file_cam && form.elements.file_cam.files[0]) || null;
function docRow(f, current) {
  return `<li><a class="row" href="#documento--${esc(f.uuid)}"><div class="row-main"><strong>${esc(f.name)}</strong><span class="sub"><span class="doc-tag">${esc(DOC_TYPES[f.ext].label)}</span>${f.kind && f.kind !== 'documento' ? `<span>${esc(DOC_KINDS[f.kind])}</span>` : ''}${f.version ? `<span>Versión ${esc(f.version)}</span>` : ''}<span>${esc(fmtStamp(f.created_at).slice(0, 10))}</span><span>${fmtSize(f.size)}</span></span></div>${current ? '<span class="pill green">Vigente</span>' : ''}</a></li>`;
}
/** Bloque de documentos adjuntos para fichas de materias primas, envases, bibliografía y recetas de las elaboraciones. */
async function docsSection(ownerType, ownerUuid, kinds, title = 'Documentos', { pickLabel = 'Elegir archivo', accept = DOC_ACCEPT, camera = hasCamera(), note = '', none = 'Sin documentos adjuntos.', submit = 'Guardar documento' } = {}) {
  const docs = (await docsOf(ownerUuid)).sort(latestFirst);
  return `<section><h2>${esc(title)}</h2>
    ${docs.length ? `<ul class="list">${docs.map((f) => docRow(f, false)).join('')}</ul>` : `<p class="hint none-docs">${esc(none)}</p>`}
    <form class="panel form spaced" data-form="docUpload" data-owner-type="${ownerType}" data-owner-id="${esc(ownerUuid)}" novalidate>
      ${formMsg()}
      ${filePicker(pickLabel, { accept, camera })}
      ${note ? `<p class="hint">${note}</p>` : ''}
      ${kinds.length > 1 ? field('Tipo de documento', `<select name="kind">${options(kinds, kinds[0], DOC_KINDS)}</select>`) : `<input type="hidden" name="kind" value="${kinds[0]}">`}
      <button class="btn secondary block" type="submit">${esc(submit)}</button>
    </form></section>`;
}
const DOC_ACTION = { pnt: 'alta_documento_pnt', material: 'alta_documento', packaging: 'alta_documento', biblio: 'alta_documento', production: 'alta_receta' };
Object.assign(FORMS, {
  async docUpload(form) {
    const { ownerType, ownerId } = form.dataset;
    if (!DOC_ACTION[ownerType]) return;
    const owner = await getOne(ownerType, ownerId);
    if (!owner) throw new InputError('Esta ficha ya no existe.');
    const file = pickedFile(form);
    const kind = ownerType === 'production' ? 'receta' : form.elements.kind.value;
    if (!file) throw new InputError(kind === 'receta' ? 'Haz una foto o elige el archivo de la receta.' : 'Haz una foto o elige un archivo.');
    const doc = await buildDocRecord(file, ownerType, ownerId, await docsOf(ownerId), { kind });
    // de la receta no se anota el nombre del archivo: puede llevar el nombre del paciente
    const detail = kind === 'receta'
      ? `${owner.lot || owner.record_code}: receta (${DOC_TYPES[doc.ext].label}, ${fmtSize(doc.size)})`
      : `${owner.name || owner.title || owner.code}: ${DOC_KINDS[doc.kind]} ${doc.name}`;
    await saveMany([[FILE_STORE, doc]], DOC_ACTION[ownerType], detail);
    toast(kind === 'receta' ? 'Receta guardada en este dispositivo.' : 'Documento guardado.');
    await route();
  },
});

// ------------------------------------------------------------------ visor de documentos
const OWNER_ROUTE = { pnt: 'pnt', material: 'materias', packaging: 'envases', biblio: 'biblio', production: 'elaboraciones' };
async function ownerLabel(doc) {
  const store = doc.owner_type || 'pnt';
  const o = await getOne(store, doc.owner_uuid || doc.pnt_uuid);
  if (!o) return doc.name;
  if (store === 'pnt') return `${o.code} ${o.title}`;
  if (store === 'biblio') return o.title;
  if (store === 'production') return `${o.lot || o.record_code} · ${o.formula_name}`;
  return `${o.name}${o.lot ? `, lote ${o.lot}` : ''}`;
}
async function viewDocument(id) {
  const doc = await getOne(FILE_STORE, id);
  if (!doc) return empty('Este documento no existe.', '');
  state.parent = `#${OWNER_ROUTE[doc.owner_type || 'pnt']}--${doc.owner_uuid || doc.pnt_uuid}`;
  const canShare = (doc.ext === 'pdf' || DOC_TYPES[doc.ext].image) && navigator.canShare
    && navigator.canShare({ files: [new File([''], `x.${doc.ext}`, { type: doc.mime })] });
  return `<div class="doc-head">
    <strong>${esc(await ownerLabel(doc))}</strong>
    <span class="sub"><span>${esc(DOC_KINDS[doc.kind] || 'Documento')}</span><span>${esc(doc.name)}</span>${doc.version ? `<span>Versión ${esc(doc.version)}</span>` : ''}<span>${fmtSize(doc.size)}</span></span>
    <div class="actions">
      <button class="btn secondary small" data-act="downloadDoc" data-id="${esc(doc.uuid)}">Descargar</button>
      ${canShare ? `<button class="btn secondary small" data-act="shareDoc" data-id="${esc(doc.uuid)}">Abrir con otra app</button>` : ''}
      ${isLocalOnly(doc) ? `<button class="btn danger-outline small" data-act="deleteDoc" data-id="${esc(doc.uuid)}">Eliminar</button>` : ''}
    </div>
    ${isLocalOnly(doc) ? '<p class="hint">Solo está en este dispositivo: no va en las copias de seguridad.</p>' : ''}
  </div>
  <div id="docview" class="docview" data-id="${esc(doc.uuid)}"><p class="hint">Abriendo el documento...</p></div>`;
}

async function renderDocument(container) {
  const doc = container.dataset.id ? await getOne(FILE_STORE, container.dataset.id) : state.label && { ext: 'pdf', blob: state.label.blob };
  if (!doc || !container.isConnected) return;
  try {
    if (doc.ext === 'pdf') await renderPdf(container, doc);
    else if (doc.ext === 'docx') await renderDocx(container, doc);
    else if (DOC_TYPES[doc.ext] && DOC_TYPES[doc.ext].image) renderImage(container, doc);
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
  const task = pdfjs.getDocument({
    data: new Uint8Array(await doc.blob.arrayBuffer()),
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
    wasmUrl: vendorUrl('pdfjs/wasm/'),
    iccUrl: vendorUrl('pdfjs/iccs/'),
    isEvalSupported: false,
    enableXfa: false,
  });
  const pdf = await task.promise;
  if (!container.isConnected) { task.destroy().catch(() => {}); return; }   // se salió de la pantalla mientras cargaba
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

function renderImage(container, doc) {
  const url = URL.createObjectURL(doc.blob);
  state.objectUrls.push(url);
  container.innerHTML = '<p class="hint pages">Pellizca para ampliar.</p>';
  const img = document.createElement('img');
  img.className = 'doc-image';
  img.src = url;
  img.alt = DOC_KINDS[doc.kind] || 'Imagen';
  container.append(img);
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

// ------------------------------------------------------------------ PNT
const DOCS_TABS = [['#pnt', 'PNT'], ['#biblio', 'Bibliografía']];
ROUTES.pnt = (arg, extra) => (arg === 'nuevo' ? viewPntForm() : arg && extra === 'editar' ? viewPntForm(arg) : arg ? viewPnt(arg) : viewPnts());
ROUTES.documento = (arg) => viewDocument(arg);

Object.assign(ACTIONS, {
  /** Solo se pueden borrar los archivos que no viajan en las copias (recetas): los demás quedan como historial. */
  deleteDoc: async (el) => {
    const doc = await getOne(FILE_STORE, el.dataset.id);
    if (!doc || !isLocalOnly(doc)) return;
    const owner = await getOne(doc.owner_type, doc.owner_uuid);
    const ok = await ask({ title: 'Eliminar receta', message: 'Se borrará de este dispositivo y no se podrá recuperar.', confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    const stamp = nowIso();
    await tx([FILE_STORE, 'audit', 'meta'], 'readwrite', (t) => {
      t.objectStore(FILE_STORE).delete(doc.uuid);
      t.objectStore('audit').put(auditEntry('baja_receta', `${owner ? owner.lot || owner.record_code : 'Elaboración'}: receta (${DOC_TYPES[doc.ext].label})`, stamp));
      t.objectStore('meta').put(stamp, 'lastChange');
    });
    toast('Receta eliminada.');
    location.hash = `#${OWNER_ROUTE[doc.owner_type] || 'inicio'}--${doc.owner_uuid}`;
  },
});
AFTER_RENDER.push(() => { const v = $('#docview'); if (v) renderDocument(v); });

async function viewPnts() {
  const all = await getAll('pnt');
  const items = all.filter((p) => !p.deleted_at).sort(byText('code'));
  const trashed = all.length - items.length;
  const latest = {};
  (await getAll(FILE_STORE)).filter((f) => (f.owner_type || 'pnt') === 'pnt').sort(latestFirst)
    .forEach((f) => { const k = f.owner_uuid || f.pnt_uuid; if (!latest[k]) latest[k] = f; });
  const list = items.length
    ? `<ul class="list" data-list>${items.map((p) => {
      const overdue = p.status === 'vigente' && isDay(p.review_date) && daysUntil(p.review_date) < 0;
      const doc = latest[p.uuid];
      return `<li data-text="${esc(lc([p.code, p.title, p.category, p.file_note].join(' ')))}"><a class="row" href="#pnt--${esc(p.uuid)}"><div class="row-main"><strong><span class="code">${esc(p.code)}</span> ${esc(p.title)}</strong><span class="sub">${p.category ? `<span>${esc(p.category)}</span>` : ''}<span>Versión ${esc(p.version)}</span><span>Revisión ${fmtDay(p.review_date)}</span>${overdue ? '<span class="bad">Revisión vencida</span>' : ''}</span><span class="sub">${doc ? `<span class="doc-tag">${esc(DOC_TYPES[doc.ext].label)}</span>` : '<span>Sin documento</span>'}</span></div>${pill('pnt', p.status)}</a></li>`;
    }).join('')}</ul><p class="none" data-none hidden>Ningún PNT coincide con la búsqueda.</p>`
    : empty('Aún no hay PNT registrados.', 'Registra el primero con «Nuevo PNT».');
  return `${segmented(DOCS_TABS, '#pnt')}${items.length ? searchBox('Buscar código, título o categoría') : ''}${list}${trashed ? `<p class="more"><a href="#papelera">Eliminados (${trashed})</a></p>` : ''}${fab('#pnt--nuevo', 'Nuevo PNT')}`;
}

async function viewPnt(id) {
  const p = await getOne('pnt', id);
  if (!p) return empty('Este PNT no existe.', 'Puede que el enlace no sea correcto.');
  const docs = (await docsOf(id)).sort(latestFirst);
  const [current, ...older] = docs;
  const overdue = p.status === 'vigente' && isDay(p.review_date) && daysUntil(p.review_date) < 0;
  const canShare = current && current.ext === 'pdf' && navigator.canShare
    && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  const linked = (await getLive('formula')).filter((f) => (f.pnt_uuids || []).includes(id));
  const gone = Boolean(p.deleted_at);
  return `${gone ? deletedBanner('pnt', p) : ''}<div class="panel">
    <div class="head-row"><h2 class="big"><span class="code">${esc(p.code)}</span> ${esc(p.title)}</h2>${pill('pnt', p.status)}</div>
    ${facts([
      ['Versión', val(p.version)],
      ['Categoría', val(p.category)],
      ['En vigor desde', fmtDay(p.effective_date)],
      ['Próxima revisión', `${fmtDay(p.review_date)}${overdue ? ' <span class="bad">vencida</span>' : ''}`],
      ['Ubicación', val(p.file_note)],
    ])}
    ${gone ? '' : `<div class="actions spaced"><a class="btn secondary small" href="#pnt--${esc(p.uuid)}--editar">Editar PNT</a></div>`}
  </div>
  <section><h2>Documento</h2>
  ${current
    ? `<ul class="list">${docRow(current, true)}</ul>
       <div class="actions spaced">
         <a class="btn" href="#documento--${esc(current.uuid)}">Ver documento</a>
         <button class="btn secondary" data-act="downloadDoc" data-id="${esc(current.uuid)}">Descargar</button>
         ${canShare ? `<button class="btn secondary" data-act="shareDoc" data-id="${esc(current.uuid)}">Abrir con otra app</button>` : ''}
       </div>`
    : empty('Este PNT aún no tiene documento.', 'Súbelo en PDF, Word o foto para consultarlo desde aquí, también sin conexión.')}
  </section>
  ${linked.length ? `<section><h2>Fórmulas que lo usan</h2><ul class="list">${linked.map((f) => `<li><a class="row" href="#formulas--${esc(f.uuid)}"><span class="row-main">${esc(f.name)}</span>${pill('formula', f.status)}</a></li>`).join('')}</ul></section>` : ''}
  ${gone ? '' : `<section><h2>${current ? 'Subir una versión nueva' : 'Subir documento'}</h2>
  <form class="panel form" data-form="pntDoc" data-id="${esc(p.uuid)}" novalidate>
    ${formMsg()}
    ${filePicker()}
    <div class="grid2">
      ${field('Versión del PNT', text('version', `value="${esc(p.version)}" maxlength="30"`))}
      ${field('En vigor desde', dateInput('effective_date', p.effective_date))}
    </div>
    ${field('Próxima revisión', dateInput('review_date', p.review_date))}
    <button class="btn block" type="submit">Guardar documento</button>
    <p class="hint">Máximo 25 MB. Se guarda en este teléfono y entra en las copias de seguridad.${current ? ' El documento actual pasará a versiones anteriores; no se borra.' : ''}</p>
  </form></section>
  `}${older.length ? `<section><h2>Versiones anteriores</h2><ul class="list">${older.map((f) => docRow(f, false)).join('')}</ul></section>` : ''}
  ${gone ? '' : `<section><h2>Cambiar estado</h2>${statusButtons('pnt', p)}</section>
  <section><h2>Eliminar</h2><button class="btn danger-outline block" data-act="deleteRecord" data-store="pnt" data-id="${esc(p.uuid)}">Eliminar PNT</button>
  <p class="hint">Pasa a la papelera con sus documentos y se puede restaurar.</p></section>`}`;
}

DELETE_CHECKS.pnt = async (p) => {
  const linked = (await getLive('formula')).filter((f) => (f.pnt_uuids || []).includes(p.uuid));
  return {
    message: linked.length
      ? `Está vinculado a ${linked.length === 1 ? 'la fórmula' : `${linked.length} fórmulas:`} ${linked.map((f) => f.name).join(', ')}. Dejará de aparecer en ${linked.length === 1 ? 'ella' : 'ellas'} y en las elaboraciones nuevas; si lo restauras, vuelve a aparecer. Las elaboraciones ya hechas conservan la referencia.`
      : '',
  };
};
RESTORE_CHECKS.pnt = async (p) => {
  const clash = (await getLive('pnt')).find((x) => x.uuid !== p.uuid && lc(x.code) === lc(p.code));
  return clash ? `Ya hay otro PNT con el código ${p.code} (${clash.title}). Cambia el código de ese PNT y vuelve a intentarlo.` : null;
};

async function viewPntForm(id) {
  const p = id ? await getOne('pnt', id) : null;
  if (id && !p) return empty('Este PNT no existe.', '');
  if (p && p.deleted_at) return `${deletedBanner('pnt', p)}<p class="hint">Restáuralo para poder editarlo.</p>`;
  const v = p || { version: '1' };
  return `<form class="form" data-form="pnt" ${p ? `data-id="${esc(p.uuid)}"` : ''} novalidate>
    ${formMsg()}
    <div class="grid2">
      ${field('Código', text('code', `required maxlength="80" value="${esc(v.code || '')}"`))}
      ${field('Versión', text('version', `value="${esc(v.version || '1')}" maxlength="30"`))}
    </div>
    ${field('Título', text('title', `required maxlength="180" value="${esc(v.title || '')}"`))}
    ${field('Categoría', text('category', `maxlength="100" value="${esc(v.category || '')}"`))}
    <div class="grid2">
      ${field('Entrada en vigor', dateInput('effective_date', v.effective_date))}
      ${field('Próxima revisión', dateInput('review_date', v.review_date))}
    </div>
    ${p ? '' : `<div class="field"><span>Documento (opcional)</span>${filePicker()}</div>`}
    ${field('Ubicación del original', text('file_note', `maxlength="500" value="${esc(v.file_note || '')}"`), 'Dónde está el documento en papel: carpeta, archivador...')}
    ${p ? '<p class="hint">El documento y el estado se cambian desde la ficha del PNT.</p>' : field('Estado', `<select name="status">${options(Object.keys(STATUS.pnt), 'borrador', STATUS.pnt)}</select>`)}
    <button class="btn block" type="submit">${p ? 'Guardar cambios' : 'Guardar PNT'}</button>
  </form>`;
}

Object.assign(FORMS, {
  async pnt(form) {
    const d = formData(form);
    const code = str(d.code); const title = str(d.title);
    if (!code || !title) throw new InputError('El código y el título son obligatorios.');
    const prev = form.dataset.id ? await getOne('pnt', form.dataset.id) : null;
    if (form.dataset.id && (!prev || prev.deleted_at)) throw new InputError('Este PNT ya no está disponible para editar.');
    if ((await getLive('pnt')).some((x) => x.uuid !== (prev && prev.uuid) && lc(x.code) === lc(code))) throw new InputError('Ya existe un PNT con ese código.');
    if (prev) {
      const rec = {
        ...prev, code: code.slice(0, 80), title: title.slice(0, 180), category: str(d.category).slice(0, 100),
        version: str(d.version).slice(0, 30) || '1',
        effective_date: isDay(d.effective_date) ? d.effective_date : null, review_date: isDay(d.review_date) ? d.review_date : null,
        file_note: str(d.file_note).slice(0, 500),
      };
      await save('pnt', rec, 'edicion_pnt', `${rec.code} ${rec.title}`);
      toast('PNT guardado.');
      location.hash = `#pnt--${rec.uuid}`;
      return;
    }
    const rec = {
      uuid: newId(), code: code.slice(0, 80), title: title.slice(0, 180), category: str(d.category).slice(0, 100),
      version: str(d.version).slice(0, 30) || '1',
      effective_date: isDay(d.effective_date) ? d.effective_date : null, review_date: isDay(d.review_date) ? d.review_date : null,
      status: STATUS.pnt[d.status] ? d.status : 'borrador', file_note: str(d.file_note).slice(0, 500),
    };
    const file = pickedFile(form);
    if (file) {
      const doc = await buildDocRecord(file, 'pnt', rec.uuid, [], { version: rec.version });
      await saveMany([['pnt', rec], [FILE_STORE, doc]], 'alta_pnt', `${rec.code} ${rec.title} (con documento ${doc.name})`);
    } else {
      await save('pnt', rec, 'alta_pnt', `${rec.code} ${rec.title}`);
    }
    toast(file ? 'PNT registrado con su documento.' : 'PNT registrado.');
    location.hash = `#pnt--${rec.uuid}`;
  },

  async pntDoc(form) {
    const p = await getOne('pnt', form.dataset.id);
    if (!p || p.deleted_at) throw new InputError('Este PNT ya no existe o está en la papelera.');
    const file = pickedFile(form);
    if (!file) throw new InputError('Haz una foto o elige un archivo.');
    const version = str(form.elements.version.value).slice(0, 30) || p.version || '1';
    const doc = await buildDocRecord(file, 'pnt', p.uuid, await docsOf(p.uuid), { version });
    p.version = version;
    if (isDay(form.elements.effective_date.value)) p.effective_date = form.elements.effective_date.value;
    if (isDay(form.elements.review_date.value)) p.review_date = form.elements.review_date.value;
    await saveMany([['pnt', p], [FILE_STORE, doc]], 'alta_documento_pnt', `${p.code}: ${doc.name} (versión ${version})`);
    toast('Documento guardado.');
    await route();
  },
});

// ------------------------------------------------------------------ Bibliografía
const BIBLIO_KINDS = { formulario: 'Formulario Nacional', farmacopea: 'Farmacopea', normativa: 'Normativa', libro: 'Libro', articulo: 'Artículo', guia: 'Guía o protocolo', web: 'Página web', otro: 'Otro' };
ROUTES.biblio = (arg, extra) => (arg === 'nueva' ? viewBiblioForm() : arg && extra === 'editar' ? viewBiblioForm(arg) : arg ? viewBiblio(arg) : viewBiblios());

async function viewBiblios() {
  const items = (await getAll('biblio')).sort(byText('title'));
  const counts = {};
  (await getAll(FILE_STORE)).filter((f) => f.owner_type === 'biblio').forEach((f) => { counts[f.owner_uuid] = (counts[f.owner_uuid] || 0) + 1; });
  const list = items.length
    ? `<ul class="list" data-list>${items.map((b) => `<li data-text="${esc(lc([b.title, b.authors, b.source, b.tags, b.notes, BIBLIO_KINDS[b.kind]].join(' ')))}"><a class="row" href="#biblio--${esc(b.uuid)}"><div class="row-main"><strong>${esc(b.title)}</strong><span class="sub"><span>${esc(BIBLIO_KINDS[b.kind] || 'Otro')}</span>${b.authors ? `<span>${esc(b.authors)}</span>` : ''}${b.year ? `<span>${esc(b.year)}</span>` : ''}${counts[b.uuid] ? `<span class="doc-tag">${counts[b.uuid]} ${counts[b.uuid] === 1 ? 'documento' : 'documentos'}</span>` : ''}</span></div></a></li>`).join('')}</ul><p class="none" data-none hidden>Nada coincide con la búsqueda.</p>`
    : empty('Aún no hay bibliografía.', 'Añade formularios, normativa, artículos o guías con «Nueva referencia».');
  return `${segmented(DOCS_TABS, '#biblio')}${items.length ? searchBox('Buscar título, autor o etiqueta') : ''}${list}${fab('#biblio--nueva', 'Nueva referencia')}`;
}
async function viewBiblio(id) {
  const b = await getOne('biblio', id);
  if (!b) return empty('Esta referencia no existe.', '');
  const safeUrl = /^https?:\/\//i.test(b.url || '') ? b.url : '';
  return `<div class="panel">
    <div class="head-row"><h2 class="big">${esc(b.title)}</h2><a class="btn secondary small" href="#biblio--${esc(b.uuid)}--editar">Editar</a></div>
    ${facts([
      ['Tipo', val(BIBLIO_KINDS[b.kind])],
      ['Autores', val(b.authors)],
      ['Fuente', val(b.source)],
      ['Año', val(b.year)],
      ['Etiquetas', val(b.tags)],
      ['Enlace', safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">${esc(safeUrl.replace(/^https?:\/\//i, '').slice(0, 60))}</a>` : '—'],
    ])}
    ${b.notes ? `<p class="pre spaced">${esc(b.notes)}</p>` : ''}
  </div>
  ${await docsSection('biblio', b.uuid, ['documento'])}`;
}
async function viewBiblioForm(id) {
  const b = id ? await getOne('biblio', id) : null;
  if (id && !b) return empty('Esta referencia no existe.', '');
  const v = b || {};
  return `<form class="form" data-form="biblio" ${b ? `data-id="${esc(b.uuid)}"` : ''} novalidate>
    ${formMsg()}
    ${field('Título', text('title', `value="${esc(v.title || '')}" required maxlength="250"`))}
    ${field('Tipo', `<select name="kind">${options(Object.keys(BIBLIO_KINDS), v.kind || 'libro', BIBLIO_KINDS)}</select>`)}
    ${field('Autores', text('authors', `value="${esc(v.authors || '')}" maxlength="250"`))}
    <div class="grid2">
      ${field('Fuente o editorial', text('source', `value="${esc(v.source || '')}" maxlength="200"`))}
      ${field('Año', `<input type="text" inputmode="numeric" name="year" value="${esc(v.year || '')}" maxlength="4">`)}
    </div>
    ${field('Enlace', `<input type="url" name="url" value="${esc(v.url || '')}" maxlength="500" placeholder="https://">`)}
    ${field('Etiquetas', text('tags', `value="${esc(v.tags || '')}" maxlength="200"`), 'Palabras para encontrarla: por ejemplo, cápsulas, pediatría, estabilidad.')}
    ${field('Notas', `<textarea name="notes" maxlength="4000">${esc(v.notes || '')}</textarea>`)}
    ${b ? '' : `<div class="field"><span>Documento (opcional)</span>${filePicker()}</div>`}
    <button class="btn block" type="submit">${b ? 'Guardar cambios' : 'Guardar referencia'}</button>
  </form>`;
}
Object.assign(FORMS, {
  async biblio(form) {
    const d = formData(form);
    const title = str(d.title);
    if (!title) throw new InputError('Escribe el título.');
    const year = str(d.year);
    if (year && !/^\d{4}$/.test(year)) throw new InputError('El año debe tener cuatro cifras.');
    const url = str(d.url);
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new InputError('El enlace debe empezar por http:// o https://');
    const prev = form.dataset.id ? await getOne('biblio', form.dataset.id) : null;
    const rec = {
      ...(prev || { uuid: newId() }), title: title.slice(0, 250), kind: BIBLIO_KINDS[d.kind] ? d.kind : 'otro',
      authors: str(d.authors).slice(0, 250), source: str(d.source).slice(0, 200), year, url: url.slice(0, 500),
      tags: str(d.tags).slice(0, 200), notes: str(d.notes).slice(0, 4000),
    };
    const file = !prev && pickedFile(form);
    if (file) {
      const doc = await buildDocRecord(file, 'biblio', rec.uuid, []);
      await saveMany([['biblio', rec], [FILE_STORE, doc]], 'alta_bibliografia', `${rec.title} (con documento ${doc.name})`);
    } else {
      await save('biblio', rec, prev ? 'edicion_bibliografia' : 'alta_bibliografia', rec.title);
    }
    toast(prev ? 'Cambios guardados.' : 'Referencia guardada.');
    location.hash = `#biblio--${rec.uuid}`;
  },
});
