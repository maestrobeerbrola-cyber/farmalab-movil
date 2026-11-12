'use strict';
/* FARMA·LAB móvil · Precio de las fórmulas magistrales financiadas (Comunidad de Madrid):
   búsqueda de precio tasado por código nacional y calculadora de valoración según el Anexo 3
   del Convenio 2023-2027 (Tabla I principios activos, II excipientes, III honorarios, IV envases). */

ROUTES.valoracion = (arg, extra) => (arg === 'tasado' ? viewTasado() : viewValuation(arg, extra));

const PRICE_FILES = ['./datos/tabla1-principios-activos.json', './datos/precio-tasado-2026.json'];
let priceDataPromise = null;
function loadPriceData() {
  if (!priceDataPromise) {
    priceDataPromise = Promise.all(PRICE_FILES.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`no se pudo cargar ${url.split('/').pop()} (${res.status})`);
      return res.json();
    })).then(([t1, ts]) => ({
      tabla1: t1.items.map((it) => ({ ...it, keys: aliasKeys(it.nombre) })),
      tasado: ts.items,
      byCn: new Map(ts.items.map((x) => [x.cn, x])),
      sources: { tabla1: t1.fuente, tasado: ts.fuente },
    })).catch((err) => { priceDataPromise = null; throw err; });
  }
  return priceDataPromise;
}
/** Fórmula con precio tasado para un código nacional (admite el dígito de control: 599079.3). */
function tasadoLookup(data, cn) {
  const digits = String(cn || '').replace(/\D/g, '');
  return data.byCn.get(digits) || (digits.length === 7 ? data.byCn.get(digits.slice(0, 6)) : null) || null;
}
async function tasadoFor(cn) {
  if (!cn) return null;
  try { return tasadoLookup(await loadPriceData(), cn); } catch { return null; }
}

// ------------------------------------------------------------------ tablas del Anexo 3
/** Tabla III. Hasta el umbral (10 unidades o 100 g/ml): P × base. Por encima: + (cantidad − umbral) × extra × P. */
const FEE_FORMS = {
  colirios: { label: 'Colirios, pomadas oftálmicas', kind: 'u', max: 1, base: 8, extra: 0, unit: 'envases' },
  inyectables: { label: 'Inyectables', kind: 'u', max: 25, base: 8, extra: 0.3, unit: 'unidades' },
  inyectables_susp: { label: 'Inyectables suspensiones', kind: 'u', max: 25, base: 8, extra: 0.4, unit: 'unidades' },
  supositorios: { label: 'Óvulos, supositorios', kind: 'u', max: 25, base: 8, extra: 0.1, unit: 'unidades' },
  papeles: { label: 'Papeles, sellos', kind: 'u', max: 50, base: 8, extra: 0.1, unit: 'unidades' },
  grageas: { label: 'Grageas, píldoras', kind: 'u', max: 100, base: 8, extra: 0.1, unit: 'unidades' },
  comprimidos: { label: 'Comprimidos', kind: 'u', max: 100, base: 8, extra: 0.1, unit: 'unidades' },
  capsulas: { label: 'Cápsulas', kind: 'u', max: 100, base: 5, extra: 0.1, unit: 'unidades' },
  capsulas_gr: { label: 'Cápsulas gastrorresistentes', kind: 'u', max: 100, base: 8, extra: 0.1, unit: 'unidades' },
  pomadas: { label: 'Pastas, pomadas', kind: 'g', max: 250, base: 6, extra: 0.010, unit: 'g o ml' },
  geles: { label: 'Geles', kind: 'g', max: 250, base: 8, extra: 0.010, unit: 'g o ml' },
  emulsiones: { label: 'Granulados, emulsiones', kind: 'g', max: 250, base: 8, extra: 0.013, unit: 'g o ml' },
  polvos: { label: 'Polvos compuestos', kind: 'g', max: 250, base: 8, extra: 0.003, unit: 'g o ml' },
  suspensiones: { label: 'Suspensiones', kind: 'g', max: 250, base: 5, extra: 0.007, unit: 'g o ml' },
  soluciones_esteriles: { label: 'Soluciones estériles', kind: 'g', max: 1000, base: 8, extra: 0.005, unit: 'g o ml' },
  soluciones: { label: 'Soluciones, enemas', kind: 'g', max: 1000, base: 6, extra: 0.005, unit: 'g o ml' },
};
const FEE_THRESHOLD = { u: 10, g: 100 };
/** Cantidad que se elabora si la receta no la indica (punto 3.1 del Anexo 3). */
const DEFAULT_QTY = { colirios: 1, inyectables: 25, inyectables_susp: 25, supositorios: 25 };
const defaultQty = (form) => DEFAULT_QTY[form] || (FEE_FORMS[form].kind === 'u' ? 30 : 100);

/** Tabla II. per: bloque en ml o g que se cobra entero ("o fracción"); 'ud' = precio por unidad. */
const EXCIPIENTS = {
  esteriles: { label: 'Soluciones y suspensiones estériles', price: 0.35, per: 10, basis: 'ml' },
  acuosas: { label: 'Soluciones y suspensiones acuosas', price: 0.63, per: 100, basis: 'ml' },
  hidroalcoholicas: { label: 'Hidroalcohólicas (y otras no acuosas)', price: 2.01, per: 100, basis: 'ml' },
  oleosas: { label: 'Oleosas', price: 2.22, per: 100, basis: 'ml' },
  jarabes: { label: 'Jarabes', price: 1.85, per: 100, basis: 'ml' },
  pomadas: { label: 'Pastas y pomadas anhidras', price: 1.34, per: 100, basis: 'g' },
  emulsiones: { label: 'Emulsiones y geles (excepto colodiones)', price: 1.87, per: 100, basis: 'g' },
  polvos: { label: 'Polvos y granulados', price: 0.69, per: 100, basis: 'g' },
  supositorios: { label: 'Supositorios, óvulos y barras labiales', price: 0.04, per: 'ud' },
  capsulas_entericas: { label: 'Cápsulas entéricas', price: 0.03, per: 'ud' },
  capsulas: { label: 'Cápsulas duras', price: 0.03, per: 'ud' },
};
/** Tabla IV. */
const CONTAINERS = {
  liquidas: { label: 'Formas líquidas', price: 0.90 },
  cuentagotas: { label: 'Cuentagotas para formas líquidas', price: 1.00 },
  semisolidas: { label: 'Formas semisólidas', price: 1.25 },
  solidas: { label: 'Formas sólidas (cápsulas y papelillos)', price: 1.25 },
  vial: { label: 'Vial', price: 0.70 },
  ampolla: { label: 'Ampolla (5 ml)', price: 0.38 },
  colirio: { label: 'Frasco estéril para colirio', price: 0.70 },
  supositorio: { label: 'Molde para supositorios', price: 1.25 },
  ovulos: { label: 'Molde para óvulos', price: 1.25 },
};
const DEFAULT_EXCIPIENT = {
  colirios: 'esteriles', inyectables: 'esteriles', inyectables_susp: 'esteriles', supositorios: 'supositorios', papeles: 'polvos',
  grageas: '', comprimidos: '', capsulas: 'capsulas', capsulas_gr: 'capsulas_entericas', pomadas: 'pomadas', geles: 'emulsiones',
  emulsiones: 'emulsiones', polvos: 'polvos', suspensiones: 'acuosas', soluciones_esteriles: 'esteriles', soluciones: 'acuosas',
};
const DEFAULT_CONTAINER = {
  colirios: 'colirio', inyectables: 'vial', inyectables_susp: 'vial', supositorios: 'supositorio', papeles: 'solidas', grageas: 'solidas',
  comprimidos: 'solidas', capsulas: 'solidas', capsulas_gr: 'solidas', pomadas: 'semisolidas', geles: 'semisolidas', emulsiones: 'semisolidas',
  polvos: 'solidas', suspensiones: 'liquidas', soluciones_esteriles: 'liquidas', soluciones: 'liquidas',
};
/** Punto 8 del Anexo 3: preparados oficinales con precio específico (IVA incluido). */
const OFFICINAL_PRICES = [
  { name: 'Alcohol boricado al 5 % o a saturación (solo uso otológico)', match: /alcohol boric/, upTo100: 8.5, upTo250: 14.5 },
  { name: 'Sulfato de cobre, solución al 0,05 %, 0,1 % y 0,2 %', match: /(sulfato de cobre|cobre,? sulfato|sulfato cuprico)/, upTo100: 8, upTo250: 14 },
];
const officinalHit = (name) => OFFICINAL_PRICES.find((o) => o.match.test(fold(name))) || null;
const VIA_LABELS = { vs: 'vía sistémica', vo: 'vía oral', vt: 'vía tópica' };
const ACT_UNITS = { pct: '%', g: 'g', mg: 'mg', ug: 'µg', mg_ud: 'mg/ud.', ug_ud: 'µg/ud.' };

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const money = (n) => `${(isNum(n) ? n : 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const eur4 = (n) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
const eurG = (n) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 6 })} €/g`;

// ------------------------------------------------------------------ búsqueda de principios activos
const NAME_STOP = new Set(['de', 'del', 'la', 'el', 'y', 'en', 'al', 'base']);
const NAME_SYN = { sodico: 'sodio', potasico: 'potasio', calcico: 'calcio', magnesico: 'magnesio', clorhidrato: 'hcl', hidrocloruro: 'hcl', mcg: 'ug' };
const nameTokens = (s) => fold(s).replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((t) => t && !NAME_STOP.has(t)).map((t) => NAME_SYN[t] || t);
const aliasKeys = (nombre) => nombre.split('=').map(nameTokens).filter((k) => k.length);

/** Busca el principio activo en la Tabla I: igual, mismas palabras en otro orden o un único candidato que las contenga. */
function matchActive(name, table) {
  const exact = table.find((it) => fold(it.nombre) === fold(name));
  if (exact) return { item: exact, candidates: [] };
  const q = new Set(nameTokens(name));
  if (!q.size) return { item: null, candidates: [] };
  const scored = [];
  for (const it of table) {
    let best = 0; let nested = false;
    for (const k of it.keys) {
      const ks = new Set(k);
      const inter = [...ks].filter((t) => q.has(t)).length;
      if (!inter) continue;
      const score = inter / new Set([...q, ...ks]).size;
      if (score > best) best = score;
      if (inter === ks.size || inter === q.size) nested = true;
    }
    if (best) scored.push({ it, best, nested });
  }
  scored.sort((a, b) => b.best - a.best);
  const top = scored[0];
  if (top && top.best === 1) return { item: top.it, candidates: [] };
  const nestedHits = scored.filter((s) => s.nested);
  if (nestedHits.length === 1 && nestedHits[0].best >= 0.5) return { item: nestedHits[0].it, candidates: [] };
  return { item: null, candidates: (nestedHits.length ? nestedHits : scored.filter((s) => s.best >= 0.34)).slice(0, 4).map((s) => s.it) };
}

/** Forma de la Tabla III que corresponde al texto libre de la fórmula ("Cápsulas", "Crema O/W"...). */
function guessFeeForm(text, unit) {
  const t = fold(text);
  const rules = [
    [/gastrorresist|enteric/, 'capsulas_gr'], [/capsul/, 'capsulas'], [/colirio|oftalm/, 'colirios'],
    [/inyect.*suspens|suspens.*inyect/, 'inyectables_susp'], [/inyect|ampolla|vial/, 'inyectables'],
    [/supositorio|ovulo/, 'supositorios'], [/papel|sello|sobre/, 'papeles'], [/gragea|pildora/, 'grageas'],
    [/comprimido/, 'comprimidos'], [/pasta|pomada|unguento|vaselina/, 'pomadas'], [/\bgel/, 'geles'],
    [/crema|emulsion|granulado|o\/w|w\/o/, 'emulsiones'], [/polvo/, 'polvos'], [/suspens/, 'suspensiones'],
    [/esteril|irrigac/, 'soluciones_esteriles'], [/solucion|jarabe|enema|gota|elixir|colutorio|locion|aceite/, 'soluciones'],
  ];
  const hit = rules.find(([re]) => re.test(t));
  if (hit) return hit[1];
  return unit === 'unidades' ? 'capsulas' : unit === 'ml' ? 'soluciones' : 'pomadas';
}
function guessExcipient(form, text) {
  const t = fold(text);
  if (['soluciones', 'suspensiones'].includes(form)) {
    if (/jarabe/.test(t)) return 'jarabes';
    if (/oleos|aceite/.test(t)) return 'oleosas';
    if (/hidroalcoh|alcohol|tintura/.test(t)) return 'hidroalcoholicas';
  }
  return DEFAULT_EXCIPIENT[form];
}

/** Datos iniciales de la calculadora a partir de una fórmula o una elaboración. */
function initFromRecipe(formText, amount, unit, actives) {
  const form = guessFeeForm(formText, unit);
  const kind = FEE_FORMS[form].kind;
  const sameKind = (kind === 'u') === (unit === 'unidades');
  return {
    form,
    qty: sameKind && isNum(amount) ? amount : null,
    vol: null,
    actives: actives.length ? actives.map((a) => ({ name: a.name, value: ['g', 'mg'].includes(a.unit) ? a.amount : null, unit: a.unit === 'mg' ? 'mg' : 'g' })) : [{}],
    excipient: guessExcipient(form, formText),
    exc_qty: null,
    container: DEFAULT_CONTAINER[form],
    containers: null,
  };
}

// ------------------------------------------------------------------ pantallas
function actRow(a = {}) {
  return `<div class="actrow" data-comp>
    <input type="text" name="act_name" list="dl-tabla1" placeholder="Principio activo" aria-label="Principio activo" maxlength="160" autocomplete="off" value="${esc(a.name || '')}">
    <button type="button" class="icon-btn quiet" data-act="removeRow" aria-label="Quitar">${ICON.x}</button>
    <input type="text" name="act_value" inputmode="decimal" autocomplete="off" placeholder="Cantidad total" aria-label="Cantidad de principio activo" value="${esc(inputNum(a.value))}">
    <select name="act_unit" aria-label="Unidad">${options(Object.keys(ACT_UNITS), a.unit || 'g', ACT_UNITS)}</select>
    <label class="eurg"><span>Precio</span><input type="text" name="act_eurg" inputmode="decimal" autocomplete="off" aria-label="Precio del principio activo en euros por gramo" value="${esc(inputNum(a.eurg))}"><span>€/g</span></label>
    <p class="act-info" data-actinfo aria-live="polite"></p>
  </div>`;
}
ROW_BUILDERS.act = actRow;

const priceError = (err, current = '#valoracion') => `${segmented(CALC_TABS, current)}<div class="msg error">No se pudieron cargar las tablas de precios (${esc(err.message)}). Abre la app una vez con conexión para que se guarden en el teléfono.</div>`;

async function viewValuation(src, id) {
  let data;
  try { data = await loadPriceData(); } catch (err) { return priceError(err); }
  const s = await loadSettings();
  let init = null; let origin = ''; const notes = [];
  let saveId = '';
  if (src === 'elab' && id) {
    const p = await getOne('production', id);
    if (!p) return empty('Este registro no existe.', '');
    state.parent = `#elaboraciones--${p.uuid}`;
    init = p.valuation && p.valuation.inputs
      ? p.valuation.inputs
      : initFromRecipe(p.form, p.target_amount, p.unit, (p.weighings || []).filter((w) => w.role === 'activo').map((w) => ({ name: w.ingredient, amount: w.theoretical, unit: w.unit })));
    origin = `<a href="#elaboraciones--${esc(p.uuid)}">${esc(p.lot || p.record_code)}</a> · ${esc(p.formula_name)} · ${fmtNum(p.target_amount)} ${esc(p.unit)}${p.form ? ` · ${esc(p.form)}` : ''}`;
    const hit = p.cn ? tasadoLookup(data, p.cn.cn) : null;
    if (hit) notes.push(`<div class="msg ok">El CN ${esc(p.cn.cn)} tiene precio tasado: <strong>${money(hit.pvp)}</strong> (${esc(hit.producto)}). Se factura a ese precio, sin valorar.</div>`);
    if (p.valuation) notes.push(`<p class="hint">Valoración guardada el ${fmtDay(p.valuation.date)}: ${money(p.valuation.total)}${isNum(p.valuation.p_factor) && p.valuation.p_factor !== s.pricing.p_factor ? ` (con factor P ${fmtNum(p.valuation.p_factor)} €; ahora es ${fmtNum(s.pricing.p_factor)} €)` : ''}.</p>`);
    const of = officinalHit(p.formula_name);
    if (of) notes.push(`<div class="msg ok">${esc(of.name)}: precio fijo de ${money(of.upTo100)} hasta 100 ml y ${money(of.upTo250)} de 101 a 250 ml (IVA incluido).</div>`);
    if (p.status !== 'rechazada') saveId = p.uuid;
  } else if (src === 'formula' && id) {
    const f = await getOne('formula', id);
    if (!f) return empty('Esta fórmula no existe.', '');
    state.parent = `#formulas--${f.uuid}`;
    init = initFromRecipe(f.form, f.target_amount, f.unit, (f.components || []).filter((c) => c.role === 'activo').map((c) => ({ name: c.ingredient, amount: c.amount, unit: c.unit })));
    origin = `<a href="#formulas--${esc(f.uuid)}">${esc(f.name)}</a> · lote de referencia ${fmtNum(f.target_amount)} ${esc(f.unit)}${f.form ? ` · ${esc(f.form)}` : ''}`;
    const hits = (f.national_codes || []).map((c) => [c, tasadoLookup(data, c.cn)]).filter(([, h]) => h);
    if (hits.length) notes.push(`<div class="msg ok">Con precio tasado: ${hits.map(([c, h]) => `CN ${esc(c.cn)} ${money(h.pvp)}`).join(' · ')}. Esas presentaciones no se valoran.</div>`);
    const of = officinalHit(f.name);
    if (of) notes.push(`<div class="msg ok">${esc(of.name)}: precio fijo de ${money(of.upTo100)} hasta 100 ml y ${money(of.upTo250)} de 101 a 250 ml (IVA incluido).</div>`);
  } else {
    state.parent = '#calculadora';
  }
  const v = init || { form: 'capsulas', qty: null, vol: null, actives: [{}, {}], excipient: 'capsulas', exc_qty: null, container: 'solidas', containers: null };
  if (!FEE_FORMS[v.form]) v.form = 'capsulas';
  const formSelect = `<select name="fee_form">
      <optgroup label="Por unidades">${Object.entries(FEE_FORMS).filter(([, f]) => f.kind === 'u').map(([k, f]) => `<option value="${k}"${k === v.form ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</optgroup>
      <optgroup label="Por gramos o mililitros">${Object.entries(FEE_FORMS).filter(([, f]) => f.kind === 'g').map(([k, f]) => `<option value="${k}"${k === v.form ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</optgroup>
    </select>`;
  const excOptions = `<option value="">Sin excipiente de la Tabla II</option>${Object.entries(EXCIPIENTS).map(([k, e]) => `<option value="${k}"${k === (v.excipient || '') ? ' selected' : ''}>${esc(e.label)} · ${money(e.price)}${e.per === 'ud' ? '/ud.' : `/${e.per} ${e.basis}`}</option>`).join('')}`;
  const contOptions = `<option value="">Sin envase</option>${Object.entries(CONTAINERS).map(([k, c]) => `<option value="${k}"${k === (v.container || '') ? ' selected' : ''}>${esc(c.label)} · ${money(c.price)}</option>`).join('')}`;
  const acts = v.actives && v.actives.length ? v.actives : [{}];
  return `${segmented(CALC_TABS, '#valoracion')}
  ${origin ? `<div class="panel origin"><span class="kind">Datos tomados de</span>${origin}</div>` : ''}
  ${notes.join('')}
  <div class="pricecalc" data-pricecalc data-save="${esc(saveId)}">
    <section><h2>Fórmula</h2><div class="panel form">
      ${field('Forma farmacéutica (honorarios, Tabla III)', formSelect)}
      <div class="grid2">
        <label class="field"><span data-qlabel>Unidades</span>${decimal('qty', `value="${esc(inputNum(v.qty))}"`)}<span class="hint" data-qhint></span></label>
        <label class="field" data-volbox><span>Total en g o ml</span>${decimal('vol', `value="${esc(inputNum(v.vol))}"`)}<span class="hint">Para principios activos en % y excipientes por volumen.</span></label>
      </div>
    </div></section>
    <section><h2>Principios activos (Tabla I)</h2><div class="panel form">
      <div data-rows="act">${acts.map((a) => actRow(a)).join('')}</div>
      <button type="button" class="btn secondary small" data-act="addRow" data-kind="act">${ICON.plus}Añadir principio activo</button>
      <p class="hint">Cantidad de cada principio activo en toda la fórmula. En % se calcula sobre el total; en mg/ud. se multiplica por las unidades. Precio: si lo dejas vacío se usa el de la Tabla I; si el principio activo no está en ella, escribe su precio de coste en €/g.</p>
    </div>
    <datalist id="dl-tabla1">${data.tabla1.map((it) => `<option value="${esc(it.nombre)}">${esc(`${eurG(it.eur_g)}${it.comentario ? ` · ${it.comentario.slice(0, 70)}` : ''}`)}</option>`).join('')}</datalist>
    </section>
    <section><h2>Excipiente (Tabla II) y envase (Tabla IV)</h2><div class="panel form">
      <div class="grid2">
        ${field('Excipiente', `<select name="excipient">${excOptions}</select>`)}
        <label class="field"><span>Cantidad para el excipiente</span>${decimal('exc_qty', `value="${esc(inputNum(v.exc_qty))}"`)}<span class="hint" data-exchint></span></label>
      </div>
      <div class="grid2">
        ${field('Envase', `<select name="container">${contOptions}</select>`)}
        ${field('Número de envases', `<input type="text" inputmode="numeric" autocomplete="off" name="containers" placeholder="1" value="${esc(inputNum(v.containers))}">`)}
      </div>
    </div></section>
    <section><h2>Precio de facturación</h2><div data-out="price"></div></section>
  </div>
  <p class="hint">Factor P ${esc(fmtNum(s.pricing.p_factor))} € e IVA ${esc(fmtNum(s.pricing.iva))} % (se cambian en <a href="#ajustes">Ajustes</a>). Tablas del Anexo 3 del Convenio 2023-2027 con la Comunidad de Madrid; cada concepto se redondea a céntimos. Valoración orientativa: compruébala antes de facturar.</p>`;
}

async function viewTasado() {
  state.parent = '#calculadora';
  let data;
  try { data = await loadPriceData(); } catch (err) { return priceError(err, '#valoracion--tasado'); }
  return `${segmented(CALC_TABS, '#valoracion--tasado')}
  <p class="hint intro">Fórmulas magistrales financiadas con código nacional propio y precio fijo: se facturan a este PVP, sin valorarlas.</p>
  ${searchBox('Buscar por nombre o código nacional')}
  <ul class="list" data-list>${data.tasado.map((x) => `<li data-text="${esc(lc(`${x.producto} ${x.cn}`))}"><div class="row"><div class="row-main"><strong>${esc(x.producto)}</strong><span class="sub"><span>CN ${esc(x.cn)}</span></span></div><b class="num">${money(x.pvp)}</b></div></li>`).join('')}</ul>
  <p class="none" data-none hidden>Ninguna fórmula con precio tasado coincide. Si no está en la lista, se valora con la pestaña Valoración.</p>
  <section><h2>Preparados oficinales con precio fijo</h2><ul class="list">${OFFICINAL_PRICES.map((o) => `<li><div class="row"><div class="row-main"><strong>${esc(o.name)}</strong><span class="sub"><span>Hasta 100 ml: ${money(o.upTo100)}</span><span>101 a 250 ml: ${money(o.upTo250)}</span></span></div></div></li>`).join('')}</ul>
  <p class="hint">Precios con IVA incluido (punto 8 del Anexo 3). Máximo 250 ml por receta.</p></section>
  <p class="hint">${esc(data.tasado.length)} fórmulas. Fuente: ${esc(data.sources.tasado)}.</p>`;
}

// ------------------------------------------------------------------ cálculo
function readPriceInputs(box) {
  const el = (n) => $(`[name="${n}"]`, box);
  const n = (input) => { try { return parseNum(input.value, ''); } catch { return NaN; } };
  return {
    form: el('fee_form').value,
    qty: n(el('qty')),
    vol: n(el('vol')),
    actives: $$('[data-rows="act"] [data-comp]', box).map((row) => ({
      row, name: str($('[name="act_name"]', row).value), value: n($('[name="act_value"]', row)), unit: $('[name="act_unit"]', row).value, eurg: n($('[name="act_eurg"]', row)),
    })),
    excipient: el('excipient').value,
    exc_qty: n(el('exc_qty')),
    container: el('container').value,
    containers: n(el('containers')),
  };
}

function valuate(inp, data, pricing) {
  const P = pricing.p_factor;
  const fee = FEE_FORMS[inp.form] || FEE_FORMS.capsulas;
  const unitWord = fee.unit;
  const warn = [];
  const q = inp.qty;
  const qtyOk = isNum(q) && q > 0;
  const total = fee.kind === 'g' ? (qtyOk ? q : null) : (isNum(inp.vol) && inp.vol > 0 ? inp.vol : (inp.form === 'colirios' ? 10 : null));

  // a) principios activos
  const acts = inp.actives.filter((a) => a.name || a.value !== null || a.eurg !== null).map((a) => {
    const m = a.name ? matchActive(a.name, data.tabla1) : { item: null, candidates: [] };
    let grams = null; let note = '';
    if (!isNum(a.value) || a.value <= 0) note = 'Indica la cantidad.';
    else if (a.unit === 'pct') { if (total) grams = (a.value / 100) * total; else note = 'Para calcular el %, indica el total en g o ml.'; }
    else if (a.unit === 'g') grams = a.value;
    else if (a.unit === 'mg') grams = a.value / 1000;
    else if (a.unit === 'ug') grams = a.value / 1e6;
    else if (a.unit === 'mg_ud' || a.unit === 'ug_ud') {
      if (fee.kind === 'u' && qtyOk) grams = (a.value / (a.unit === 'mg_ud' ? 1000 : 1e6)) * q;
      else note = fee.kind === 'u' ? 'Indica las unidades.' : 'mg/ud. solo sirve para formas por unidades.';
    }
    // Precio en €/g: el que se escriba en la fila; si se deja vacío, el de la Tabla I.
    const manual = isNum(a.eurg) && a.eurg > 0;
    const price = manual ? a.eurg : m.item ? m.item.eur_g : null;
    let priceNote = '';
    if (a.eurg !== null && !manual) priceNote = 'El precio en €/g no es válido.';
    else if (!price && a.name) priceNote = 'Escribe su precio de coste en €/g.';
    const cost = price !== null && grams !== null ? price * grams : null;
    return { ...a, item: m.item, candidates: m.candidates, grams, price, manual, cost, note: [note, priceNote].filter(Boolean).join(' ') };
  });
  const named = acts.filter((a) => a.name);
  if (!named.length) warn.push('Sin principios activos: una fórmula solo con excipientes no es facturable (punto 3.6 del Anexo 3).');
  const outside = named.filter((a) => !a.item);
  if (outside.length) warn.push(`${outside.map((a) => a.name).join(', ')}: no ${outside.length === 1 ? 'figura' : 'figuran'} en la Tabla I. Se valora con el precio de coste que escribas; la fórmula solo es facturable al Servicio Madrileño de Salud con su autorización previa (punto 2).`);
  const changed = named.filter((a) => a.item && a.manual && Math.abs(a.eurg - a.item.eur_g) > 1e-9);
  if (changed.length) warn.push(`${changed.map((a) => `${a.item.nombre}: usas ${eurG(a.eurg)} en lugar de los ${eurG(a.item.eur_g)} de la Tabla I`).join('; ')}. En las recetas financiadas se aplica el precio de la Tabla I.`);
  if (named.length > 1) {
    const mono = named.filter((a) => a.item && /monof|sin asociar/.test(fold(a.item.comentario)) && !/asociad/.test(fold(a.item.comentario)));
    if (mono.length) warn.push(`${mono.map((a) => a.item.nombre).join(', ')}: la Tabla I lo admite solo como monofármaco.`);
  } else if (named.length === 1 && named[0].item && /^(solo|solamente) asociad/.test(fold(named[0].item.comentario))) {
    warn.push(`${named[0].item.nombre}: la Tabla I solo lo admite asociado a otros principios activos.`);
  }
  const aRaw = acts.reduce((sum, x) => sum + (x.cost || 0), 0);
  const actsPending = acts.some((x) => x.name && (x.cost === null));

  if (!qtyOk) return { ready: false, acts, warn, need: `Indica ${fee.kind === 'u' ? (inp.form === 'colirios' ? 'el número de envases' : 'el número de unidades') : 'los gramos o mililitros'} a elaborar.` };
  if (fee.kind === 'u' && !Number.isInteger(q)) warn.unshift('Las unidades deberían ser un número entero.');

  // c) honorarios
  const th = FEE_THRESHOLD[fee.kind];
  const billed = Math.min(q, fee.max);
  if (q > fee.max) warn.unshift(`Máximo dispensable en ${fee.label.toLocaleLowerCase('es')}: ${fmtNum(fee.max)} ${unitWord}. No se abonan cantidades superiores; los honorarios se calculan sobre ${fmtNum(fee.max)}.`);
  const cRaw = P * fee.base + (billed > th ? (billed - th) * fee.extra * P : 0);
  const cDetail = billed > th
    ? `P × ${fee.base} + (${fmtNum(billed)} − ${th}) × ${fmtNum(fee.extra)} P = ${eur4(P * fee.base)} + ${eur4((billed - th) * fee.extra * P)}`
    : `P × ${fee.base} (hasta ${th} ${fee.kind === 'u' ? 'unidades' : 'g o ml'})`;

  // b) excipiente
  const ex = EXCIPIENTS[inp.excipient];
  let bRaw = 0; let bDetail = 'Sin excipiente de la Tabla II'; let excAuto = null;
  if (ex) {
    excAuto = ex.per === 'ud' ? (fee.kind === 'u' ? q : null) : total;
    const base = isNum(inp.exc_qty) && inp.exc_qty > 0 ? inp.exc_qty : excAuto;
    if (!base) {
      warn.push(`Indica la cantidad para el excipiente (${ex.per === 'ud' ? 'unidades' : ex.basis}).`);
      bDetail = 'Falta la cantidad';
    } else if (ex.per === 'ud') {
      bRaw = base * ex.price; bDetail = `${fmtNum(base)} ud. × ${money(ex.price)}`;
    } else {
      const blocks = Math.ceil(base / ex.per - 1e-9);
      bRaw = blocks * ex.price; bDetail = `${blocks} × ${money(ex.price)} (cada ${ex.per} ${ex.basis} o fracción; ${fmtNum(base)} ${ex.basis})`;
    }
  }

  // d) envase
  const ct = CONTAINERS[inp.container];
  const nC = isNum(inp.containers) && inp.containers > 0 ? inp.containers : 1;
  const dRaw = ct ? nC * ct.price : 0;
  const dDetail = ct ? `${fmtNum(nC)} × ${money(ct.price)} · ${ct.label.toLocaleLowerCase('es')}` : 'Sin envase';

  const a = round2(aRaw); const b = round2(bRaw); const c = round2(cRaw); const d = round2(dRaw);
  const subtotal = round2(a + b + c + d);
  const iva = round2((subtotal * pricing.iva) / 100);
  const totalPrice = round2(subtotal + iva);
  const aDetail = named.length ? acts.filter((x) => x.cost !== null).map((x) => `${(x.item ? x.item.nombre : x.name).split(/[=(]/)[0].trim()} ${eur4(x.cost)}`).join(' + ') || 'Falta la cantidad o el precio' : 'Sin principios activos';
  if (actsPending) warn.push('Hay principios activos sin precio calculado: revisa la cantidad y el precio en €/g.');
  const text = [
    `Precio principios activos: ${money(a)}`, `Precio de excipientes: ${money(b)}`, `Honorarios profesionales: ${money(c)}`, `Envase: ${money(d)}`,
    `Subtotal: ${money(subtotal)}`, `IVA: ${fmtNum(pricing.iva)} %`, `Total: ${money(totalPrice)}`,
  ].join('\n');
  return {
    ready: true, acts, warn, excAuto, fee, total,
    rows: [['a', 'Precio principios activos', a, aDetail], ['b', 'Precio de excipientes', b, bDetail], ['c', 'Honorarios profesionales', c, cDetail], ['d', 'Envase', d, dDetail]],
    a, b, c, d, subtotal, iva_pct: pricing.iva, iva, total_price: totalPrice, p_factor: P, text,
  };
}

/** Solo toca el DOM si cambia: así un toque en un botón no se pierde cuando el recálculo llega justo al soltar el campo. */
const RENDERED = new WeakMap();
function setHtml(el, html) {
  if (!el || RENDERED.get(el) === html) return;
  el.innerHTML = html;
  RENDERED.set(el, html);
}
function renderActInfo(x) {
  const info = $('[data-actinfo]', x.row);
  if (!info) return;
  const eurInput = $('[name="act_eurg"]', x.row);
  if (eurInput) eurInput.placeholder = x.item ? `Tabla I: ${fmtNum(x.item.eur_g)}` : 'Obligatorio';
  if (!x.name && x.value === null && x.eurg === null) { setHtml(info, ''); return; }
  const parts = [];
  if (x.item) {
    parts.push(`<span class="act-match">${esc(x.item.nombre)}</span> · Tabla I: ${esc(eurG(x.item.eur_g))}${x.item.via ? ` · ${esc(VIA_LABELS[x.item.via] || x.item.via)}` : ''}`);
  } else if (x.name) {
    parts.push('<span class="bad">No figura en la Tabla I.</span>');
    if (x.candidates.length) parts.push(`¿Es ${x.candidates.map((c) => `<button type="button" class="linkbtn" data-act="pickActive" data-name="${esc(c.nombre)}">${esc(c.nombre)}</button>`).join(' o ')}?`);
  }
  if (x.cost !== null) parts.push(`${esc(massTextShort(x.grams))} × ${esc(eurG(x.price))}${x.manual ? ' (precio escrito)' : ''} → <strong>${esc(eur4(x.cost))}</strong>`);
  if (x.note) parts.push(`<span class="warn-ink">${esc(x.note)}</span>`);
  if (x.item && x.item.comentario) parts.push(`<span class="act-cond">${esc(x.item.comentario)}</span>`);
  setHtml(info, parts.join('<br>'));
}
const massTextShort = (g) => (g >= 1 ? `${fmtNum(round6(g))} g` : g >= 0.001 ? `${fmtNum(round6(g * 1000))} mg` : `${fmtNum(round6(g * 1e6))} µg`);

function applyFormDefaults(box, initial) {
  const form = $('[name="fee_form"]', box).value;
  const fee = FEE_FORMS[form];
  if (!fee) return;
  $('[data-qlabel]', box).textContent = form === 'colirios' ? 'Envases' : fee.kind === 'u' ? 'Unidades' : 'Gramos o mililitros';
  $('[data-qhint]', box).textContent = `Máximo ${fmtNum(fee.max)}. Si la receta no la indica: ${fmtNum(defaultQty(form))}${form === 'colirios' ? ' envase de 10 ml' : ''}.`;
  $('[name="qty"]', box).placeholder = String(defaultQty(form));
  $('[data-volbox]', box).hidden = fee.kind === 'g';
  if (initial) return;
  const exc = $('[name="excipient"]', box);
  const cont = $('[name="container"]', box);
  if (!exc.dataset.touched) exc.value = DEFAULT_EXCIPIENT[form] || '';
  if (!cont.dataset.touched) cont.value = DEFAULT_CONTAINER[form] || '';
}

async function recalcPrice(box) {
  let data;
  try { data = await loadPriceData(); } catch { return; }
  const inp = readPriceInputs(box);
  const r = valuate(inp, data, state.settings ? state.settings.pricing : DEFAULT_SETTINGS.pricing);
  r.acts.forEach(renderActInfo);
  $$('[data-rows="act"] [data-comp]', box).forEach((row) => { if (!r.acts.some((x) => x.row === row)) setHtml($('[data-actinfo]', row), ''); });
  const excQty = $('[name="exc_qty"]', box);
  const ex = EXCIPIENTS[inp.excipient];
  excQty.placeholder = isNum(r.excAuto) && r.excAuto > 0 ? fmtNum(r.excAuto) : '';
  const excUnit = ex && ex.per === 'ud' ? 'unidades' : ex ? ex.basis : '';
  $('[data-exchint]', box).textContent = ex ? (isNum(r.excAuto) && r.excAuto > 0 ? `Si lo dejas vacío: ${fmtNum(r.excAuto)} ${excUnit}.` : `En ${excUnit}.`) : '';
  const out = $('[data-out="price"]', box);
  const warnHtml = r.warn.length ? `<div class="msg warn stack-tight">${r.warn.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : '';
  if (!r.ready) {
    state.valuation = null;
    setHtml(out, `<p class="hint">${esc(r.need)}</p>${warnHtml}`);
    return;
  }
  const saveId = box.dataset.save;
  state.valuation = {
    ...r,
    inputs: {
      form: inp.form, qty: inp.qty, vol: isNum(inp.vol) ? inp.vol : null,
      actives: inp.actives.filter((a) => a.name || isNum(a.value)).map((a) => ({ name: a.name.slice(0, 160), value: isNum(a.value) ? a.value : null, unit: ACT_UNITS[a.unit] ? a.unit : 'g', eurg: isNum(a.eurg) && a.eurg > 0 ? a.eurg : null })),
      excipient: EXCIPIENTS[inp.excipient] ? inp.excipient : '', exc_qty: isNum(inp.exc_qty) ? inp.exc_qty : null,
      container: CONTAINERS[inp.container] ? inp.container : '', containers: isNum(inp.containers) ? inp.containers : null,
    },
  };
  setHtml(out, `<div class="panel price-out">
    <ul class="list breakdown">${r.rows.map(([k, label, amount, detail]) => `<li><div class="row"><div class="row-main"><strong>${esc(label)} <span class="code">«${k}»</span></strong><span class="sub"><span>${esc(detail)}</span></span></div><b class="num">${money(amount)}</b></div></li>`).join('')}
      <li class="subtotal"><div class="row"><span class="row-main">Subtotal «X»</span><b class="num">${money(r.subtotal)}</b></div></li>
      <li><div class="row"><span class="row-main">IVA «e» ${esc(fmtNum(r.iva_pct))} %</span><b class="num">${money(r.iva)}</b></div></li>
    </ul>
    <div class="display big-result total-display"><span class="v">Total ${money(r.total_price)}</span></div>
    <div class="actions">
      <button type="button" class="btn secondary" data-act="copyValuation">Copiar desglose</button>
      ${saveId ? `<button type="button" class="btn" data-act="saveValuation" data-id="${esc(saveId)}">Guardar en la elaboración</button>` : ''}
    </div>
  </div>${warnHtml}`);
}

INPUT_HOOKS.push((t) => {
  const box = t.closest && t.closest('[data-pricecalc]');
  if (box) recalcPrice(box).catch((err) => console.error(err));
});
CHANGE_HOOKS.push((t) => {
  const box = t.closest && t.closest('[data-pricecalc]');
  if (!box) return;
  if (t.name === 'excipient' || t.name === 'container') t.dataset.touched = '1';
  if (t.name === 'fee_form') applyFormDefaults(box, false);
  recalcPrice(box).catch((err) => console.error(err));
});
AFTER_RENDER.push(() => {
  const box = $('[data-pricecalc]');
  if (!box) return;
  applyFormDefaults(box, true);
  recalcPrice(box).catch((err) => console.error(err));
});

Object.assign(ACTIONS, {
  pickActive: (el) => {
    const row = el.closest('[data-comp]');
    const input = row && $('[name="act_name"]', row);
    if (!input) return;
    input.value = el.dataset.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    $('[name="act_value"]', row).focus();
  },
  copyValuation: async () => {
    const v = state.valuation;
    if (!v || !v.ready) return;
    try {
      await navigator.clipboard.writeText(v.text);
      toast('Desglose copiado. Pégalo donde lo necesites.');
    } catch {
      toast('No se pudo copiar. Anota el desglose de la pantalla.');
    }
  },
  saveValuation: async (el) => {
    const v = state.valuation;
    if (!v || !v.ready) { toast('Completa la valoración antes de guardarla.'); return; }
    const rec = await getOne('production', el.dataset.id);
    if (!rec) { toast('Esta elaboración ya no existe.'); return; }
    if (rec.status === 'rechazada') { toast('Esta elaboración está rechazada.'); return; }
    rec.valuation = {
      a: v.a, b: v.b, c: v.c, d: v.d, subtotal: v.subtotal, iva_pct: v.iva_pct, iva: v.iva, total: v.total_price,
      p_factor: v.p_factor, text: v.text, inputs: v.inputs, date: todayIso(), by: state.profile.name,
    };
    await save('production', rec, 'valoracion_precio', `${rec.lot || rec.record_code} ${rec.formula_name}: ${money(v.total_price)}`);
    toast(`Precio guardado: ${money(v.total_price)}.`);
    location.hash = `#elaboraciones--${rec.uuid}`;
  },
});
