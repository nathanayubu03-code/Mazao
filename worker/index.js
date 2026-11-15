// Point d'entrée du Worker : sert l'API /api/* ; les fichiers statiques sont servis par Cloudflare (dossier public/).
import { ensureSchema } from './socle/schema.js';
import { json, HttpError, fail } from './socle/util.js';
import { getAuth, requireRole, routeAuth, publicUser } from './socle/auth.js';
import { routeAdmin, purgeTrash } from './socle/admin.js';
import { routeProducers, routeSim, agentPoints } from './socle/producers.js';

async function ref(env, auth) {
  const user = requireRole(auth);
  const all = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const settings = Object.fromEntries((await all('SELECT key, value FROM settings')).map(r => [r.key, r.value]));
  const out = {
    me: publicUser(user),
    zones: await all('SELECT id, parent_id, level, name, code FROM zones WHERE deleted_at IS NULL AND active = 1 ORDER BY name'),
    collection_points: await all('SELECT id, village_id, name, lat, lng FROM collection_points WHERE deleted_at IS NULL AND active = 1 ORDER BY name'),
    commodities: await all('SELECT id, code, name_fr, name_sw, unit, eudr_scope FROM commodities WHERE deleted_at IS NULL AND active = 1 ORDER BY name_fr'),
    grades: (await all('SELECT id, commodity_id, code, label_fr, label_sw, criteria, rank FROM grades WHERE deleted_at IS NULL AND active = 1 ORDER BY commodity_id, rank')).map(g => ({ ...g, criteria: JSON.parse(g.criteria || '[]') })),
    settings: { exchange_rate: Number(settings.exchange_rate), cooperative_name: settings.cooperative_name, ussd_code: settings.ussd_code, demo_enabled: settings.demo_enabled === '1' },
    modules: await all('SELECT code, label, enabled, availability FROM modules ORDER BY code'),
    server_time: new Date().toISOString()
  };
  if (user.role === 'agent') {
    out.my_points = await agentPoints(env, user);
    // Prochain numéro de producteur pour cet agent (le compteur continue ensuite hors ligne sur l'appareil)
    const r = await env.DB.prepare('SELECT MAX(CAST(substr(code, ?) AS INTEGER)) AS n FROM producers WHERE code LIKE ?').bind(user.agent_code.length + 2, user.agent_code + '-%').first();
    out.next_seq = (r?.n || 0) + 1;
  }
  return json(out);
}

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api/public/status') {
    const d = await env.DB.prepare("SELECT value FROM settings WHERE key = 'demo_enabled'").first();
    const c = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cooperative_name'").first();
    return json({ ok: true, demo: d?.value === '1', cooperative_name: c?.value ?? '' });
  }
  const auth = await getAuth(env, req);
  if (path.startsWith('/api/auth/') || path === '/api/me') return routeAuth(env, req, path, auth);
  if (path === '/api/ref') return ref(env, auth);
  if (path.startsWith('/api/admin/')) return routeAdmin(env, req, path, requireRole(auth, 'admin'));
  if (path.startsWith('/api/producers')) return routeProducers(env, req, path, requireRole(auth, 'agent', 'coordination', 'admin'));
  if (path.startsWith('/api/sim/')) return routeSim(env, req, path, requireRole(auth, 'coordination', 'admin'));
  fail(404, 'Route inconnue');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      await ensureSchema(env);
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      return json({ error: 'Erreur serveur. Réessayez.' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(purgeTrash(env));
  }
};
