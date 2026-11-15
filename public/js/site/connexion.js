// Connexion unique pour tous les rôles. Après connexion, chacun part vers son espace :
// agent → /app, acheteur → /acheteur, coopérative / ONG / coordination → /coordination,
// administrateur → code à 6 chiffres puis /admin.
import { S, t, esc, icon, $, shell, setMeta, loadAll, pickLang } from './core.js';
import { login, confirmTotp, HOME } from '../socle/auth.js';
import { session } from '../socle/api.js';

const next = new URLSearchParams(location.search).get('next');
const target = (role) => { const h = HOME[role] || '/'; return next && next.startsWith(h) ? next : h; };

function go(user) {
  // Chaque espace garde sa propre session sur l'appareil
  const s = session.get();
  if (user.role === 'agent') { session.setFor('agent', s); session.clear(); }
  $('#err').textContent = '';
  $('#ok').textContent = t('login.redirect');
  location.href = target(user.role);
}

function form(m) {
  setMeta('login.title');
  m.innerHTML = `<section class="form-page"><div class="wrap"><div class="form-card narrow">
    <div class="row" style="gap:12px;margin-bottom:6px"><img src="/assets/logo-mark.png" alt="" width="48" height="48" style="border-radius:10px;border:1px solid var(--line);background:#fff">
      <div><h1>${esc(t('login.title'))}</h1><p class="small muted">${esc(t('login.lead'))}</p></div></div>
    <form id="f" class="stack" novalidate style="margin-top:14px">
      <div><label class="lbl" for="login">${esc(t('login.id'))}</label><input class="input" id="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
      <div><label class="lbl" for="password">${esc(t('login.pw'))}</label><input class="input" id="password" type="password" autocomplete="current-password" required></div>
      <div class="err" id="err" role="alert"></div><div class="small" id="ok" role="status" style="color:var(--ok);font-weight:600"></div>
      <button class="btn primary block lg" id="submit">${icon('log-in')}${esc(t('login.submit'))}</button>
    </form>
    <p class="small" style="margin-top:18px;text-align:center">${esc(t('login.no_account'))} <a href="/inscription">${esc(t('login.signup'))}</a></p>
  </div></div></section>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const id = $('#login').value.trim(), pw = $('#password').value;
    if (!id || !pw) { $('#err').textContent = t('login.err_required'); return; }
    const b = $('#submit'); b.disabled = true; b.textContent = t('login.checking'); $('#err').textContent = '';
    try {
      const r = await login(id, pw, 'web');
      if (r.stage === 'ok') return go(r.user);
      totp(m, r);
    } catch (ex) {
      $('#err').textContent = ex.message; $('#password').value = '';
      b.disabled = false; b.innerHTML = icon('log-in') + esc(t('login.submit'));
    }
  };
}

// Double authentification des administrateurs, sur la même page
function totp(m, r) {
  const enroll = r.stage === 'enroll';
  m.innerHTML = `<section class="form-page"><div class="wrap"><div class="form-card narrow"><form id="f" class="stack" novalidate>
    <h1>${esc(t(enroll ? 'login.totp.enroll' : 'login.totp.title'))}</h1>
    <p class="small">${esc(t(enroll ? 'login.totp.enroll_lead' : 'login.totp.lead'))}</p>
    ${enroll ? `<div id="qr" style="display:grid;place-items:center;padding:10px;background:#fff;border-radius:10px;border:1px solid var(--line);min-height:200px"></div>
      <p class="tiny muted">${esc(t('login.totp.manual'))} : <span class="mono" style="word-break:break-all">${esc(r.secret)}</span></p>` : ''}
    <div><label class="lbl" for="code">${esc(t('login.totp.code'))}</label><input class="input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="font-size:1.4rem;letter-spacing:.3em;text-align:center"></div>
    <div class="err" id="err" role="alert"></div><div class="small" id="ok" role="status" style="color:var(--ok);font-weight:600"></div>
    <button class="btn primary block lg" id="go">${esc(t('login.totp.validate'))}</button>
    <button class="btn ghost block" type="button" id="back">${esc(t('common.back'))}</button></form></div></div></section>`;
  if (enroll) {
    const draw = () => { $('#qr').innerHTML = ''; new window.QRCode($('#qr'), { text: r.otpauth, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M }); };
    if (window.QRCode) draw();
    else { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'; sc.onload = draw; sc.onerror = () => { $('#qr').textContent = t('login.totp.manual'); }; document.head.appendChild(sc); }
  }
  $('#code').focus();
  $('#back').onclick = () => form(m);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await confirmTotp(r.token, $('#code').value.trim(), 'admin'); $('#ok').textContent = t('login.redirect'); location.href = '/admin'; }
    catch (ex) { $('#err').textContent = ex.message; $('#code').value = ''; }
  };
}

async function boot() {
  await loadAll(pickLang());
  const render = () => form(shell('login', render));
  render();
}
boot();
