// Authentification et sessions.
// Le hachage lourd (PBKDF2, 100 000 tours) est fait sur l'appareil : le client envoie
// la clé dérivée (dk). Le serveur stocke SHA-256(dk) et compare en temps constant.
// Un vol de la base n'expose donc que des empreintes dont chaque essai coûte 100 000 tours.
import { fail, json, now, uuid, readJson, randomHex, sha256Hex, hmacHex, hexToBytes, safeEqual, base32Encode, verifyTotp, sealSecret, openSecret } from './util.js';
import { audit } from './audit.js';

const HOURS = 3600_000;
export const SESSION_TTL = { web: 12 * HOURS, agent: 14 * 24 * HOURS, admin: 8 * HOURS, pending: 10 * 60_000 };
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;

export const publicUser = (u) => u && ({
  id: u.id, login: u.login, full_name: u.full_name, role: u.role, agent_code: u.agent_code, buyer_id: u.buyer_id,
  lang: u.lang, email: u.email, phone: u.phone, must_change: !!u.must_change, totp_enabled: !!u.totp_enabled, is_demo: !!u.is_demo,
  account_status: u.account_status || 'approved', org_id: u.org_id || null
});

async function createSession(env, user, kind, deviceId = null) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, kind, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(uuid(), user.id, await sha256Hex(token), kind, deviceId, now(), Date.now() + SESSION_TTL[kind]).run();
  return token;
}

// Résout la session à partir de l'en-tête Authorization: Bearer <jeton>
export async function getAuth(env, req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).first();
  if (!s || s.revoked_at || s.expires_at < Date.now()) return null;
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(s.user_id).first();
  if (!u || u.status !== 'active') return null;
  return { session: s, user: u };
}

// Contrôle d'accès : rôle attendu et session complète (l'administrateur doit être passé par le TOTP)
export function requireRole(auth, ...roles) {
  if (!auth || auth.session.kind === 'pending') fail(401, 'Connexion requise');
  if (roles.length && !roles.includes(auth.user.role)) fail(403, 'Accès refusé pour ce rôle');
  if (auth.user.role === 'admin' && auth.session.kind !== 'admin') fail(403, 'Connectez-vous par /admin avec la double authentification');
  return auth.user;
}

async function saltSecret(env) {
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'salt_secret'").first()).value;
}

export async function routeAuth(env, req, path, auth) {
  const body = req.method === 'POST' ? await readJson(req) : {};

  if (path === '/api/auth/salt') {
    const login = String(body.login || '').trim().toLowerCase();
    const u = await env.DB.prepare('SELECT pw_salt, pw_iter FROM users WHERE login = ? AND deleted_at IS NULL').bind(login).first();
    // Identifiant inconnu : sel fictif stable, pour ne pas révéler quels comptes existent
    if (!u) return json({ salt: (await hmacHex(await saltSecret(env), login)).slice(0, 32), iter: 100000 });
    return json({ salt: u.pw_salt, iter: u.pw_iter });
  }

  if (path === '/api/auth/login') {
    const login = String(body.login || '').trim().toLowerCase();
    const kind = ['web', 'agent', 'admin'].includes(body.kind) ? body.kind : 'web';
    const u = await env.DB.prepare('SELECT * FROM users WHERE login = ? AND deleted_at IS NULL').bind(login).first();
    const generic = 'Identifiant ou mot de passe incorrect';
    if (!u || typeof body.dk !== 'string') fail(401, generic);
    if (u.status === 'blocked') fail(403, 'Compte bloqué. Contactez l\'administrateur.');
    if (u.account_status === 'refused') fail(403, 'Demande d\'inscription refusée. Consultez le message reçu ou contactez-nous.');
    if (u.locked_until && u.locked_until > Date.now()) fail(429, `Trop de tentatives. Réessayez dans ${Math.ceil((u.locked_until - Date.now()) / 60000)} min.`);
    const ok = safeEqual(await sha256Hex(hexToBytes(body.dk)), u.pw_hash);
    if (!ok) {
      const fails = u.failed_attempts + 1;
      await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').bind(fails, fails >= MAX_FAILS ? Date.now() + LOCK_MS : null, u.id).run();
      if (fails >= MAX_FAILS) await audit(env, null, 'auth.lock', 'users', u.id, null, { login: u.login }, req);
      fail(401, generic);
    }
    await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
    if (u.role === 'admin') {
      // Double authentification obligatoire : session « en attente » jusqu'au code TOTP
      const token = await createSession(env, u, 'pending', body.device_id);
      if (!u.totp_enabled) {
        const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
        await env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').bind(await sealSecret(env, secret), u.id).run();
        const label = encodeURIComponent('KivuTrace:' + u.login);
        return json({ stage: 'enroll', token, secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=KivuTrace&algorithm=SHA1&digits=6&period=30` });
      }
      return json({ stage: 'totp', token });
    }
    if (kind === 'admin') fail(403, 'Cet espace est réservé aux administrateurs');
    const token = await createSession(env, u, u.role === 'agent' ? 'agent' : 'web', body.device_id);
    await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), u.id).run();
    return json({ stage: 'ok', token, user: publicUser(u) });
  }

  if (path === '/api/auth/totp') {
    if (!auth || auth.session.kind !== 'pending') fail(401, 'Session expirée, reconnectez-vous');
    const u = auth.user;
    const secret = await openSecret(env, u.totp_secret);
    const step = await verifyTotp(secret, body.code, u.totp_last_step);
    if (step < 0) fail(401, 'Code incorrect ou expiré');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ?, last_login_at = ? WHERE id = ?').bind(step, now(), u.id),
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(now(), auth.session.id)
    ]);
    if (!u.totp_enabled) await audit(env, u, 'auth.totp_enrolled', 'users', u.id, null, null, req);
    const token = await createSession(env, u, 'admin', auth.session.device_id);
    return json({ stage: 'ok', token, user: publicUser({ ...u, totp_enabled: 1 }) });
  }

  if (path === '/api/auth/password') {
    if (!auth || auth.session.kind === 'pending') fail(401, 'Connexion requise');
    const u = auth.user;
    if (!safeEqual(await sha256Hex(hexToBytes(String(body.old_dk || ''))), u.pw_hash)) fail(400, 'Mot de passe actuel incorrect');
    if (!/^[0-9a-f]{32}$/.test(body.salt || '') || !/^[0-9a-f]{64}$/.test(body.dk || '') || Number(body.iter) < 100000) fail(400, 'Paramètres de mot de passe invalides');
    await env.DB.prepare('UPDATE users SET pw_salt = ?, pw_iter = ?, pw_hash = ?, must_change = 0, updated_at = ?, version = version + 1 WHERE id = ?')
      .bind(body.salt, Number(body.iter), await sha256Hex(hexToBytes(body.dk)), now(), u.id).run();
    await audit(env, u, 'auth.password_changed', 'users', u.id, null, null, req);
    return json({ ok: true });
  }

  if (path === '/api/auth/logout') {
    if (auth) await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(now(), auth.session.id).run();
    return json({ ok: true });
  }

  if (path === '/api/me') {
    if (!auth || auth.session.kind === 'pending') fail(401, 'Connexion requise');
    return json({ user: publicUser(auth.user), session: { kind: auth.session.kind, expires_at: auth.session.expires_at } });
  }
  fail(404, 'Route inconnue');
}
