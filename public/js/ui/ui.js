// Composants d'interface : icônes Lucide, notifications, modales, squelettes, thème, bandeau démo.
import { esc } from '../socle/util.js';
import { api } from '../socle/api.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"/></svg>`;
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function toast(msg, type = '') {
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const ic = { ok: 'circle-check', err: 'circle-x', warn: 'triangle-alert' }[type] || 'info';
  const el = document.createElement('div'); el.className = 'toast ' + type;
  el.innerHTML = icon(ic) + '<span>' + esc(msg) + '</span>';
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 4200);
}

let onClose = null;
export function modal({ title, body, actions = [], wide = false, onclose = null }) {
  closeModal(true);
  onClose = onclose;
  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal';
  bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h3 class="grow">${esc(title)}</h3><button class="icon-btn" data-close aria-label="Fermer">${icon('x')}</button></div><div class="modal-b">${body}</div>${actions.length ? '<div class="modal-f"></div>' : ''}</div>`;
  const f = $('.modal-f', bg);
  for (const a of actions) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (a.cls || ''); b.innerHTML = a.label; if (a.id) b.id = a.id;
    b.addEventListener('click', a.onClick); f.appendChild(b);
  }
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeModal(); });
  document.body.appendChild(bg);
  setTimeout(() => $('input,select,textarea', bg)?.focus(), 50);
  return bg;
}
export function closeModal(silent) {
  const m = $('#modal'); if (m) m.remove();
  const cb = onClose; onClose = null; if (cb && !silent) cb();
}
addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal')) closeModal(); });

export function confirmBox(title, text, okLabel, onOk, danger = false) {
  modal({ title, body: `<p>${text}</p>`, actions: [{ label: 'Annuler', onClick: () => closeModal() }, { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: onOk }] });
}

export const skeleton = (n = 4) => Array.from({ length: n }, (_, i) => `<div class="sk sk-line" style="width:${90 - (i % 3) * 18}%"></div>`).join('');

// Compteur qui monte jusqu'à sa valeur (transform/opacity non concernés : on change seulement le texte)
export function countUp(el, value, fmt = (v) => Math.round(v).toLocaleString('fr-FR')) {
  if (reducedMotion() || !value) { el.textContent = fmt(value); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(value * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* Thème clair / sombre (espaces web) */
export function initTheme() {
  let t = null; try { t = localStorage.getItem('kt.theme'); } catch {}
  if (t) document.documentElement.dataset.theme = t;
}
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('kt.theme', next); } catch {}
}

/* Bandeau « Données fictives » */
export async function demoBanner(status) {
  try { status = status || await api('/api/public/status'); } catch { return; }
  let b = $('.demo-banner');
  if (status.demo && !b) {
    b = document.createElement('div'); b.className = 'demo-banner';
    b.textContent = 'Données fictives : mode démonstration actif. Désactivez-le dans /admin avant le pilote réel.';
    document.body.prepend(b);
  } else if (!status.demo && b) b.remove();
}

export const consentBadge = (s) => ({
  granted: `<span class="badge b-ok">${icon('circle-check')}Consentement validé</span>`,
  pending: `<span class="badge b-warn">${icon('clock')}Consentement en attente</span>`,
  refused: `<span class="badge b-err">${icon('circle-x')}Consentement refusé</span>`,
  withdrawn: `<span class="badge b-err">${icon('circle-x')}Consentement retiré</span>`
}[s] || '');
