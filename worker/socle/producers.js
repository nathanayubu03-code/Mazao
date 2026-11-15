// Producteurs, parcelles et consentement (application agent et coordination).
import { fail, json, now, uuid, readJson, normPhone, maskPhone, clampStr } from './util.js';
import { checkGeometry } from './geo.js';
import { sendTemplate, handleInbound } from './messaging.js';
import { audit } from './audit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function agentPoints(env, user) {
  const r = await env.DB.prepare(`SELECT collection_point_id FROM agent_assignments WHERE agent_id = ? AND deleted_at IS NULL
    AND (start_date IS NULL OR start_date <= date('now')) AND (end_date IS NULL OR end_date >= date('now'))`).bind(user.id).all();
  return r.results.map(x => x.collection_point_id);
}

// Vérifie qu'un utilisateur a le droit de voir ou modifier ce producteur
async function scoped(env, user, id) {
  const p = await env.DB.prepare('SELECT * FROM producers WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if (!p) fail(404, 'Producteur introuvable');
  if (user.role === 'agent') {
    const pts = await agentPoints(env, user);
    if (p.agent_id !== user.id && !pts.includes(p.collection_point_id)) fail(403, 'Producteur hors de vos points de collecte');
  } else if (!['coordination', 'admin'].includes(user.role)) fail(403, 'Accès refusé');
  return p;
}

// Vue selon le rôle : l'agent ne voit ni le téléphone complet ni les coordonnées GPS
function view(p, user, extra = {}) {
  const full = ['coordination', 'admin'].includes(user.role);
  const base = { id: p.id, code: p.code, full_name: p.full_name, sex: p.sex, birth_year: p.birth_year, lang: p.lang, momo_operator: p.momo_operator,
    village_id: p.village_id, collection_point_id: p.collection_point_id, consent_status: p.consent_status, consent_at: p.consent_at,
    status: p.status, is_demo: !!p.is_demo, created_at: p.created_at, phone_masked: maskPhone(p.phone), ...extra };
  if (full) Object.assign(base, { phone: p.phone, household_size: p.household_size, female_headed: p.female_headed, voter_last4: p.voter_last4, agent_id: p.agent_id });
  return base;
}

export async function routeProducers(env, req, path, user) {
  const method = req.method;
  const url = new URL(req.url);
  const m = path.match(/^\/api\/producers(?:\/([^/]+))?(?:\/([a-z]+))?(?:\/([a-z]+))?$/);
  if (!m) fail(404, 'Route inconnue');
  const [, id, sub, sub2] = m;

  if (method === 'GET' && !id) {
    const where = ["p.deleted_at IS NULL", "p.status = 'active'"], args = [];
    if (user.role === 'agent') {
      const pts = await agentPoints(env, user);
      where.push(`(p.agent_id = ? ${pts.length ? `OR p.collection_point_id IN (${pts.map(() => '?').join(',')})` : ''})`);
      args.push(user.id, ...pts);
    } else if (!['coordination', 'admin'].includes(user.role)) fail(403, 'Accès refusé');
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      const ph = normPhone(q);
      if (ph) { where.push('p.phone = ?'); args.push(ph); }
      else { where.push('(p.full_name LIKE ? OR p.code LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
    }
    for (const f of ['consent_status', 'collection_point_id', 'village_id', 'sex']) {
      const v = url.searchParams.get(f); if (v) { where.push('p.' + f + ' = ?'); args.push(v); }
    }
    const rows = await env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM plots pl WHERE pl.producer_id = p.id AND pl.deleted_at IS NULL) AS plot_count,
      (SELECT GROUP_CONCAT(commodity_id) FROM producer_commodities pc WHERE pc.producer_id = p.id) AS commodity_ids
      FROM producers p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 1000`).bind(...args).all();
    return json({ rows: rows.results.map(p => view(p, user, { plot_count: p.plot_count, commodity_ids: (p.commodity_ids || '').split(',').filter(Boolean) })) });
  }

  if (method === 'POST' && !id) return createProducer(env, req, user);

  if (method === 'GET' && id && !sub) {
    const p = await scoped(env, user, id);
    const full = ['coordination', 'admin'].includes(user.role);
    const plots = (await env.DB.prepare('SELECT * FROM plots WHERE producer_id = ? AND deleted_at IS NULL ORDER BY captured_at DESC').bind(id).all()).results
      .map(pl => ({ id: pl.id, commodity_id: pl.commodity_id, declared_area_ha: pl.declared_area_ha, geometry_type: pl.geometry_type, computed_area_ha: pl.computed_area_ha,
        captured_at: pl.captured_at, gps_accuracy_m: pl.gps_accuracy_m, method: pl.method, ...(full ? { geometry: JSON.parse(pl.geometry) } : {}) }));
    const baseline = await env.DB.prepare('SELECT * FROM baselines WHERE producer_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').bind(id).first();
    const commodities = (await env.DB.prepare('SELECT commodity_id FROM producer_commodities WHERE producer_id = ?').bind(id).all()).results.map(r => r.commodity_id);
    const consent = (await env.DB.prepare('SELECT event, channel, at FROM consent_events WHERE producer_id = ? ORDER BY at').bind(id).all()).results;
    return json({ producer: view(p, user, { commodity_ids: commodities }), plots, baseline: full ? baseline : null, consent });
  }

  if (method === 'POST' && id && sub === 'plots') {
    const p = await scoped(env, user, id);
    if (!['agent', 'coordination', 'admin'].includes(user.role)) fail(403, 'Accès refusé');
    return addPlot(env, req, user, p);
  }

  if (method === 'POST' && id && sub === 'consent' && sub2 === 'resend') {
    const p = await scoped(env, user, id);
    if (p.consent_status === 'granted') fail(400, 'Consentement déjà accordé');
    if (!p.phone) fail(400, 'Aucun téléphone enregistré');
    const recent = await env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE producer_id = ? AND template_code = 'CONSENT_REQUEST' AND created_at > ?").bind(id, new Date(Date.now() - 3600_000).toISOString()).first();
    if (recent.n >= 2) fail(429, 'Déjà renvoyé récemment. Réessayez dans une heure.');
    await sendTemplate(env, p, 'CONSENT_REQUEST');
    await env.DB.prepare('INSERT INTO consent_events (id, producer_id, event, channel, at, is_demo) VALUES (?, ?, ?, ?, ?, ?)').bind(uuid(), id, 'requested', 'sms', now(), p.is_demo).run();
    return json({ ok: true });
  }

  if (method === 'GET' && id && sub === 'messages') {
    if (!['coordination', 'admin'].includes(user.role)) fail(403, 'Accès refusé');
    const rows = await env.DB.prepare('SELECT * FROM messages WHERE producer_id = ? ORDER BY created_at').bind(id).all();
    return json({ rows: rows.results });
  }
  fail(404, 'Route inconnue');
}

async function createProducer(env, req, user) {
  if (user.role !== 'agent') fail(403, 'Seuls les agents inscrivent les producteurs');
  const b = await readJson(req);
  if (!UUID_RE.test(b.id || '')) fail(400, 'Identifiant UUID manquant');
  // Idempotence : un renvoi de la même inscription ne crée pas de doublon
  const already = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(b.id).first();
  if (already) return json({ producer: view(already, user), existing: true });
  if (!new RegExp('^' + user.agent_code + '-\\d{4}$').test(b.code || '')) fail(400, `Code producteur attendu : ${user.agent_code}-0001`);
  const name = clampStr(b.full_name, 120);
  if (!name || name.length < 3) fail(400, 'Nom complet obligatoire');
  if (!['F', 'M'].includes(b.sex)) fail(400, 'Sexe obligatoire');
  const year = Number(b.birth_year), thisYear = new Date().getFullYear();
  if (!(year >= thisYear - 100 && year <= thisYear - 14)) fail(400, 'Année de naissance invalide');
  const phone = normPhone(b.phone);
  if (!phone) fail(400, 'Téléphone invalide (+243 et 9 chiffres) : il sert au consentement et au paiement');
  if (!['MPESA', 'AIRTEL', 'ORANGE'].includes(b.momo_operator)) fail(400, 'Opérateur Mobile Money obligatoire');
  const pts = await agentPoints(env, user);
  if (!pts.includes(b.collection_point_id)) fail(403, 'Ce point de collecte ne vous est pas affecté');
  const v = await env.DB.prepare("SELECT id FROM zones WHERE id = ? AND level = 'village' AND deleted_at IS NULL").bind(b.village_id || '').first();
  if (!v) fail(400, 'Village obligatoire');
  const comms = Array.isArray(b.commodity_ids) ? b.commodity_ids : [];
  if (!comms.length) fail(400, 'Choisissez au moins une filière');
  const voter = b.voter_last4 ? String(b.voter_last4).replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase() : null;
  const dup = await env.DB.prepare("SELECT code, full_name FROM producers WHERE phone = ? AND deleted_at IS NULL AND status = 'active'").bind(phone).first();
  if (dup) fail(409, `Doublon possible : ${dup.full_name} (${dup.code}) a déjà ce téléphone`, { existing_code: dup.code });
  const codeTaken = await env.DB.prepare('SELECT id FROM producers WHERE code = ?').bind(b.code).first();
  if (codeTaken) fail(409, 'Code producteur déjà utilisé : resynchronisez l\'application', { code_conflict: true });
  const t = now();
  const st = [env.DB.prepare(`INSERT INTO producers (id, code, agent_id, full_name, sex, birth_year, phone, lang, momo_operator, voter_last4, village_id, collection_point_id,
      household_size, female_headed, consent_status, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .bind(b.id, b.code, user.id, name, b.sex, year, phone, b.lang === 'fr' ? 'fr' : 'sw', b.momo_operator, voter, b.village_id, b.collection_point_id,
      Number.isInteger(+b.household_size) && +b.household_size > 0 ? +b.household_size : null, b.female_headed ? 1 : 0, b.created_at || t, t, user.id)];
  for (const c of comms.slice(0, 5)) st.push(env.DB.prepare('INSERT OR IGNORE INTO producer_commodities (producer_id, commodity_id) SELECT ?, id FROM commodities WHERE id = ?').bind(b.id, String(c)));
  const bl = b.baseline || {};
  st.push(env.DB.prepare(`INSERT INTO baselines (id, producer_id, season, production_kg, income_cdf, last_price_amount, last_price_currency, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uuid(), b.id, clampStr(bl.season, 20), num(bl.production_kg), num(bl.income_cdf), num(bl.last_price_amount),
    ['CDF', 'USD'].includes(bl.last_price_currency) ? bl.last_price_currency : 'CDF', t, t, user.id));
  st.push(env.DB.prepare('INSERT INTO consent_events (id, producer_id, event, channel, at) VALUES (?, ?, ?, ?, ?)').bind(uuid(), b.id, 'requested', 'sms', t));
  await env.DB.batch(st);
  const p = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(b.id).first();
  await sendTemplate(env, p, 'CONSENT_REQUEST');
  await audit(env, user, 'producer.create', 'producers', p.id, null, { code: p.code, village_id: p.village_id }, req);
  return json({ producer: view(p, user) }, 201);
}

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return v === '' || v == null || !Number.isFinite(n) || n < 0 ? null : n; };

async function addPlot(env, req, user, p) {
  const b = await readJson(req);
  if (!UUID_RE.test(b.id || '')) fail(400, 'Identifiant UUID manquant');
  const already = await env.DB.prepare('SELECT id FROM plots WHERE id = ?').bind(b.id).first();
  if (already) return json({ ok: true, existing: true });
  const declared = num(b.declared_area_ha);
  if (!(declared > 0 && declared < 500)) fail(400, 'Superficie déclarée obligatoire (en hectares)');
  // Règle EUDR : polygone obligatoire à partir de 4 ha
  if (declared >= 4 && b.geometry_type !== 'polygon') fail(400, 'Superficie de 4 ha ou plus : le contour (polygone) est obligatoire');
  const g = checkGeometry(b.geometry_type, b.geometry);
  if (g.error) fail(400, g.error);
  const captured = b.captured_at && !isNaN(Date.parse(b.captured_at)) ? new Date(b.captured_at).toISOString() : now();
  const t = now();
  await env.DB.prepare(`INSERT INTO plots (id, producer_id, commodity_id, declared_area_ha, geometry_type, geometry, computed_area_ha, captured_at, gps_accuracy_m, method, captured_by, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(b.id, p.id, b.commodity_id || null, declared, b.geometry_type, JSON.stringify(g.geometry), g.areaHa, captured,
    num(b.gps_accuracy_m), ['gps', 'manuel', 'simulé'].includes(b.method) ? b.method : 'gps', user.id, t, t, user.id).run();
  await audit(env, user, 'plot.create', 'plots', b.id, null, { producer: p.code, type: b.geometry_type, declared_area_ha: declared, computed_area_ha: g.areaHa }, req);
  return json({ ok: true, computed_area_ha: g.areaHa }, 201);
}

// Simulateur de téléphone : la coordination et l'administrateur jouent le producteur
export async function routeSim(env, req, path, user) {
  if (!['coordination', 'admin'].includes(user.role)) fail(403, 'Accès refusé');
  if (path === '/api/sim/reply' && req.method === 'POST') {
    const b = await readJson(req);
    const p = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(b.producer_id || '').first();
    if (!p || !p.phone) fail(404, 'Producteur ou téléphone introuvable');
    const text = clampStr(b.text, 160);
    if (!text) fail(400, 'Message vide');
    return json(await handleInbound(env, p.phone, text));
  }
  fail(404, 'Route inconnue');
}
