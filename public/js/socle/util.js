// Utilitaires partagés (navigateur) : échappement, formats, téléphone, CSV, téléchargement.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uuid = () => crypto.randomUUID();
export const num = (n, d = 0) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ | /g, ' ');
export const money = (n, cur) => cur === 'USD' ? '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : num(Math.round(n || 0)) + ' FC';
export const date = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
export const dateTime = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function normPhone(raw) {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('00243')) s = '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) s = '+243' + s.slice(1);
  if (/^243\d{9}$/.test(s)) s = '+' + s;
  return /^\+243[89]\d{8}$/.test(s) ? s : null;
}
export const fmtPhone = (p) => p ? p.replace(/^\+243(\d{3})(\d{3})(\d{3})$/, '+243 $1 $2 $3') : '';
export const OPERATORS = { MPESA: { label: 'M-Pesa', nums: ['81', '82', '83'] }, AIRTEL: { label: 'Airtel Money', nums: ['97', '98', '99'] }, ORANGE: { label: 'Orange Money', nums: ['84', '85', '89', '80'] } };
export function operatorFor(phone) {
  const two = (phone || '').slice(4, 6);
  return Object.keys(OPERATORS).find(k => OPERATORS[k].nums.includes(two)) || null;
}

// CSV : séparateur ; (Excel français), BOM UTF-8. Lecture : ; ou , détecté.
export function toCSV(headers, rows) {
  const cell = v => { v = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + [headers, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
}
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(x => String(x).trim() !== ''));
  if (!clean.length) return [];
  const head = clean[0].map(h => h.trim());
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
export function download(name, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export const pickFile = (accept) => new Promise(res => { const i = Object.assign(document.createElement('input'), { type: 'file', accept }); i.onchange = () => res(i.files[0] || null); i.click(); });
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
