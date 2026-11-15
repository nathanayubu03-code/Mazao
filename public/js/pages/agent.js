// Application agent (mobile) : inscription des producteurs et de leurs parcelles.
// Écrans courts (3 ou 4 champs), gros boutons, français et swahili.
// Étape a : les enregistrements partent directement au serveur. L'étape b ajoute la file hors ligne (IndexedDB).
import { api, session } from '../socle/api.js';
import { login, logout } from '../socle/auth.js';
import { esc, uuid, normPhone, fmtPhone, operatorFor, OPERATORS, initials, debounce, num } from '../socle/util.js';
import { t, getLang, setLang } from '../socle/i18n.js';
import { ringAreaHa, closeRing, selfIntersects } from '../socle/geo.js';
import { $, $$, icon, toast, demoBanner } from '../ui/ui.js';

const root = $('#root');
const S = { user: null, ref: null, draft: null, step: 1, current: null, plot: null };

/* ---------------- Installation sur l'écran d'accueil (agents connectés, mobile) ---------------- */
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (S.user && $('#install')) $('#install').hidden = false; });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function installButton() {
  if (standalone()) return '';
  if (isIos()) return `<div class="card small">${icon('download')} ${esc(t('installIos'))}</div>`;
  return `<button class="big" id="install" ${installEvt ? '' : 'hidden'}>${icon('download')}<span class="grow">${t('install')}</span></button>`;
}

/* ---------------- Démarrage ---------------- */
async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  addEventListener('online', netBadge); addEventListener('offline', netBadge);
  demoBanner();
  const s = session.get();
  if (!s?.token || s.user?.role !== 'agent') return loginView();
  S.user = s.user;
  try { await loadRef(); } catch (e) { if (e.status === 401) return loginView(); S.ref = cachedRef(); if (!S.ref) return loginView(); }
  home();
}
function cachedRef() { try { return JSON.parse(localStorage.getItem('kt.ref')); } catch { return null; } }
async function loadRef() {
  S.ref = await api('/api/ref');
  try { localStorage.setItem('kt.ref', JSON.stringify(S.ref)); } catch {}
  const local = Number(localStorage.getItem('kt.seq.' + S.user.agent_code) || 0);
  if (S.ref.next_seq > local) localStorage.setItem('kt.seq.' + S.user.agent_code, String(S.ref.next_seq));
}
const nextCode = () => S.user.agent_code + '-' + String(Number(localStorage.getItem('kt.seq.' + S.user.agent_code) || 1)).padStart(4, '0');
const bumpSeq = () => localStorage.setItem('kt.seq.' + S.user.agent_code, String(Number(localStorage.getItem('kt.seq.' + S.user.agent_code) || 1) + 1));

function frame(title, body, { back } = {}) {
  root.innerHTML = `<header class="agent-top">${back ? `<button class="icon-btn" data-back aria-label="${t('back')}">${icon('arrow-left')}</button>` : `<img src="/assets/logo-mark.png" alt="" style="width:30px;height:30px;border-radius:6px;background:#fff">`}
    <h1>${esc(title)}</h1><span class="net" id="net"><span class="dot"></span><span></span></span></header><main class="agent-body">${body}</main>`;
  if (back) $('[data-back]').onclick = back;
  netBadge();
}
function netBadge() {
  const n = $('#net'); if (!n) return;
  n.classList.toggle('off', !navigator.onLine);
  n.lastElementChild.textContent = navigator.onLine ? t('online') : t('offline');
}

/* ---------------- Connexion ---------------- */
function loginView() {
  frame(t('app'), `<form class="stack" id="f" novalidate>
    <div><label class="lbl" for="lg">${t('id')}</label><input class="input" id="lg" autocomplete="username" autocapitalize="none"></div>
    <div><label class="lbl" for="pw">${t('password')}</label><input class="input" id="pw" type="password" autocomplete="current-password"></div>
    <div class="err" id="err" role="alert"></div>
    <button class="btn primary block" id="go">${t('signin')}</button>
    <button class="btn ghost block" type="button" id="lang">${icon('languages')}${t('lang')}</button></form>`);
  $('#lang').onclick = () => { setLang(getLang() === 'fr' ? 'sw' : 'fr'); loginView(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#go'); b.disabled = true; b.textContent = t('checking');
    try {
      const r = await login($('#lg').value.trim(), $('#pw').value, 'agent');
      if (r.stage !== 'ok' || r.user.role !== 'agent') { session.clear(); $('#err').innerHTML = esc(t('notAgent')).replace('/connexion', '<a href="/connexion">/connexion</a>'); b.disabled = false; b.textContent = t('signin'); return; }
      S.user = r.user; await loadRef(); home();
    } catch (ex) { $('#err').textContent = ex.message; b.disabled = false; b.textContent = t('signin'); }
  };
}

/* ---------------- Accueil ---------------- */
function home() {
  const pts = (S.ref.my_points || []).map(id => S.ref.collection_points.find(p => p.id === id)).filter(Boolean);
  frame(t('app'), `<div><div class="small muted">${t('hello')}</div><h2>${esc(S.user.full_name)} <span class="mono small muted">${esc(S.user.agent_code)}</span></h2>
      <div class="small muted" style="margin-top:4px">${pts.map(p => esc(p.name)).join(' · ') || t('noPoints')}</div></div>
    <button class="big" data-go="reg" ${pts.length ? '' : 'disabled'}>${icon('user-plus')}<span class="grow">${t('register')}</span>${icon('chevron-right')}</button>
    <button class="big" data-go="list">${icon('users')}<span class="grow">${t('producers')}</span>${icon('chevron-right')}</button>
    <button class="big" disabled>${icon('scale')}<span class="grow">${t('weigh')} <span class="badge">${t('soon')}</span></span></button>
    ${installButton()}
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="lang">${icon('languages')}${t('lang')}</button><button class="btn ghost right" id="out">${icon('log-out')}${t('logout')}</button></div>`);
  $('[data-go="reg"]').onclick = () => { S.draft = newDraft(); S.step = 1; regStep(); };
  $('[data-go="list"]').onclick = () => listView();
  $('#lang').onclick = () => { setLang(getLang() === 'fr' ? 'sw' : 'fr'); home(); };
  $('#out').onclick = async () => { await logout(); loginView(); };
  const ib = $('#install');
  if (ib) ib.onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; ib.hidden = true; };
}

/* ---------------- Inscription en 4 écrans ---------------- */
function newDraft() {
  const pt = S.ref.my_points[0];
  const p = S.ref.collection_points.find(x => x.id === pt);
  return { id: uuid(), full_name: '', sex: '', birth_year: '', phone: '', momo_operator: '', collection_point_id: pt, village_id: p?.village_id || '',
    commodity_ids: S.ref.commodities.length === 1 ? [S.ref.commodities[0].id] : [], household_size: '', female_headed: null, voter_last4: '',
    baseline: { season: lastSeason(), production_kg: '', income_cdf: '', last_price_amount: '', last_price_currency: 'CDF' } };
}
// Saison A : septembre à février ; saison B : mars à août. On demande la dernière saison terminée.
function lastSeason() { const d = new Date(), m = d.getMonth(), y = d.getFullYear(); return m >= 8 ? y + 'B' : m <= 1 ? (y - 1) + 'B' : y + 'A'; }
const zone = (id) => S.ref.zones.find(z => z.id === id);
function villagesNear(pointId) {
  const p = S.ref.collection_points.find(x => x.id === pointId); const v = zone(p?.village_id); if (!v) return [];
  return S.ref.zones.filter(z => z.level === 'village' && z.parent_id === v.parent_id);
}
const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l, ic]) => `<button type="button" data-v="${v}" aria-pressed="${String(val) === String(v)}">${ic ? icon(ic) : ''}${esc(l)}</button>`).join('')}</div>`;

function regStep() {
  const d = S.draft, n = S.step;
  const titles = [t('s1'), t('s2'), t('s3'), t('s4')];
  let body = '';
  if (n === 1) body = `
    <div><label class="lbl" for="fn">${t('fullname')}</label><input class="input" id="fn" value="${esc(d.full_name)}" autocomplete="off"></div>
    <div><span class="lbl">${t('sex')}</span>${seg('sex', [['F', t('woman')], ['M', t('man')]], d.sex)}</div>
    <div><label class="lbl" for="by">${t('birthyear')}</label><input class="input" id="by" type="number" inputmode="numeric" value="${esc(d.birth_year)}" placeholder="1985"></div>
    <div><label class="lbl" for="ph">${t('phone')}</label><input class="input" id="ph" type="tel" inputmode="tel" value="${esc(d.phone)}" placeholder="0812 345 678"></div>`;
  if (n === 2) {
    const pts = S.ref.my_points.map(id => S.ref.collection_points.find(p => p.id === id)).filter(Boolean);
    body = `
    <div><span class="lbl">${t('operator')}</span>${seg('op', Object.entries(OPERATORS).map(([k, o]) => [k, o.label]), d.momo_operator)}</div>
    <div><label class="lbl" for="cp">${t('point')}</label><select class="input" id="cp">${pts.map(p => `<option value="${p.id}" ${p.id === d.collection_point_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div><label class="lbl" for="vi">${t('village')}</label><select class="input" id="vi"></select></div>
    <div><span class="lbl">${t('commodities')}</span><div class="seg" data-multi>${S.ref.commodities.map(c => `<button type="button" data-v="${c.id}" aria-pressed="${d.commodity_ids.includes(c.id)}">${esc(getLang() === 'sw' ? c.name_sw : c.name_fr)}</button>`).join('')}</div></div>`;
  }
  if (n === 3) body = `
    <div><label class="lbl" for="hh">${t('household')}</label><input class="input" id="hh" type="number" inputmode="numeric" min="1" value="${esc(d.household_size)}"></div>
    <div><span class="lbl">${t('femaleHead')}</span>${seg('fh', [['1', t('yes')], ['0', t('no')]], d.female_headed)}</div>
    <div><label class="lbl" for="vo">${t('voter')}</label><input class="input" id="vo" maxlength="12" value="${esc(d.voter_last4)}" autocomplete="off"></div>`;
  if (n === 4) body = `
    <div class="small muted">${t('season')} ${esc(d.baseline.season)}</div>
    <div><label class="lbl" for="pk">${t('production')}</label><input class="input" id="pk" type="number" inputmode="decimal" value="${esc(d.baseline.production_kg)}"></div>
    <div><label class="lbl" for="ic">${t('income')}</label><input class="input" id="ic" type="number" inputmode="numeric" value="${esc(d.baseline.income_cdf)}"></div>
    <div><label class="lbl" for="lp">${t('lastPrice')}</label><div class="row"><input class="input grow" id="lp" type="number" inputmode="decimal" value="${esc(d.baseline.last_price_amount)}" style="flex:1">
      <div style="flex:0 0 150px">${seg('cur', [['CDF', 'CDF'], ['USD', 'USD']], d.baseline.last_price_currency)}</div></div></div>`;
  frame(t('register'), `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>
    <div><div class="small muted">${t('step')} ${n}/4</div><h2>${titles[n - 1]}</h2></div>
    <form class="stack" id="f" novalidate>${body}<div class="err" id="err" role="alert"></div>
    <button class="btn primary block">${n < 4 ? t('next') : t('summary')}</button></form>`,
    { back: () => { if (n > 1) { read(); S.step--; regStep(); } else home(); } });
  $$('.input').forEach(i => i.addEventListener('input', () => { i.classList.toggle('invalid', false); $('#err').textContent = ''; }));
  $$('[data-seg]').forEach(g => g.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', g).forEach(x => x.setAttribute('aria-pressed', x === b)); });
  const multi = $('[data-multi]'); if (multi) multi.onclick = (e) => { const b = e.target.closest('button'); if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); };
  if (n === 2) {
    const fillVillages = () => { const vs = villagesNear($('#cp').value); const pv = S.ref.collection_points.find(p => p.id === $('#cp').value)?.village_id;
      $('#vi').innerHTML = vs.map(v => `<option value="${v.id}" ${v.id === (d.village_id || pv) ? 'selected' : ''}>${esc(v.name)}</option>`).join(''); };
    $('#cp').onchange = () => { d.village_id = ''; fillVillages(); }; fillVillages();
    if (!d.momo_operator) { const op = operatorFor(normPhone(d.phone)); if (op) $(`[data-seg="op"] [data-v="${op}"]`).setAttribute('aria-pressed', 'true'); }
  }
  function pressed(name) { return $(`[data-seg="${name}"] [aria-pressed="true"]`)?.dataset.v ?? ''; }
  function read() {
    if (n === 1) Object.assign(d, { full_name: $('#fn').value.trim().replace(/\s+/g, ' '), sex: pressed('sex'), birth_year: $('#by').value.trim(), phone: $('#ph').value.trim() });
    if (n === 2) Object.assign(d, { momo_operator: pressed('op'), collection_point_id: $('#cp').value, village_id: $('#vi').value, commodity_ids: $$('[data-multi] [aria-pressed="true"]').map(b => b.dataset.v) });
    if (n === 3) { const fh = pressed('fh'); Object.assign(d, { household_size: $('#hh').value.trim(), female_headed: fh === '' ? null : fh === '1', voter_last4: $('#vo').value.trim() }); }
    if (n === 4) Object.assign(d.baseline, { production_kg: $('#pk').value.trim(), income_cdf: $('#ic').value.trim(), last_price_amount: $('#lp').value.trim(), last_price_currency: pressed('cur') || 'CDF' });
  }
  function check() {
    const y = new Date().getFullYear();
    if (n === 1) {
      if (d.full_name.length < 3) return [t('fullname'), 'fn'];
      if (!d.sex) return [t('sex')];
      if (!(+d.birth_year >= y - 100 && +d.birth_year <= y - 14)) return [t('birthyear'), 'by'];
      if (!normPhone(d.phone)) return [t('badPhone'), 'ph', true];
    }
    if (n === 2) { if (!d.momo_operator) return [t('operator')]; if (!d.village_id) return [t('village')]; if (!d.commodity_ids.length) return [t('commodities')]; }
    if (n === 3) { if (!(+d.household_size >= 1)) return [t('household'), 'hh']; if (d.female_headed === null) return [t('femaleHead')]; }
    return null;
  }
  $('#f').onsubmit = (e) => {
    e.preventDefault(); read();
    const pb = check();
    if (pb) { $('#err').textContent = pb[2] ? pb[0] : t('required') + ' : ' + pb[0]; if (pb[1]) $('#' + pb[1]).classList.add('invalid'); return; }
    if (n < 4) { S.step++; regStep(); } else summary();
  };
}

function summary() {
  const d = S.draft, pt = S.ref.collection_points.find(p => p.id === d.collection_point_id);
  frame(t('summary'), `<div class="card stack small">
      <div><b style="font-size:1.1rem">${esc(d.full_name)}</b> <span class="muted">· ${d.sex === 'F' ? t('woman') : t('man')} · ${esc(d.birth_year)}</span></div>
      <div>${icon('phone')} ${esc(fmtPhone(normPhone(d.phone)))} · ${esc(OPERATORS[d.momo_operator].label)}</div>
      <div>${icon('map-pin')} ${esc(zone(d.village_id)?.name)} · ${esc(pt?.name)}</div>
      <div>${icon('users')} ${esc(d.household_size)} · ${d.female_headed ? t('femaleHead') : ''}</div>
      <div>${icon('wheat')} ${esc(d.baseline.production_kg || '?')} kg · ${esc(d.baseline.last_price_amount || '?')} ${esc(d.baseline.last_price_currency)}/kg</div>
      <div class="muted">Code : <span class="mono">${esc(nextCode())}</span></div></div>
    <div class="err" id="err" role="alert"></div>
    <button class="btn ok block" id="save">${icon('check')}${t('save')}</button>`, { back: () => { S.step = 4; regStep(); } });
  $('#save').onclick = async () => {
    const b = $('#save'); b.disabled = true;
    const payload = { ...d, code: nextCode(), phone: normPhone(d.phone), lang: 'sw', created_at: new Date().toISOString() };
    try {
      const r = await api('/api/producers', { method: 'POST', body: payload });
      bumpSeq();
      saved(r.producer);
    } catch (e) {
      if (e.data?.code_conflict) { await loadRef(); }
      $('#err').textContent = e.message; b.disabled = false;
    }
  };
}

function saved(p) {
  frame(t('saved'), `<div class="saved"><div class="tick">${icon('check', 'xl')}</div><h2>${esc(p.full_name)}</h2><div class="mono">${esc(p.code)}</div>
      <div id="qr" style="background:#fff;padding:8px;border-radius:8px"></div><p class="small muted">${t('consentSent')}</p></div>
    <button class="btn primary block" id="plot">${icon('map-pin')}${t('addPlot')}</button>
    <button class="btn block" id="done">${t('done')}</button>`);
  $('#plot').onclick = () => plotView(p);
  $('#done').onclick = home;
  // QR du code producteur (librairie chargée seulement ici)
  loadScript('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js').then(() => { if (window.QRCode && $('#qr')) new QRCode($('#qr'), { text: 'KIVUTRACE|' + p.code + '|' + p.id, width: 120, height: 120 }); }).catch(() => {});
}

/* ---------------- Liste et fiche ---------------- */
async function listView(q = '') {
  frame(t('producers'), `<input class="input" id="q" type="search" placeholder="${t('search')}" value="${esc(q)}" aria-label="${t('search')}"><div class="plist" id="pl"><div class="sk sk-line"></div><div class="sk sk-line"></div></div>`, { back: home });
  const load = async () => {
    try {
      const r = await api('/api/producers?q=' + encodeURIComponent($('#q').value.trim()));
      $('#pl').innerHTML = r.rows.length ? r.rows.map(p => `<button class="pitem" data-id="${p.id}"><span class="avatar">${esc(initials(p.full_name))}</span><span class="grow"><b>${esc(p.full_name)}</b><div class="small muted">${esc(p.code)} · ${esc(p.phone_masked || '')}</div></span>${consent(p.consent_status)}</button>`).join('') : `<div class="empty">${t('none')}</div>`;
      $$('[data-id]').forEach(b => b.onclick = () => detail(b.dataset.id));
    } catch (e) { $('#pl').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#q').oninput = debounce(load, 300); load();
}
const consent = (s) => s === 'granted' ? `<span class="badge b-ok">${icon('circle-check')}</span>` : s === 'pending' ? `<span class="badge b-warn">${icon('clock')}</span>` : `<span class="badge b-err">${icon('circle-x')}</span>`;

async function detail(id) {
  frame('…', '<div class="sk sk-line"></div><div class="sk sk-line"></div>', { back: () => listView() });
  const d = await api('/api/producers/' + id);
  const p = d.producer;
  const label = { granted: t('consentOk'), pending: t('consentPending'), refused: t('consentNo'), withdrawn: t('consentNo') }[p.consent_status];
  frame(p.full_name, `<div class="card stack small"><div class="mono">${esc(p.code)}</div><div>${consent(p.consent_status)} ${esc(label)}</div>
      <div>${icon('phone')} ${esc(p.phone_masked || '')}</div><div>${icon('map-pin')} ${esc(zone(p.village_id)?.name || '')}</div>
      <div>${icon('layers')} ${d.plots.length ? d.plots.map(pl => `${pl.geometry_type === 'point' ? 'Point' : 'Polygone'} · ${num(pl.declared_area_ha, 2)} ha`).join(', ') : '0 ' + t('plot').toLowerCase()}</div></div>
    ${p.consent_status !== 'granted' ? `<button class="btn block" id="resend">${icon('send')}${t('resend')}</button>` : ''}
    <button class="btn primary block" id="plot">${icon('map-pin')}${t('addPlot')}</button>`, { back: () => listView() });
  $('#plot').onclick = () => plotView(p);
  const rs = $('#resend'); if (rs) rs.onclick = async () => { try { await api(`/api/producers/${id}/consent/resend`, { method: 'POST' }); toast('SMS envoyé.', 'ok'); } catch (e) { toast(e.message, 'err'); } };
}

/* ---------------- Parcelle : point sous 4 ha, polygone au-delà ---------------- */
function plotView(p) {
  S.plot = { producer: p, pts: [], declared: '', acc: null, method: 'gps' };
  draw();
  function draw() {
    const pl = S.plot, poly = Number(pl.declared) >= 4;
    const ring = pl.pts.length >= 4 ? closeRing(pl.pts) : null;
    const area = ring ? ringAreaHa(ring) : 0;
    frame(t('plot'), `<div class="small muted">${esc(p.full_name)} · <span class="mono">${esc(p.code)}</span></div>
      <div><label class="lbl" for="da">${t('declared')}</label><input class="input" id="da" type="number" inputmode="decimal" step="0.01" min="0.01" value="${esc(pl.declared)}"></div>
      <div class="card small" style="background:var(--surface-2)">${pl.declared ? (poly ? t('polyRule') : t('pointRule')) : t('pointRule') + '<br>' + t('polyRule')}</div>
      <div class="row"><button class="btn primary grow" id="cap">${icon('locate-fixed')}${t('capture')}</button><button class="btn grow" id="sim">${icon('satellite')}${t('simulate')}</button></div>
      <div class="card small" id="pts">${pl.pts.length} ${t('points')}${poly && ring ? ` · ${t('area')} : <b>${num(area, 2)} ha</b>` : ''}${pl.acc ? ` · ${t('accuracy')} ±${pl.acc} m` : ''}${poly && ring && Math.abs(area - Number(pl.declared)) / Number(pl.declared) > 0.3 ? `<div style="color:var(--warn-ink);margin-top:4px">${icon('triangle-alert')} ${t('gap')}</div>` : ''}
        ${pl.pts.map((x, i) => `<div class="mono tiny">P${i + 1} ${x[1].toFixed(6)}, ${x[0].toFixed(6)}</div>`).join('')}</div>
      ${pl.pts.length ? `<button class="btn ghost block" id="undo">${icon('rotate-ccw')}${t('undo')}</button>` : ''}
      <div class="err" id="err" role="alert"></div>
      <button class="btn ok block" id="save">${icon('check')}${t('save')}</button>`, { back: () => detail(p.id) });
    $('#da').onchange = () => { pl.declared = $('#da').value; if (Number(pl.declared) < 4 && pl.pts.length > 1) pl.pts = pl.pts.slice(-1); draw(); };
    $('#cap').onclick = () => {
      if (!('geolocation' in navigator)) { toast(t('gpsErr'), 'err'); return; }
      const b = $('#cap'); b.disabled = true; b.textContent = t('gpsWait');
      navigator.geolocation.getCurrentPosition(pos => { addPt([pos.coords.longitude, pos.coords.latitude], Math.round(pos.coords.accuracy), 'gps'); },
        () => { toast(t('gpsErr'), 'err'); draw(); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    };
    $('#sim').onclick = () => {
      const cp = S.ref.collection_points.find(x => x.id === p.collection_point_id) || S.ref.collection_points[0];
      if (!pl.center) pl.center = [cp.lng + (Math.random() - .5) * 0.01, cp.lat + (Math.random() - .5) * 0.01];
      const k = pl.pts.length, ang = k * Math.PI / 2.4 + Math.random() * .2, r = poly ? 125 : 0;
      const pt = [pl.center[0] + r * Math.cos(ang) / (111320 * Math.cos(pl.center[1] * Math.PI / 180)), pl.center[1] + r * Math.sin(ang) / 111320];
      addPt(pt, 4 + Math.round(Math.random() * 4), 'simulé');
    };
    const u = $('#undo'); if (u) u.onclick = () => { pl.pts.pop(); draw(); };
    $('#save').onclick = save;
  }
  function addPt(pt, acc, method) {
    const pl = S.plot;
    if (Number(pl.declared) >= 4) pl.pts.push(pt); else pl.pts = [pt];
    pl.acc = acc; pl.method = method; draw();
  }
  async function save() {
    const pl = S.plot, declared = Number(String(pl.declared).replace(',', '.')), poly = declared >= 4;
    if (!(declared > 0)) { $('#err').textContent = t('required') + ' : ' + t('declared'); return; }
    if (!pl.pts.length) { $('#err').textContent = t('capture'); return; }
    if (poly && pl.pts.length < 4) { $('#err').textContent = t('polyRule'); return; }
    if (poly && selfIntersects(pl.pts)) { $('#err').textContent = 'Les points ne suivent pas le contour : annulez et refaites le tour dans l\'ordre.'; return; }
    const geometry = poly ? { type: 'Polygon', coordinates: [closeRing(pl.pts)] } : { type: 'Point', coordinates: [+pl.pts[0][0].toFixed(6), +pl.pts[0][1].toFixed(6)] };
    try {
      $('#save').disabled = true;
      await api(`/api/producers/${pl.producer.id}/plots`, { method: 'POST', body: { id: uuid(), commodity_id: pl.producer.commodity_ids?.[0] || null, declared_area_ha: declared, geometry_type: poly ? 'polygon' : 'point', geometry, captured_at: new Date().toISOString(), gps_accuracy_m: pl.acc, method: pl.method } });
      frame(t('plotSaved'), `<div class="saved"><div class="tick">${icon('check', 'xl')}</div><h2>${t('plotSaved')}</h2></div><button class="btn primary block" id="ok">${t('done')}</button>`);
      $('#ok').onclick = () => detail(pl.producer.id);
    } catch (e) { $('#err').textContent = e.message; $('#save').disabled = false; }
  }
}

function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = Object.assign(document.createElement('script'), { src, onload: res, onerror: rej }); document.head.appendChild(s); });
}

start();
