// API de l'espace /admin : listes génériques (recherche, filtres, import CSV), corbeille,
// journal, paramètres, données de démonstration, modules, actions sur les producteurs.
import { fail, json, now, uuid, readJson, sha256Hex, hexToBytes, normPhone, clampStr } from './util.js';
import { audit, diff } from './audit.js';
import { setDemo } from './demo.js';
import { render } from './messaging.js';

const LEVELS = ['province', 'territoire', 'secteur_chefferie', 'groupement', 'village'];
export const TEMPLATE_VARS = ['nom', 'poids', 'montant', 'date', 'cooperative', 'ussd', 'volume', 'produit', 'point', 'prix', 'ordre', 'reference', 'grade', 'heure'];

// Description des entités gérables. Types : str, text, phone, enum:a,b, bool, int, num, ref:table, date, json, last4.
// Un « ? » final rend le champ facultatif.
export const ENTITIES = {
  users: { label: 'Utilisateurs', fields: { login: 'str', full_name: 'str', email: 'str?', phone: 'phone?', role: 'enum:admin,coordination,buyer,agent', agent_code: 'str?', lang: 'enum:fr,sw', status: 'enum:active,blocked' },
    search: ['login', 'full_name', 'email', 'agent_code'], order: 'full_name', hide: ['pw_hash', 'pw_salt', 'totp_secret', 'totp_last_step', 'failed_attempts'] },
  zones: { label: 'Zones', fields: { parent_id: 'ref:zones?', level: 'enum:' + LEVELS.join(','), name: 'str', code: 'str?', active: 'bool' }, search: ['name', 'code'], order: 'name' },
  collection_points: { label: 'Points de collecte', fields: { village_id: 'ref:zones', name: 'str', lat: 'num', lng: 'num', active: 'bool' }, search: ['name'], order: 'name' },
  agent_assignments: { label: 'Affectations', fields: { agent_id: 'ref:users', collection_point_id: 'ref:collection_points', start_date: 'date?', end_date: 'date?' }, search: [], order: 'created_at DESC' },
  commodities: { label: 'Filières', fields: { code: 'str', name_fr: 'str', name_sw: 'str', unit: 'str', hs_code: 'str?', eudr_scope: 'bool', active: 'bool' }, search: ['code', 'name_fr', 'name_sw'], order: 'name_fr' },
  grades: { label: 'Grades', fields: { commodity_id: 'ref:commodities', code: 'str', label_fr: 'str', label_sw: 'str', criteria: 'json', rank: 'int', active: 'bool' }, search: ['code', 'label_fr', 'label_sw'], order: 'commodity_id, rank' },
  sms_templates: { label: 'Modèles de SMS', fields: { code: 'str', lang: 'enum:sw,fr', body: 'text', description: 'str?' }, search: ['code', 'body', 'description'], order: 'code, lang' },
  producers: { label: 'Producteurs', fields: { full_name: 'str', sex: 'enum:F,M', birth_year: 'int?', phone: 'phone?', lang: 'enum:sw,fr', momo_operator: 'enum:MPESA,AIRTEL,ORANGE?', voter_last4: 'last4?', village_id: 'ref:zones?', collection_point_id: 'ref:collection_points?', household_size: 'int?', female_headed: 'bool' },
    search: ['full_name', 'code', 'phone'], order: 'code' }
};
const FILTERABLE = { users: ['role', 'status'], zones: ['level', 'parent_id', 'active'], collection_points: ['village_id', 'active'], agent_assignments: ['agent_id', 'collection_point_id'],
  commodities: ['active'], grades: ['commodity_id', 'active'], sms_templates: ['code', 'lang'], producers: ['consent_status', 'collection_point_id', 'village_id', 'sex', 'status', 'agent_id'] };

const strip = (e, row) => { if (!row) return row; const r = { ...row }; for (const h of ENTITIES[e].hide || []) delete r[h]; return r; };

async function coerce(env, e, input, partial) {
  const out = {};
  for (const [f, spec] of Object.entries(ENTITIES[e].fields)) {
    if (partial && !(f in input)) continue;
    const opt = spec.endsWith('?'); const type = opt ? spec.slice(0, -1) : spec;
    let v = input[f];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (empty) {
      if (type === 'bool') { out[f] = 0; continue; }
      if (!opt) fail(400, `Champ obligatoire : ${f}`);
      out[f] = null; continue;
    }
    if (type === 'str') v = clampStr(v, 200);
    else if (type === 'text') { v = String(v).trim(); if (v.length > 480) fail(400, `${f} : 480 caractères maximum`); }
    else if (type === 'phone') { v = normPhone(v); if (!v) fail(400, 'Téléphone invalide (format +243 suivi de 9 chiffres)'); }
    else if (type.startsWith('enum:')) { const opts = type.slice(5).split(','); v = String(v).trim(); if (!opts.includes(v)) fail(400, `${f} : valeur attendue parmi ${opts.join(', ')}`); }
    else if (type === 'bool') v = ['1', 'true', 'oui', 'yes', 'on'].includes(String(v).toLowerCase()) ? 1 : 0;
    else if (type === 'int') { v = Number(v); if (!Number.isInteger(v)) fail(400, `${f} : nombre entier attendu`); }
    else if (type === 'num') { v = Number(String(v).replace(',', '.')); if (!Number.isFinite(v)) fail(400, `${f} : nombre attendu`); }
    else if (type === 'date') { v = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, `${f} : date AAAA-MM-JJ attendue`); }
    else if (type === 'last4') { v = String(v).replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase(); if (v.length < 4) fail(400, 'Carte d\'électeur : 4 caractères minimum'); }
    else if (type === 'json') {
      const arr = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { fail(400, `${f} : JSON invalide`); } })() : v;
      if (!Array.isArray(arr) || !arr.every(c => c && c.key && c.label && (c.min != null || c.max != null))) fail(400, 'Critères : liste de {key, label, unit, min et/ou max}');
      v = JSON.stringify(arr.map(c => ({ key: String(c.key), label: String(c.label), unit: String(c.unit || ''), ...(c.min != null ? { min: Number(c.min) } : {}), ...(c.max != null ? { max: Number(c.max) } : {}) })));
    }
    else if (type.startsWith('ref:')) {
      const t = type.slice(4);
      const ok = await env.DB.prepare(`SELECT id FROM ${t} WHERE id = ? AND deleted_at IS NULL`).bind(String(v)).first();
      if (!ok) fail(400, `${f} : référence introuvable`);
      v = String(v);
    }
    out[f] = v;
  }
  return out;
}

// Règles métier propres à chaque entité
async function validate(env, e, row, id) {
  if (e === 'zones') {
    const i = LEVELS.indexOf(row.level);
    if (i === 0 && row.parent_id) fail(400, 'Une province n\'a pas de parent');
    if (i > 0) {
      if (!row.parent_id) fail(400, `Un(e) ${row.level} doit avoir un parent de niveau ${LEVELS[i - 1]}`);
      const p = await env.DB.prepare('SELECT level FROM zones WHERE id = ?').bind(row.parent_id).first();
      if (p.level !== LEVELS[i - 1]) fail(400, `Le parent doit être de niveau ${LEVELS[i - 1]}`);
    }
  }
  if (e === 'collection_points') {
    const v = await env.DB.prepare('SELECT level FROM zones WHERE id = ?').bind(row.village_id).first();
    if (v.level !== 'village') fail(400, 'Un point de collecte se rattache à un village');
    if (!(row.lat >= -14 && row.lat <= 6 && row.lng >= 12 && row.lng <= 32)) fail(400, 'Coordonnées hors de la RDC');
  }
  if (e === 'users') {
    if (row.role === 'agent' && !/^AG\d{2,3}$/.test(row.agent_code || '')) fail(400, 'Un agent doit avoir un code du type AG07');
    if (row.role !== 'agent') row.agent_code = null;
    row.login = String(row.login).toLowerCase();
  }
  if (e === 'sms_templates') {
    const unknown = [...String(row.body).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(v => !TEMPLATE_VARS.includes(v));
    if (unknown.length) fail(400, 'Variables inconnues : ' + unknown.join(', ') + '. Autorisées : ' + TEMPLATE_VARS.map(v => '{' + v + '}').join(' '));
  }
  if (e === 'producers' && row.phone) {
    const dup = await env.DB.prepare("SELECT code FROM producers WHERE phone = ? AND id != ? AND deleted_at IS NULL AND status = 'active'").bind(row.phone, id || '').first();
    if (dup) fail(409, `Ce téléphone appartient déjà au producteur ${dup.code}`);
  }
}

async function getRow(env, e, id) {
  return env.DB.prepare(`SELECT * FROM ${e} WHERE id = ?`).bind(id).first();
}

async function insertRow(env, e, row, user) {
  const t = now();
  const data = { id: row.id || uuid(), ...row, created_at: t, updated_at: t, created_by: user.id };
  const cols = Object.keys(data);
  try {
    await env.DB.prepare(`INSERT INTO ${e} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map(c => data[c])).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) fail(409, 'Doublon : une valeur unique existe déjà (identifiant, code ou login)');
    throw err;
  }
  return data;
}

async function updateRow(env, e, id, row) {
  const cols = Object.keys(row);
  if (!cols.length) return;
  try {
    await env.DB.prepare(`UPDATE ${e} SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ?, version = version + 1 WHERE id = ?`).bind(...cols.map(c => row[c]), now(), id).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) fail(409, 'Doublon : une valeur unique existe déjà');
    throw err;
  }
}

function checkPassword(p) {
  if (!p || !/^[0-9a-f]{32}$/.test(p.salt || '') || !/^[0-9a-f]{64}$/.test(p.dk || '') || Number(p.iter) < 100000) fail(400, 'Mot de passe initial manquant ou invalide');
}

export async function routeAdmin(env, req, path, user) {
  const m = path.match(/^\/api\/admin\/([a-z_]+)(?:\/([^/]+))?(?:\/([a-z-]+))?$/);
  if (!m) fail(404, 'Route inconnue');
  const [, a, id, action] = m;
  const method = req.method;
  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readJson(req) : {};
  const url = new URL(req.url);

  /* ---------- Tableau de bord ---------- */
  if (a === 'summary') {
    const q = (sql) => env.DB.prepare(sql).first();
    const [p, f, c, u, ag] = await Promise.all([
      q("SELECT COUNT(*) n FROM producers WHERE deleted_at IS NULL AND status = 'active'"),
      q("SELECT COUNT(*) n FROM producers WHERE deleted_at IS NULL AND status = 'active' AND sex = 'F'"),
      q("SELECT COUNT(*) n FROM producers WHERE deleted_at IS NULL AND status = 'active' AND consent_status = 'pending'"),
      q('SELECT COUNT(*) n FROM users WHERE deleted_at IS NULL'),
      q('SELECT COUNT(*) n FROM audit_log WHERE at > datetime(\'now\', \'-1 day\')')
    ]);
    return json({ producers: p.n, women: f.n, consent_pending: c.n, users: u.n, audit_24h: ag.n });
  }

  /* ---------- Journal ---------- */
  if (a === 'audit') {
    const term = '%' + (url.searchParams.get('q') || '') + '%';
    const ent = url.searchParams.get('entity');
    const rows = await env.DB.prepare(`SELECT * FROM audit_log WHERE (user_name LIKE ? OR action LIKE ? OR entity_id LIKE ? OR after LIKE ?) ${ent ? 'AND entity = ?' : ''} ORDER BY at DESC LIMIT 500`)
      .bind(term, term, term, term, ...(ent ? [ent] : [])).all();
    return json({ rows: rows.results });
  }

  /* ---------- Corbeille ---------- */
  if (a === 'trash') {
    const out = [];
    for (const e of Object.keys(ENTITIES)) {
      const r = await env.DB.prepare(`SELECT * FROM ${e} WHERE deleted_at IS NOT NULL AND deleted_at > datetime('now', '-30 days') ORDER BY deleted_at DESC`).all();
      for (const row of r.results) out.push({ entity: e, entity_label: ENTITIES[e].label, id: row.id, label: row.full_name || row.name || row.label_fr || row.code || row.login || row.id, deleted_at: row.deleted_at });
    }
    return json({ rows: out });
  }

  /* ---------- Paramètres, démo, modules ---------- */
  if (a === 'settings') {
    if (method === 'PATCH') {
      const allowed = { exchange_rate: v => { const n = Number(v); if (!(n > 0 && n < 1_000_000)) fail(400, 'Taux invalide'); return String(n); }, cooperative_name: v => clampStr(v, 80), ussd_code: v => { if (!/^\*[\d*]+#$/.test(v)) fail(400, 'Code USSD du type *384*20#'); return v; } };
      for (const [k, fn] of Object.entries(allowed)) if (k in body) {
        const before = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first();
        const v = fn(body[k]);
        await env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by').bind(k, v, now(), user.full_name).run();
        await audit(env, user, 'settings.update', 'settings', k, { value: before?.value }, { value: v }, req);
      }
    }
    const s = await env.DB.prepare('SELECT * FROM settings').all();
    const mods = await env.DB.prepare('SELECT * FROM modules ORDER BY code').all();
    return json({ settings: Object.fromEntries(s.results.map(r => [r.key, r.value])), meta: s.results, modules: mods.results });
  }
  if (a === 'demo' && method === 'POST') {
    const enabled = !!body.enabled;
    await setDemo(env, enabled, user);
    await audit(env, user, enabled ? 'demo.enable' : 'demo.disable', 'settings', 'demo_enabled', null, { enabled }, req);
    return json({ ok: true, enabled });
  }
  if (a === 'modules' && id && method === 'PATCH') {
    const mod = await env.DB.prepare('SELECT * FROM modules WHERE code = ?').bind(id).first();
    if (!mod) fail(404, 'Module inconnu');
    if (mod.availability !== 'live') fail(400, 'Module bientôt disponible : activation impossible pour le moment');
    await env.DB.prepare('UPDATE modules SET enabled = ? WHERE code = ?').bind(body.enabled ? 1 : 0, id).run();
    await audit(env, user, 'module.toggle', 'modules', id, { enabled: mod.enabled }, { enabled: body.enabled ? 1 : 0 }, req);
    return json({ ok: true });
  }

  /* ---------- Aperçu d'un modèle de SMS ---------- */
  if (a === 'sms_preview' && method === 'POST') {
    const vars = { nom: 'Furaha', poids: '120', montant: '756 000 CDF', date: '18/11/2026', cooperative: 'Coopérative pilote', ussd: '*384*20#', volume: '2 000', produit: 'kahawa arabika', point: 'Minova', prix: '6 300 CDF/kg', ordre: 'OA-0001', reference: 'MP261118.4821', grade: 'Daraja 1', heure: '08:00' };
    const unknown = [...String(body.body || '').matchAll(/\{(\w+)\}/g)].map(x => x[1]).filter(v => !TEMPLATE_VARS.includes(v));
    const text = render(String(body.body || ''), vars);
    return json({ text, length: text.length, segments: Math.ceil(text.length / 160) || 1, unknown });
  }

  /* ---------- Actions producteurs ---------- */
  if (a === 'producers' && id === 'merge' && method === 'POST') return mergeProducers(env, req, user, body);
  if (a === 'producers' && id && action === 'export') return json(await exportProducer(env, id));
  if (a === 'producers' && id && action === 'erase' && method === 'POST') return eraseProducer(env, req, user, id);

  /* ---------- Utilisateurs : mot de passe, TOTP ---------- */
  if (a === 'users' && id && action === 'password' && method === 'POST') {
    checkPassword(body);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_salt = ?, pw_iter = ?, pw_hash = ?, must_change = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?, version = version + 1 WHERE id = ?')
        .bind(body.salt, Number(body.iter), await sha256Hex(hexToBytes(body.dk)), now(), id),
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now(), id)
    ]);
    await audit(env, user, 'users.password_reset', 'users', id, null, null, req);
    return json({ ok: true });
  }
  if (a === 'users' && id && action === 'reset-totp' && method === 'POST') {
    await env.DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?').bind(id).run();
    await audit(env, user, 'users.totp_reset', 'users', id, null, null, req);
    return json({ ok: true });
  }

  /* ---------- Listes génériques ---------- */
  const e = a;
  if (!ENTITIES[e]) fail(404, 'Liste inconnue');
  const cfg = ENTITIES[e];

  if (method === 'GET' && !id) {
    const where = [url.searchParams.get('trash') === '1' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'], args = [];
    const q = (url.searchParams.get('q') || '').trim();
    if (q && cfg.search.length) { where.push('(' + cfg.search.map(c => c + ' LIKE ?').join(' OR ') + ')'); cfg.search.forEach(() => args.push('%' + q + '%')); }
    for (const f of FILTERABLE[e] || []) { const v = url.searchParams.get('f.' + f); if (v !== null && v !== '') { where.push(f + ' = ?'); args.push(v); } }
    const rows = await env.DB.prepare(`SELECT * FROM ${e} WHERE ${where.join(' AND ')} ORDER BY ${cfg.order} LIMIT 2000`).bind(...args).all();
    return json({ rows: rows.results.map(r => strip(e, r)) });
  }
  if (method === 'GET' && id) {
    const row = await getRow(env, e, id);
    if (!row) fail(404, 'Introuvable');
    return json({ row: strip(e, row) });
  }
  if (method === 'POST' && id === 'import') {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : fail(400, 'rows attendu');
    let created = 0, updated = 0; const errors = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const r = rows[i];
        if (e === 'users') fail(400, 'Import d\'utilisateurs désactivé : chaque compte demande un mot de passe initial');
        const existing = r.id ? await getRow(env, e, r.id) : null;
        if (existing) {
          const data = await coerce(env, e, r, true); await validate(env, e, { ...existing, ...data }, r.id);
          await updateRow(env, e, r.id, data); updated++;
          const [b, af] = diff(existing, data); await audit(env, user, 'import.update', e, r.id, b, af, req);
        } else {
          const data = await coerce(env, e, r, false); await validate(env, e, data, null);
          if (e === 'producers') fail(400, 'Les producteurs s\'inscrivent par l\'application agent (consentement par SMS)');
          const ins = await insertRow(env, e, { ...data, ...(r.id ? { id: String(r.id) } : {}) }, user); created++;
          await audit(env, user, 'import.create', e, ins.id, null, data, req);
        }
      } catch (err) { errors.push({ line: i + 2, error: err.message }); }
    }
    return json({ created, updated, errors });
  }
  if (method === 'POST' && id && action === 'restore') {
    const row = await getRow(env, e, id); if (!row) fail(404, 'Introuvable');
    await env.DB.prepare(`UPDATE ${e} SET deleted_at = NULL, updated_at = ? WHERE id = ?`).bind(now(), id).run();
    await audit(env, user, 'restore', e, id, { deleted_at: row.deleted_at }, { deleted_at: null }, req);
    return json({ ok: true });
  }
  if (method === 'POST' && !id) {
    if (e === 'producers') fail(400, 'Les producteurs s\'inscrivent par l\'application agent (consentement par SMS)');
    const data = await coerce(env, e, body, false);
    await validate(env, e, data, null);
    if (e === 'users') {
      checkPassword(body.password);
      Object.assign(data, { pw_salt: body.password.salt, pw_iter: Number(body.password.iter), pw_hash: await sha256Hex(hexToBytes(body.password.dk)), must_change: 1 });
    }
    const row = await insertRow(env, e, data, user);
    await audit(env, user, 'create', e, row.id, null, data, req);
    return json({ row: strip(e, row) }, 201);
  }
  if (method === 'PATCH' && id) {
    const before = await getRow(env, e, id); if (!before) fail(404, 'Introuvable');
    const data = await coerce(env, e, body, true);
    await validate(env, e, { ...before, ...data }, id);
    if (e === 'users' && id === user.id && (data.role && data.role !== 'admin' || data.status === 'blocked')) fail(400, 'Vous ne pouvez pas retirer votre propre accès administrateur');
    if (e === 'users' && 'role' in data && data.role !== 'agent') data.agent_code = null;
    await updateRow(env, e, id, data);
    if (e === 'users' && (data.status === 'blocked' || (data.role && data.role !== before.role)))
      await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now(), id).run();
    const [b, af] = diff(before, data);
    if (Object.keys(af).length) await audit(env, user, 'update', e, id, strip(e, b), strip(e, af), req);
    return json({ row: strip(e, await getRow(env, e, id)) });
  }
  if (method === 'DELETE' && id) {
    const before = await getRow(env, e, id); if (!before) fail(404, 'Introuvable');
    if (e === 'users' && id === user.id) fail(400, 'Vous ne pouvez pas supprimer votre propre compte');
    if (e === 'zones') {
      const child = await env.DB.prepare('SELECT COUNT(*) n FROM zones WHERE parent_id = ? AND deleted_at IS NULL').bind(id).first();
      if (child.n) fail(400, 'Supprimez ou déplacez d\'abord les zones rattachées');
    }
    await env.DB.prepare(`UPDATE ${e} SET deleted_at = ? WHERE id = ?`).bind(now(), id).run();
    if (e === 'users') await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ?').bind(now(), id).run();
    await audit(env, user, 'delete', e, id, strip(e, before), { deleted_at: 'corbeille (30 jours)' }, req);
    return json({ ok: true });
  }
  fail(405, 'Méthode non prise en charge');
}

/* ---------- Données d'un producteur (droit d'accès, effacement, fusion) ---------- */
async function exportProducer(env, id) {
  const p = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(id).first();
  if (!p) fail(404, 'Producteur introuvable');
  const all = async (sql) => (await env.DB.prepare(sql).bind(id).all()).results;
  return {
    exported_at: now(), producer: p,
    commodities: await all('SELECT commodity_id FROM producer_commodities WHERE producer_id = ?'),
    baselines: await all('SELECT * FROM baselines WHERE producer_id = ?'),
    plots: await all('SELECT * FROM plots WHERE producer_id = ?'),
    consent_events: await all('SELECT * FROM consent_events WHERE producer_id = ? ORDER BY at'),
    messages: await all('SELECT * FROM messages WHERE producer_id = ? ORDER BY created_at')
  };
}

async function hasDeliveries(env, id) {
  const t = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'weighings'").first();
  if (!t) return false;
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM weighings WHERE producer_id = ? AND status = 'valid'").bind(id).first();
  return r.n > 0;
}

async function eraseProducer(env, req, user, id) {
  const p = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(id).first();
  if (!p) fail(404, 'Producteur introuvable');
  const t = now();
  if (await hasDeliveries(env, id)) {
    // Livraisons présentes : obligation de conservation EUDR (5 ans) → anonymisation
    await env.DB.batch([
      env.DB.prepare("UPDATE producers SET full_name = 'Producteur anonymisé', phone = NULL, birth_year = NULL, voter_last4 = NULL, household_size = NULL, status = 'anonymized', updated_at = ?, version = version + 1 WHERE id = ?").bind(t, id),
      env.DB.prepare("UPDATE messages SET body = '[effacé]', phone = NULL WHERE producer_id = ?").bind(id),
      env.DB.prepare('DELETE FROM baselines WHERE producer_id = ?').bind(id),
      env.DB.prepare('INSERT INTO data_requests (id, producer_id, type, requested_at, handled_by, handled_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(uuid(), id, 'delete', t, user.id, t, 'anonymisé (livraisons conservées 5 ans, EUDR)')
    ]);
    await audit(env, user, 'producer.anonymize', 'producers', id, { code: p.code, full_name: p.full_name }, { status: 'anonymized' }, req);
    return json({ ok: true, outcome: 'anonymized' });
  }
  await env.DB.batch([
    ...['producer_commodities', 'baselines', 'plots', 'consent_events', 'messages'].map(tb => env.DB.prepare(`DELETE FROM ${tb} WHERE producer_id = ?`).bind(id)),
    env.DB.prepare('DELETE FROM producers WHERE id = ?').bind(id),
    env.DB.prepare('INSERT INTO data_requests (id, producer_id, type, requested_at, handled_by, handled_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(uuid(), id, 'delete', t, user.id, t, 'supprimé (aucune livraison)')
  ]);
  await audit(env, user, 'producer.erase', 'producers', id, { code: p.code }, { erased: true }, req);
  return json({ ok: true, outcome: 'deleted' });
}

async function mergeProducers(env, req, user, body) {
  const { source_id, target_id } = body;
  if (!source_id || !target_id || source_id === target_id) fail(400, 'Choisissez deux producteurs différents');
  const s = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(source_id).first();
  const t = await env.DB.prepare('SELECT * FROM producers WHERE id = ?').bind(target_id).first();
  if (!s || !t) fail(404, 'Producteur introuvable');
  const ts = now();
  const moves = ['baselines', 'plots', 'consent_events', 'messages'].map(tb => env.DB.prepare(`UPDATE ${tb} SET producer_id = ? WHERE producer_id = ?`).bind(target_id, source_id));
  for (const tb of ['weighings', 'order_offers', 'payments']) {
    const ex = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(tb).first();
    if (ex) moves.push(env.DB.prepare(`UPDATE ${tb} SET producer_id = ? WHERE producer_id = ?`).bind(target_id, source_id));
  }
  await env.DB.batch([
    ...moves,
    env.DB.prepare('INSERT OR IGNORE INTO producer_commodities (producer_id, commodity_id) SELECT ?, commodity_id FROM producer_commodities WHERE producer_id = ?').bind(target_id, source_id),
    env.DB.prepare('DELETE FROM producer_commodities WHERE producer_id = ?').bind(source_id),
    // Si l'une des deux fiches avait donné son consentement, la personne l'a donné
    env.DB.prepare("UPDATE producers SET consent_status = CASE WHEN ? = 'granted' OR consent_status = 'granted' THEN 'granted' ELSE consent_status END, phone = COALESCE(phone, ?), updated_at = ?, version = version + 1 WHERE id = ?").bind(s.consent_status, s.phone, ts, target_id),
    env.DB.prepare("UPDATE producers SET status = 'merged', merged_into_id = ?, phone = NULL, updated_at = ?, version = version + 1 WHERE id = ?").bind(target_id, ts, source_id)
  ]);
  await audit(env, user, 'producer.merge', 'producers', target_id, { source: s.code }, { target: t.code }, req);
  return json({ ok: true });
}

// Purge définitive de la corbeille après 30 jours (tâche planifiée)
export async function purgeTrash(env) {
  for (const e of Object.keys(ENTITIES)) {
    await env.DB.prepare(`DELETE FROM ${e} WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')`).run();
  }
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now() - 86400_000).run();
}
