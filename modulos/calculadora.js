'use strict';
/* FARMA·LAB móvil · Calculadora: cantidad a pesar, conversiones de unidades y diluciones. */

ROUTES.calculadora = () => viewCalculator();
const CALC_TABS = [['#calculadora', 'Cálculos'], ['#valoracion', 'Valoración'], ['#valoracion--tasado', 'Precio tasado']];

const CONC_TYPES = {
  pp: { label: '% m/m (p/p)', total: 'g', hint: 'gramos de principio activo por 100 g de preparado' },
  pv: { label: '% m/v (p/v)', total: 'ml', hint: 'gramos de principio activo por 100 ml de preparado' },
  vv: { label: '% v/v', total: 'ml', hint: 'mililitros de principio activo por 100 ml de preparado' },
  mgg: { label: 'mg/g', total: 'g', hint: 'miligramos por gramo de preparado' },
  mgml: { label: 'mg/ml', total: 'ml', hint: 'miligramos por mililitro de preparado' },
  ppm: { label: 'ppm (m/m)', total: 'g', hint: 'partes por millón en masa' },
  ratio: { label: 'Proporción 1:X', total: 'g o ml', hint: '1 g en X g o en X ml de preparado' },
  dose: { label: 'mg por unidad', total: 'unidades', hint: 'cápsulas, sobres, óvulos...' },
};

function viewCalculator() {
  return `${segmented(CALC_TABS, '#calculadora')}
  <section><h2>Cantidad de principio activo a pesar</h2>
  <div class="panel form calc" data-calc="dose">
    ${field('Tipo de concentración', `<select name="type">${options(Object.keys(CONC_TYPES), 'pp', Object.fromEntries(Object.entries(CONC_TYPES).map(([k, v]) => [k, v.label])))}</select>`)}
    <div class="grid2">
      ${field('Concentración', decimal('conc', 'placeholder="2"'))}
      ${field('Cantidad final', decimal('total', 'placeholder="100"'), '<span data-total-unit>g</span>')}
    </div>
    <div class="grid2">
      ${field('Riqueza de la materia prima (%)', decimal('purity', 'value="100"'))}
      ${field('Exceso por mermas (%)', decimal('excess', 'value="0"'))}
    </div>
    <div class="grid2">
      ${field('Factor de equivalencia', decimal('factor', 'value="1"'), 'Sal/base o hidratación.')}
      ${field('Densidad (g/ml)', decimal('density', 'placeholder="Opcional"'), 'Para pasar volumen a masa.')}
    </div>
    <details class="sub-calc"><summary>Calcular el factor con los pesos moleculares</summary>
      <div class="grid2">
        ${field('PM de la sal o forma usada', decimal('pm_salt'))}
        ${field('PM de la base o forma prescrita', decimal('pm_base'))}
      </div>
    </details>
    <div class="result" data-out="dose"><p class="hint">Escribe la concentración y la cantidad final.</p></div>
  </div></section>

  <section><h2>Conversión de unidades</h2>
  <div class="panel form calc" data-calc="units">
    <div class="grid2">
      ${field('Valor', decimal('value', 'placeholder="1,5"'))}
      ${field('Unidad', `<select name="unit">${options(['kg', 'g', 'mg', 'µg', 'l', 'ml', 'µl'], 'g')}</select>`)}
    </div>
    <div class="result" data-out="units"></div>
  </div></section>

  <section><h2>Dilución (C1 · V1 = C2 · V2)</h2>
  <div class="panel form calc" data-calc="dilution">
    <div class="grid2">
      ${field('Concentración de partida', decimal('c1', 'placeholder="70"'))}
      ${field('Concentración deseada', decimal('c2', 'placeholder="10"'))}
    </div>
    ${field('Cantidad final que necesitas (ml o g)', decimal('v2', 'placeholder="100"'), 'Las dos concentraciones en la misma unidad (%, mg/ml...).')}
    <div class="result" data-out="dilution"></div>
  </div></section>

  <section><h2>Equivalencias rápidas</h2>
  <div class="panel form calc" data-calc="equiv">
    <div class="grid2">
      ${field('Valor', decimal('value', 'placeholder="0,1"'))}
      ${field('Expresado como', `<select name="unit">${options(['pct', 'mgml', 'ratio'], 'pct', { pct: '% m/v', mgml: 'mg/ml', ratio: '1:X (X)' })}</select>`)}
    </div>
    <div class="result" data-out="equiv"></div>
  </div></section>
  <p class="hint">Resultados orientativos para agilizar el cálculo. Comprueba siempre la fórmula y las cantidades antes de pesar.</p>`;
}

const num = (box, name) => {
  const el = $(`[name="${name}"]`, box);
  if (!el) return null;
  try { return parseNum(el.value, name); } catch { return NaN; }
};
const show = (n, max = 4) => (isNum(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: max, useGrouping: false }) : '—');
const massText = (g) => (g >= 1 ? `${show(g, 4)} g` : g >= 0.001 ? `${show(g * 1000, 3)} mg (${show(g, 6)} g)` : `${show(g * 1e6, 2)} µg`);

function calcDose(box) {
  const type = $('[name="type"]', box).value;
  const meta = CONC_TYPES[type];
  $('[data-total-unit]', box).textContent = meta.total;
  const out = $('[data-out="dose"]', box);
  const c = num(box, 'conc'); const total = num(box, 'total');
  const purity = num(box, 'purity') ?? 100; const excess = num(box, 'excess') ?? 0;
  const pmSalt = num(box, 'pm_salt'); const pmBase = num(box, 'pm_base');
  const factorEl = $('[name="factor"]', box);
  if (isNum(pmSalt) && isNum(pmBase) && pmSalt > 0 && pmBase > 0) factorEl.value = show(pmSalt / pmBase, 4);
  const factor = num(box, 'factor') ?? 1; const density = num(box, 'density');
  if (![c, total].every((v) => isNum(v) && v > 0)) { out.innerHTML = '<p class="hint">Escribe la concentración y la cantidad final.</p>'; return; }
  if (![purity, excess, factor].every(isNum) || purity <= 0 || purity > 100 || factor <= 0 || excess < 0) { out.innerHTML = '<p class="bad">Revisa la riqueza (1-100 %), el factor y el exceso.</p>'; return; }
  let grams = null; let ml = null; let base = '';
  switch (type) {
    case 'pp': case 'pv': grams = (c / 100) * total; base = `${show(c)} % × ${show(total)} ${meta.total} ÷ 100`; break;
    case 'vv': ml = (c / 100) * total; base = `${show(c)} % × ${show(total)} ml ÷ 100`; break;
    case 'mgg': case 'mgml': grams = (c * total) / 1000; base = `${show(c)} mg × ${show(total)} ${meta.total}`; break;
    case 'ppm': grams = (c * total) / 1e6; base = `${show(c)} ppm × ${show(total)} g ÷ 1 000 000`; break;
    case 'ratio': grams = total / c; base = `${show(total)} ÷ ${show(c)}`; break;
    case 'dose': grams = (c * total) / 1000; base = `${show(c)} mg × ${show(total)} unidades`; break;
    default: break;
  }
  const k = (factor / (purity / 100)) * (1 + excess / 100);
  const corr = [factor !== 1 ? `× factor ${show(factor)}` : '', purity !== 100 ? `÷ riqueza ${show(purity)} %` : '', excess ? `+ ${show(excess)} % de exceso` : ''].filter(Boolean).join(' ');
  let main; let secondary = '';
  if (ml !== null) {
    const v = ml * k;
    main = `Medir ${show(v, 4)} ml`;
    secondary = isNum(density) && density > 0 ? `Equivale a pesar ${massText(v * density)} (densidad ${show(density)} g/ml).` : 'Indica la densidad si prefieres pesarlo.';
  } else {
    const g = grams * k;
    main = `Pesar ${massText(g)}`;
    if (type === 'dose') secondary = `${show(c * k, 3)} mg por unidad ya corregidos.`;
    if (isNum(density) && density > 0) secondary += ` Si es líquido: ${show(g / density, 4)} ml.`;
  }
  out.innerHTML = `<div class="display big-result"><span class="v">${esc(main)}</span></div>
    ${secondary ? `<p class="hint">${esc(secondary)}</p>` : ''}
    <p class="hint">Cálculo: ${esc(base)}${corr ? ` ${esc(corr)}` : ''}.</p>`;
}

function calcUnits(box) {
  const v = num(box, 'value'); const u = $('[name="unit"]', box).value;
  const out = $('[data-out="units"]', box);
  if (!isNum(v)) { out.innerHTML = ''; return; }
  const targets = UNIT_FACTORS[u][0] === 'm' ? ['kg', 'g', 'mg', 'µg'] : ['l', 'ml', 'µl'];
  out.innerHTML = `<ul class="list">${targets.map((t) => `<li><div class="row"><span class="row-main">${t}</span><b class="num">${show((v * UNIT_FACTORS[u][1]) / UNIT_FACTORS[t][1], 9)}</b></div></li>`).join('')}</ul>`;
}

function calcDilution(box) {
  const c1 = num(box, 'c1'); const c2 = num(box, 'c2'); const v2 = num(box, 'v2');
  const out = $('[data-out="dilution"]', box);
  if (![c1, c2, v2].every((x) => isNum(x) && x > 0)) { out.innerHTML = ''; return; }
  if (c2 >= c1) { out.innerHTML = '<p class="bad">La concentración deseada debe ser menor que la de partida.</p>'; return; }
  const v1 = (c2 * v2) / c1;
  out.innerHTML = `<div class="display big-result"><span class="v">${esc(`Toma ${show(v1, 4)} de la solución de partida`)}</span></div>
    <p class="hint">Completa con ${esc(show(v2 - v1, 4))} de diluyente hasta ${esc(show(v2))}.</p>`;
}

function calcEquiv(box) {
  const v = num(box, 'value'); const u = $('[name="unit"]', box).value;
  const out = $('[data-out="equiv"]', box);
  if (!isNum(v) || v <= 0) { out.innerHTML = ''; return; }
  const pct = u === 'pct' ? v : u === 'mgml' ? v / 10 : 100 / v;
  out.innerHTML = `<ul class="list">
    <li><div class="row"><span class="row-main">% m/v</span><b class="num">${show(pct, 6)} %</b></div></li>
    <li><div class="row"><span class="row-main">mg/ml</span><b class="num">${show(pct * 10, 6)}</b></div></li>
    <li><div class="row"><span class="row-main">Proporción</span><b class="num">1:${show(100 / pct, 2)}</b></div></li>
    <li><div class="row"><span class="row-main">ppm (m/v)</span><b class="num">${show(pct * 10000, 2)}</b></div></li>
  </ul>`;
}

const CALCS = { dose: calcDose, units: calcUnits, dilution: calcDilution, equiv: calcEquiv };
const runCalc = (t) => { const box = t.closest('[data-calc]'); if (box) CALCS[box.dataset.calc](box); };
INPUT_HOOKS.push(runCalc);
CHANGE_HOOKS.push(runCalc);
AFTER_RENDER.push(() => $$('[data-calc]').forEach((box) => CALCS[box.dataset.calc](box)));
