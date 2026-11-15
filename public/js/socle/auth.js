// Connexion. Le mot de passe ne quitte jamais l'appareil : on envoie une clé dérivée
// par PBKDF2-SHA256 (100 000 tours, sel propre à chaque compte).
import { api, session } from './api.js';

const ITER = 100000;
const hex = (b) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b, 16)));

export async function derive(password, saltHex, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iter }, key, 256));
}

// Prépare un nouveau mot de passe (création de compte, réinitialisation, changement)
export async function makePassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: ITER, dk: await derive(password, salt, ITER) };
}

export function passwordProblem(pw) {
  if (pw.length < 10) return '10 caractères minimum';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Lettres et chiffres obligatoires';
  return null;
}

let lastLogin = null; // gardé en mémoire pour un éventuel changement de mot de passe juste après
export async function login(loginName, password, kind) {
  const { salt, iter } = await api('/api/auth/salt', { method: 'POST', body: { login: loginName } });
  const dk = await derive(password, salt, iter);
  lastLogin = { dk };
  const deviceId = deviceIdentity();
  const r = await api('/api/auth/login', { method: 'POST', body: { login: loginName, dk, kind, device_id: deviceId } });
  if (r.stage === 'ok') session.set({ token: r.token, user: r.user, at: Date.now() });
  return r;
}

export async function confirmTotp(pendingToken, code, space = null) {
  const r = await api('/api/auth/totp', { method: 'POST', token: pendingToken, body: { code } });
  const s = { token: r.token, user: r.user, at: Date.now() };
  if (space) session.setFor(space, s); else session.set(s);
  return r;
}

export async function changePassword(oldPassword, newPassword) {
  const me = session.get()?.user;
  const { salt, iter } = await api('/api/auth/salt', { method: 'POST', body: { login: me.login } });
  const old_dk = await derive(oldPassword, salt, iter);
  const n = await makePassword(newPassword);
  await api('/api/auth/password', { method: 'POST', body: { old_dk, ...n } });
  const s = session.get(); if (s) { s.user.must_change = false; session.set(s); }
}

export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  session.clear();
}

export function deviceIdentity() {
  try {
    let id = localStorage.getItem('kt.device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('kt.device', id); }
    return id;
  } catch { return null; }
}

export const HOME = { agent: '/app', buyer: '/acheteur', coordination: '/coordination', cooperative: '/coordination', partner: '/coordination', admin: '/admin' };
// Espace (clé de session) de chaque rôle
export const SPACE_OF = { agent: 'agent', admin: 'admin' };

// Garde d'accès d'une page : renvoie l'utilisateur ou redirige vers la connexion
export async function guard(roles) {
  const s = session.get();
  if (!s?.token) { location.replace('/connexion?next=' + encodeURIComponent(location.pathname)); return null; }
  if (!roles.includes(s.user.role)) { location.replace(HOME[s.user.role] || '/connexion'); return null; }
  return s.user;
}
