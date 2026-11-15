// Portail public : contenu du site, chiffres agrégés, inscriptions, demandes de démonstration,
// fichiers (documents et photos stockés dans D1), espace « mon compte » et validation dans /admin.
import { fail, json, now, uuid, readJson, randomHex, sha256Hex, hexToBytes, clampStr, normIntlPhone, isEmail } from './util.js';
import { audit } from './audit.js';
import { renderTemplate } from './messaging.js';
import { providers } from '../providers/index.js';

export const LANGS = ['fr', 'en', 'sw', 'ln'];
const PROFILES = {
  buyer: { role: 'buyer', types: ['exportateur', 'transformateur', 'cooperative_acheteuse', 'commercant', 'ong_acheteuse'] },
  cooperative: { role: 'cooperative', types: ['cooperative', 'union', 'association', 'groupement'] },
  partner: { role: 'partner', types: ['ong_internationale', 'ong_locale', 'bailleur', 'agence_publique', 'entreprise', 'autre'] }
};
const COMMODITIES = ['cafe_arabica', 'cacao', 'vivres'];
const GLOBAL_KEYS = ['contact_email', 'contact_phone', 'contact_address', 'eudr_date_large', 'eudr_date_small', 'legal_publisher'];
const PHOTO_SLOTS = ['hero', 'buyers', 'producers', 'partners'];
const MAX_FILE = 1_500_000, CHUNK = 512 * 1024, MAX_DOCS = 3;
const SUBJECTS = {
  REG_RECEIVED: { fr: 'Demande de compte reçue', en: 'Account request received', sw: 'Ombi la akaunti limepokelewa', ln: 'Bosenga ya compte ekomi' },
  REG_APPROVED: { fr: 'Compte validé', en: 'Account approved', sw: 'Akaunti imeidhinishwa', ln: 'Compte endimami' },
  REG_REFUSED: { fr: 'Demande non acceptée', en: 'Request not accepted', sw: 'Ombi halikukubaliwa', ln: 'Bosenga endimami te' },
  REG_INFO: { fr: 'Informations à compléter', en: 'More information needed', sw: 'Maelezo zaidi yanahitajika', ln: 'Bansango ya kobakisa' }
};

const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
const one = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const tableExists = async (env, name) => !!(await one(env, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name));

/* ------------------------------------------------------------------ Chiffres publics */
// Agrégats uniquement. Une case de moins de 5 producteurs n'est jamais chiffrée (« moins de 5 »).
async function publicStats(env) {
  const zones = await all(env, 'SELECT id, parent_id, level, name FROM zones WHERE deleted_at IS NULL');
  const byId = Object.fromEntries(zones.map(z => [z.id, z]));
  const territoryOf = (id) => { let z = byId[id]; while (z && z.level !== 'territoire') z = byId[z.parent_id]; return z; };
  const prods = await all(env, "SELECT p.id, p.sex, p.village_id, (SELECT COUNT(*) FROM plots pl WHERE pl.producer_id = p.id AND pl.deleted_at IS NULL) AS plots FROM producers p WHERE p.deleted_at IS NULL AND p.status = 'active'");
  const terr = {};
  for (const p of prods) {
    const t = territoryOf(p.village_id); if (!t) continue;
    const prov = byId[t.parent_id]?.name || '';
    (terr[t.id] ||= { id: t.id, name: t.name, province: prov, n: 0 }).n++;
  }
  let tonnes = 0, paid = 0;
  // Tables créées par le module 1 (pesées, paiements) : absentes tant que les étapes e et f ne sont pas livrées
  try { if (await tableExists(env, 'weighings')) tonnes = ((await one(env, "SELECT SUM(net_kg) s FROM weighings WHERE status = 'valid'"))?.s || 0) / 1000; } catch {}
  try { if (await tableExists(env, 'payments')) paid = (await one(env, "SELECT SUM(amount_cdf) s FROM payments WHERE status = 'paid'"))?.s || 0; } catch {}
  const women = prods.filter(p => p.sex === 'F').length;
  return {
    producers: prods.length,
    women_pct: prods.length >= 5 ? Math.round(women / prods.length * 100) : null,
    with_plot: prods.filter(p => p.plots > 0).length,
    tonnes: Math.round(tonnes * 10) / 10, paid_cdf: Math.round(paid),
    territories: Object.values(terr).map(t => ({ id: t.id, name: t.name, province: t.province, producers: t.n >= 5 ? t.n : null, lt5: t.n < 5 }))
  };
}

async function siteData(env, lang) {
  const rows = await all(env, "SELECT lang, key, value FROM site_content WHERE lang IN (?, '*')", lang);
  const content = {}, global = {};
  for (const r of rows) (r.lang === '*' ? global : content)[r.key] = r.value;
  const mods = await all(env, 'SELECT code, site_status FROM modules ORDER BY code');
  const demo = (await one(env, "SELECT value FROM settings WHERE key = 'demo_enabled'"))?.value === '1';
  const ussd = (await one(env, "SELECT value FROM settings WHERE key = 'ussd_code'"))?.value || '';
  const territories = await all(env, "SELECT t.id, t.name, p.name AS province FROM zones t LEFT JOIN zones p ON p.id = t.parent_id WHERE t.level = 'territoire' AND t.deleted_at IS NULL AND t.active = 1 ORDER BY p.name, t.name");
  return { lang, content, global, services: mods.map(m => ({ code: m.code, status: m.site_status })), demo, ussd, territories, stats: await publicStats(env) };
}

/* ------------------------------------------------------------------ Fichiers */
function sniff(bytes) {
  const b = bytes.subarray(0, 12), s = String.fromCharCode(...b);
  if (s.startsWith('%PDF')) return 'application/pdf';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'image/png';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function storeFile(env, req, { ownerType, ownerId, kind, allowed, createdBy, isDemo = 0 }) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_FILE + 1024) fail(413, 'Fichier trop lourd : 1,5 Mo maximum');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) fail(400, 'Fichier vide');
  if (bytes.length > MAX_FILE) fail(413, 'Fichier trop lourd : 1,5 Mo maximum');
  const mime = sniff(bytes);
  if (!mime || !allowed.includes(mime)) fail(415, 'Format refusé. Formats acceptés : ' + allowed.map(m => m.split('/')[1].toUpperCase()).join(', '));
  let name = 'fichier';
  try { name = decodeURIComponent(req.headers.get('x-file-name') || 'fichier'); } catch {}
  name = name.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120);
  const id = uuid(), chunks = Math.ceil(bytes.length / CHUNK);
  const st = [env.DB.prepare('INSERT INTO files (id, owner_type, owner_id, kind, name, mime, size, sha256, chunks, created_at, created_by, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, ownerType, ownerId, kind, name, mime, bytes.length, await sha256Hex(bytes), chunks, now(), createdBy, isDemo)];
  for (let i = 0; i < chunks; i++) st.push(env.DB.prepare('INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)').bind(id, i, bytes.slice(i * CHUNK, (i + 1) * CHUNK)));
  await env.DB.batch(st);
  return { id, name, mime, size: bytes.length };
}

async function serveFile(env, f, cache) {
  const parts = await all(env, 'SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx', f.id);
  const body = new Uint8Array(f.size); let off = 0;
  for (const p of parts) { const b = new Uint8Array(p.data); body.set(b, off); off += b.length; }
  return new Response(body, { headers: { 'content-type': f.mime, 'cache-control': cache, 'x-content-type-options': 'nosniff',
    'content-disposition': (f.mime === 'application/pdf' ? 'inline' : 'inline') + '; filename="' + encodeURIComponent(f.name || 'fichier') + '"' } });
}

const fileList = (env, ownerType, ownerId) => all(env, 'SELECT id, name, mime, size, created_at FROM files WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at', ownerType, ownerId);

/* ------------------------------------------------------------------ Notifications des comptes */
function siteUrl(req) { const u = new URL(req.url); return u.origin + '/connexion'; }

async function notifyAccount(env, req, org, user, code, extra = {}) {
  const lang = LANGS.includes(org.lang) ? org.lang : 'fr';
  const body = await renderTemplate(env, code, lang, { organisation: org.name, lien: siteUrl(req), ...extra }, 'fr');
  if (!body) return;
  const p = providers(env), isDemo = org.is_demo || 0;
  if (org.email) await p.email.send({ to: org.email, subject: 'KivuTrace & Market · ' + (SUBJECTS[code]?.[lang] || SUBJECTS[code]?.fr || code), body, userId: user?.id, orgId: org.id, templateCode: code, lang, isDemo });
  if (org.phone) await p.sms.send({ to: org.phone, body, userId: user?.id, orgId: org.id, templateCode: code, lang, isDemo });
}

/* ------------------------------------------------------------------ Validation d'un dossier */
const str = (v, max, label, req = false) => {
  const s = clampStr(v, max);
  if (req && !s) fail(400, 'Champ obligatoire : ' + label);
  return s || null;
};
const arr = (v, allowed) => (Array.isArray(v) ? v : []).map(String).filter(x => !allowed || allowed.includes(x)).slice(0, 30);

async function cleanOrg(env, profile, b, partial = false) {
  const P = PROFILES[profile];
  const out = {};
  const has = (k) => !partial || k in b;
  if (has('name')) out.name = str(b.name, 120, 'nom', true);
  if (has('org_type')) { if (!P.types.includes(b.org_type)) fail(400, 'Type d\'organisation invalide'); out.org_type = b.org_type; }
  for (const k of ['rccm', 'id_nat', 'nif']) if (has(k)) out[k] = str(b[k], 40);
  if (has('address')) out.address = str(b.address, 200);
  if (has('country')) out.country = str(b.country, 60, 'pays', true);
  if (has('contact_role')) out.contact_role = str(b.contact_role, 80);
  if (b.activity !== undefined || !partial) {
    const a = b.activity || {};
    const territories = new Set((await all(env, "SELECT id FROM zones WHERE level = 'territoire' AND deleted_at IS NULL")).map(z => z.id));
    const act = { commodities: arr(a.commodities, COMMODITIES), zones: arr(a.zones).filter(z => territories.has(z)) };
    if (profile === 'buyer') {
      const v = a.volume_t === '' || a.volume_t == null ? null : Number(a.volume_t);
      if (v != null && !(v >= 0 && v < 10_000_000)) fail(400, 'Volume annuel invalide');
      Object.assign(act, { volume_t: v, eu_export: !!a.eu_export });
      if (!act.commodities.length) fail(400, 'Choisissez au moins une filière');
    } else {
      const m = a.members === '' || a.members == null ? null : Number(a.members);
      if (m != null && !(Number.isInteger(m) && m >= 0 && m < 10_000_000)) fail(400, 'Nombre de membres invalide');
      Object.assign(act, { members: m, donors: str(a.donors, 300), projects: str(a.projects, 600) });
    }
    out.activity = JSON.stringify(act);
  }
  return out;
}

async function register(env, req) {
  const b = await readJson(req);
  if (b.website) fail(400, 'Requête refusée'); // champ piège invisible pour les robots
  const profile = b.profile;
  if (!PROFILES[profile]) fail(400, 'Choisissez un profil');
  const ip = req.headers.get('cf-connecting-ip') || '';
  const recent = await one(env, "SELECT COUNT(*) n FROM organizations WHERE ip = ? AND submitted_at > ?", ip, new Date(Date.now() - 3600_000).toISOString());
  if (ip && recent.n >= 5) fail(429, 'Trop de demandes depuis cette connexion. Réessayez dans une heure.');
  const org = await cleanOrg(env, profile, b);
  const contact_name = str(b.contact_name, 120, 'nom du responsable', true);
  const phone = normIntlPhone(b.phone); if (!phone) fail(400, 'Téléphone invalide : +243 suivi de 9 chiffres, ou numéro international');
  const email = String(b.email || '').trim().toLowerCase(); if (!isEmail(email)) fail(400, 'Adresse e-mail invalide');
  if (!b.consent) fail(400, 'Acceptez la politique de protection des données');
  const pw = b.password || {};
  if (!/^[0-9a-f]{32}$/.test(pw.salt || '') || !/^[0-9a-f]{64}$/.test(pw.dk || '') || Number(pw.iter) < 100000) fail(400, 'Mot de passe invalide');
  if (await one(env, 'SELECT id FROM users WHERE login = ? OR (email = ? AND deleted_at IS NULL)', email, email)) fail(409, 'Un compte existe déjà avec cet e-mail. Connectez-vous ou contactez-nous.');
  const lang = LANGS.includes(b.lang) ? b.lang : 'fr';
  const t = now(), orgId = uuid(), userId = uuid(), uploadToken = randomHex(24);
  const row = { id: orgId, kind: profile, ...org, contact_name, phone, email, lang, status: 'pending', submitted_at: t, ip,
    upload_token_hash: await sha256Hex(uploadToken), upload_expires: Date.now() + 2 * 3600_000, created_at: t, updated_at: t };
  const cols = Object.keys(row);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO organizations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map(c => row[c])),
    env.DB.prepare(`INSERT INTO users (id, login, full_name, email, phone, role, lang, pw_salt, pw_iter, pw_hash, account_status, org_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).bind(userId, email, contact_name, email, phone, PROFILES[profile].role, lang, pw.salt, Number(pw.iter), await sha256Hex(hexToBytes(pw.dk)), orgId, t, t)
  ]);
  await audit(env, null, 'registration.submitted', 'organizations', orgId, null, { name: row.name, kind: profile, email }, req);
  await notifyAccount(env, req, row, { id: userId }, 'REG_RECEIVED');
  return json({ ok: true, id: orgId, upload_token: uploadToken }, 201);
}

/* ------------------------------------------------------------------ Routes publiques */
export async function routePublic(env, req, path) {
  const url = new URL(req.url);
  if (path === '/api/public/site' && req.method === 'GET') {
    const lang = LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'fr';
    return json(await siteData(env, lang));
  }
  if (path === '/api/public/register' && req.method === 'POST') return register(env, req);
  if (path === '/api/public/upload' && req.method === 'POST') {
    const tok = req.headers.get('x-upload-token') || '';
    if (!/^[0-9a-f]{48}$/.test(tok)) fail(401, 'Jeton d\'envoi invalide');
    const org = await one(env, 'SELECT * FROM organizations WHERE upload_token_hash = ?', await sha256Hex(tok));
    if (!org || org.upload_expires < Date.now()) fail(401, 'Délai d\'envoi dépassé : ajoutez vos documents depuis votre espace');
    const n = await one(env, "SELECT COUNT(*) n FROM files WHERE owner_type = 'organization' AND owner_id = ? AND deleted_at IS NULL", org.id);
    if (n.n >= MAX_DOCS) fail(400, '3 documents maximum');
    const f = await storeFile(env, req, { ownerType: 'organization', ownerId: org.id, kind: 'document', allowed: ['application/pdf', 'image/jpeg', 'image/png'], createdBy: null });
    return json({ file: f }, 201);
  }
  if (path === '/api/public/demo-request' && req.method === 'POST') {
    const b = await readJson(req);
    if (b.website) fail(400, 'Requête refusée');
    const ip = req.headers.get('cf-connecting-ip') || '';
    const recent = await one(env, 'SELECT COUNT(*) n FROM demo_requests WHERE ip = ? AND created_at > ?', ip, new Date(Date.now() - 3600_000).toISOString());
    if (ip && recent.n >= 5) fail(429, 'Trop de demandes depuis cette connexion. Réessayez dans une heure.');
    const name = str(b.name, 120, 'nom', true);
    const phone = b.phone ? normIntlPhone(b.phone) : null; if (b.phone && !phone) fail(400, 'Téléphone invalide');
    const email = b.email ? String(b.email).trim().toLowerCase() : null; if (email && !isEmail(email)) fail(400, 'Adresse e-mail invalide');
    if (!phone && !email) fail(400, 'Indiquez un téléphone ou un e-mail');
    const id = uuid();
    await env.DB.prepare('INSERT INTO demo_requests (id, name, organization, phone, email, message, lang, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, str(b.organization, 120), phone, email, str(b.message, 1500), LANGS.includes(b.lang) ? b.lang : 'fr', ip, now()).run();
    await audit(env, null, 'demo_request.created', 'demo_requests', id, null, { name, organization: b.organization || null }, req);
    return json({ ok: true }, 201);
  }
  const fm = path.match(/^\/api\/public\/file\/([0-9a-f-]{36})$/);
  if (fm) {
    const f = await one(env, "SELECT * FROM files WHERE id = ? AND owner_type = 'site' AND deleted_at IS NULL", fm[1]);
    if (!f) fail(404, 'Image introuvable');
    return serveFile(env, f, 'public, max-age=86400, immutable');
  }
  fail(404, 'Route inconnue');
}

/* ------------------------------------------------------------------ Mon compte (acheteur, coopérative, partenaire) */
export async function routeAccount(env, req, path, user) {
  const org = user.org_id ? await one(env, 'SELECT * FROM organizations WHERE id = ?', user.org_id) : null;
  if (path === '/api/account' && req.method === 'GET') {
    return json({ account_status: user.account_status, org: org && orgView(org),
      files: org ? await fileList(env, 'organization', org.id) : [],
      messages: await all(env, "SELECT id, channel, email, phone, subject, body, created_at FROM messages WHERE user_id = ? OR (org_id = ? AND org_id IS NOT NULL) ORDER BY created_at DESC LIMIT 30", user.id, org?.id ?? '') });
  }
  if (!org) fail(400, 'Aucune organisation liée à ce compte');
  if (path === '/api/account/org' && req.method === 'PATCH') {
    if (org.status === 'refused') fail(403, 'Demande refusée : contactez-nous');
    const b = await readJson(req);
    // Une fois validé, le nom et le type ne changent plus sans l'administrateur
    if (org.status === 'approved') { delete b.name; delete b.org_type; }
    const data = await cleanOrg(env, org.kind, b, true);
    const cols = Object.keys(data);
    if (cols.length) await env.DB.prepare(`UPDATE organizations SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ?, version = version + 1 WHERE id = ?`).bind(...cols.map(c => data[c]), now(), org.id).run();
    await audit(env, user, 'organization.update', 'organizations', org.id, null, data, req);
    return json({ org: orgView(await one(env, 'SELECT * FROM organizations WHERE id = ?', org.id)) });
  }
  if (path === '/api/account/resubmit' && req.method === 'POST') {
    if (org.status !== 'info_requested') fail(400, 'Aucun complément demandé');
    await env.DB.batch([
      env.DB.prepare("UPDATE organizations SET status = 'pending', submitted_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), org.id),
      env.DB.prepare("UPDATE users SET account_status = 'pending' WHERE org_id = ?").bind(org.id)
    ]);
    await audit(env, user, 'registration.resubmitted', 'organizations', org.id, { status: 'info_requested' }, { status: 'pending' }, req);
    return json({ ok: true });
  }
  if (path === '/api/account/upload' && req.method === 'POST') {
    const n = await one(env, "SELECT COUNT(*) n FROM files WHERE owner_type = 'organization' AND owner_id = ? AND deleted_at IS NULL", org.id);
    if (n.n >= MAX_DOCS + 2) fail(400, '5 documents maximum');
    const f = await storeFile(env, req, { ownerType: 'organization', ownerId: org.id, kind: 'document', allowed: ['application/pdf', 'image/jpeg', 'image/png'], createdBy: user.id, isDemo: org.is_demo });
    await audit(env, user, 'organization.document', 'organizations', org.id, null, { file: f.name }, req);
    return json({ file: f }, 201);
  }
  const fm = path.match(/^\/api\/account\/file\/([0-9a-f-]{36})$/);
  if (fm) {
    const f = await one(env, "SELECT * FROM files WHERE id = ? AND owner_type = 'organization' AND owner_id = ? AND deleted_at IS NULL", fm[1], org.id);
    if (!f) fail(404, 'Document introuvable');
    return serveFile(env, f, 'private, no-store');
  }
  fail(404, 'Route inconnue');
}

const orgView = (o) => { const { upload_token_hash, upload_expires, ip, ...r } = o; return { ...r, activity: JSON.parse(o.activity || '{}') }; };

// Les ordres d'achat arrivent à l'étape c. Ce contrôle s'appliquera à toute action de l'acheteur.
export async function requireApproved(env, user) {
  if (user.account_status !== 'approved') fail(403, 'Compte en attente de validation : action impossible pour le moment');
  if (user.role === 'buyer') {
    const org = user.org_id ? await one(env, 'SELECT rccm, id_nat, nif FROM organizations WHERE id = ?', user.org_id) : null;
    if (org && (!org.rccm || !org.id_nat || !org.nif)) fail(403, 'Complétez RCCM, ID national et NIF dans « Mon entreprise » avant votre premier ordre d\'achat');
  }
}

/* ------------------------------------------------------------------ Administration du portail */
export async function routeAdminPortal(env, req, path, user) {
  const url = new URL(req.url);
  const m = path.match(/^\/api\/admin\/(portal_counts|registrations|demo_requests|site|files)(?:\/([^/]+))?(?:\/([a-z_]+))?$/);
  if (!m) return null;
  const [, a, id, action] = m;

  if (a === 'portal_counts') {
    const r = await one(env, "SELECT (SELECT COUNT(*) FROM organizations WHERE status = 'pending' AND deleted_at IS NULL) reg, (SELECT COUNT(*) FROM demo_requests WHERE status = 'new') demo");
    return json(r);
  }

  if (a === 'registrations') {
    if (!id && req.method === 'GET') {
      const st = url.searchParams.get('status') || '';
      const q = '%' + (url.searchParams.get('q') || '') + '%';
      const rows = await all(env, `SELECT o.*, (SELECT COUNT(*) FROM files f WHERE f.owner_type = 'organization' AND f.owner_id = o.id AND f.deleted_at IS NULL) AS docs
        FROM organizations o WHERE o.deleted_at IS NULL ${st ? 'AND o.status = ?' : ''} AND (o.name LIKE ? OR o.email LIKE ? OR o.contact_name LIKE ?)
        ORDER BY CASE o.status WHEN 'pending' THEN 0 WHEN 'info_requested' THEN 1 ELSE 2 END, o.submitted_at DESC LIMIT 500`, ...(st ? [st] : []), q, q, q);
      return json({ rows: rows.map(orgView) });
    }
    const org = await one(env, 'SELECT * FROM organizations WHERE id = ?', id);
    if (!org) fail(404, 'Demande introuvable');
    if (!action && req.method === 'GET') {
      const users = await all(env, 'SELECT id, login, full_name, role, account_status, last_login_at FROM users WHERE org_id = ? AND deleted_at IS NULL', id);
      const messages = await all(env, "SELECT id, channel, email, phone, subject, body, template_code, created_at FROM messages WHERE org_id = ? ORDER BY created_at DESC LIMIT 50", id);
      const history = await all(env, "SELECT action, user_name, after, at FROM audit_log WHERE entity = 'organizations' AND entity_id = ? ORDER BY at DESC LIMIT 50", id);
      return json({ org: orgView(org), users, files: await fileList(env, 'organization', id), messages, history });
    }
    if (action === 'decision' && req.method === 'POST') {
      const b = await readJson(req);
      const map = { approve: ['approved', 'REG_APPROVED'], refuse: ['refused', 'REG_REFUSED'], info: ['info_requested', 'REG_INFO'] };
      if (!map[b.decision]) fail(400, 'Décision inconnue');
      const reason = clampStr(b.reason, 400);
      if (b.decision !== 'approve' && !reason) fail(400, b.decision === 'refuse' ? 'Indiquez le motif du refus' : 'Indiquez les informations à compléter');
      const [status, code] = map[b.decision];
      const t = now();
      await env.DB.batch([
        env.DB.prepare('UPDATE organizations SET status = ?, status_reason = ?, decided_by = ?, decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').bind(status, reason, user.full_name, t, t, id),
        env.DB.prepare('UPDATE users SET account_status = ?, updated_at = ? WHERE org_id = ?').bind(status, t, id),
        // Un compte refusé perd ses sessions ouvertes
        ...(status === 'refused' ? [env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id IN (SELECT id FROM users WHERE org_id = ?) AND revoked_at IS NULL').bind(t, id)] : [])
      ]);
      await audit(env, user, 'registration.' + b.decision, 'organizations', id, { status: org.status }, { status, reason }, req);
      const u = await one(env, 'SELECT id FROM users WHERE org_id = ? LIMIT 1', id);
      await notifyAccount(env, req, org, u, code, { motif: reason || '' });
      return json({ ok: true, status });
    }
    fail(405, 'Méthode non prise en charge');
  }

  if (a === 'demo_requests') {
    if (!id && req.method === 'GET') return json({ rows: await all(env, "SELECT * FROM demo_requests ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, created_at DESC LIMIT 500") });
    if (id && req.method === 'PATCH') {
      const b = await readJson(req);
      const before = await one(env, 'SELECT * FROM demo_requests WHERE id = ?', id); if (!before) fail(404, 'Introuvable');
      if (b.status && !['new', 'contacted', 'closed'].includes(b.status)) fail(400, 'Statut invalide');
      await env.DB.prepare('UPDATE demo_requests SET status = COALESCE(?, status), note = COALESCE(?, note), handled_at = ?, handled_by = ? WHERE id = ?')
        .bind(b.status || null, b.note != null ? clampStr(b.note, 1000) : null, now(), user.full_name, id).run();
      await audit(env, user, 'demo_request.update', 'demo_requests', id, { status: before.status }, { status: b.status, note: b.note }, req);
      return json({ ok: true });
    }
    fail(405, 'Méthode non prise en charge');
  }

  if (a === 'files' && id && req.method === 'GET') {
    const f = await one(env, 'SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', id);
    if (!f) fail(404, 'Fichier introuvable');
    return serveFile(env, f, 'private, no-store');
  }

  if (a === 'site') {
    if (!id && req.method === 'GET') {
      const rows = await all(env, 'SELECT lang, key, value, updated_at, updated_by FROM site_content ORDER BY lang, key');
      const services = await all(env, 'SELECT code, label, site_status, availability, enabled FROM modules ORDER BY code');
      const photos = {};
      for (const r of rows) if (r.lang === '*' && r.key.startsWith('img.') && r.value) photos[r.key.slice(4)] = r.value;
      return json({ rows, services, photos, slots: PHOTO_SLOTS, global_keys: GLOBAL_KEYS });
    }
    // Textes d'une langue : { lang, values: { clé: texte | null (rétablir le texte par défaut) } }
    if (id === 'content' && req.method === 'PUT') {
      const b = await readJson(req);
      const lang = b.lang === '*' ? '*' : LANGS.includes(b.lang) ? b.lang : fail(400, 'Langue invalide');
      const st = [], changed = {};
      for (const [k, v] of Object.entries(b.values || {}).slice(0, 300)) {
        if (!/^[a-z0-9_.]{2,60}$/.test(k)) fail(400, 'Clé invalide : ' + k);
        if (lang === '*' && !GLOBAL_KEYS.includes(k)) fail(400, 'Clé inconnue : ' + k);
        if (v == null || String(v).trim() === '' && lang !== '*') st.push(env.DB.prepare('DELETE FROM site_content WHERE lang = ? AND key = ?').bind(lang, k));
        else {
          const val = String(v).slice(0, 2000);
          st.push(env.DB.prepare('INSERT INTO site_content (lang, key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lang, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by').bind(lang, k, val, now(), user.full_name));
        }
        changed[k] = v;
      }
      if (st.length) await env.DB.batch(st);
      await audit(env, user, 'site.content', 'site_content', lang, null, changed, req);
      return json({ ok: true, count: st.length });
    }
    if (id === 'services' && req.method === 'PATCH') {
      const b = await readJson(req);
      if (!['available', 'soon', 'hidden'].includes(b.status)) fail(400, 'Statut invalide');
      const mod = await one(env, 'SELECT * FROM modules WHERE code = ?', b.code); if (!mod) fail(404, 'Service inconnu');
      await env.DB.prepare('UPDATE modules SET site_status = ? WHERE code = ?').bind(b.status, b.code).run();
      await audit(env, user, 'site.service_status', 'modules', b.code, { site_status: mod.site_status }, { site_status: b.status }, req);
      return json({ ok: true });
    }
    if (id === 'photo' && action && req.method === 'POST') {
      if (!PHOTO_SLOTS.includes(action)) fail(400, 'Emplacement inconnu');
      const f = await storeFile(env, req, { ownerType: 'site', ownerId: action, kind: 'photo', allowed: ['image/jpeg', 'image/png', 'image/webp'], createdBy: user.id });
      await setPhoto(env, action, f.id, user);
      await audit(env, user, 'site.photo', 'site_content', 'img.' + action, null, { file: f.name }, req);
      return json({ file: f }, 201);
    }
    if (id === 'photo' && action && req.method === 'DELETE') {
      if (!PHOTO_SLOTS.includes(action)) fail(400, 'Emplacement inconnu');
      await setPhoto(env, action, null, user);
      await audit(env, user, 'site.photo_removed', 'site_content', 'img.' + action, null, null, req);
      return json({ ok: true });
    }
    fail(405, 'Méthode non prise en charge');
  }
  return null;
}

async function setPhoto(env, slot, fileId, user) {
  const old = await one(env, "SELECT value FROM site_content WHERE lang = '*' AND key = ?", 'img.' + slot);
  const st = [];
  if (old?.value) st.push(env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(now(), old.value));
  st.push(fileId
    ? env.DB.prepare("INSERT INTO site_content (lang, key, value, updated_at, updated_by) VALUES ('*', ?, ?, ?, ?) ON CONFLICT(lang, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind('img.' + slot, fileId, now(), user.full_name)
    : env.DB.prepare("DELETE FROM site_content WHERE lang = '*' AND key = ?").bind('img.' + slot));
  await env.DB.batch(st);
}

// Purge des fichiers mis de côté (photos remplacées) : appelée par la tâche planifiée
export async function purgeFiles(env) {
  const old = await all(env, "SELECT id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')");
  for (const f of old) await env.DB.batch([env.DB.prepare('DELETE FROM file_chunks WHERE file_id = ?').bind(f.id), env.DB.prepare('DELETE FROM files WHERE id = ?').bind(f.id)]);
}
