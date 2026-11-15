// Espaces web acheteur et coordination.
// Étape a : coordination (producteurs, consentement, téléphone simulé). Les ordres d'achat arrivent à l'étape c.
import { api, session } from '../socle/api.js';
import { guard, logout } from '../socle/auth.js';
import { esc, date, fmtPhone, debounce } from '../socle/util.js';
import { $, $$, icon, toast, modal, closeModal, skeleton, countUp, demoBanner, toggleTheme, consentBadge } from '../ui/ui.js';
import { phoneSim } from '../ui/phone.js';

const root = $('#root');
let USER = null, REF = null;

const NAV = {
  coordination: [['overview', 'layout-dashboard', 'Vue d\'ensemble'], ['producers', 'users', 'Producteurs'], ['orders', 'clipboard-list', 'Ordres d\'achat'], ['exports', 'download', 'Exports']],
  buyer: [['orders', 'clipboard-list', 'Mes ordres d\'achat'], ['payments', 'wallet', 'Paiements'], ['lots', 'package', 'Dossiers de lots']]
};

async function start() {
  USER = await guard(['buyer', 'coordination']); if (!USER) return;
  demoBanner();
  try { REF = await api('/api/ref'); } catch (e) { if (e.status === 401) { location.replace('/'); return; } }
  const nav = NAV[USER.role];
  root.innerHTML = `<div class="shell"><aside class="side">
      <div class="brand"><img src="/assets/logo-mark.png" alt=""><div><b>KivuTrace &amp; Market</b><span class="tiny muted">${USER.role === 'buyer' ? 'Espace acheteur' : 'Coordination'}</span></div></div>
      ${nav.map(n => `<button class="nav-btn" data-nav="${n[0]}">${icon(n[1])}${n[2]}</button>`).join('')}
      <div class="side-foot"><div class="small"><b>${esc(USER.full_name)}</b><div class="tiny muted">${esc(REF?.settings.cooperative_name || '')}</div></div>
        <div class="row"><button class="icon-btn" id="theme" aria-label="Changer de thème">${icon('moon')}</button><button class="btn sm ghost" id="out">${icon('log-out')}Déconnexion</button></div></div>
    </aside><main class="main" id="main"></main></div>`;
  $('#out').onclick = async () => { await logout(); location.replace('/'); };
  $('#theme').onclick = toggleTheme;
  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
  go(location.hash.slice(1) || nav[0][0]);
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
  later(el, sec) {
    const what = { orders: 'Ordres d\'achat', payments: 'Paiements', lots: 'Dossiers de lots', exports: 'Exports CSV et GeoJSON' }[sec];
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
