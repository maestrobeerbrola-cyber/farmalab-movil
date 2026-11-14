'use strict';
/*
 * FARMA·LAB móvil
 * App web instalable (PWA). Todos los datos se guardan en este dispositivo (IndexedDB).
 * Cada registro lleva uuid, created_at, updated_at y device_id para poder
 * sincronizarlo más adelante con la versión de PC.
 */

const APP_VERSION = '0.3.15';
const PREVIEW = document.documentElement.dataset.preview === '1'; // copia de prueba publicada en Claude
const DB_NAME = 'farmalab-movil';
const EXPORT_FORMAT = 'farmalab-datos';
const EXPORT_FORMAT_VERSION = 3;          // 3: acondicionamiento, bibliografía, documentos de cualquier ficha y ajustes
const DB_VERSION = 3;                     // 3: acondicionamiento, bibliografía, documentos genéricos, estados de elaboración
const FILE_STORE = 'pnt_file';            // documentos adjuntos (PNT, materias primas, acondicionamiento, bibliografía)
const MAX_DOC_BYTES = 25 * 1048576;
const DOC_TYPES = {
  pdf: { label: 'PDF', mime: 'application/pdf' },
  docx: { label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  doc: { label: 'Word 97-2003', mime: 'application/msword' },
  jpg: { label: 'Foto JPG', mime: 'image/jpeg', image: true },
  png: { label: 'Imagen PNG', mime: 'image/png', image: true },
  webp: { label: 'Imagen WebP', mime: 'image/webp', image: true },
};
// En todos los adjuntos: PDF, Word o foto (cámara del móvil o imagen guardada).
const DOC_ACCEPT = '.pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,image/jpeg,image/png,image/webp';
const DOC_KINDS = { documento: 'Documento', boletin: 'Boletín de análisis', fds: 'Ficha de datos de seguridad', especificaciones: 'Especificaciones', otro: 'Otro', receta: 'Receta' };
const RECETA_ACCEPT = DOC_ACCEPT;
/**
 * Las recetas llevan datos del paciente y del prescriptor: se guardan solo en este dispositivo
 * (local_only), no van en las copias ni en la sincronización, y su nombre de archivo no pasa al registro de actividad.
 */
const isLocalOnly = (f) => Boolean(f && (f.local_only || f.kind === 'receta'));
const STORES = ['material', 'packaging', 'formula', 'pnt', 'biblio', 'production', 'audit'];
const LOCK_HIDDEN_MS = 5 * 60 * 1000;   // bloqueo tras 5 min con la app en segundo plano
const LOCK_IDLE_MS = 15 * 60 * 1000;    // o tras 15 min sin tocar la pantalla
const PBKDF2_ITERATIONS = 200000;
const BACKUP_REMINDER_DAYS = 7;
const EXPIRY_WARNING_DAYS = 30;
const STALE_PRODUCTION_DAYS = 2;

const MATERIAL_UNITS = ['g', 'kg', 'mg', 'ml', 'l', 'unidades'];
const COMPONENT_UNITS = ['g', 'mg', 'ml', 'unidades'];
const FORMULA_UNITS = ['g', 'ml', 'unidades'];
const STATUS = {
  material: { cuarentena: 'Cuarentena', aceptado: 'Aceptado', rechazado: 'Rechazado', bloqueado: 'Bloqueado' },
  packaging: { cuarentena: 'Cuarentena', aceptado: 'Aceptado', rechazado: 'Rechazado' },
  formula: { borrador: 'Borrador', aprobada: 'Aprobada', obsoleta: 'Obsoleta' },
  pnt: { borrador: 'Borrador', vigente: 'Vigente', obsoleto: 'Obsoleto' },
  production: { en_proceso: 'En proceso', elaborada: 'Elaborada', dispensada: 'Dispensada', rechazada: 'Rechazada' },
};
const TONE = {
  cuarentena: 'amber', aceptado: 'green', rechazado: 'red', bloqueado: 'red', aprobada: 'green', vigente: 'green',
  en_proceso: 'amber', elaborada: 'blue', dispensada: 'green', rechazada: 'red',
};
const ACTION_LABELS = {
  inicio_sesion: 'Desbloqueo de la app',
  alta_lote_materia_prima: 'Alta de lote de materia prima',
  edicion_materia_prima: 'Ficha de materia prima modificada',
  cambio_estado_materia_prima: 'Decisión sobre materia prima',
  alta_acondicionamiento: 'Alta de material de acondicionamiento',
  edicion_acondicionamiento: 'Ficha de acondicionamiento modificada',
  cambio_estado_acondicionamiento: 'Decisión sobre acondicionamiento',
  alta_formula: 'Alta de fórmula',
  edicion_formula: 'Fórmula modificada',
  cambio_estado_formula: 'Cambio de estado de fórmula',
  alta_pnt: 'Alta de PNT',
  alta_documento_pnt: 'Documento de PNT subido',
  alta_documento: 'Documento adjuntado',
  cambio_estado_pnt: 'Cambio de estado de PNT',
  alta_bibliografia: 'Alta en bibliografía',
  edicion_bibliografia: 'Bibliografía modificada',
  crear_registro_elaboracion: 'Nuevo registro de elaboración',
  actualizar_pesadas: 'Guía de elaboración guardada',
  enviar_revision: 'Enviado a revisión farmacéutica',
  marcar_elaborada: 'Fórmula elaborada (lote asignado)',
  marcar_dispensada: 'Fórmula dispensada',
  rechazar_elaboracion: 'Elaboración rechazada',
  asignar_lote: 'Lote asignado',
  consumo_stock: 'Consumo de stock',
  etiqueta_generada: 'Etiqueta generada',
  borrado_conservacion: 'Borrado por fin del plazo de conservación',
  conservar_registro: 'Marcado para no borrar',
  permitir_borrado: 'Permitido el borrado por plazo',
  alta_receta: 'Receta adjuntada',
  baja_receta: 'Receta eliminada',
  eliminar_formula: 'Fórmula eliminada',
  restaurar_formula: 'Fórmula restaurada',
  eliminar_pnt: 'PNT eliminado',
  restaurar_pnt: 'PNT restaurado',
  edicion_pnt: 'Edición de PNT',
  ficha_generada: 'Ficha de registro generada',
  ficha_mp_generada: 'Registro y especificaciones de materia prima generados',
  ficha_env_generada: 'Registro de acondicionamiento generado',
  control_calidad_materia_prima: 'Control de calidad de materia prima',
  valoracion_precio: 'Precio de valoración guardado',
  ajustes: 'Ajustes modificados',
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
  envases: { title: 'Acondicionamiento', tab: 1 },
  formulas: { title: 'Fórmulas', tab: 2 },
  elaboraciones: { title: 'Elaboraciones', tab: 3 },
  etiqueta: { title: 'Etiqueta', tab: 3 },
  ficha: { title: 'Ficha de registro', tab: 3 },
  fichamp: { title: 'Registro de la materia prima', tab: 1 },
  registromp: { title: 'Registro de materias primas', tab: 1 },
  fichaenv: { title: 'Registro de envase', tab: 1 },
  pnt: { title: 'PNT', tab: 4 },
  biblio: { title: 'Bibliografía', tab: 4 },
  documento: { title: 'Documento', tab: 4 },
  calculadora: { title: 'Calculadora' },
  papelera: { title: 'Papelera' },
  conservacion: { title: 'Conservación' },
  sincronizacion: { title: 'Sincronización' },
  valoracion: { title: 'Valoración' },
  ajustes: { title: 'Ajustes' },
  auditoria: { title: 'Actividad' },
};

/** Utillaje mínimo (RD 175/2001, equipamiento general) como lista inicial editable en Ajustes. */
const DEFAULT_EQUIPMENT = [
  'Balanza de precisión 1 mg', 'Probetas', 'Pipetas', 'Matraces aforados', 'Mortero', 'Baño de agua', 'Agitador',
  'Espátulas', 'Termómetro', 'Vasos de precipitados', 'Vidrio de reloj', 'Placa calefactora', 'pH-metro', 'Tamices',
];
const DEFAULT_QC_TESTS = ['Caracteres organolépticos (aspecto, color, olor)', 'Peso o volumen final', 'Homogeneidad', 'pH'];
const DEFAULT_MP_QC_TESTS = ['Caracteres organolépticos (aspecto, color, olor)', 'Identificación', 'Solubilidad', 'Comprobación del boletín de análisis del proveedor'];
const DEFAULT_SETTINGS = {
  pharmacy: { name: '', address: '', phone: '', pharmacist: '' },
  lot: { letter: 'J', next: 1 },
  equipment: DEFAULT_EQUIPMENT,
  qc_tests: DEFAULT_QC_TESTS,
  mp_qc_tests: DEFAULT_MP_QC_TESTS,
  label: { layout: '8', all_components: false },
  pricing: { p_factor: 3.65, iva: 4 },     // factor P 2026 (Anexo 3 del Convenio con la Comunidad de Madrid) e IVA de medicamentos
  // años de conservación desde la caducidad y días de aviso antes de borrar
  retention: { enabled: true, production: { general: 1, psicotropo: 2, estupefaciente: 5, veterinaria: 5 }, material: 1, packaging: 1, notice_days: 30 },
  // PNT de recepción, control de conformidad y almacenamiento de materias primas (Formulario Nacional)
  fn: { mp_code: 'PN/L/PG/005/00', mp_related: '' },
  updated_at: '',
};

/** Excipientes de declaración obligatoria más habituales en formulación (Circular AEMPS 1/2018). */
const EDO_LIST = [
  ['Ácido bórico y boratos', /\bboric|\bborato|\bborax/],
  ['Alcohol cetoestearílico / cetílico', /alcohol\s+(ceto)?estearil|alcohol\s+cetil|cetearyl|cetyl alcohol/],
  ['Almidón (arroz, maíz, patata)', /almidon\s+de\s+(arroz|maiz|patata)/],
  ['Almidón de trigo, avena, cebada o centeno (gluten)', /almidon\s+de\s+(trigo|avena|cebada|centeno|triticale)|gluten/],
  ['Bálsamo del Perú', /balsamo\s+del?\s+peru/],
  ['Butilhidroxitolueno (E-321)', /butilhidroxitolueno|\bbht\b|e-?321/],
  ['Dimetilsulfóxido', /dimetilsulfoxido|\bdmso\b/],
  ['Etanol', /\betanol\b|alcohol\s+etilico|alcohol\s+de\s+\d+|alcohol\s+\d+\s*[º°]/],
  ['Glicerol (E-422)', /glicerol|glicerina|e-?422/],
  ['Lactosa', /lactosa/],
  ['Lanolina (grasa de lana)', /lanolina|grasa\s+de\s+lana/],
  ['Laurilsulfato de sodio', /laurilsulfato|lauril\s+sulfato/],
  ['Parahidroxibenzoatos (parabenos)', /parahidroxibenzoato|paraben|nipagin|nipasol|metilparaben|propilparaben/],
  ['Propilenglicol (E-1520)', /propilenglicol|e-?1520/],
  ['Sacarosa', /sacarosa/],
  ['Sorbitol (E-420)', /sorbitol|e-?420/],
];
const fold = (v) => String(v ?? '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
const edoMatch = (name) => { const n = fold(name); const hit = EDO_LIST.find(([, re]) => re.test(n)); return hit ? hit[0] : null; };

const state = {
  profile: null, deviceId: null, unlocked: false,
  hiddenAt: 0, lastTouch: Date.now(),
  deferredInstall: null, swWaiting: null, updateRequested: false,
  formulaCache: {}, materials: [], prevHash: '', parent: '#inicio', objectUrls: [],
  settings: null, label: null,
};

// Registros que rellenan los módulos (modulos/*.js).
const ROUTES = {};
const AFTER_RENDER = [];
const INPUT_HOOKS = [];
const CHANGE_HOOKS = [];
const STATUS_CHECKS = {};   // comprobaciones antes de cambiar de estado: store -> async (registro, estado) => opciones de ask() o null
const ROW_BUILDERS = {};    // filas repetibles de los formularios (data-act="addRow" data-kind="...")
const DELETE_CHECKS = {};   // antes de eliminar: store -> async (registro) => { message, block } (block impide eliminar)
const ALERT_SOURCES = [];   // avisos adicionales de los módulos: async () => [{ tone, kind, title, text, href }]
const AFTER_UNLOCK = [];    // tareas al desbloquear la app (p. ej. borrado por fin del plazo de conservación)
const RESTORE_CHECKS = {};  // antes de restaurar: store -> async (registro) => mensaje de error o null
const BOOT_HOOKS = [];      // al arrancar, antes de pedir el PIN (p. ej. recoger la vuelta del inicio de sesión de Google)
const SETTINGS_SECTIONS = [];   // apartados de Ajustes que añaden los módulos: async () => html
const BEFORE_LOT = [];      // antes de asignar un número de lote: async () => true para seguir, false para no asignarlo
const AFTER_SAVE = [];      // tras guardar cambios (p. ej. enviarlos al otro equipo); no se esperan

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

/** Conversión entre unidades de la misma magnitud (masa o volumen). Devuelve null si no son compatibles. */
const UNIT_FACTORS = { kg: ['m', 1000], g: ['m', 1], mg: ['m', 0.001], 'µg': ['m', 1e-6], l: ['v', 1000], ml: ['v', 1], 'µl': ['v', 0.001], unidades: ['u', 1] };
function convertQty(value, from, to) {
  const a = UNIT_FACTORS[from]; const b = UNIT_FACTORS[to];
  if (!isNum(value) || !a || !b || a[0] !== b[0]) return null;
  return round6((value * a[1]) / b[1]);
}
// ------------------------------------------------------------------ base de datos
let dbPromise = null;
const LEGACY_PRODUCTION_STATUS = { borrador: 'en_proceso', pendiente_revision: 'elaborada' };
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = (ev) => {
        // Solo crea o completa lo que falta: los datos existentes se conservan en cada actualización.
        const db = r.result;
        const t = r.transaction;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'uuid' }); });
        const files = db.objectStoreNames.contains(FILE_STORE)
          ? t.objectStore(FILE_STORE)
          : db.createObjectStore(FILE_STORE, { keyPath: 'uuid' });
        if (!files.indexNames.contains('pnt_uuid')) files.createIndex('pnt_uuid', 'pnt_uuid');
        if (!files.indexNames.contains('owner_uuid')) files.createIndex('owner_uuid', 'owner_uuid');
        if (ev.oldVersion > 0 && ev.oldVersion < 3) {
          // v2 → v3: los documentos pasan a tener propietario genérico y cambian los estados de elaboración.
          files.openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return;
            if (!c.value.owner_uuid) c.update({ ...c.value, owner_type: 'pnt', owner_uuid: c.value.pnt_uuid, kind: c.value.kind || 'documento' });
            c.continue();
          };
          t.objectStore('production').openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return;
            const v = c.value;
            if (LEGACY_PRODUCTION_STATUS[v.status]) {
              c.update({ ...v, status: LEGACY_PRODUCTION_STATUS[v.status], status_changed_at: v.submitted_at || v.updated_at || v.created_at });
            }
            c.continue();
          };
        }
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Cierra las otras ventanas de FARMA·LAB y vuelve a abrirla.'));
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
/**
 * Las fórmulas y los PNT eliminados no se borran: quedan en la papelera con deleted_at y se pueden restaurar.
 * Al ser un cambio más del registro, viaja en las copias y se aplica en el otro equipo al importarlas.
 */
const getLive = async (s) => (await getAll(s)).filter((r) => !r.deleted_at);
const DELETABLE = { formula: 'Fórmula', pnt: 'PNT' };
const recordName = (store, r) => (store === 'pnt' ? `${r.code} ${r.title}` : `${r.name}${r.version ? ` (versión ${r.version})` : ''}`);
const getOne = (s, id) => tx(s, 'readonly', (t) => t.objectStore(s).get(id));
const metaGet = (k) => tx('meta', 'readonly', (t) => t.objectStore('meta').get(k));
const metaSet = (k, v) => tx('meta', 'readwrite', (t) => t.objectStore('meta').put(v, k));

function auditEntry(action, detail, stamp) {
  return {
    uuid: newId(), created_at: stamp, updated_at: stamp, device_id: state.deviceId,
    user: state.profile ? state.profile.name : '', action, detail: String(detail ?? '').slice(0, 500),
  };
}
/**
 * Guarda uno o varios registros y su auditoría en una sola operación.
 * extraAudit: líneas de auditoría adicionales [[acción, detalle], ...] (p. ej. consumos de stock).
 */
async function saveMany(entries, action, detail, extraAudit = [], metaPuts = {}) {
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
    extraAudit.forEach(([a, d]) => t.objectStore('audit').put(auditEntry(a, d, stamp)));
    Object.entries(metaPuts).forEach(([k, v]) => t.objectStore('meta').put(v, k));
    t.objectStore('meta').put(stamp, 'lastChange');
  });
  afterSave();
}
function afterSave() {
  AFTER_SAVE.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
}
async function save(store, record, action, detail) {
  await saveMany([[store, record]], action, detail);
  return record;
}
/** Comprobaciones de los módulos antes de dar un número de lote (p. ej. sincronizar con el otro equipo). */
async function beforeLot() {
  for (const fn of BEFORE_LOT) if (!(await fn())) return false;
  return true;
}
const docsOf = (ownerUuid) => tx(FILE_STORE, 'readonly', (t) => t.objectStore(FILE_STORE).index('owner_uuid').getAll(ownerUuid));
const logOnly = (action, detail) => tx('audit', 'readwrite', (t) => t.objectStore('audit').put(auditEntry(action, detail, nowIso())));

/** Ajustes de la farmacia (datos para etiquetas, numeración de lotes, utillaje...). */
async function loadSettings() {
  state.settings = normalizeSettings(await metaGet('settings'));
  return state.settings;
}
/** Ajustes guardados completados con los valores por defecto y corregidos si traen valores no válidos. */
function normalizeSettings(stored) {
  const saved = stored && typeof stored === 'object' ? stored : {};
  const s = {
    ...DEFAULT_SETTINGS, ...saved,
    pharmacy: { ...DEFAULT_SETTINGS.pharmacy, ...(saved.pharmacy || {}) },
    lot: { ...DEFAULT_SETTINGS.lot, ...(saved.lot || {}) },
    label: { ...DEFAULT_SETTINGS.label, ...(saved.label || {}) },
    pricing: { ...DEFAULT_SETTINGS.pricing, ...(saved.pricing || {}) },
    fn: { ...DEFAULT_SETTINGS.fn, ...(saved.fn || {}) },
    retention: {
      ...DEFAULT_SETTINGS.retention, ...(saved.retention || {}),
      production: { ...DEFAULT_SETTINGS.retention.production, ...((saved.retention && saved.retention.production) || {}) },
    },
  };
  const okYears = (n) => Number.isInteger(n) && n >= 1 && n <= 30;
  for (const k of Object.keys(DEFAULT_SETTINGS.retention.production)) if (!okYears(s.retention.production[k])) s.retention.production[k] = DEFAULT_SETTINGS.retention.production[k];
  for (const k of ['material', 'packaging']) if (!okYears(s.retention[k])) s.retention[k] = DEFAULT_SETTINGS.retention[k];
  if (!(Number.isInteger(s.retention.notice_days) && s.retention.notice_days >= 30 && s.retention.notice_days <= 365)) s.retention.notice_days = DEFAULT_SETTINGS.retention.notice_days;
  s.retention.enabled = s.retention.enabled !== false;
  if (!(isNum(s.pricing.p_factor) && s.pricing.p_factor > 0)) s.pricing.p_factor = DEFAULT_SETTINGS.pricing.p_factor;
  if (!(isNum(s.pricing.iva) && s.pricing.iva >= 0)) s.pricing.iva = DEFAULT_SETTINGS.pricing.iva;
  if (!str(s.fn.mp_code)) s.fn.mp_code = DEFAULT_SETTINGS.fn.mp_code;
  return s;
}
/**
 * Une los ajustes de este dispositivo con los recibidos (copia o sincronización): ganan los más recientes,
 * pero el próximo número de lote es siempre el mayor de los dos, para no repetir lotes.
 */
function mergeSettings(local, incoming) {
  if (!incoming || typeof incoming !== 'object') return local;
  const takeIncoming = String(incoming.updated_at || '') > String(local.updated_at || '');
  const merged = takeIncoming ? {
    ...local, ...incoming,
    pharmacy: { ...local.pharmacy, ...(incoming.pharmacy || {}) },
    label: { ...local.label, ...(incoming.label || {}) },
    pricing: { ...local.pricing, ...(incoming.pricing || {}) },
    fn: { ...local.fn, ...(incoming.fn || {}) },
    retention: { ...local.retention, ...(incoming.retention || {}), production: { ...local.retention.production, ...((incoming.retention && incoming.retention.production) || {}) } },
  } : { ...local };
  const nextLot = Math.max(Number(local.lot.next) || 1, Number(incoming.lot && incoming.lot.next) || 1);
  merged.lot = { ...(takeIncoming ? { ...local.lot, ...(incoming.lot || {}) } : local.lot), next: nextLot };
  for (const k of ['equipment', 'qc_tests', 'mp_qc_tests']) if (!Array.isArray(merged[k])) merged[k] = local[k];
  if (!merged.pricing || !(isNum(merged.pricing.p_factor) && merged.pricing.p_factor > 0) || !(isNum(merged.pricing.iva) && merged.pricing.iva >= 0)) merged.pricing = local.pricing;
  return normalizeSettings(merged);
}
async function saveSettings(s, detail) {
  s.updated_at = nowIso();
  await tx(['meta', 'audit'], 'readwrite', (t) => {
    t.objectStore('meta').put(s, 'settings');
    t.objectStore('meta').put(s.updated_at, 'lastChange');
    t.objectStore('audit').put(auditEntry('ajustes', detail, s.updated_at));
  });
  state.settings = s;
  afterSave();
}

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
  calc: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5"/>'),
  box: svg('<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>'),
  book: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>'),
  tag: svg('<path d="M3 12V4h8l9.5 9.5-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  sync: svg('<path d="M7 18.5H6.5a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 16.6 9a3.75 3.75 0 0 1 .9 7.4"/><path d="M15 13.5l-3-3-3 3M12 10.5V20"/>'),
};
const TABS = [['#inicio', 'Inicio', ICON.home], ['#materias', 'Almacén', ICON.box], ['#formulas', 'Fórmulas', ICON.flask], ['#elaboraciones', 'Elaborar', ICON.scale], ['#pnt', 'Documentos', ICON.doc]];

// ------------------------------------------------------------------ piezas de interfaz
const pill = (kind, status) => `<span class="pill ${TONE[status] || ''}">${esc((STATUS[kind] || {})[status] || status)}</span>`;
const segmented = (items, current) => `<nav class="seg" aria-label="Apartados">${items.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
const checkbox = (name, label, checked, attrs = '') => `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''} ${attrs}><span>${label}</span></label>`;
const dateInput = (name, value, attrs = '') => `<input type="date" name="${name}" value="${isDay(value) ? value : ''}" ${attrs}>`;
const STATUS_ACTIONS = { material: 'cambio_estado_materia_prima', packaging: 'cambio_estado_acondicionamiento', formula: 'cambio_estado_formula', pnt: 'cambio_estado_pnt' };
const statusButtons = (store, rec) => `<div class="actions">${Object.keys(STATUS[store]).map((st) => `<button class="btn ${st === rec.status ? '' : 'secondary'}" data-act="setStatus" data-store="${store}" data-id="${esc(rec.uuid)}" data-status="${st}" ${st === rec.status ? 'disabled' : ''}>${STATUS[store][st]}</button>`).join('')}</div>`;
const recordLabel = (store, r) => (store === 'pnt' ? `${r.code} ${r.title}` : store === 'formula' ? `${r.code || ''} ${r.name}`.trim() : `${r.name}${r.lot ? ` / ${r.lot}` : ''}`);
const val = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));
/** Lista de datos: pares [etiqueta, html ya escapado]; se omiten los vacíos si skipEmpty. */
const facts = (pairs) => `<dl class="facts">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const intOrNull = (v, label) => {
  const t = str(v);
  if (!t) return null;
  if (!/^\d{1,7}$/.test(t)) throw new InputError(`${label}: escribe un número entero.`);
  return Number(t);
};
const empty = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
const fab = (href, label) => `<a class="fab" href="${href}">${ICON.plus}<span>${esc(label)}</span></a>`;
const searchBox = (placeholder) => `<div class="search"><input type="search" data-filter placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"></div>`;
const formMsg = () => '<div class="msg error" data-formmsg hidden role="alert"></div>';
const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
const text = (name, attrs = '') => `<input type="text" name="${name}" ${attrs}>`;
const decimal = (name, attrs = '') => `<input type="text" inputmode="decimal" autocomplete="off" name="${name}" ${attrs}>`;
const yearsInput = (name, v) => `<div class="withunit"><input type="text" inputmode="numeric" autocomplete="off" name="${name}" value="${esc(v)}" maxlength="2"><span>años</span></div>`;

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
  for (const task of AFTER_UNLOCK) {
    try { await task(); } catch (err) { console.error(err); }
  }
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
    await loadSettings();
    for (const hook of BOOT_HOOKS) {
      try { await hook(); } catch (err) { console.error(err); }
    }
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
      <button class="icon-btn sync-btn" data-act="syncNow" id="syncBtn" aria-label="Sincronizar con Google Drive" hidden>${ICON.sync}<span class="sync-dot"></span></button>
      <a class="icon-btn" href="#calculadora" aria-label="Calculadora">${ICON.calc}</a>
      <a class="icon-btn" href="#ajustes" aria-label="Ajustes y copias de seguridad">${ICON.sliders}</a>
      <button class="icon-btn" data-act="lock" aria-label="Bloquear">${ICON.lock}</button>
    </header>
    ${PREVIEW ? '<div class="banner preview">Vista previa para probar la app. No guardes aquí datos reales: las copias de seguridad y la instalación solo funcionan en la versión publicada.</div>' : ''}
    <div id="banner"></div>
    <main id="view" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Secciones">${TABS.map(([href, label, icon], i) => `<a href="${href}"><span class="ind">${icon}${i === 0 ? '<span class="badge" id="alertBadge" hidden></span>' : ''}</span>${label}</a>`).join('')}</nav>
    <div id="toast" role="status" aria-live="polite"></div>
  </div>`;
  showUpdateBanner();
}

ROUTES[''] = () => viewHome();
ROUTES.ajustes = () => viewSettings();
ROUTES.auditoria = () => viewAudit();
ROUTES.papelera = () => viewTrash();

async function viewTrash() {
  const rows = [];
  for (const st of Object.keys(DELETABLE)) {
    (await getAll(st)).filter((r) => r.deleted_at).forEach((r) => rows.push({ st, r }));
  }
  rows.sort((a, b) => String(b.r.deleted_at).localeCompare(String(a.r.deleted_at)));
  const href = ({ st, r }) => (st === 'pnt' ? `#pnt--${r.uuid}` : `#formulas--${r.uuid}`);
  return `<p class="hint intro">Las fórmulas y los PNT eliminados se guardan aquí. Al restaurarlos vuelven a su lista con sus documentos y vínculos.</p>
    ${rows.length
      ? `<ul class="list">${rows.map((x) => `<li><div class="row"><a class="row-main" href="${esc(href(x))}"><span class="kind">${esc(DELETABLE[x.st])}</span><strong>${esc(recordName(x.st, x.r))}</strong><span class="sub"><span>${x.st === 'formula' ? 'Eliminada' : 'Eliminado'} el ${esc(fmtStamp(x.r.deleted_at))}${x.r.deleted_by ? ` por ${esc(x.r.deleted_by)}` : ''}</span></span></a><button class="btn secondary small" data-act="restoreRecord" data-store="${x.st}" data-id="${esc(x.r.uuid)}">Restaurar</button></div></li>`).join('')}</ul>`
      : empty('La papelera está vacía.', 'Aquí aparecerán las fórmulas y los PNT que elimines.')}`;
}
/** Aviso de elemento eliminado, con el botón para restaurarlo. */
function deletedBanner(store, r) {
  return `<div class="msg warn reminder"><p><strong>${esc(DELETABLE[store])} eliminad${store === 'formula' ? 'a' : 'o'}</strong> el ${esc(fmtStamp(r.deleted_at))}${r.deleted_by ? ` por ${esc(r.deleted_by)}` : ''}. Está en la papelera.</p><button class="btn small" data-act="restoreRecord" data-store="${store}" data-id="${esc(r.uuid)}">Restaurar</button></div>`;
}

/**
 * Las pantallas se preparan de una en una: si se navega mientras otra aún carga, la anterior
 * no se pinta encima de la nueva (las pantallas con varias consultas tardan más que las sencillas).
 */
let routeChain = Promise.resolve();
function route() {
  const run = routeChain.then(renderRoute);
  routeChain = run.catch(() => {});
  return run;
}
async function renderRoute() {
  if (!state.unlocked || !$('#view')) return;
  const hash = location.hash || '#inicio';
  const parts = hash.slice(1).split('--');
  if (parts[0] === 'inicio') parts[0] = '';
  const [sec = '', arg = '', extra = ''] = parts;
  const info = SECTIONS[sec] || SECTIONS[''];
  state.parent = arg ? `#${sec}` : (['auditoria', 'papelera', 'conservacion', 'sincronizacion'].includes(sec) ? '#ajustes' : '#inicio');
  let html;
  try {
    const handler = ROUTES[sec];
    html = handler ? await handler(arg, extra) : empty('Página no encontrada', 'Usa las pestañas de abajo para moverte por la app.');
  } catch (err) {
    console.error(err);
    html = `<div class="msg error">No se pudo mostrar esta pantalla: ${esc(err.message)}</div>`;
  }
  if ((location.hash || '#inicio') !== hash || !state.unlocked) return;   // ya se ha pedido otra pantalla: se pintará esa
  state.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  state.objectUrls = [];
  $('#view').innerHTML = html;
  $('#title').textContent = info.title;
  const sub = Boolean(arg) || ['ajustes', 'auditoria', 'papelera', 'conservacion', 'sincronizacion', 'calculadora', 'valoracion', 'etiqueta', 'registromp'].includes(sec);
  $('#backBtn').hidden = !sub;
  $('#mark').hidden = sub;
  $$('.tabbar a').forEach((a, i) => {
    if (i === info.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (state.prevHash !== hash) window.scrollTo(0, 0);
  state.prevHash = hash;
  AFTER_RENDER.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
  updateAlertBadge().catch(() => {});
}

// ------------------------------------------------------------------ Inicio y avisos
async function backupStatus() {
  const [lastExport, lastChange, syncCfg, syncSt] = await Promise.all([metaGet('lastExport'), metaGet('lastChange'), metaGet('syncConfig'), metaGet('syncState')]);
  const pending = Boolean(lastChange) && (!lastExport || lastChange > lastExport);
  const old = !lastExport || Date.now() - Date.parse(lastExport) > BACKUP_REMINDER_DAYS * 864e5;
  const synced = Boolean(syncCfg && syncSt && syncSt.last_ok);   // también están en Google Drive
  return { lastExport, lastChange, remind: pending && old, synced };
}

/** Avisos que la app calcula al abrirse: stock, caducidades, cuarentenas, elaboraciones paradas y fichas incompletas. */
async function computeAlerts() {
  const [mats, packs, prods] = await Promise.all([getAll('material'), getAll('packaging'), getAll('production')]);
  const out = [];
  for (const g of stockGroups(mats, 'material')) {
    if (g.low) out.push({ tone: 'red', kind: 'Stock bajo', title: g.name, text: `Quedan ${fmtNum(round6(g.total))} ${g.unit} (mínimo ${fmtNum(g.min)} ${g.unit})${g.active ? '. Principio activo' : ''}`, href: `#materias--${g.sample}` });
  }
  for (const g of stockGroups(packs, 'packaging')) {
    if (g.low) out.push({ tone: 'red', kind: 'Reponer envases', title: g.name, text: `Quedan ${fmtNum(g.total)} unidades (mínimo ${fmtNum(g.min)})`, href: `#envases--${g.sample}` });
  }
  const expiring = [...mats.map((m) => ['materias', m]), ...packs.map((p) => ['envases', p])]
    .filter(([, r]) => isDay(r.expiry) && !['rechazado', 'bloqueado'].includes(r.status) && (r.quantity ?? 1) > 0 && daysUntil(r.expiry) <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a[1].expiry.localeCompare(b[1].expiry));
  for (const [sec, r] of expiring) {
    const d = daysUntil(r.expiry);
    const when = d < 0 ? `Caducado el ${fmtDay(r.expiry)}` : d === 0 ? 'Caduca hoy' : `Caduca el ${fmtDay(r.expiry)} (${d} ${d === 1 ? 'día' : 'días'})`;
    out.push({ tone: d < 0 ? 'red' : 'amber', kind: 'Caducidad', title: r.name, text: `Lote ${r.lot || '—'}. ${when}`, href: `#${sec}--${r.uuid}` });
  }
  for (const [sec, r] of [...mats.map((m) => ['materias', m]), ...packs.map((p) => ['envases', p])]) {
    if (r.status === 'cuarentena') out.push({ tone: 'amber', kind: 'En cuarentena', title: r.name, text: `Lote ${r.lot || '—'}: pendiente de aceptación o rechazo`, href: `#${sec}--${r.uuid}` });
  }
  for (const p of prods) {
    if (p.status === 'en_proceso') {
      const since = Date.parse(p.status_changed_at || p.created_at);
      const days = Math.floor((Date.now() - since) / 864e5);
      if (days >= STALE_PRODUCTION_DAYS) out.push({ tone: 'amber', kind: 'Elaboración pendiente', title: `${p.record_code} ${p.formula_name}`, text: `En proceso desde hace ${days} días sin cambiar de estado`, href: `#elaboraciones--${p.uuid}` });
    }
    if (['elaborada', 'dispensada'].includes(p.status)) {
      const missing = pendingItems(p);
      if (missing.length) out.push({ tone: 'amber', kind: 'Faltan datos', title: `${p.lot || p.record_code} ${p.formula_name}`, text: missing.join(', '), href: `#elaboraciones--${p.uuid}` });
    }
  }
  for (const src of ALERT_SOURCES) {
    try { out.push(...(await src())); } catch (err) { console.error(err); }
  }
  return out;
}
async function updateAlertBadge() {
  const badge = $('#alertBadge');
  if (!badge) return;
  const n = (await computeAlerts()).length;
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : String(n);
}

async function viewHome() {
  const [mats, packs, forms, pnts, prods, bib, audit] = await Promise.all(['material', 'packaging', 'formula', 'pnt', 'production', 'biblio', 'audit']
    .map((st) => (DELETABLE[st] ? getLive(st) : getAll(st))));
  const backup = await backupStatus();
  const alerts = await computeAlerts();
  const open = prods.filter((p) => p.status === 'en_proceso').sort(byNewest);
  const recent = audit.sort(byNewest).slice(0, 5);
  const standalone = matchMedia('(display-mode: standalone)').matches;

  let html = '';
  if (backup.remind) {
    html += `<div class="msg warn reminder"><p><strong>Haz una copia de seguridad.</strong> ${backup.synced ? 'Tus datos se sincronizan con Google Drive, pero una copia propia permite volver atrás si algo se borra por error en los dos equipos' : 'Tus datos solo están en este teléfono'}${backup.lastExport ? `; la última copia es del ${esc(fmtStamp(backup.lastExport))}` : ' y aún no has hecho ninguna copia'}.</p><button class="btn small" data-act="export">Exportar copia</button></div>`;
  }
  if (state.deferredInstall && !standalone) {
    html += '<div class="msg ok reminder"><p>Instala FARMA·LAB para abrirla desde la pantalla de inicio y usarla sin conexión.</p><button class="btn small" data-act="install">Instalar</button></div>';
  }
  html += `<section><h2>Avisos${alerts.length ? ` (${alerts.length})` : ''}</h2>`;
  html += alerts.length
    ? `<ul class="list alerts">${alerts.map((a) => `<li><a class="row" href="${esc(a.href)}"><span class="dot ${a.tone}" aria-hidden="true"></span><div class="row-main"><span class="kind">${esc(a.kind)}</span><strong>${esc(a.title)}</strong><span class="sub">${esc(a.text)}</span></div></a></li>`).join('')}</ul>`
    : '<div class="empty"><strong>Todo en orden.</strong>Sin stock bajo, caducidades próximas ni fichas pendientes.</div>';
  html += '</section><section><h2>En proceso</h2>';
  html += open.length
    ? `<ul class="list">${open.map((p) => `<li><a class="row" href="#elaboraciones--${esc(p.uuid)}"><div class="row-main"><strong>${esc(p.record_code)}</strong><span class="sub"><span>${esc(p.formula_name)}</span><span>${fmtNum(p.target_amount)} ${esc(p.unit)}</span><span>${progressText(p)}</span></span></div></a></li>`).join('')}</ul>`
    : `<div class="empty"><strong>No hay elaboraciones en proceso.</strong><a class="btn secondary small" href="#elaboraciones--nueva">Nueva elaboración</a></div>`;
  html += `</section><section><h2>Registros</h2><ul class="list counts">
    <li><a class="row" href="#materias"><span class="row-main">Materias primas</span><b>${mats.length}</b></a></li>
    <li><a class="row" href="#envases"><span class="row-main">Material de acondicionamiento</span><b>${packs.length}</b></a></li>
    <li><a class="row" href="#formulas"><span class="row-main">Fórmulas</span><b>${forms.length}</b></a></li>
    <li><a class="row" href="#elaboraciones"><span class="row-main">Elaboraciones</span><b>${prods.length}</b></a></li>
    <li><a class="row" href="#pnt"><span class="row-main">PNT</span><b>${pnts.length}</b></a></li>
    <li><a class="row" href="#biblio"><span class="row-main">Bibliografía</span><b>${bib.length}</b></a></li>
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

// ------------------------------------------------------------------ Ajustes, copias y actividad
const lotPreview = (s, n) => `${new Date().getFullYear()}-${s.lot.letter || 'J'}-${pad2(new Date().getMonth() + 1)}-FM-${n}`;

async function viewSettings() {
  const s = await loadSettings();
  const backup = await backupStatus();
  const allDocs = await getAll(FILE_STORE);
  const docs = allDocs.filter((f) => !isLocalOnly(f));
  const recetas = allDocs.length - docs.length;
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
  const ph = s.pharmacy;
  return `<section><h2>Copia de seguridad</h2><div class="panel stack">
      <p>${backup.synced ? 'Tus datos están en este dispositivo y, sincronizados, en Google Drive. Una copia propia sigue siendo útil: permite volver atrás si algo se borra o se cambia por error en los dos equipos.' : 'Tus datos solo están en este teléfono. Si se pierde, se rompe o se borran los datos de Chrome, solo se podrán recuperar con una copia.'}</p>
      <p><strong>Última copia:</strong> ${backup.lastExport ? esc(fmtStamp(backup.lastExport)) : 'ninguna todavía'}${backup.remind ? ' <span class="bad">(hay cambios sin copiar)</span>' : ''}</p>
      <div class="actions">
        <button class="btn" data-act="export">Exportar copia</button>
        ${canShare ? '<button class="btn secondary" data-act="share">Compartir copia</button>' : ''}
        <label class="btn secondary">Importar copia<input type="file" accept=".json,application/json" data-import hidden></label>
      </div>
      ${docs.length ? `<p class="hint">La copia incluye ${docs.length} ${docs.length === 1 ? 'documento adjunto' : 'documentos adjuntos'} (${fmtSize(docBytes)}), así que ocupará algo más.</p>` : ''}
      ${recetas ? `<p class="hint">Las recetas adjuntas a las elaboraciones (${recetas}) no van en la copia: contienen datos de pacientes y solo se guardan en este dispositivo.</p>` : ''}
      <p class="hint">La copia es un archivo .json que se guarda en Descargas. Guárdalo también fuera del teléfono (correo, Drive o el PC). Importar añade los registros que no tengas y actualiza los que sean más recientes; no borra nada.</p>
    </div></section>
  ${(await Promise.all(SETTINGS_SECTIONS.map((fn) => fn().catch((err) => { console.error(err); return ''; })))).join('')}
  <form class="form" data-form="settings" novalidate>
    ${formMsg()}
    <section><h2>Farmacia (aparece en las etiquetas)</h2><div class="panel form">
      ${field('Nombre de la oficina de farmacia', text('ph_name', `value="${esc(ph.name)}" maxlength="120"`))}
      ${field('Dirección', text('ph_address', `value="${esc(ph.address)}" maxlength="200"`))}
      <div class="grid2">
        ${field('Teléfono', `<input type="tel" name="ph_phone" value="${esc(ph.phone)}" maxlength="40">`)}
        ${field('Farmacéutico', text('ph_pharmacist', `value="${esc(ph.pharmacist)}" maxlength="120"`))}
      </div>
    </div></section>
    <section><h2>Lotes de fórmulas</h2><div class="panel form">
      <div class="grid2">
        ${field('Letra', text('lot_letter', `value="${esc(s.lot.letter)}" maxlength="4"`))}
        ${field('Próximo número', `<input type="text" inputmode="numeric" name="lot_next" value="${esc(s.lot.next)}" maxlength="7">`)}
      </div>
      <p class="hint">Formato [Año]-${esc(s.lot.letter || 'J')}-[Mes]-FM-[Número]. El número sigue siempre, sin reiniciarse. Próximo lote: <strong>${esc(lotPreview(s, s.lot.next))}</strong>.</p>
    </div></section>
    <section><h2>Etiquetas</h2><div class="panel form">
      ${field('Formato en folio A4', `<select name="label_layout">${options(['8', '2'], s.label.layout, { 8: '8 etiquetas por folio (92 × 66 mm)', 2: '2 etiquetas por folio (190 × 135 mm)' })}</select>`)}
      <label class="check"><input type="checkbox" name="label_all"${s.label.all_components ? ' checked' : ''}><span>Mostrar todos los componentes (si no, solo principios activos y excipientes de declaración obligatoria)</span></label>
    </div></section>
    <section><h2>Valoración de fórmulas</h2><div class="panel form">
      <div class="grid2">
        ${field('Factor P (€)', decimal('p_factor', `value="${esc(inputNum(s.pricing.p_factor))}"`))}
        ${field('IVA (%)', decimal('iva', `value="${esc(inputNum(s.pricing.iva))}"`))}
      </div>
      <p class="hint">Honorarios del Anexo 3 del Convenio con la Comunidad de Madrid. El factor P se actualiza cada enero con el IPC (2026: 3,65 €).</p>
    </div></section>
    <section><h2>Conservación de registros</h2><div class="panel form">
      <p class="hint">Años que se conservan después de la caducidad. Cumplido el plazo, el registro y sus documentos se borran solos, con aviso previo.</p>
      <div class="grid2">
        ${field('Elaboraciones', yearsInput('ret_general', s.retention.production.general))}
        ${field('Con psicótropos', yearsInput('ret_psicotropo', s.retention.production.psicotropo))}
        ${field('Con estupefacientes', yearsInput('ret_estupefaciente', s.retention.production.estupefaciente))}
        ${field('Uso veterinario', yearsInput('ret_veterinaria', s.retention.production.veterinaria))}
        ${field('Materias primas', yearsInput('ret_material', s.retention.material))}
        ${field('Acondicionamiento', yearsInput('ret_packaging', s.retention.packaging))}
      </div>
      ${field('Días de aviso antes de borrar', `<input type="text" inputmode="numeric" name="ret_notice" value="${esc(s.retention.notice_days)}" maxlength="3">`, 'Mínimo 30.')}
      ${checkbox('ret_enabled', 'Borrar automáticamente al cumplir el plazo', s.retention.enabled)}
      <p class="hint">Si lo desactivas, solo se muestran los avisos. La clase de cada fórmula (psicótropos, estupefacientes, uso veterinario) se elige en la propia fórmula.</p>
    </div></section>
    <section><h2>Registro de materias primas</h2><div class="panel form">
      <div class="grid2">
        ${field('Código del PNT', text('fn_mp_code', `value="${esc(s.fn.mp_code)}" maxlength="40"`), 'Formulario Nacional: PN/L/PG/005/00.')}
        ${field('Procedimientos relacionados', text('fn_mp_related', `value="${esc(s.fn.mp_related)}" maxlength="120"`), 'Opcional. Por ejemplo: PN/L/PG/006/00.')}
      </div>
      <p class="hint">Aparecen en la cabecera del registro (anexo II) y de las especificaciones (anexo III).</p>
    </div></section>
    <section><h2>Utillaje y controles habituales</h2><div class="panel form">
      ${field('Utillaje del laboratorio', `<textarea name="equipment" rows="6">${esc(s.equipment.join('\n'))}</textarea>`, 'Uno por línea. Se ofrece al registrar cada elaboración.')}
      ${field('Pruebas de control de calidad', `<textarea name="qc_tests" rows="4">${esc(s.qc_tests.join('\n'))}</textarea>`, 'Una por línea. Aparecen en el control de calidad de cada elaboración.')}
      ${field('Ensayos de materias primas', `<textarea name="mp_qc_tests" rows="4">${esc((s.mp_qc_tests || []).join('\n'))}</textarea>`, 'Uno por línea. Aparecen en el control de calidad de cada lote recibido.')}
    </div></section>
    <button class="btn block" type="submit">Guardar ajustes</button>
  </form>
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
      ${standalone ? '<p class="hint">App instalada en el teléfono.</p>' : state.deferredInstall ? '<button class="btn secondary" data-act="install">Instalar en el teléfono</button>' : '<p class="hint">Para instalarla: menú de Chrome (⋮) y «Instalar aplicación».</p>'}
    </div></section>
  <section><h2>Actividad</h2><ul class="list"><li><a class="row" href="#auditoria"><span class="row-main">Ver el registro de actividad</span></a></li><li><a class="row" href="#papelera"><span class="row-main">Papelera: fórmulas y PNT eliminados</span></a></li><li><a class="row" href="#conservacion"><span class="row-main">Conservación: borrados programados</span></a></li></ul></section>
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
    if (isLocalOnly(f)) continue;
    const { blob, ...meta } = f;
    datos[FILE_STORE].push({ ...meta, data: await blobToBase64(blob) });
  }
  const ajustes = await loadSettings();
  return {
    formato: EXPORT_FORMAT, version_formato: EXPORT_FORMAT_VERSION,
    app: `FARMA·LAB móvil ${APP_VERSION}`, exportado: nowIso(),
    dispositivo: state.deviceId, usuario: state.profile.name, ajustes, datos,
    borrados: cleanTombstones(await metaGet('tombstones')),
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
const OWNER_TYPES = ['pnt', 'material', 'packaging', 'biblio'];   // dueños de documentos que viajan en las copias
/** Datos de un documento recibido (copia o sincronización): true si se pueden usar. Las recetas nunca viajan. */
function docMetaOk(r) {
  if (!r || typeof r !== 'object' || !ID_RE.test(String(r.uuid))) return false;
  if (!ID_RE.test(String(r.owner_uuid || r.pnt_uuid))) return false;
  if (typeof r.updated_at !== 'string' || typeof r.name !== 'string' || !DOC_TYPES[r.ext]) return false;
  if (isLocalOnly(r) || !OWNER_TYPES.includes(r.owner_type || 'pnt')) return false;
  return /^[0-9a-f]{64}$/.test(String(r.sha256));
}
/** Documento adjunto de una copia: valida los datos y comprueba que el archivo llega íntegro (SHA-256). */
async function importedDoc(r) {
  if (!docMetaOk(r) || typeof r.data !== 'string' || r.data.length > (MAX_DOC_BYTES * 4) / 3 + 8) return null;
  let bytes;
  try { bytes = base64ToBytes(r.data); } catch { return null; }
  const { data, ...meta } = r;
  return docFromBytes(meta, bytes);
}
/** Documento listo para guardar a partir de sus datos y su contenido, si el contenido es el esperado (SHA-256). */
async function docFromBytes(r, bytes) {
  if (!docMetaOk(r) || !bytes || bytes.length > MAX_DOC_BYTES) return null;
  if (toHex(await crypto.subtle.digest('SHA-256', bytes)) !== r.sha256) return null;
  const { data, blob, ...meta } = r;
  const owner = r.owner_uuid || r.pnt_uuid;
  return {
    ...meta, owner_uuid: owner, owner_type: OWNER_TYPES.includes(r.owner_type) ? r.owner_type : 'pnt',
    kind: DOC_KINDS[r.kind] ? r.kind : 'documento', name: meta.name.slice(0, 200), mime: DOC_TYPES[r.ext].mime,
    size: bytes.length, blob: new Blob([bytes], { type: DOC_TYPES[r.ext].mime }),
  };
}
function validRecord(store, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || !ID_RE.test(String(r.uuid)) || typeof r.updated_at !== 'string') return false;
  const s = (v) => typeof v === 'string';
  const optNum = (v) => v === null || v === undefined || isNum(v);
  switch (store) {
    case 'material': return s(r.name) && s(r.lot) && isNum(r.quantity) && optNum(r.min_stock);
    case 'packaging': return s(r.name) && isNum(r.quantity) && optNum(r.min_stock);
    case 'formula': return s(r.name) && isNum(r.target_amount) && Array.isArray(r.components)
      && r.components.every((c) => c && s(c.ingredient) && isNum(c.amount));
    case 'pnt': return s(r.code) && s(r.title);
    case 'biblio': return s(r.title);
    case 'production': return s(r.record_code) && isNum(r.target_amount) && Array.isArray(r.weighings)
      && r.weighings.every((w) => w && s(w.ingredient) && isNum(w.theoretical) && optNum(w.actual));
    case 'audit': return s(r.action);
    default: return false;
  }
}
/** Adapta registros de copias antiguas al formato actual. */
function normalizeImported(store, r) {
  if (store === 'production' && LEGACY_PRODUCTION_STATUS[r.status]) {
    return { ...r, status: LEGACY_PRODUCTION_STATUS[r.status], status_changed_at: r.status_changed_at || r.submitted_at || r.updated_at };
  }
  if (store === 'production' && !STATUS.production[r.status]) return { ...r, status: 'en_proceso' };
  return r;
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
  const { plan, counts } = await planMerge(payload.datos, payload.ajustes, payload.borrados, importedDoc);
  const { added, updated, same, invalid, docs, removed } = counts;
  const summary = `Copia de ${payload.usuario || 'origen desconocido'} del ${fmtStamp(payload.exportado)}.\n\nRegistros nuevos: ${added}\nMás recientes que los tuyos: ${updated}${docs ? ` (incluye ${docs} ${docs === 1 ? 'documento adjunto' : 'documentos adjuntos'})` : ''}\nIguales o más antiguos (se ignoran): ${same}${invalid ? `\nNo válidos o dañados (se ignoran): ${invalid}` : ''}${removed ? `\nBorrados en el otro equipo por fin del plazo de conservación: ${removed}` : ''}${plan.settings ? '\nTambién se actualizan los ajustes.' : ''}\n\n${removed ? 'No se borra nada más de lo que ya tienes.' : 'No se borra nada de lo que ya tienes.'}`;
  if (!(await ask({ title: 'Importar copia', message: summary, confirmLabel: 'Importar' }))) return;
  await applyMerge(plan);
  await logOnly('importar_copia', `${file.name}: ${added} nuevos, ${updated} actualizados${removed ? `, ${removed} borrados` : ''}`);
  toast(added + updated + removed ? `Importados: ${added} nuevos y ${updated} actualizados${removed ? `; ${removed} borrados` : ''}.` : 'La copia no tenía nada nuevo.');
  await route();
}

// ------------------------------------------------------------------ unir datos de otro equipo (copias y sincronización)
const TOMBSTONE_KEEP_DAYS = 3 * 365;
/**
 * Borrados definitivos (fin del plazo de conservación): se recuerdan para que el registro
 * no vuelva desde otro equipo que aún lo tenga. Formato: { uuid: { store, at } }.
 */
function cleanTombstones(raw) {
  const out = {};
  const limit = new Date(Date.now() - TOMBSTONE_KEEP_DAYS * 864e5).toISOString();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, v] of Object.entries(raw)) {
      if (ID_RE.test(id) && v && [...STORES, FILE_STORE].includes(v.store) && typeof v.at === 'string' && v.at > limit) out[id] = { store: v.store, at: v.at };
    }
  }
  return out;
}
/** Anota borrados definitivos dentro de una transacción abierta que incluya 'meta'. */
function addTombstones(t, list, stamp) {
  if (!list.length) return;
  const meta = t.objectStore('meta');
  const g = meta.get('tombstones');
  g.onsuccess = () => {
    const all = cleanTombstones(g.result);
    list.forEach(({ store, uuid }) => { all[uuid] = { store, at: stamp }; });
    meta.put(all, 'tombstones');
  };
}
/**
 * Compara los datos recibidos (copia de seguridad o Google Drive) con los de este dispositivo, sin escribir nada.
 * Gana la versión más reciente de cada registro. Un borrado definitivo gana a las versiones anteriores a él,
 * y una modificación posterior al borrado gana al borrado. Las recetas de este dispositivo no se tocan nunca.
 * getDoc(datos del documento) devuelve el documento listo para guardar, o null si no se puede usar.
 */
async function planMerge(datos, ajustes, borrados, getDoc) {
  const incoming = datos && typeof datos === 'object' ? datos : {};
  const localTombs = cleanTombstones(await metaGet('tombstones'));
  const inTombs = cleanTombstones(borrados);
  const tombOf = (id) => localTombs[id] || inTombs[id];
  const plan = { puts: {}, deletes: [], tombs: {}, untomb: [], settings: null };
  const counts = { added: 0, updated: 0, same: 0, invalid: 0, docs: 0, removed: 0, records: 0 };
  const winners = new Map();   // uuid -> updated_at de lo recibido que se acepta
  const existing = {};
  for (const s of STORES) {
    existing[s] = new Map((await getAll(s)).map((r) => [r.uuid, r]));
    plan.puts[s] = [];
    for (const raw of Array.isArray(incoming[s]) ? incoming[s] : []) {
      if (!validRecord(s, raw)) { counts.invalid += 1; continue; }
      const r = normalizeImported(s, raw);
      const tomb = tombOf(r.uuid);
      if (tomb && tomb.at >= r.updated_at) { counts.same += 1; continue; }
      const cur = existing[s].get(r.uuid);
      if (cur && !(r.updated_at > (cur.updated_at || ''))) { counts.same += 1; continue; }
      if (tomb) plan.untomb.push(r.uuid);
      plan.puts[s].push(r);
      winners.set(r.uuid, r.updated_at);
      if (cur) counts.updated += 1; else counts.added += 1;
      if (s !== 'audit') counts.records += 1;
    }
  }
  plan.puts[FILE_STORE] = [];
  const existingDocs = new Map((await getAll(FILE_STORE)).map((r) => [r.uuid, r]));
  for (const raw of Array.isArray(incoming[FILE_STORE]) ? incoming[FILE_STORE] : []) {
    const id = raw && raw.uuid;
    const cur = existingDocs.get(id);
    if (cur && (isLocalOnly(cur) || !(String(raw.updated_at) > (cur.updated_at || '')))) { counts.same += 1; continue; }
    const tomb = tombOf(id) || tombOf(raw && (raw.owner_uuid || raw.pnt_uuid));
    if (tomb && tomb.at >= String(raw.updated_at)) { counts.same += 1; continue; }
    const doc = await getDoc(raw);
    if (!doc) { counts.invalid += 1; continue; }
    plan.puts[FILE_STORE].push(doc);
    counts.docs += 1; counts.records += 1;
    if (cur) counts.updated += 1; else counts.added += 1;
  }
  for (const [id, tomb] of Object.entries(inTombs)) {
    if (localTombs[id] && localTombs[id].at >= tomb.at) continue;
    if (winners.has(id) && winners.get(id) > tomb.at) continue;   // se modificó después de borrarse: gana el registro
    const cur = tomb.store === FILE_STORE ? existingDocs.get(id) : existing[tomb.store] && existing[tomb.store].get(id);
    if (cur && (isLocalOnly(cur) || (cur.updated_at || '') > tomb.at)) continue;
    plan.tombs[id] = tomb;
    if (cur) { plan.deletes.push({ store: tomb.store, uuid: id, at: tomb.at }); counts.removed += 1; counts.records += 1; }
  }
  if (ajustes && typeof ajustes === 'object') {
    const local = await loadSettings();
    if (JSON.stringify(mergeSettings(local, ajustes)) !== JSON.stringify(local)) plan.settings = ajustes;
  }
  return { plan, counts };
}
/** Aplica lo planificado en una sola operación, comprobando de nuevo cada registro por si ha cambiado mientras tanto. */
async function applyMerge(plan) {
  const nothing = !Object.values(plan.puts).some((l) => l.length) && !plan.deletes.length && !plan.settings
    && !Object.keys(plan.tombs).length && !plan.untomb.length;
  if (nothing) return false;
  await tx([...STORES, FILE_STORE, 'meta'], 'readwrite', (t) => {
    for (const [s, list] of Object.entries(plan.puts)) {
      const os = t.objectStore(s);
      list.forEach((r) => {
        const g = os.get(r.uuid);
        g.onsuccess = () => {
          const cur = g.result;
          if (s === FILE_STORE && cur && isLocalOnly(cur)) return;
          if (!cur || String(r.updated_at) > String(cur.updated_at || '')) os.put(r);
        };
      });
    }
    plan.deletes.forEach(({ store, uuid, at }) => {
      const os = t.objectStore(store);
      const g = os.get(uuid);
      g.onsuccess = () => {
        const cur = g.result;
        if (!cur || isLocalOnly(cur) || String(cur.updated_at || '') > at) return;
        os.delete(uuid);
        if (store === FILE_STORE) return;
        const files = t.objectStore(FILE_STORE);
        const k = files.index('owner_uuid').getAllKeys(uuid);   // incluidas las recetas de esa elaboración
        k.onsuccess = () => k.result.forEach((key) => files.delete(key));
      };
    });
    const meta = t.objectStore('meta');
    if (Object.keys(plan.tombs).length || plan.untomb.length) {
      const g = meta.get('tombstones');
      g.onsuccess = () => {
        const all = cleanTombstones(g.result);
        Object.assign(all, plan.tombs);
        plan.untomb.forEach((id) => { delete all[id]; });
        meta.put(all, 'tombstones');
      };
    }
    if (plan.settings) {
      const g = meta.get('settings');
      g.onsuccess = () => {
        const cur = normalizeSettings(g.result);
        const merged = mergeSettings(cur, plan.settings);
        if (JSON.stringify(merged) !== JSON.stringify(cur)) meta.put(merged, 'settings');
      };
    }
    meta.put(nowIso(), 'lastChange');
  });
  await loadSettings();
  return true;
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
  wipe: () => wipeAll(),
  setStatus: async (el) => {
    const { store, id, status } = el.dataset;
    if (!STATUS_ACTIONS[store] || !STATUS[store][status]) return;
    const rec = await getOne(store, id);
    if (!rec || rec.status === status) return;
    const check = STATUS_CHECKS[store] ? await STATUS_CHECKS[store](rec, status) : null;
    if (check && !(await ask(check))) return;
    if (check && typeof check.apply === 'function') check.apply(rec);   // p. ej., el nº de registro interno al aceptar
    rec.status = status;
    if ((store === 'material' || store === 'packaging') && ['aceptado', 'rechazado'].includes(status)) {
      rec.decision_date = todayIso();
      rec.decision_by = state.profile.name;
    }
    await save(store, rec, STATUS_ACTIONS[store], `${recordLabel(store, rec)}: ${STATUS[store][status]}`);
    toast(`Estado cambiado a ${STATUS[store][status]}.`);
    await route();
  },
  deleteRecord: async (el) => {
    const { store, id } = el.dataset;
    if (!DELETABLE[store]) return;
    const rec = await getOne(store, id);
    if (!rec || rec.deleted_at) return;
    const check = DELETE_CHECKS[store] ? await DELETE_CHECKS[store](rec) : { message: '' };
    if (check.block) { await ask({ title: `No se puede eliminar`, message: check.block, confirmLabel: 'Entendido', cancelLabel: 'Cerrar' }); return; }
    const name = recordName(store, rec);
    const ok = await ask({
      title: `Eliminar ${DELETABLE[store] === 'PNT' ? 'PNT' : 'fórmula'}`,
      message: `${name} pasará a la papelera (Ajustes → Papelera), desde donde se puede restaurar.${check.message ? `\n\n${check.message}` : ''}`,
      confirmLabel: 'Eliminar', danger: true,
    });
    if (!ok) return;
    rec.deleted_at = nowIso();
    rec.deleted_by = state.profile.name;
    await save(store, rec, `eliminar_${store}`, name);
    toast(`${DELETABLE[store]} eliminad${store === 'formula' ? 'a' : 'o'}. Puedes restaurarl${store === 'formula' ? 'a' : 'o'} desde la papelera.`);
    location.hash = store === 'pnt' ? '#pnt' : '#formulas';
  },
  restoreRecord: async (el) => {
    const { store, id } = el.dataset;
    if (!DELETABLE[store]) return;
    const rec = await getOne(store, id);
    if (!rec || !rec.deleted_at) return;
    const problem = RESTORE_CHECKS[store] ? await RESTORE_CHECKS[store](rec) : null;
    if (problem) { await ask({ title: 'No se puede restaurar', message: problem, confirmLabel: 'Entendido', cancelLabel: 'Cerrar' }); return; }
    delete rec.deleted_at;
    delete rec.deleted_by;
    await save(store, rec, `restaurar_${store}`, recordName(store, rec));
    toast(`${DELETABLE[store]} restaurad${store === 'formula' ? 'a' : 'o'}.`);
    await route();
  },
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
  try { await handler(el, e); } catch (err) { reportError(err, el.closest('form')); }
}

// ------------------------------------------------------------------ formularios
const formData = (form) => Object.fromEntries(new FormData(form));
const lines = (v) => String(v ?? '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 120)).slice(0, 80);

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

  async settings(form) {
    const d = formData(form);
    const s = await loadSettings();
    const next = parseInt(str(d.lot_next), 10);
    if (!Number.isInteger(next) || next < 1 || next > 9999999) throw new InputError('El próximo número de lote debe ser un número entero mayor que cero.');
    const letter = str(d.lot_letter).toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(letter)) throw new InputError('La letra del lote solo puede tener letras o números (por ejemplo, J).');
    const years = (k, label) => {
      const n = Number(str(d[k]));
      if (!Number.isInteger(n) || n < 1 || n > 30) throw new InputError(`${label}: escribe un número entero de años entre 1 y 30.`);
      return n;
    };
    const retention = {
      enabled: d.ret_enabled === 'on',
      production: {
        general: years('ret_general', 'Elaboraciones'), psicotropo: years('ret_psicotropo', 'Con psicótropos'),
        estupefaciente: years('ret_estupefaciente', 'Con estupefacientes'), veterinaria: years('ret_veterinaria', 'Uso veterinario'),
      },
      material: years('ret_material', 'Materias primas'), packaging: years('ret_packaging', 'Acondicionamiento'),
      notice_days: Number(str(d.ret_notice)),
    };
    if (!Number.isInteger(retention.notice_days) || retention.notice_days < 30 || retention.notice_days > 365) throw new InputError('Los días de aviso deben ser un número entre 30 y 365.');
    const pFactor = parseNum(d.p_factor, 'Factor P');
    if (!(pFactor > 0 && pFactor < 100)) throw new InputError('El factor P debe ser un importe en euros mayor que cero (por ejemplo, 3,65).');
    const iva = parseNum(d.iva, 'IVA');
    if (!(iva >= 0 && iva <= 30)) throw new InputError('El IVA debe estar entre 0 y 30 %.');
    const used = (await getAll('production')).filter((p) => p.lot).map((p) => p.lot);
    const preview = lotPreview({ lot: { letter } }, next);
    if (used.includes(preview)) throw new InputError(`El lote ${preview} ya está asignado. Elige un número mayor.`);
    const updated = {
      ...s,
      pharmacy: { name: str(d.ph_name).slice(0, 120), address: str(d.ph_address).slice(0, 200), phone: str(d.ph_phone).slice(0, 40), pharmacist: str(d.ph_pharmacist).slice(0, 120) },
      lot: { letter, next },
      label: { layout: d.label_layout === '2' ? '2' : '8', all_components: d.label_all === 'on' },
      pricing: { p_factor: pFactor, iva },
      fn: { mp_code: str(d.fn_mp_code).slice(0, 40) || DEFAULT_SETTINGS.fn.mp_code, mp_related: str(d.fn_mp_related).slice(0, 120) },
      retention,
      equipment: lines(d.equipment),
      qc_tests: lines(d.qc_tests),
      mp_qc_tests: lines(d.mp_qc_tests),
    };
    await saveSettings(updated, `Farmacia, lotes (próximo ${preview}), etiquetas, factor P ${fmtNum(pFactor)} €, IVA ${fmtNum(iva)} % y utillaje`);
    toast('Ajustes guardados.');
    await route();
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
    const words = fold(str(t.value)).split(/\s+/).filter(Boolean);   // todas las palabras, en cualquier orden
    const rows = $$('[data-list] > li');
    let shown = 0;
    rows.forEach((li) => { const text = fold(li.dataset.text); const hit = words.every((w) => text.includes(w)); li.hidden = !hit; if (hit) shown += 1; });
    const none = $('[data-none]');
    if (none) none.hidden = shown > 0;
    return;
  }
  INPUT_HOOKS.forEach((fn) => { try { fn(t, e); } catch (err) { console.error(err); } });
}
async function onChange(e) {
  const t = e.target;
  if (t.matches('input[data-docpick]')) {
    const out = $('[data-file-chosen]', t.closest('form'));
    const f = t.files && t.files[0];
    if (f) $$('input[data-docpick]', t.closest('form')).forEach((other) => { if (other !== t) other.value = ''; });   // cámara o archivo: vale el último elegido
    if (out) out.textContent = f ? `${f.name} (${fmtSize(f.size)})` : 'Ningún archivo elegido';
  } else if (t.matches('input[data-import]')) {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    try { await importBackup(file); } catch (err) { reportError(err); }
  }
  CHANGE_HOOKS.forEach((fn) => { try { fn(t, e); } catch (err) { console.error(err); } });
}

window.addEventListener('hashchange', (e) => { state.prevBack = e.oldURL.includes('#') ? `#${e.oldURL.split('#')[1]}` : '#inicio'; });
document.addEventListener('DOMContentLoaded', boot);
