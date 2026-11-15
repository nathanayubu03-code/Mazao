// Données de démonstration : activables et désactivables depuis /admin.
// Toutes les lignes portent is_demo = 1 ; les désactiver les supprime proprement.
import { uuid, now } from './util.js';
import { demoPolygon, ringAreaHa } from './geo.js';
import { renderTemplate } from './messaging.js';

const DEMO_PW = { salt: 'fa203022ef4d4e7e832819c760c648bd', hash: 'a26f6507fd95fd90b9e52bf97e125736515fcba4775f8bc0288fc8ed71b16dfe' };
export const DEMO_ACCOUNTS = [
  { id: 'demo-user-agent1', login: 'agent.demo', full_name: 'Agent démo 1', role: 'agent', agent_code: 'AG01', lang: 'fr' },
  { id: 'demo-user-agent2', login: 'agent2.demo', full_name: 'Agent démo 2', role: 'agent', agent_code: 'AG02', lang: 'sw' },
  { id: 'demo-user-coord', login: 'coord.demo', full_name: 'Coordination démo', role: 'coordination' },
  { id: 'demo-user-buyer', login: 'acheteur.demo', full_name: 'Acheteur démo', role: 'buyer' }
];
// Compte supplémentaire créé avec le portail : attente.demo (acheteur en attente de validation)
export const DEMO_PASSWORD = 'Demo-Kivu-2026';

// Tables qui portent is_demo, dans l'ordre de suppression (enfants d'abord)
export const DEMO_TABLES = ['messages', 'consent_events', 'plots', 'baselines', 'producers', 'agent_assignments', 'collection_points', 'zones', 'users'];

export async function setDemo(env, enabled, actor) {
  const t = now();
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('demo_enabled', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind(enabled ? '1' : '0', t, actor?.full_name ?? 'système').run();
  if (!enabled) return removeDemo(env);
  const has = await env.DB.prepare('SELECT COUNT(*) AS n FROM producers WHERE is_demo = 1').first();
  if (!has.n) { await seedDemo(env); if (await hasTable(env, 'organizations')) await seedPortalDemo(env); }
}

const hasTable = async (env, name) => !!(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());

// Portail : une entreprise acheteuse validée (compte acheteur.demo), une demande d'inscription
// en attente (compte attente.demo) et une demande de démonstration, pour essayer /admin.
export async function seedPortalDemo(env) {
  const t = now();
  const activity = (o) => JSON.stringify(o);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO organizations (id, kind, name, org_type, rccm, nif, address, country, contact_name, contact_role, phone, email, lang, activity, status, decided_at, submitted_at, is_demo, created_at, updated_at)
      VALUES ('demo-org-buyer', 'buyer', 'Acheteur démo SARL', 'exportateur', 'CD/GOM/RCCM/24-B-00000', 'A0000000X', 'Avenue du Lac, Goma', 'RD Congo', 'Acheteur démo', 'Directeur des achats', '+243990000001', 'acheteur@demo.invalid', 'fr', ?, 'approved', ?, ?, 1, ?, ?)`)
      .bind(activity({ commodities: ['cafe_arabica'], volume_t: 120, zones: ['zone-t-kalehe', 'zone-t-masisi'], eu_export: true }), t, t, t, t),
    env.DB.prepare("UPDATE users SET org_id = 'demo-org-buyer' WHERE id = 'demo-user-buyer'"),
    env.DB.prepare(`INSERT OR IGNORE INTO organizations (id, kind, name, org_type, address, country, contact_name, contact_role, phone, email, lang, activity, status, submitted_at, is_demo, created_at, updated_at)
      VALUES ('demo-org-pending', 'buyer', 'Kivu Highlands Coffee (démo)', 'transformateur', 'Bukavu', 'RD Congo', 'Grâce Mushagalusa', 'Gérante', '+243990000002', 'attente@demo.invalid', 'fr', ?, 'pending', ?, 1, ?, ?)`)
      .bind(activity({ commodities: ['cafe_arabica', 'cacao'], volume_t: 40, zones: ['zone-t-kabare', 'zone-t-kalehe'], eu_export: false }), t, t, t),
    env.DB.prepare(`INSERT OR IGNORE INTO users (id, login, full_name, email, phone, role, lang, pw_salt, pw_iter, pw_hash, account_status, org_id, is_demo, created_at, updated_at)
      VALUES ('demo-user-pending', 'attente.demo', 'Grâce Mushagalusa', 'attente@demo.invalid', '+243990000002', 'buyer', 'fr', ?, 100000, ?, 'pending', 'demo-org-pending', 1, ?, ?)`).bind(DEMO_PW.salt, DEMO_PW.hash, t, t),
    env.DB.prepare(`INSERT OR IGNORE INTO demo_requests (id, name, organization, phone, email, message, lang, status, created_at, is_demo)
      VALUES ('demo-dr-1', 'Patrick Mumbere', 'ONG Terres du Kivu (démo)', '+243990000003', 'demo@demo.invalid', 'Nous suivons 400 caféiculteurs à Kalehe et voudrions voir la traçabilité.', 'fr', 'new', ?, 1)`).bind(t)
  ]);
}

export async function removeDemo(env) {
  const extra = [];
  // Tables ajoutées par les modules (créées plus tard) : on ignore celles qui n'existent pas encore
  for (const tb of ['payments', 'weighings', 'order_offers', 'lots', 'purchase_orders', 'buyers', 'sync_ops', 'organizations', 'demo_requests', 'files']) {
    const ex = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(tb).first();
    if (ex) {
      const cols = await env.DB.prepare(`PRAGMA table_info(${tb})`).all();
      if (cols.results.some(c => c.name === 'is_demo')) extra.push(env.DB.prepare(`DELETE FROM ${tb} WHERE is_demo = 1`));
    }
  }
  if (await hasTable(env, 'file_chunks')) extra.unshift(env.DB.prepare('DELETE FROM file_chunks WHERE file_id IN (SELECT id FROM files WHERE is_demo = 1)'));
  await env.DB.batch([
    ...extra,
    env.DB.prepare('DELETE FROM producer_commodities WHERE producer_id IN (SELECT id FROM producers WHERE is_demo = 1)'),
    env.DB.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)"),
    ...DEMO_TABLES.map(tb => env.DB.prepare(`DELETE FROM ${tb} WHERE is_demo = 1`))
  ]);
}

async function seedDemo(env) {
  const t = now(); const st = [];
  const ins = (sql, ...a) => st.push(env.DB.prepare(sql).bind(...a));
  const zone = (id, parent, level, name) => ins('INSERT INTO zones (id, parent_id, level, name, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id, parent, level, name, t, t);
  // Hiérarchie de démonstration (à vérifier et compléter par l'administrateur)
  zone('demo-z-buhavu', 'zone-t-kalehe', 'secteur_chefferie', 'Chefferie de Buhavu');
  zone('demo-z-buzi', 'demo-z-buhavu', 'groupement', 'Groupement de Buzi');
  zone('demo-z-minova', 'demo-z-buzi', 'village', 'Minova');
  zone('demo-z-bahunde', 'zone-t-masisi', 'secteur_chefferie', 'Chefferie des Bahunde');
  zone('demo-z-kamuronza', 'demo-z-bahunde', 'groupement', 'Groupement de Kamuronza');
  zone('demo-z-sake', 'demo-z-kamuronza', 'village', 'Sake');
  const pts = [['demo-cp-minova', 'demo-z-minova', 'Minova, marché central', -1.7050, 29.0300], ['demo-cp-sake', 'demo-z-sake', 'Sake, entrepôt coopératif', -1.5730, 29.0450]];
  for (const p of pts) ins('INSERT INTO collection_points (id, village_id, name, lat, lng, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', ...p, t, t);
  for (const u of DEMO_ACCOUNTS)
    ins(`INSERT INTO users (id, login, full_name, role, agent_code, lang, pw_salt, pw_iter, pw_hash, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 100000, ?, 1, ?, ?)`, u.id, u.login, u.full_name, u.role, u.agent_code ?? null, u.lang ?? 'fr', DEMO_PW.salt, DEMO_PW.hash, t, t);
  for (const [agent, cp] of [['demo-user-agent1', 'demo-cp-minova'], ['demo-user-agent1', 'demo-cp-sake'], ['demo-user-agent2', 'demo-cp-minova']])
    ins('INSERT INTO agent_assignments (id, agent_id, collection_point_id, start_date, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', uuid(), agent, cp, '2026-01-01', t, t);

  // [nom, sexe, année, téléphone, opérateur, point, village, consentement, ménage, cheffe, prod kg, revenu CDF, dernier prix CDF/kg, superficie, dLat, dLng]
  const P = [
    ['Furaha Mapendo', 'F', 1979, '+243812345671', 'MPESA', 'demo-cp-minova', 'demo-z-minova', 'granted', 6, 1, 650, 4_100_000, 6300, 1.4, 0.006, 0.004],
    ['Jean-Baptiste Bahati', 'M', 1971, '+243997214558', 'AIRTEL', 'demo-cp-minova', 'demo-z-minova', 'granted', 8, 0, 900, 5_400_000, 6000, 2.1, 0.009, -0.006],
    ['Esther Kavira', 'F', 1988, '+243970558312', 'AIRTEL', 'demo-cp-minova', 'demo-z-minova', 'granted', 5, 1, 520, 3_300_000, 6300, 1.1, 0.004, -0.009],
    ['Josué Kambale', 'M', 1983, '+243998305419', 'AIRTEL', 'demo-cp-minova', 'demo-z-minova', 'pending', 7, 0, 700, 4_000_000, 5700, 1.6, 0.011, 0.002],
    ['Mwamini Bisimwa', 'F', 1975, '+243821904417', 'MPESA', 'demo-cp-minova', 'demo-z-minova', 'granted', 9, 0, 1400, 8_500_000, 6100, 4.8, 0.014, 0.010],
    ['Neema Kahindo', 'F', 1991, '+243823661904', 'MPESA', 'demo-cp-sake', 'demo-z-sake', 'granted', 4, 1, 480, 2_900_000, 6000, 0.9, 0.010, 0.004],
    ['Emmanuel Ntambuka', 'M', 1968, '+243851409127', 'ORANGE', 'demo-cp-sake', 'demo-z-sake', 'granted', 10, 0, 820, 4_700_000, 5800, 1.9, 0.006, 0.008]
  ];
  const pointsById = Object.fromEntries(pts.map(p => [p[0], p]));
  let n = 0;
  for (const r of P) {
    n++;
    const [name, sex, by, phone, op, cp, village, consent, hh, fh, prodKg, income, lastPrice, area, dLat, dLng] = r;
    const id = 'demo-prod-' + n, code = 'AG01-' + String(n).padStart(4, '0');
    const created = `2026-0${3 + (n % 3)}-1${n}T08:30:00.000Z`;
    ins(`INSERT INTO producers (id, code, agent_id, full_name, sex, birth_year, phone, lang, momo_operator, village_id, collection_point_id, household_size, female_headed, consent_status, consent_at, is_demo, created_at, updated_at, created_by)
         VALUES (?, ?, 'demo-user-agent1', ?, ?, ?, ?, 'sw', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'demo-user-agent1')`,
      id, code, name, sex, by, phone, op, village, cp, hh, fh, consent, consent === 'granted' ? created : null, created, created);
    ins('INSERT INTO producer_commodities (producer_id, commodity_id) VALUES (?, ?)', id, 'com-cafe-arabica');
    ins(`INSERT INTO baselines (id, producer_id, season, production_kg, income_cdf, last_price_amount, last_price_currency, is_demo, created_at, updated_at)
         VALUES (?, ?, '2025B', ?, ?, ?, 'CDF', 1, ?, ?)`, uuid(), id, prodKg, income, lastPrice, created, created);
    const [, , , lat, lng] = pointsById[cp];
    const pl = { lat: lat + dLat, lng: lng + dLng };
    // Règle EUDR : un point sous 4 ha, un polygone au-delà
    const geom = area >= 4 ? demoPolygon(pl.lat, pl.lng, 250, 195) : { type: 'Point', coordinates: [+pl.lng.toFixed(6), +pl.lat.toFixed(6)] };
    const computed = area >= 4 ? Math.round(ringAreaHa(geom.coordinates[0]) * 100) / 100 : null;
    ins(`INSERT INTO plots (id, producer_id, commodity_id, declared_area_ha, geometry_type, geometry, computed_area_ha, captured_at, gps_accuracy_m, method, captured_by, is_demo, created_at, updated_at)
         VALUES (?, ?, 'com-cafe-arabica', ?, ?, ?, ?, ?, 6, 'gps', 'demo-user-agent1', 1, ?, ?)`,
      uuid(), id, area, area >= 4 ? 'polygon' : 'point', JSON.stringify(geom), computed, created, created, created);
    // Historique des SMS de consentement
    const vars = { nom: name.split(' ')[0] };
    const req = await renderTemplate(env, 'CONSENT_REQUEST', 'sw', vars);
    ins(`INSERT INTO messages (id, producer_id, phone, direction, channel, template_code, lang, body, status, provider, created_at, is_demo) VALUES (?, ?, ?, 'out', 'sms', 'CONSENT_REQUEST', 'sw', ?, 'delivered', 'simulateur', ?, 1)`, uuid(), id, phone, req, created);
    if (consent === 'granted') {
      const mid = uuid();
      ins(`INSERT INTO messages (id, producer_id, phone, direction, channel, body, status, provider, created_at, is_demo) VALUES (?, ?, ?, 'in', 'sms', 'NDIYO', 'received', 'simulateur', ?, 1)`, mid, id, phone, created);
      ins('INSERT INTO consent_events (id, producer_id, event, channel, message_id, at, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)', uuid(), id, 'granted', 'sms', mid, created);
      ins(`INSERT INTO messages (id, producer_id, phone, direction, channel, template_code, lang, body, status, provider, created_at, is_demo) VALUES (?, ?, ?, 'out', 'sms', 'CONSENT_OK', 'sw', ?, 'delivered', 'simulateur', ?, 1)`,
        uuid(), id, phone, await renderTemplate(env, 'CONSENT_OK', 'sw', vars), created);
    }
  }
  await env.DB.batch(st);
}
