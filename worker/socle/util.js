// Utilitaires serveur : réponses JSON, erreurs, hachage, TOTP (RFC 6238), dates.

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

export async function readJson(req) {
  const text = await req.text();
  if (text.length > 2_000_000) fail(413, 'Requête trop volumineuse');
  if (!text) return {};
  try { return JSON.parse(text); } catch { fail(400, 'JSON invalide'); }
}

export const hexToBytes = (h) => {
  if (typeof h !== 'string' || !/^[0-9a-f]*$/i.test(h) || h.length % 2) fail(400, 'Format invalide');
  return new Uint8Array(h.match(/.{2}/g)?.map(b => parseInt(b, 16)) ?? []);
};
export const bytesToHex = (b) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
export const randomHex = (n) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));

export async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return bytesToHex(await crypto.subtle.digest('SHA-256', buf));
}
export async function hmacHex(key, msg, hash = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
// Comparaison à temps constant de deux chaînes hexadécimales
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---- TOTP ---- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = str.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of clean) { const i = B32.indexOf(c); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function hotp(secretB32, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8); const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32)); view.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}
// Renvoie le pas de temps accepté (pour bloquer le rejeu) ou -1
export async function verifyTotp(secretB32, code, lastStep = 0) {
  if (!/^\d{6}$/.test(String(code || ''))) return -1;
  const step = Math.floor(Date.now() / 30000);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    if (safeEqual(await hotp(secretB32, s), String(code))) return s;
  }
  return -1;
}

/* ---- Chiffrement optionnel du secret TOTP (clé TOTP_KEY en secret Cloudflare) ---- */
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TOTP_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealSecret(env, plain) {
  if (!env.TOTP_KEY) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(plain));
  return 'enc:' + bytesToHex(iv) + ':' + bytesToHex(ct);
}
export async function openSecret(env, stored) {
  if (!stored || !stored.startsWith('enc:')) return stored;
  if (!env.TOTP_KEY) fail(500, 'Clé TOTP_KEY manquante pour lire le secret');
  const [, iv, ct] = stored.split(':');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(iv) }, await aesKey(env), hexToBytes(ct));
  return new TextDecoder().decode(pt);
}

/* ---- Téléphone RDC ---- */
export function normPhone(raw) {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('00243')) s = '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) s = '+243' + s.slice(1);
  if (/^243\d{9}$/.test(s)) s = '+' + s;
  return /^\+243[89]\d{8}$/.test(s) ? s : null;
}
export const maskPhone = (p) => p ? p.slice(0, 6) + ' ••• ••' + p.slice(-3) : null;

export const clampStr = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max));

// Téléphone d'un compte inscrit sur le site : RDC (+243) ou international (E.164)
export function normIntlPhone(raw) {
  const drc = normPhone(raw); if (drc) return drc;
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
export const isEmail = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(String(v || '')) && String(v).length <= 254;
