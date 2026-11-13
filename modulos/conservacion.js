'use strict';
/* FARMA·LAB móvil · Conservación de registros.
   Las elaboraciones se conservan 1 año después de su caducidad (2 si contienen psicótropos,
   5 si contienen estupefacientes o son de uso veterinario); las fichas de materias primas y de
   material de acondicionamiento, 1 año después de su caducidad. Cumplido el plazo se borran solas,
   siempre con un aviso visible al menos 30 días antes. Los plazos se cambian en Ajustes. */

ROUTES.conservacion = () => viewRetention();

/** Clase de conservación de las elaboraciones de una fórmula. */
const RETENTION_CLASSES = {
  general: 'General',
  psicotropo: 'Contiene psicótropos',
  estupefaciente: 'Contiene estupefacientes',
  veterinaria: 'Uso veterinario',
};
const RETENTION_STORES = { production: 'Elaboración', material: 'Materia prima', packaging: 'Acondicionamiento' };
const RETENTION_ROUTE = { production: 'elaboraciones', material: 'materias', packaging: 'envases' };

const addYears = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y + n, m - 1, d);
  if (t.getMonth() !== m - 1) t.setDate(0);   // 29 de febrero → 28 de febrero
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
const plusDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
const maxDay = (a, b) => (a > b ? a : b);
const yearsText = (n) => `${n} ${n === 1 ? 'año' : 'años'}`;

function productionRetentionClass(p, formulas) {
  const f = p.formula_uuid ? formulas.get(p.formula_uuid) : null;
  const c = p.retention_class || (f && f.retention_class);
  return RETENTION_CLASSES[c] ? c : 'general';
}
/** Fecha desde la que se cuenta el plazo de una elaboración: su caducidad (o, si no la tiene, la fecha de elaboración). */
function productionBase(p) {
  if (!['elaborada', 'dispensada', 'rechazada'].includes(p.status)) return null;   // en proceso: no se borra
  if (isDay(p.expiry_date)) return { day: p.expiry_date, what: 'caducidad' };
  if (isDay(p.elaborated_date)) return { day: p.elaborated_date, what: 'elaboración' };
  if (isDay(p.decision_date)) return { day: p.decision_date, what: 'rechazo' };
  return { day: String(p.created_at || '').slice(0, 10), what: 'registro' };
}

/**
 * Plan de conservación: para cada registro, cuándo se borra y por qué.
 * Un lote de materia prima o de envase se conserva, como mínimo, mientras se conserve alguna elaboración que lo usó.
 */
async function retentionPlan() {
  const s = await loadSettings();
  const r = s.retention;
  const [prods, mats, packs, formulas] = await Promise.all(['production', 'material', 'packaging', 'formula'].map(getAll));
  const fmap = new Map(formulas.map((f) => [f.uuid, f]));
  const items = [];
  const prodDelete = new Map();   // uuid de elaboración → fecha de borrado (null = no se borra)
  for (const p of prods) {
    const cls = productionRetentionClass(p, fmap);
    const years = r.production[cls];
    const base = productionBase(p);
    const deleteOn = base && /^\d{4}-\d{2}-\d{2}$/.test(base.day) ? addYears(base.day, years) : null;
    prodDelete.set(p.uuid, deleteOn);
    items.push({
      store: 'production', rec: p, deleteOn, hold: Boolean(p.retention_hold),
      title: `${p.lot || p.record_code} · ${p.formula_name}`,
      rule: base ? `${yearsText(years)} desde la ${base.what} (${fmtDay(base.day)})${cls !== 'general' ? ` · ${RETENTION_CLASSES[cls].toLocaleLowerCase('es')}` : ''}` : 'En proceso: no se borra',
    });
  }
  const usedBy = (rec, store) => prods.filter((p) => (store === 'material'
    ? (p.weighings || []).some((w) => w.material_uuid === rec.uuid)
    : (p.packaging_used || []).some((u) => u.packaging_uuid === rec.uuid)));
  for (const [store, list] of [['material', mats], ['packaging', packs]]) {
    const years = r[store];
    for (const rec of list) {
      let deleteOn = isDay(rec.expiry) ? addYears(rec.expiry, years) : null;
      let rule = isDay(rec.expiry) ? `${yearsText(years)} desde la caducidad (${fmtDay(rec.expiry)})` : 'Sin fecha de caducidad: no se borra';
      if (deleteOn) {
        for (const p of usedBy(rec, store)) {
          const pd = prodDelete.get(p.uuid);
          if (!pd) { deleteOn = null; rule = `Se conserva mientras se conserve la elaboración ${p.lot || p.record_code}, que lo usó`; break; }
          if (pd > deleteOn) { deleteOn = pd; rule = `Se conserva hasta que se borre la elaboración ${p.lot || p.record_code}, que lo usó`; }
        }
      }
      items.push({ store, rec, deleteOn, hold: Boolean(rec.retention_hold), title: `${rec.name}${rec.lot ? ` · lote ${rec.lot}` : ''}`, rule });
    }
  }
  return { items, settings: r };
}

/** Avisos ya mostrados: uuid → primer día en que se avisó. Se guardan en este dispositivo. */
async function retentionNotices() { return (await metaGet('retentionNotices')) || {}; }

/**
 * Registra los avisos nuevos y devuelve lo que vence en los próximos días de aviso.
 * Un registro solo se borra cuando ha pasado su fecha y lleva avisado al menos esos días,
 * aunque la fecha ya hubiera pasado al aparecer (por ejemplo, al importar una copia antigua).
 */
async function retentionStatus() {
  const { items, settings } = await retentionPlan();
  const notices = await retentionNotices();
  const today = todayIso();
  const warnFrom = plusDays(today, settings.notice_days);
  let changed = false;
  const upcoming = [];
  for (const it of items) {
    if (!it.deleteOn || it.hold) continue;
    if (it.deleteOn <= warnFrom) {
      if (!notices[it.rec.uuid]) { notices[it.rec.uuid] = today; changed = true; }
      it.noticeSince = notices[it.rec.uuid];
      it.effectiveOn = maxDay(it.deleteOn, plusDays(it.noticeSince, settings.notice_days));
      upcoming.push(it);
    }
  }
  if (changed) await metaSet('retentionNotices', notices);
  upcoming.sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn));
  return { upcoming, settings, items };
}

/** Borra lo que ha cumplido su plazo (una vez al día, al desbloquear la app). */
async function runRetention({ force = false } = {}) {
  const s = await loadSettings();
  if (!s.retention.enabled) return 0;
  const today = todayIso();
  if (!force && (await metaGet('retentionRun')) === today) return 0;
  const { upcoming } = await retentionStatus();
  const due = upcoming.filter((it) => it.effectiveOn <= today);
  const order = { production: 0, material: 1, packaging: 2 };
  due.sort((a, b) => order[a.store] - order[b.store]);
  const stamp = nowIso();
  for (const it of due) {
    const docs = await docsOf(it.rec.uuid);
    const base = it.store === 'production' ? `${it.rec.lot || it.rec.record_code} ${it.rec.formula_name}` : `${it.rec.name}${it.rec.lot ? ` / lote ${it.rec.lot}` : ''}`;
    await tx([it.store, FILE_STORE, 'audit', 'meta'], 'readwrite', (t) => {
      t.objectStore(it.store).delete(it.rec.uuid);
      docs.forEach((d) => t.objectStore(FILE_STORE).delete(d.uuid));
      t.objectStore('audit').put(auditEntry('borrado_conservacion', `${RETENTION_STORES[it.store]}: ${base} (${it.rule.replace(/ · .*/, '')}; ${docs.length ? `${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'}` : 'sin documentos'})`, stamp));
      t.objectStore('meta').put(stamp, 'lastChange');
    });
  }
  await metaSet('retentionRun', today);
  if (due.length) await metaSet('retentionLast', { at: stamp, count: due.length });
  return due.length;
}

AFTER_UNLOCK.push(async () => {
  const n = await runRetention();
  if (n) {
    toast(`Se ${n === 1 ? 'ha borrado 1 registro' : `han borrado ${n} registros`} por fin del plazo de conservación.`);
    await route();
    await updateAlertBadge();
  }
});

ALERT_SOURCES.push(async () => {
  const out = [];
  const { upcoming, settings } = await retentionStatus();
  if (upcoming.length && settings.enabled) {
    const first = upcoming[0];
    out.push({
      tone: 'amber', kind: 'Conservación',
      title: `${upcoming.length} ${upcoming.length === 1 ? 'registro se borrará' : 'registros se borrarán'} por fin del plazo`,
      text: `El primero, ${first.title}, el ${fmtDay(first.effectiveOn)}. Revísalos antes si quieres conservar alguno.`,
      href: '#conservacion',
    });
  }
  const last = await metaGet('retentionLast');
  if (last && Date.now() - Date.parse(last.at) < 7 * 864e5) {
    out.push({ tone: 'amber', kind: 'Conservación', title: `${last.count} ${last.count === 1 ? 'registro borrado' : 'registros borrados'} el ${fmtStamp(last.at)}`, text: 'Por fin del plazo de conservación. El detalle está en el registro de actividad.', href: '#conservacion' });
  }
  return out;
});

/** Línea de conservación para la ficha de un registro. */
async function retentionFact(store, rec) {
  const { items } = await retentionPlan();
  const it = items.find((x) => x.store === store && x.rec.uuid === rec.uuid);
  if (!it) return null;
  const notices = await retentionNotices();
  const s = await loadSettings();
  let when;
  if (it.hold) when = '<strong>Se conserva</strong> (marcado para no borrar)';
  else if (!it.deleteOn) when = esc(it.rule);
  else {
    const eff = notices[rec.uuid] ? maxDay(it.deleteOn, plusDays(notices[rec.uuid], s.retention.notice_days)) : it.deleteOn;
    when = `${s.retention.enabled ? 'Se borrará' : 'Plazo cumplido'} el ${fmtDay(eff)} · ${esc(it.rule)}`;
  }
  return ['Conservación', `${when} <button class="linkbtn" data-act="toggleRetentionHold" data-store="${store}" data-id="${esc(rec.uuid)}">${it.hold ? 'Permitir el borrado' : 'No borrar'}</button>`];
}

async function viewRetention() {
  const { upcoming, settings, items } = await retentionStatus();
  const held = items.filter((it) => it.hold);
  const audit = (await getAll('audit')).filter((a) => a.action === 'borrado_conservacion').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30);
  const row = (it, extra) => `<li><div class="row"><a class="row-main" href="#${RETENTION_ROUTE[it.store]}--${esc(it.rec.uuid)}"><span class="kind">${esc(RETENTION_STORES[it.store])}</span><strong>${esc(it.title)}</strong><span class="sub"><span>${extra}</span><span>${esc(it.rule)}</span></span></a><button class="btn secondary small" data-act="toggleRetentionHold" data-store="${it.store}" data-id="${esc(it.rec.uuid)}">${it.hold ? 'Permitir borrado' : 'No borrar'}</button></div></li>`;
  const r = settings;
  return `<p class="hint intro">Plazos: elaboraciones ${yearsText(r.production.general)} desde su caducidad (psicótropos ${yearsText(r.production.psicotropo)}, estupefacientes ${yearsText(r.production.estupefaciente)}, uso veterinario ${yearsText(r.production.veterinaria)}); materias primas ${yearsText(r.material)} y material de acondicionamiento ${yearsText(r.packaging)} desde su caducidad. Se avisa ${r.notice_days} días antes. Se cambian en <a href="#ajustes">Ajustes</a>.</p>
    ${r.enabled ? '' : '<p class="msg warn">El borrado automático está desactivado en Ajustes: solo se muestran los avisos.</p>'}
    <section><h2>Se borrarán pronto</h2>
      ${upcoming.length ? `<ul class="list">${upcoming.map((it) => row(it, `Se borrará el ${fmtDay(it.effectiveOn)}`)).join('')}</ul>` : '<p class="hint">Nada se borrará en los próximos días.</p>'}
      <p class="hint">Antes de que se borren, exporta una copia o genera sus fichas en PDF si quieres guardarlas fuera de la app. Con «No borrar», el registro se conserva hasta que lo vuelvas a permitir.</p>
    </section>
    ${held.length ? `<section><h2>Marcados para no borrar</h2><ul class="list">${held.map((it) => row(it, 'Se conserva')).join('')}</ul></section>` : ''}
    <section><h2>Borrados por fin del plazo</h2>
      ${audit.length ? `<ul class="list">${audit.map((a) => `<li><div class="row"><span class="row-main"><strong>${esc(a.detail)}</strong><span class="sub"><span>${esc(fmtStamp(a.created_at))}</span></span></span></div></li>`).join('')}</ul>` : '<p class="hint">Todavía no se ha borrado nada.</p>'}
    </section>`;
}

Object.assign(ACTIONS, {
  toggleRetentionHold: async (el) => {
    const { store, id } = el.dataset;
    if (!RETENTION_STORES[store]) return;
    const rec = await getOne(store, id);
    if (!rec) return;
    const name = store === 'production' ? `${rec.lot || rec.record_code} ${rec.formula_name}` : `${rec.name}${rec.lot ? ` / lote ${rec.lot}` : ''}`;
    if (rec.retention_hold) delete rec.retention_hold; else rec.retention_hold = true;
    await save(store, rec, rec.retention_hold ? 'conservar_registro' : 'permitir_borrado', name);
    toast(rec.retention_hold ? 'No se borrará automáticamente.' : 'Se borrará al cumplir su plazo de conservación.');
    await route();
    await updateAlertBadge();
  },
});

/** Opciones de clase con los años vigentes, para el formulario de fórmulas. */
const RETENTION_LABELS = () => {
  const r = ((state.settings || DEFAULT_SETTINGS).retention) || DEFAULT_SETTINGS.retention;
  return Object.fromEntries(Object.entries(RETENTION_CLASSES).map(([k, v]) => [k, `${v} (${yearsText(r.production[k])})`]));
};
