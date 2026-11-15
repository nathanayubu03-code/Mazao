// Espaces connectés du site : /acheteur (acheteurs) et /coordination (coordination, coopératives, ONG).
// Un compte inscrit sur le site et pas encore validé ne voit qu'un écran d'attente.
import { api, session } from '../socle/api.js';
import { guard, logout, HOME } from '../socle/auth.js';
import { esc, date, dateTime, fmtPhone, debounce } from '../socle/util.js';
import { $, $$, icon, toast, modal, closeModal, skeleton, countUp, demoBanner, toggleTheme, consentBadge } from '../ui/ui.js';
import { phoneSim } from '../ui/phone.js';

const root = $('#root');
const SPACE_PAGE = document.body.dataset.space; // acheteur | coordination
let USER = null, REF = null;

const NAV = {
  coordination: [['overview', 'layout-dashboard', 'Vue d\'ensemble'], ['producers', 'users', 'Producteurs'], ['orders', 'clipboard-list', 'Ordres d\'achat'], ['exports', 'download', 'Exports']],
  buyer: [['orders', 'clipboard-list', 'Mes ordres d\'achat'], ['payments', 'wallet', 'Paiements'], ['lots', 'package', 'Dossiers de lots'], ['org', 'building-2', 'Mon entreprise']],
  cooperative: [['overview', 'layout-dashboard', 'Vue d\'ensemble'], ['org', 'building-2', 'Mon organisation']],
  partner: [['overview', 'layout-dashboard', 'Vue d\'ensemble'], ['org', 'building-2', 'Mon organisation']]
};
const LABEL = { buyer: 'Espace acheteur', coordination: 'Coordination', cooperative: 'Espace coopérative', partner: 'Espace partenaire' };

async function start() {
  USER = await guard(SPACE_PAGE === 'acheteur' ? ['buyer'] : ['coordination', 'cooperative', 'partner']); if (!USER) return;
  demoBanner();
  // Statut du compte à jour (il a pu être validé depuis la dernière connexion)
  try { const me = await api('/api/me'); USER = me.user; const s = session.get(); session.set({ ...s, user: me.user }); }
  catch (e) { if (e.status === 401) { location.replace('/connexion?next=' + encodeURIComponent(location.pathname)); return; } }
  if (location.pathname.startsWith('/acheteur') !== (USER.role === 'buyer')) { location.replace(HOME[USER.role]); return; }
  if (USER.account_status !== 'approved') return waitScreen();
  try { REF = await api('/api/ref'); } catch (e) { if (e.status === 401) { location.replace('/connexion'); return; } }
  const nav = NAV[USER.role];
  root.innerHTML = `<div class="shell"><aside class="side">
      <div class="brand"><img src="/assets/logo-mark.png" alt=""><div><b>KivuTrace &amp; Market</b><span class="tiny muted">${LABEL[USER.role]}</span></div></div>
      ${nav.map(n => `<button class="nav-btn" data-nav="${n[0]}">${icon(n[1])}${n[2]}</button>`).join('')}
      <a class="nav-btn" href="/">${icon('house')}Site public</a>
      <div class="side-foot"><div class="small"><b>${esc(USER.full_name)}</b><div class="tiny muted">${esc(USER.role === 'coordination' ? (REF?.settings.cooperative_name || '') : USER.email || '')}</div></div>
        <div class="row"><button class="icon-btn" id="theme" aria-label="Changer de thème">${icon('moon')}</button><button class="btn sm ghost" id="out">${icon('log-out')}Déconnexion</button></div></div>
    </aside><main class="main" id="main"></main></div>`;
  $('#out').onclick = async () => { await logout(); location.replace('/'); };
  $('#theme').onclick = toggleTheme;
  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
  go(location.hash.slice(1) || nav[0][0]);
}

/* ------------------------------------------------------------------ Compte en attente de validation */
async function waitScreen() {
  const lang = ['fr', 'en', 'sw', 'ln'].includes(USER.lang) ? USER.lang : 'fr';
  const dict = (await import(`/js/site/i18n/${lang}.js`)).default;
  const fr = lang === 'fr' ? dict : (await import('/js/site/i18n/fr.js')).default;
  const T = (k) => dict[k] ?? fr[k] ?? k;
  const acc = await api('/api/account');
  const info = acc.account_status === 'info_requested';
  root.innerHTML = `<div class="auth-wrap" style="align-items:start;padding-top:40px"><div style="width:min(720px,100%)" class="stack">
    <div class="row"><img src="/assets/logo-mark.png" alt="" width="40" height="40" style="border-radius:8px;background:#fff;border:1px solid var(--line)"><b class="grow">KivuTrace &amp; Market</b>
      <a class="btn sm ghost" href="/">${icon('house')}Site</a><button class="btn sm ghost" id="out">${icon('log-out')}${esc(T('wait.logout'))}</button></div>
    <div class="card stack" style="text-align:center;justify-items:center">
      <span style="width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:${info ? 'var(--warn-50)' : 'var(--primary-50)'};color:${info ? 'var(--warn-ink)' : 'var(--primary)'}">${icon(info ? 'triangle-alert' : 'clock', 'xl')}</span>
      <h1 style="font-size:1.4rem">${esc(T(info ? 'wait.info.title' : 'wait.title'))}</h1>
      ${info ? `<p>${esc(T('wait.info.lead'))}</p><p class="card" style="background:var(--warn-50);color:var(--warn-ink);font-weight:600;width:100%">${esc(acc.org?.status_reason || '')}</p><p class="small">${esc(T('wait.info.action'))}</p>`
        : `<p>${esc(T('wait.lead'))}</p>`}
      <p class="small muted">${icon('lock')} ${esc(T('wait.blocked'))}</p>
      <span class="badge ${info ? 'b-warn' : 'b-pri'}">${esc(T('wait.status.' + acc.account_status))}</span>
    </div>
    <div id="orgBox"></div>
    <div class="card"><h3 style="margin-bottom:10px">${icon('inbox')} ${esc(T('wait.messages'))}</h3>${messagesList(acc.messages, T('wait.no_messages'))}</div>
  </div></div>`;
  $('#out').onclick = async () => { await logout(); location.replace('/'); };
  orgEditor($('#orgBox'), acc, { T, editableName: info, onResubmit: info });
}

function messagesList(rows, empty) {
  if (!rows?.length) return `<p class="muted small">${esc(empty)}</p>`;
  return `<div class="stack" style="gap:8px">${rows.map(m => `<div style="border:1px solid var(--line);border-radius:8px;padding:10px">
    <div class="row tiny muted">${icon(m.channel === 'email' ? 'mail' : 'message-square-text')}<span>${m.channel === 'email' ? 'E-mail' : 'SMS'} · ${esc(m.channel === 'email' ? m.email : fmtPhone(m.phone))}</span><span class="right">${esc(dateTime(m.created_at))}</span></div>
    ${m.subject ? `<div class="small" style="font-weight:650;margin-top:4px">${esc(m.subject)}</div>` : ''}<div class="small" style="margin-top:4px">${esc(m.body)}</div></div>`).join('')}</div>
    <p class="tiny muted" style="margin-top:8px">E-mails et SMS simulés pendant le prototype.</p>`;
}

// Fiche de l'organisation : identifiants légaux, adresse, documents (et renvoi de la demande si un complément est demandé)
function orgEditor(el, acc, { T = (k) => k, editableName = false, onResubmit = false } = {}) {
  const o = acc.org; if (!o) { el.innerHTML = ''; return; }
  const lbl = (k, fb) => { const v = T(k); return v === k ? fb : v; };
  el.innerHTML = `<div class="card stack"><h3>${icon('building-2')} ${esc(lbl('wait.file', 'Votre dossier'))} · ${esc(o.name)}</h3>
    <div class="fgrid c2">
      ${editableName ? `<div class="full"><label class="lbl" for="oName">${esc(lbl('f.org_name.org', 'Nom'))}</label><input class="input" id="oName" value="${esc(o.name)}"></div>` : ''}
      <div><label class="lbl" for="oRccm">${esc(lbl('f.rccm', 'RCCM'))}</label><input class="input" id="oRccm" value="${esc(o.rccm || '')}"></div>
      <div><label class="lbl" for="oIdnat">${esc(lbl('f.id_nat', 'ID national'))}</label><input class="input" id="oIdnat" value="${esc(o.id_nat || '')}"></div>
      <div><label class="lbl" for="oNif">${esc(lbl('f.nif', 'NIF'))}</label><input class="input" id="oNif" value="${esc(o.nif || '')}"></div>
      <div><label class="lbl" for="oRole">${esc(lbl('f.contact_role', 'Fonction'))}</label><input class="input" id="oRole" value="${esc(o.contact_role || '')}"></div>
      <div class="full"><label class="lbl" for="oAddr">${esc(lbl('f.address', 'Adresse'))}</label><input class="input" id="oAddr" value="${esc(o.address || '')}"></div>
    </div>
    ${o.kind === 'buyer' ? `<p class="small muted">${esc(lbl('f.ids_hint', 'RCCM, ID national et NIF sont demandés avant le premier ordre d\'achat.'))}</p>` : ''}
    <div><button class="btn primary" id="oSave">${icon('save')}${esc(lbl('wait.save', 'Enregistrer'))}</button></div>
    <div><span class="lbl">${esc(lbl('wait.docs', 'Documents'))}</span><div id="oFiles" class="stack" style="gap:6px"></div>
      <label class="btn sm" style="margin-top:8px">${icon('paperclip')}${esc(lbl('wait.add_doc', 'Ajouter un document'))}<input type="file" id="oFile" accept=".pdf,.jpg,.jpeg,.png" hidden></label>
      <div class="hint">${esc(lbl('f.docs_hint', 'PDF, JPG ou PNG, 1,5 Mo maximum.'))}</div></div>
    ${onResubmit ? `<div style="border-top:1px solid var(--line);padding-top:14px"><button class="btn ok" id="oResub">${icon('send')}${esc(lbl('wait.resubmit', 'Renvoyer ma demande'))}</button></div>` : ''}
  </div>`;
  const drawFiles = (files) => { $('#oFiles').innerHTML = files.length ? files.map(f => `<div class="row small" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">${icon('file-text')}<span class="grow">${esc(f.name)}</span><button class="btn sm ghost" data-f="${f.id}">${icon('eye')}</button></div>`).join('') : '<p class="muted small">—</p>'; };
  drawFiles(acc.files);
  $('#oFiles').onclick = async (e) => { const b = e.target.closest('[data-f]'); if (b) openFile('/api/account/file/' + b.dataset.f); };
  $('#oSave').onclick = async () => {
    const body = { rccm: $('#oRccm').value, id_nat: $('#oIdnat').value, nif: $('#oNif').value, contact_role: $('#oRole').value, address: $('#oAddr').value };
    if (editableName) body.name = $('#oName').value;
    try { await api('/api/account/org', { method: 'PATCH', body }); toast(lbl('wait.saved', 'Enregistré.'), 'ok'); } catch (ex) { toast(ex.message, 'err'); }
  };
  $('#oFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const r = await fetch('/api/account/upload', { method: 'POST', headers: { authorization: 'Bearer ' + session.get().token, 'x-file-name': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' }, body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
      drawFiles((await api('/api/account')).files); toast(lbl('wait.saved', 'Enregistré.'), 'ok');
    } catch (ex) { toast(ex.message, 'err'); }
  };
  if (onResubmit) $('#oResub').onclick = async () => {
    try { $('#oSave').click(); await api('/api/account/resubmit', { method: 'POST' }); toast(lbl('wait.resubmitted', 'Demande renvoyée.'), 'ok'); setTimeout(() => location.reload(), 800); } catch (ex) { toast(ex.message, 'err'); }
  };
}

// Ouvre un document protégé (le jeton passe dans l'en-tête, pas dans l'adresse)
async function openFile(url) {
  const w = window.open('', '_blank');
  try {
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + session.get().token } });
    if (!r.ok) throw new Error('Document introuvable');
    const blob = await r.blob(); const u = URL.createObjectURL(blob);
    if (w) w.location = u; else location.href = u;
  } catch (ex) { if (w) w.close(); toast(ex.message, 'err'); }
}

function go(sec) {
  const allowed = NAV[USER.role].map(n => n[0]);
  if (!allowed.includes(sec)) sec = allowed[0];
  history.replaceState(null, '', '#' + sec);
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === sec));
  const main = $('#main'), view = document.createElement('div');
  view.className = 'view-enter'; view.innerHTML = skeleton(6);
  main.replaceChildren(view);
  (VIEWS[sec] || VIEWS.later)(view, sec);
}

const EVENT = { requested: 'SMS de demande envoyé', granted: 'Accordé (NDIYO)', refused: 'Refusé (HAPANA)', withdrawn: 'Retiré (SITISHA)' };
const zoneName = (id) => REF.zones.find(z => z.id === id)?.name || '';
const pointName = (id) => REF.collection_points.find(p => p.id === id)?.name || '';

const VIEWS = {
  async overview(el) {
    if (USER.role !== 'coordination') {
      const st = (await (await fetch('/api/public/site?lang=fr')).json()).stats;
      el.innerHTML = `<div class="page-h"><div><h1>Vue d'ensemble</h1><p>Chiffres agrégés de la plateforme. Les listes de producteurs de votre organisation s'afficheront ici quand ils vous seront rattachés.</p></div></div>
        <div class="kpis"><div class="kpi"><div class="k">Producteurs inscrits</div><div class="v">${st.producers}</div></div><div class="kpi"><div class="k">Part de femmes</div><div class="v">${st.women_pct ?? 'n.d.'}${st.women_pct != null ? ' %' : ''}</div></div>
        <div class="kpi"><div class="k">Avec parcelle géolocalisée</div><div class="v">${st.with_plot}</div></div><div class="kpi"><div class="k">Territoires couverts</div><div class="v">${st.territories.length}</div></div></div>`;
      return;
    }
    const r = await api('/api/producers');
    const rows = r.rows, women = rows.filter(p => p.sex === 'F').length, ok = rows.filter(p => p.consent_status === 'granted').length;
    el.innerHTML = `<div class="page-h"><div><h1>Vue d'ensemble</h1><p>Situation de référence des producteurs inscrits. Volumes, montants et prix obtenus s'ajouteront avec les ordres d'achat.</p></div></div>
      <div class="kpis"><div class="kpi"><div class="k">Producteurs inscrits</div><div class="v" data-c="${rows.length}">0</div></div>
      <div class="kpi"><div class="k">Part de femmes</div><div class="v" data-c="${rows.length ? Math.round(women / rows.length * 100) : 0}" data-suffix=" %">0</div><div class="s">${women} femme(s)</div></div>
      <div class="kpi"><div class="k">Consentement validé</div><div class="v" data-c="${ok}">0</div><div class="s">${rows.length - ok} en attente ou refusé</div></div>
      <div class="kpi"><div class="k">Avec parcelle</div><div class="v" data-c="${rows.filter(p => p.plot_count).length}">0</div></div></div>`;
    $$('[data-c]', el).forEach(n => countUp(n, Number(n.dataset.c), v => Math.round(v) + (n.dataset.suffix || '')));
  },
  async producers(el) {
    el.innerHTML = `<div class="page-h"><div><h1>Producteurs</h1><p>Les noms, téléphones et coordonnées GPS ne sont visibles que par la coordination et l'administration.</p></div></div>
      <div class="toolbar"><input class="input search" type="search" id="q" placeholder="Nom, code ou téléphone…"><select class="input" id="fc"><option value="">Consentement : tous</option><option value="granted">Validé</option><option value="pending">En attente</option><option value="refused">Refusé</option></select>
        <select class="input" id="fp"><option value="">Point : tous</option>${REF.collection_points.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><span class="small muted right" id="cnt"></span></div><div id="list">${skeleton(5)}</div>`;
    let rows = [];
    const load = async () => {
      const p = new URLSearchParams({ q: $('#q').value.trim(), consent_status: $('#fc').value, collection_point_id: $('#fp').value });
      rows = (await api('/api/producers?' + p)).rows;
      $('#cnt').textContent = rows.length + ' producteur(s)';
      $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Producteur</th><th>Téléphone</th><th>Village / point</th><th>Parcelle</th><th>Consentement</th><th></th></tr></thead><tbody>${rows.map((p, i) =>
        `<tr><td class="mono">${esc(p.code)}</td><td><b>${esc(p.full_name)}</b><div class="tiny muted">${p.sex === 'F' ? 'Femme' : 'Homme'} · ${esc(p.birth_year || '')}</div></td><td>${esc(fmtPhone(p.phone))}</td>
         <td>${esc(zoneName(p.village_id))}<div class="tiny muted">${esc(pointName(p.collection_point_id))}</div></td><td>${p.plot_count ? `<span class="badge b-pri">${icon('map-pin')}${p.plot_count}</span>` : '<span class="muted small">aucune</span>'}</td>
         <td>${consentBadge(p.consent_status)}</td><td><button class="btn sm" data-i="${i}">${icon('eye')}Fiche</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun producteur.</div>';
    };
    $('#q').oninput = debounce(load, 300); $('#fc').onchange = load; $('#fp').onchange = load;
    $('#list').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) sheet(rows[+b.dataset.i], load); };
    load();
  },
  async org(el) {
    el.innerHTML = `<div class="page-h"><div><h1>${USER.role === 'buyer' ? 'Mon entreprise' : 'Mon organisation'}</h1><p>Informations de votre compte, documents et messages reçus.</p></div></div><div id="ob"></div><div class="card" style="margin-top:18px"><h3 style="margin-bottom:10px">${icon('inbox')} Messages reçus</h3><div id="om"></div></div>`;
    const acc = await api('/api/account');
    orgEditor($('#ob', el), acc);
    $('#om', el).innerHTML = messagesList(acc.messages, 'Aucun message.');
  },
  async orders(el) {
    if (USER.role !== 'buyer') return VIEWS.later(el, 'orders');
    el.innerHTML = `<div class="page-h"><div><h1>Mes ordres d'achat</h1><p>Publiez un ordre : produit, grade, volume, prix et point de collecte.</p></div><button class="btn primary right" id="newOrder">${icon('plus')}Nouvel ordre d'achat</button></div>
      <div class="card empty">${icon('clipboard-list', 'xl')}<p>Aucun ordre pour le moment. La création complète des ordres arrive à l'étape c du prototype.</p></div>`;
    $('#newOrder', el).onclick = async () => { try { await api('/api/buyer/orders', { method: 'POST', body: {} }); } catch (ex) { toast(ex.message, ex.status === 501 ? 'warn' : 'err'); if (ex.status === 403 && /RCCM/.test(ex.message)) go('org'); } };
  },
  later(el, sec) {
    const what = { orders: 'Ordres d\'achat', payments: 'Paiements', lots: 'Dossiers de lots', exports: 'Exports CSV et GeoJSON' }[sec] || sec;
    el.innerHTML = `<div class="page-h"><div><h1>${esc(what)}</h1></div></div><div class="card empty">${icon('clock', 'xl')}<p>Cet écran arrive aux étapes suivantes du prototype (c à f).</p></div>`;
  }
};

async function sheet(p, reload) {
  const d = await api('/api/producers/' + p.id);
  const bl = d.baseline;
  modal({ title: p.full_name + ' · ' + p.code, wide: true, body: `<div class="row" style="align-items:flex-start;gap:24px"><div class="stack" style="flex:1 1 300px">
      <div id="cbadge">${consentBadge(d.producer.consent_status)}</div>
      <table class="t"><tbody><tr><td class="muted">Téléphone</td><td>${esc(fmtPhone(d.producer.phone))}</td></tr>
      <tr><td class="muted">Ménage</td><td>${esc(d.producer.household_size ?? '?')} personne(s)${d.producer.female_headed ? ' · dirigé par une femme' : ''}</td></tr>
      <tr><td class="muted">Référence</td><td>${bl ? `${esc(bl.production_kg ?? '?')} kg · ${esc(bl.last_price_amount ?? '?')} ${esc(bl.last_price_currency)}/kg (${esc(bl.season || '')})` : '—'}</td></tr>
      <tr><td class="muted">Parcelles</td><td>${d.plots.map(pl => `${pl.geometry_type === 'point' ? 'Point' : 'Polygone'} · ${pl.declared_area_ha} ha · ${esc(date(pl.captured_at))}`).join('<br>') || '—'}</td></tr>
      <tr><td class="muted">Historique du consentement</td><td class="small">${d.consent.map(c => `${esc(EVENT[c.event] || c.event)} · ${esc(date(c.at))}`).join('<br>')}</td></tr></tbody></table>
      <p class="tiny muted">Le téléphone simulé permet de jouer le producteur : répondre NDIYO valide le consentement.</p></div>
      <div id="ph" style="flex:0 0 280px"></div></div>`,
    actions: [{ label: 'Fermer', cls: 'primary', onClick: () => { closeModal(); reload(); } }] });
  phoneSim($('#ph'), { ...d.producer, id: p.id }, async () => { const u = await api('/api/producers/' + p.id); $('#cbadge').innerHTML = consentBadge(u.producer.consent_status); });
}

start();
