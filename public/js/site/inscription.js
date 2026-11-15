// Inscription : choix du profil puis formulaire en 3 étapes avec barre de progression.
// Les agents sont créés par l'administrateur ; les producteurs s'inscrivent auprès d'un agent ou par USSD.
import { S, t, esc, icon, $, $$, shell, setMeta, loadAll, pickLang } from './core.js';
import { makePassword } from '../socle/auth.js';

const PROFILES = [['buyer', 'shopping-cart'], ['cooperative', 'users'], ['partner', 'handshake']];
const TYPES = {
  buyer: ['exportateur', 'transformateur', 'cooperative_acheteuse', 'commercant', 'ong_acheteuse'],
  cooperative: ['cooperative', 'union', 'association', 'groupement'],
  partner: ['ong_internationale', 'ong_locale', 'bailleur', 'agence_publique', 'entreprise', 'autre']
};
const COMS = ['cafe_arabica', 'cacao', 'vivres'];
const COUNTRIES = ['RD Congo', 'Rwanda', 'Ouganda', 'Burundi', 'Kenya', 'Tanzanie', 'Belgique', 'France', 'Pays-Bas', 'Allemagne', 'Suisse', 'Italie', 'Royaume-Uni', 'États-Unis'];
const MAX = 1_500_000, OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const qp = new URLSearchParams(location.search).get('profil');
const D = { profile: TYPES[qp] ? qp : null, step: 0, f: { country: 'RD Congo', activity: { commodities: [], zones: [], eu_export: null } }, files: [], consent: false };
let M = null;

const isBuyer = () => D.profile === 'buyer';
const field = (id, label, opts = {}) => `<div class="${opts.full ? 'full' : ''}"><label class="lbl" for="${id}">${esc(label)}${opts.req ? ' *' : opts.opt ? ` <span class="muted" style="font-weight:400">(${esc(t('common.optional'))})</span>` : ''}</label>
  ${opts.area ? `<textarea class="input" id="${id}" rows="3">${esc(opts.value ?? '')}</textarea>` : `<input class="input" id="${id}" type="${opts.type || 'text'}" value="${esc(opts.value ?? '')}" ${opts.attrs || ''}>`}
  ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}<div class="err" data-err="${id}"></div></div>`;
const chips = (name, items, selected, multi, label) => `<div class="chips" data-chips="${name}" data-multi="${multi ? 1 : 0}">${items.map(([v, l]) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${multi ? selected.includes(v) : selected === v}">${esc(l)}</button>`).join('')}</div><div class="err" data-err="${name}"></div>`;

function render() {
  setMeta('reg.title');
  const s = D.step;
  M.innerHTML = `<section class="form-page"><div class="wrap"><div class="form-card">
    <h1>${esc(t('reg.title'))}</h1><p class="small muted">${esc(t('reg.lead'))}</p>
    <div id="body" class="step-enter"></div></div>
    <p class="small muted" style="text-align:center;margin-top:16px"><a href="/connexion">${esc(t('buyers.have'))}</a></p></div></section>`;
  const body = $('#body');
  if (s === 0) return choose(body);
  if (s === 4) return done(body);
  const names = [isBuyer() ? t('reg.s1.buyer') : t('reg.s1.org'), t('reg.s2'), isBuyer() ? t('reg.s3.buyer') : t('reg.s3.org')];
  body.innerHTML = `<div class="row" style="margin-top:12px"><span class="badge b-pri">${icon(PROFILES.find(p => p[0] === D.profile)[1])}${esc(t('reg.p.' + D.profile))}</span>
      <button type="button" class="btn sm ghost" id="chg">${esc(t('common.back'))}</button></div>
    <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="3" aria-valuenow="${s}">${[1, 2, 3].map(i => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>
    <div class="step-name">${esc(t('reg.step', { n: s }))} · ${esc(names[s - 1])}</div>
    <form id="f" novalidate><div class="fgrid c2">${[null, step1, step2, step3][s]()}</div>
      <div class="err" id="gErr" role="alert" style="margin-top:12px"></div>
      <div class="form-nav"><button type="button" class="btn" id="prev">${icon('chevron-left')}${esc(t('common.back'))}</button>
        <button class="btn primary" id="nextBtn">${s === 3 ? icon('send') + esc(t('reg.submit')) : esc(t('common.next')) + icon('chevron-right')}</button></div>
      <input type="text" id="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true"></form>`;
  $('#chg').onclick = () => { read(); D.step = 0; render(); };
  $('#prev').onclick = () => { read(); D.step = s === 1 ? 0 : s - 1; render(); };
  $$('[data-chips]', body).forEach(bindChips);
  if (s === 3) bindFiles();
  $$('input,textarea', body).forEach(i => i.addEventListener('input', () => { const e = $(`[data-err="${i.id}"]`); if (e) e.textContent = ''; i.classList.remove('invalid'); }));
  $('#f').onsubmit = async (e) => { e.preventDefault(); read(); if (!check(s)) return; if (s < 3) { D.step++; render(); window.scrollTo(0, 0); } else submit(); };
  $('input', body)?.focus();
}

function choose(body) {
  body.innerHTML = `<p class="lbl" style="margin-top:18px">${esc(t('reg.choose'))}</p>
    <div class="profiles">${PROFILES.map(([k, ic]) => `<button type="button" class="profile" data-p="${k}" aria-pressed="${D.profile === k}">${icon(ic, 'lg')}<b>${esc(t('reg.p.' + k))}</b><span>${esc(t('reg.p.' + k + '_d'))}</span></button>`).join('')}</div>
    <div class="err" id="pErr"></div>
    <p class="side-note">${icon('sprout')}<span>${esc(t('reg.producer_note', { ussd: S.site.ussd || '*384*20#' }))} <a href="/producteurs">${esc(t('common.more'))}</a></span></p>
    <p class="side-note">${icon('info')}<span>${esc(t('reg.agent_note'))}</span></p>
    <div class="form-nav"><span></span><button class="btn primary" id="go">${esc(t('common.next'))}${icon('chevron-right')}</button></div>`;
  $$('[data-p]', body).forEach(b => b.onclick = () => { D.profile = b.dataset.p; $$('[data-p]', body).forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#pErr').textContent = ''; });
  $('#go').onclick = () => { if (!D.profile) { $('#pErr').textContent = t('err.profile'); return; } D.step = 1; render(); };
}

const step1 = () => {
  const f = D.f;
  return field('name', t(isBuyer() ? 'f.org_name.buyer' : 'f.org_name.org'), { req: true, value: f.name, full: true, attrs: 'autocomplete="organization" maxlength="120"' }) +
    `<div class="full"><span class="lbl">${esc(t('f.org_type'))} *</span>${chips('org_type', TYPES[D.profile].map(x => [x, t('type.' + x)]), f.org_type, false)}</div>
    <div class="full"><span class="lbl">${esc(t('f.ids'))}</span><div class="fgrid c2" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${field('rccm', t('f.rccm'), { value: f.rccm, attrs: 'maxlength="40"' })}${field('id_nat', t('f.id_nat'), { value: f.id_nat, attrs: 'maxlength="40"' })}${field('nif', t('f.nif'), { value: f.nif, attrs: 'maxlength="40"' })}</div>
      <div class="hint">${esc(t(isBuyer() ? 'f.ids_hint' : 'f.ids_hint_org'))}</div></div>` +
    field('address', t('f.address'), { value: f.address, attrs: 'autocomplete="street-address" maxlength="200"' }) +
    field('country', t('f.country'), { req: true, value: f.country, attrs: 'list="countries" autocomplete="country-name" maxlength="60"' }) +
    `<datalist id="countries">${COUNTRIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
};
const step2 = () => {
  const f = D.f;
  return field('contact_name', t('f.contact_name'), { req: true, value: f.contact_name, attrs: 'autocomplete="name" maxlength="120"' }) +
    field('contact_role', t('f.contact_role'), { opt: true, value: f.contact_role, attrs: 'autocomplete="organization-title" maxlength="80"' }) +
    field('phone', t('f.phone'), { req: true, type: 'tel', value: f.phone, hint: t('f.phone_hint'), attrs: 'autocomplete="tel" placeholder="+243 97 …"' }) +
    field('email', t('f.email'), { req: true, type: 'email', value: f.email, hint: t('f.email_hint'), attrs: 'autocomplete="email" autocapitalize="none" spellcheck="false"' }) +
    field('pw1', t('f.password'), { req: true, type: 'password', value: D.pw1, hint: t('f.pw_hint'), attrs: 'autocomplete="new-password"' }) +
    field('pw2', t('f.password2'), { req: true, type: 'password', value: D.pw2, attrs: 'autocomplete="new-password"' });
};
const step3 = () => {
  const a = D.f.activity;
  const byProv = {};
  for (const z of S.site.territories || []) (byProv[z.province] ||= []).push(z);
  const zones = Object.entries(byProv).map(([p, zs]) => `<div class="tiny muted" style="width:100%;margin-top:4px">${esc(p)}</div>` + zs.map(z => `<button type="button" class="chip" data-v="${z.id}" aria-pressed="${a.zones.includes(z.id)}">${esc(z.name)}</button>`).join('')).join('');
  return `<div class="full"><span class="lbl">${esc(t(isBuyer() ? 'f.commodities' : 'f.commodities_org'))}${isBuyer() ? ' *' : ''}</span>${chips('commodities', COMS.map(c => [c, t('com.' + c)]), a.commodities, true)}</div>` +
    (isBuyer()
      ? field('volume_t', t('f.volume'), { opt: true, type: 'number', value: a.volume_t, attrs: 'min="0" step="any" inputmode="decimal"' }) +
        `<div><span class="lbl">${esc(t('f.eu'))}</span>${chips('eu_export', [['1', t('common.yes')], ['0', t('common.no')]], a.eu_export == null ? '' : a.eu_export ? '1' : '0', false)}</div>`
      : field('members', t(D.profile === 'partner' ? 'f.members_partner' : 'f.members'), { opt: true, type: 'number', value: a.members, attrs: 'min="0" step="1" inputmode="numeric"' }) +
        field('donors', t('f.donors'), { opt: true, value: a.donors, attrs: 'maxlength="300"' }) +
        field('projects', t('f.projects'), { opt: true, area: true, full: true, value: a.projects })) +
    `<div class="full"><span class="lbl">${esc(t(isBuyer() ? 'f.zones' : 'f.zones_org'))}</span><div class="chips zones" data-chips="zones" data-multi="1">${zones}</div></div>
    <div class="full"><span class="lbl">${esc(t('f.docs'))} <span class="muted" style="font-weight:400">(${esc(t('common.optional'))})</span></span>
      <label class="drop" for="file">${icon('paperclip')}${esc(t('f.add_file'))}</label><input type="file" id="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple hidden>
      <div class="hint">${esc(t('f.docs_hint'))}</div><div class="files" id="files"></div><div class="err" data-err="file"></div></div>
    <div class="full"><label class="check"><input type="checkbox" id="consent" ${D.consent ? 'checked' : ''}> ${esc(t('f.consent'))}</label>
      <a class="small" href="/confidentialite" target="_blank" rel="noopener">${esc(t('f.consent_link'))} ${icon('external-link')}</a><div class="err" data-err="consent"></div></div>`;
};

function bindChips(box) {
  box.onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (box.dataset.multi === '1') b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    else $$('.chip', box).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const err = $(`[data-err="${box.dataset.chips}"]`); if (err) err.textContent = '';
  };
}
const chipVal = (name) => { const box = $(`[data-chips="${name}"]`); if (!box) return undefined; const v = $$('.chip[aria-pressed="true"]', box).map(b => b.dataset.v); return box.dataset.multi === '1' ? v : v[0] ?? null; };

function bindFiles() {
  const draw = () => { $('#files').innerHTML = D.files.map((f, i) => `<div class="file">${icon('file-text')}<span class="grow">${esc(f.name)} <span class="muted tiny">${Math.round(f.size / 1024)} Ko</span></span><button type="button" class="btn sm ghost" data-rm="${i}">${esc(t('f.remove'))}</button></div>`).join(''); };
  draw();
  $('#file').onchange = (e) => {
    const err = $('[data-err="file"]'); err.textContent = '';
    for (const f of e.target.files) {
      if (D.files.length >= 3) { err.textContent = t('err.file_count'); break; }
      if (!OK_TYPES.includes(f.type)) { err.textContent = t('err.file_type'); continue; }
      if (f.size > MAX) { err.textContent = t('err.file_size'); continue; }
      D.files.push(f);
    }
    e.target.value = ''; draw();
  };
  $('#files').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { D.files.splice(+b.dataset.rm, 1); draw(); } };
}

// Lecture des champs de l'étape affichée
function read() {
  const v = (id) => { const el = $('#' + id); return el ? el.value.trim() : undefined; };
  const f = D.f, a = f.activity;
  for (const k of ['name', 'rccm', 'id_nat', 'nif', 'address', 'country', 'contact_name', 'contact_role', 'phone', 'email']) { const x = v(k); if (x !== undefined) f[k] = x; }
  const ot = chipVal('org_type'); if (ot !== undefined) f.org_type = ot;
  if ($('#pw1')) { D.pw1 = $('#pw1').value; D.pw2 = $('#pw2').value; }
  const c = chipVal('commodities'); if (c !== undefined) a.commodities = c;
  const z = chipVal('zones'); if (z !== undefined) a.zones = z;
  const eu = chipVal('eu_export'); if (eu !== undefined) a.eu_export = eu == null ? null : eu === '1';
  for (const k of ['volume_t', 'members', 'donors', 'projects']) { const x = v(k); if (x !== undefined) a[k] = x; }
  if ($('#consent')) D.consent = $('#consent').checked;
}

export function normPhone(raw) {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) s = '+243' + s.slice(1);
  if (/^243\d{9}$/.test(s)) s = '+' + s;
  if (s.startsWith('+243')) return /^\+243[89]\d{8}$/.test(s) ? s : null;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

function check(step) {
  const errs = {}; const f = D.f;
  if (step === 1) {
    if (!f.name) errs.name = t('err.required');
    if (!f.org_type) errs.org_type = t('err.required');
    if (!f.country) errs.country = t('err.required');
  }
  if (step === 2) {
    if (!f.contact_name) errs.contact_name = t('err.required');
    if (!f.phone) errs.phone = t('err.required'); else if (!normPhone(f.phone)) errs.phone = t('err.phone');
    if (!f.email) errs.email = t('err.required'); else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email)) errs.email = t('err.email');
    const pw = D.pw1 || '';
    if (pw.length < 10) errs.pw1 = t('err.pw_short'); else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errs.pw1 = t('err.pw_mix');
    if (!errs.pw1 && pw !== D.pw2) errs.pw2 = t('err.pw_match');
  }
  if (step === 3) {
    if (isBuyer() && !f.activity.commodities.length) errs.commodities = t('err.commodities');
    if (!D.consent) errs.consent = t('err.consent');
  }
  for (const [k, msg] of Object.entries(errs)) { const e = $(`[data-err="${k}"]`); if (e) e.textContent = msg; $('#' + k)?.classList.add('invalid'); }
  const first = Object.keys(errs)[0];
  if (first) ($('#' + first) || $(`[data-chips="${first}"] .chip`))?.focus();
  return !first;
}

async function submit() {
  const b = $('#nextBtn'); b.disabled = true; b.textContent = t('reg.sending'); $('#gErr').textContent = '';
  try {
    const f = D.f, a = f.activity;
    const body = { profile: D.profile, lang: S.lang, website: $('#website').value, consent: D.consent,
      name: f.name, org_type: f.org_type, rccm: f.rccm, id_nat: f.id_nat, nif: f.nif, address: f.address, country: f.country,
      contact_name: f.contact_name, contact_role: f.contact_role, phone: normPhone(f.phone), email: f.email,
      activity: { commodities: a.commodities, zones: a.zones, volume_t: a.volume_t, eu_export: !!a.eu_export, members: a.members, donors: a.donors, projects: a.projects },
      password: await makePassword(D.pw1) };
    const r = await fetch('/api/public/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || t('common.error'));
    D.filesFailed = false;
    if (D.files.length) {
      b.textContent = t('reg.uploading');
      for (const file of D.files) {
        const u = await fetch('/api/public/upload', { method: 'POST', headers: { 'x-upload-token': j.upload_token, 'x-file-name': encodeURIComponent(file.name), 'content-type': file.type }, body: file }).catch(() => null);
        if (!u || !u.ok) D.filesFailed = true;
      }
    }
    D.pw1 = D.pw2 = ''; D.step = 4; render(); window.scrollTo(0, 0);
  } catch (ex) { $('#gErr').textContent = ex.message; b.disabled = false; b.innerHTML = icon('send') + esc(t('reg.submit')); }
}

function done(body) {
  body.innerHTML = `<div class="pending" style="margin-top:18px"><span class="big-ic">${icon('circle-check', 'xl')}</span>
    <h2>${esc(t('reg.done.t'))}</h2><p>${esc(t('reg.done.d'))}</p>
    ${D.filesFailed ? `<p class="note">${icon('triangle-alert')}<span>${esc(t('reg.done.files_err'))}</span></p>` : ''}
    <a class="btn primary lg" href="/connexion">${icon('log-in')}${esc(t('reg.done.login'))}</a></div>`;
}

async function boot() {
  await loadAll(pickLang());
  const draw = () => { if (M && D.step >= 1 && D.step <= 3) read(); M = shell('signup', draw); render(); };
  draw();
}
boot();
