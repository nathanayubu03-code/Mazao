// Schéma D1. Les migrations s'appliquent seules au premier appel de l'API :
// aucune commande à lancer côté Cloudflare.
import { randomHex, now } from './util.js';

// Colonnes communes : traçabilité, corbeille, données de démonstration, version pour les conflits
const COMMON = `is_demo INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT, created_by TEXT, deleted_at TEXT`;

const M0001 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE users (
  id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, email TEXT, phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','coordination','buyer','agent')),
  buyer_id TEXT, agent_code TEXT UNIQUE, lang TEXT NOT NULL DEFAULT 'fr',
  pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL, pw_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, last_login_at TEXT, ${COMMON});

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  device_id TEXT, created_at TEXT, expires_at INTEGER NOT NULL, revoked_at TEXT);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT, last_sync_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT);

CREATE TABLE zones (
  id TEXT PRIMARY KEY, parent_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('province','territoire','secteur_chefferie','groupement','village')),
  name TEXT NOT NULL, code TEXT, active INTEGER NOT NULL DEFAULT 1, ${COMMON});
CREATE INDEX idx_zones_parent ON zones(parent_id);

CREATE TABLE collection_points (
  id TEXT PRIMARY KEY, village_id TEXT NOT NULL, name TEXT NOT NULL, lat REAL, lng REAL, active INTEGER NOT NULL DEFAULT 1, ${COMMON});

CREATE TABLE agent_assignments (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, collection_point_id TEXT NOT NULL, start_date TEXT, end_date TEXT, ${COMMON});

CREATE TABLE commodities (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name_fr TEXT NOT NULL, name_sw TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'kg',
  hs_code TEXT, eudr_scope INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, ${COMMON});

CREATE TABLE grades (
  id TEXT PRIMARY KEY, commodity_id TEXT NOT NULL, code TEXT NOT NULL, label_fr TEXT NOT NULL, label_sw TEXT NOT NULL,
  criteria TEXT NOT NULL DEFAULT '[]', rank INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, ${COMMON});

CREATE TABLE producers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, agent_id TEXT, full_name TEXT NOT NULL,
  sex TEXT CHECK (sex IN ('F','M')), birth_year INTEGER, phone TEXT, lang TEXT NOT NULL DEFAULT 'sw',
  momo_operator TEXT CHECK (momo_operator IN ('MPESA','AIRTEL','ORANGE')), voter_last4 TEXT,
  village_id TEXT, collection_point_id TEXT, household_size INTEGER, female_headed INTEGER,
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending','granted','refused','withdrawn')),
  consent_at TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','anonymized')),
  merged_into_id TEXT, ${COMMON});
CREATE INDEX idx_producers_phone ON producers(phone);
CREATE INDEX idx_producers_point ON producers(collection_point_id);

CREATE TABLE producer_commodities (producer_id TEXT NOT NULL, commodity_id TEXT NOT NULL, PRIMARY KEY (producer_id, commodity_id));

CREATE TABLE baselines (
  id TEXT PRIMARY KEY, producer_id TEXT NOT NULL, season TEXT, production_kg REAL, income_cdf REAL,
  last_price_amount REAL, last_price_currency TEXT, last_price_unit TEXT DEFAULT 'kg', ${COMMON});

CREATE TABLE plots (
  id TEXT PRIMARY KEY, producer_id TEXT NOT NULL, commodity_id TEXT, declared_area_ha REAL,
  geometry_type TEXT NOT NULL CHECK (geometry_type IN ('point','polygon')), geometry TEXT NOT NULL,
  computed_area_ha REAL, captured_at TEXT NOT NULL, gps_accuracy_m REAL, method TEXT, captured_by TEXT, ${COMMON});
CREATE INDEX idx_plots_producer ON plots(producer_id);

CREATE TABLE consent_events (id TEXT PRIMARY KEY, producer_id TEXT NOT NULL, event TEXT NOT NULL, channel TEXT, message_id TEXT, at TEXT, is_demo INTEGER NOT NULL DEFAULT 0);

CREATE TABLE messages (
  id TEXT PRIMARY KEY, producer_id TEXT, phone TEXT, direction TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'sms',
  template_code TEXT, lang TEXT, body TEXT, status TEXT, provider TEXT, provider_ref TEXT,
  related_type TEXT, related_id TEXT, created_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_messages_phone ON messages(phone);

CREATE TABLE sms_templates (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, lang TEXT NOT NULL, body TEXT NOT NULL, description TEXT, ${COMMON}, UNIQUE (code, lang));

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT);
CREATE TABLE modules (code TEXT PRIMARY KEY, label TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, availability TEXT NOT NULL);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT,
  before TEXT, after TEXT, at TEXT NOT NULL, ip TEXT);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE sync_ops (op_id TEXT PRIMARY KEY, device_id TEXT, user_id TEXT, entity TEXT, entity_id TEXT, op TEXT, payload_hash TEXT, result TEXT, received_at TEXT);

CREATE TABLE data_requests (id TEXT PRIMARY KEY, producer_id TEXT NOT NULL, type TEXT NOT NULL, requested_at TEXT, handled_by TEXT, handled_at TEXT, outcome TEXT);
`;

// Données de référence réelles (non fictives) : provinces et territoires, filières, grades, modèles de SMS
const NK = ['Beni', 'Lubero', 'Masisi', 'Nyiragongo', 'Rutshuru', 'Walikale'];
const SK = ['Fizi', 'Idjwi', 'Kabare', 'Kalehe', 'Mwenga', 'Shabunda', 'Uvira', 'Walungu'];

export const TEMPLATES = [
  ['CONSENT_REQUEST', 'sw', 'Jambo {nom}, {cooperative} imekuandikisha. Ili kukubali matumizi ya data yako (ufuatiliaji, malipo), jibu NDIYO. Kukataa, jibu HAPANA.', 'Demande de consentement envoyée à l\'inscription'],
  ['CONSENT_REQUEST', 'fr', 'Bonjour {nom}, {cooperative} vous a inscrit. Pour accepter l\'usage de vos données (traçabilité, paiement), répondez NDIYO. Pour refuser, répondez HAPANA.', 'Demande de consentement envoyée à l\'inscription'],
  ['CONSENT_OK', 'sw', 'Asante {nom}. Ridhaa yako imepokelewa. Utapokea maagizo ya ununuzi kwa SMS. Kusitisha wakati wowote, jibu SITISHA.', 'Confirmation du consentement'],
  ['CONSENT_OK', 'fr', 'Merci {nom}. Votre consentement est enregistré. Vous recevrez les ordres d\'achat par SMS. Pour arrêter à tout moment, répondez SITISHA.', 'Confirmation du consentement'],
  ['CONSENT_REFUSED', 'sw', 'Sawa {nom}. Hatutatumia data yako. Unaweza kubadilisha uamuzi kwa kujibu NDIYO.', 'Refus du consentement'],
  ['CONSENT_REFUSED', 'fr', 'D\'accord {nom}. Vos données ne seront pas utilisées. Vous pouvez changer d\'avis en répondant NDIYO.', 'Refus du consentement'],
  ['HELP', 'sw', 'Samahani, hatukuelewa. Jibu NDIYO kukubali, HAPANA kukataa, au piga {ussd}.', 'Réponse non comprise'],
  ['HELP', 'fr', 'Désolé, message non compris. Répondez NDIYO pour accepter, HAPANA pour refuser, ou composez {ussd}.', 'Réponse non comprise']
];

export const MIGRATIONS = [
  { id: 1, sql: M0001, seed: async (env) => {
    const t = now(); const st = [];
    const ins = (sql, ...args) => st.push(env.DB.prepare(sql).bind(...args));
    ins('INSERT INTO meta (key, value) VALUES (?, ?)', 'salt_secret', randomHex(32));
    // Compte administrateur initial (mot de passe transmis hors du dépôt, à changer à la 1re connexion)
    ins(`INSERT INTO users (id, login, full_name, role, pw_salt, pw_iter, pw_hash, must_change, created_at, updated_at)
         VALUES (?, 'admin', 'Administrateur', 'admin', ?, 100000, ?, 1, ?, ?)`,
      crypto.randomUUID(), '62b189e00acaa546b0bad74d99e37da6', '5f09034e83a0c077d2f60110e74ea1596755782eaf2f29d4ec45850dd5b6268a', t, t);
    for (const [prov, list] of [['Nord-Kivu', NK], ['Sud-Kivu', SK]]) {
      const pid = 'zone-' + prov.toLowerCase();
      ins('INSERT INTO zones (id, level, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', pid, 'province', prov, t, t);
      for (const terr of list) ins('INSERT INTO zones (id, parent_id, level, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        'zone-t-' + terr.toLowerCase(), pid, 'territoire', terr, t, t);
    }
    const crit = (o) => JSON.stringify(o);
    const commodities = [
      ['com-cafe-arabica', 'CAFE_ARABICA', 'Café arabica', 'Kahawa arabika', '0901', 1],
      ['com-cacao', 'CACAO', 'Cacao', 'Kakao', '1801', 1]
    ];
    for (const c of commodities) ins('INSERT INTO commodities (id, code, name_fr, name_sw, hs_code, eudr_scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...c, t, t);
    // Grades d'exemple, modifiables dans /admin (à valider avec l'acheteur)
    const grades = [
      ['grd-cafe-1', 'com-cafe-arabica', 'G1', 'Grade 1', 'Daraja 1', crit([{ key: 'humidite', label: 'Humidité', unit: '%', max: 12 }, { key: 'defauts', label: 'Défauts (pour 350 g)', unit: 'nb', max: 5 }]), 1],
      ['grd-cafe-2', 'com-cafe-arabica', 'G2', 'Grade 2', 'Daraja 2', crit([{ key: 'humidite', label: 'Humidité', unit: '%', max: 12.5 }, { key: 'defauts', label: 'Défauts (pour 350 g)', unit: 'nb', max: 15 }]), 2],
      ['grd-cafe-3', 'com-cafe-arabica', 'G3', 'Grade 3', 'Daraja 3', crit([{ key: 'humidite', label: 'Humidité', unit: '%', max: 13 }, { key: 'defauts', label: 'Défauts (pour 350 g)', unit: 'nb', max: 30 }]), 3],
      ['grd-cacao-1', 'com-cacao', 'G1', 'Grade I', 'Daraja I', crit([{ key: 'humidite', label: 'Humidité', unit: '%', max: 7.5 }, { key: 'moisies', label: 'Fèves moisies', unit: '%', max: 3 }, { key: 'ardoisees', label: 'Fèves ardoisées', unit: '%', max: 3 }]), 1],
      ['grd-cacao-2', 'com-cacao', 'G2', 'Grade II', 'Daraja II', crit([{ key: 'humidite', label: 'Humidité', unit: '%', max: 7.5 }, { key: 'moisies', label: 'Fèves moisies', unit: '%', max: 4 }, { key: 'ardoisees', label: 'Fèves ardoisées', unit: '%', max: 8 }]), 2]
    ];
    for (const g of grades) ins('INSERT INTO grades (id, commodity_id, code, label_fr, label_sw, criteria, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ...g, t, t);
    for (const [code, lang, body, desc] of TEMPLATES) ins('INSERT INTO sms_templates (id, code, lang, body, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), code, lang, body, desc, t, t);
    for (const [k, v] of [['exchange_rate', '2850'], ['demo_enabled', '0'], ['cooperative_name', 'Coopérative pilote'], ['ussd_code', '*384*20#']])
      ins('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', k, v, t);
    for (const [code, label, en, av] of [['m1', 'Traçabilité café/cacao et ordres d\'achat', 1, 'live'], ['m2', 'Bons électroniques et paiements ONG', 0, 'soon'], ['m3', 'Conseil agricole, prix et alertes élevage', 0, 'soon'], ['m4', 'Crédit sur historique de livraisons', 0, 'soon']])
      ins('INSERT INTO modules (code, label, enabled, availability) VALUES (?, ?, ?, ?)', code, label, en, av);
    await env.DB.batch(st);
  } }
];

let ready = null;
export function ensureSchema(env) {
  if (!ready) ready = migrate(env).catch(e => { ready = null; throw e; });
  return ready;
}
async function migrate(env) {
  await env.DB.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
  let version = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS) {
    if (m.id <= version) continue;
    // D1 exec : une instruction par ligne logique
    for (const stmt of m.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      await env.DB.prepare(stmt.replace(/CREATE TABLE (?!IF)/, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX (?!IF)/, 'CREATE INDEX IF NOT EXISTS ')).run();
    }
    if (m.seed) await m.seed(env);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(m.id)).run();
    version = m.id;
    if (m.id === 1) {
      // Données de démonstration activées par défaut pour le prototype
      const { setDemo } = await import('./demo.js');
      await setDemo(env, true, null);
    }
  }
}
