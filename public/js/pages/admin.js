// Espace /admin : connexion avec double authentification (TOTP), puis gestion sans toucher au code.
import { api, session } from '../socle/api.js';
import { login, confirmTotp, changePassword, makePassword, passwordProblem, logout } from '../socle/auth.js';
import { esc, date, dateTime, fmtPhone, download, stamp, debounce } from '../socle/util.js';
import { $, $$, icon, toast, modal, closeModal, confirmBox, skeleton, countUp, demoBanner, toggleTheme, consentBadge } from '../ui/ui.js';
import { listView } from '../ui/table.js';
import { phoneSim } from '../ui/phone.js';

const root = $('#root');
let REF = null, AGENTS = [];
const LEVELS = [['province', 'Province'], ['territoire', 'Territoire'], ['secteur_chefferie', 'Secteur / chefferie'], ['groupement', 'Groupement'], ['village', 'Village']];
const LEVEL_LABEL = Object.fromEntries(LEVELS);
const ROLES = [['agent', 'Agent de collecte'], ['buyer', 'Acheteur'], ['coordination', 'Coordination'], ['admin', 'Administrateur']];
const ROLE_LABEL = Object.fromEntries(ROLES);
const TPL_CODES = ['CONSENT_REQUEST', 'CONSENT_OK', 'CONSENT_REFUSED', 'HELP', 'ORDER_OFFER', 'ORDER_CONFIRMED', 'ORDER_REMINDER', 'WEIGH_RECEIPT', 'PAYMENT_SENT'];
const VARS = ['nom', 'poids', 'montant', 'date', 'cooperative', 'ussd', 'volume', 'produit', 'point', 'prix', 'ordre', 'reference', 'grade', 'heure'];

/* ------------------------------------------------------------------ Connexion */
async function start() {
  demoBanner();
  const s = session.get();
  if (s?.token && s.user?.role === 'admin') {
    try { const me = await api('/api/me'); if (me.session.kind === 'admin') return boot(me.user); } catch {}
  }
  loginView();
}

function loginView() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card stack">
    <div class="row" style="gap:14px"><img class="logo" src="/assets/logo-mark.png" alt=""><div><h1 style="font-size:1.25rem">Administration</h1><p class="muted small">KivuTrace &amp; Market · accès réservé</p></div></div>
    <form class="card stack" id="f" novalidate>
      <div><label class="lbl" for="lg">Identifiant</label><input class="input" id="lg" autocomplete="username" autocapitalize="none"></div>
      <div><label class="lbl" for="pw">Mot de passe</label><input class="input" id="pw" type="password" autocomplete="current-password"></div>
      <div class="err" id="err" role="alert"></div>
      <button class="btn primary block" id="go">Continuer</button>
      <p class="tiny muted">Double authentification obligatoire : un code à 6 chiffres de votre application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…).</p>
    </form></div></div>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'Vérification…'; $('#err').textContent = '';
    try {
      const r = await login($('#lg').value.trim(), $('#pw').value, 'admin');
      if (r.stage === 'ok') { $('#err').textContent = 'Ce compte n\'est pas administrateur.'; session.clear(); return; }
      totpView(r);
    } catch (ex) { $('#err').textContent = ex.message; }
    finally { btn.disabled = false; btn.textContent = 'Continuer'; }
  });
}

function totpView(r) {
  const enroll = r.stage === 'enroll';
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card stack"><form class="card stack" id="f" novalidate>
    <h2>${enroll ? 'Activer la double authentification' : 'Code de vérification'}</h2>
    ${enroll ? `<p class="small">Scannez ce code avec votre application d'authentification, puis saisissez le code à 6 chiffres affiché.</p>
      <div id="qr" style="display:grid;place-items:center;padding:10px;background:#fff;border-radius:10px;border:1px solid var(--line)"></div>
      <p class="tiny muted">Saisie manuelle : <span class="mono" style="word-break:break-all">${esc(r.secret)}</span></p>` : '<p class="small">Saisissez le code à 6 chiffres de votre application d\'authentification.</p>'}
    <div><label class="lbl" for="code">Code</label><input class="input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" style="font-size:1.4rem;letter-spacing:.3em;text-align:center"></div>
    <div class="err" id="err" role="alert"></div>
    <button class="btn primary block" id="go">Valider</button>
    <button class="btn ghost block" type="button" id="back">Retour</button></form></div></div>`;
  if (enroll) {
    const draw = () => { if (window.QRCode) new QRCode($('#qr'), { text: r.otpauth, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M }); else $('#qr').textContent = 'QR indisponible : utilisez la saisie manuelle.'; };
    window.QRCode ? draw() : setTimeout(draw, 800);
  }
  $('#back').onclick = loginView;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try { const ok = await confirmTotp(r.token, $('#code').value.trim()); boot(ok.user); }
    catch (ex) { $('#err').textContent = ex.message; $('#code').value = ''; }
  });
}

function forcePassword(user) {
  modal({ title: 'Choisissez votre mot de passe', body: `<p class="small" style="margin-bottom:12px">Le mot de passe actuel est provisoire. Choisissez-en un personnel (10 caractères minimum, lettres et chiffres).</p>
    <div class="stack"><div><label class="lbl" for="o">Mot de passe actuel</label><input class="input" id="o" type="password" autocomplete="current-password"></div>
    <div><label class="lbl" for="n1">Nouveau mot de passe</label><input class="input" id="n1" type="password" autocomplete="new-password"></div>
    <div><label class="lbl" for="n2">Confirmer</label><input class="input" id="n2" type="password" autocomplete="new-password"></div><div class="err" id="pe"></div></div>`,
    actions: [{ label: 'Enregistrer', cls: 'primary', onClick: async () => {
      const n = $('#n1').value; const pb = passwordProblem(n);
      if (pb) { $('#pe').textContent = pb; return; }
      if (n !== $('#n2').value) { $('#pe').textContent = 'Les deux saisies diffèrent.'; return; }
      try { await changePassword($('#o').value, n); closeModal(true); toast('Mot de passe enregistré.', 'ok'); }
      catch (ex) { $('#pe').textContent = ex.message; }
    } }],
    onclose: () => { if (session.get()?.user?.must_change) { logout().then(loginView); } } });
}

/* ------------------------------------------------------------------ Structure */
const NAV = [
  ['dash', 'layout-dashboard', 'Tableau de bord'],
  '|Référentiels', ['zones', 'map', 'Géographie'], ['points', 'map-pin', 'Points de collecte'], ['commodities', 'coffee', 'Filières'], ['grades', 'scale', 'Grades'],
  '|Personnes', ['users', 'users', 'Utilisateurs'], ['assignments', 'map-pinned', 'Affectations des agents'], ['producers', 'sprout', 'Producteurs'],
  '|Communication', ['templates', 'message-square-text', 'Modèles de SMS'], ['simulator', 'smartphone', 'Téléphone producteur'],
  '|Système', ['settings', 'settings', 'Paramètres et modules'], ['trash', 'archive', 'Corbeille'], ['audit', 'history', 'Journal']
];

async function boot(user) {
  root.innerHTML = `<div class="shell"><aside class="side">
      <div class="brand"><img src="/assets/logo-mark.png" alt=""><div><b>KivuTrace &amp; Market</b><span class="tiny muted">Administration</span></div></div>
      ${NAV.map(n => typeof n === 'string' ? `<div class="nav-sep">${n.slice(1)}</div>` : `<button class="nav-btn" data-nav="${n[0]}">${icon(n[1])}${n[2]}</button>`).join('')}
      <div class="side-foot"><div class="small"><b>${esc(user.full_name)}</b><div class="tiny muted">${esc(user.login)}</div></div>
        <div class="row"><button class="icon-btn" id="theme" title="Mode sombre" aria-label="Changer de thème">${icon('moon')}</button><button class="btn sm ghost" id="out">${icon('log-out')}Déconnexion</button></div></div>
    </aside><main class="main" id="main"></main></div>`;
  $('#out').onclick = async () => { await logout(); loginView(); };
  $('#theme').onclick = toggleTheme;
  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
  await loadRef();
  go(location.hash.slice(1) || 'dash');
  if (user.must_change) forcePassword(user);
}

async function loadRef() {
  REF = await api('/api/ref');
  AGENTS = (await api('/api/admin/users?f.role=agent')).rows;
}
const zoneById = (id) => REF.zones.find(z => z.id === id);
const zonePath = (id) => { const out = []; let z = zoneById(id); while (z) { out.unshift(z.name); z = zoneById(z.parent_id); } return out.join(' › '); };
const pointById = (id) => REF.collection_points.find(p => p.id === id);
const commodityById = (id) => REF.commodities.find(c => c.id === id);
const yes = (v) => v ? `<span class="badge b-ok">Actif</span>` : `<span class="badge">Inactif</span>`;

function go(sec) {
  if (!SECTIONS[sec]) sec = 'dash';
  history.replaceState(null, '', '#' + sec);
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === sec));
  const main = $('#main'), view = document.createElement('div');
  view.className = 'view-enter'; view.innerHTML = skeleton(6);
  main.replaceChildren(view);
  SECTIONS[sec](view);
}

/* ------------------------------------------------------------------ Sections */
const SECTIONS = {
  async dash(el) {
    const [s, a] = await Promise.all([api('/api/admin/summary'), api('/api/admin/audit')]);
    el.innerHTML = `<div class="page-h"><div><h1>Tableau de bord</h1><p>Vue d'ensemble de la plateforme.</p></div></div>
      <div class="kpis"><div class="kpi"><div class="k">Producteurs</div><div class="v" data-c="${s.producers}">0</div></div>
        <div class="kpi"><div class="k">Femmes</div><div class="v" data-c="${s.women}">0</div><div class="s">${s.producers ? Math.round(s.women / s.producers * 100) : 0} % des producteurs</div></div>
        <div class="kpi"><div class="k">Consentements en attente</div><div class="v" data-c="${s.consent_pending}">0</div><div class="s">non payables tant que « NDIYO » n'est pas reçu</div></div>
        <div class="kpi"><div class="k">Utilisateurs</div><div class="v" data-c="${s.users}">0</div></div>
        <div class="kpi"><div class="k">Modifications (24 h)</div><div class="v" data-c="${s.audit_24h}">0</div></div></div>
      <div class="card" style="margin-top:18px"><div class="card-h"><h3 class="grow">Dernières modifications</h3><button class="btn sm" data-go="audit">Voir le journal</button></div>${auditTable(a.rows.slice(0, 8))}</div>`;
    $$('[data-c]', el).forEach(n => countUp(n, Number(n.dataset.c)));
    $('[data-go]', el).onclick = () => go('audit');
  },

  zones(el) {
    listView(el, { entity: 'zones', title: 'Géographie', sub: 'Province › territoire › secteur/chefferie › groupement › village. Les points de collecte se rattachent aux villages.',
      filters: [{ key: 'level', label: 'Niveau', options: () => LEVELS }],
      columns: [{ key: 'name', label: 'Nom', render: r => `<b>${esc(r.name)}</b>${r.code ? ` <span class="muted mono">${esc(r.code)}</span>` : ''}` },
        { key: 'level', label: 'Niveau', render: r => esc(LEVEL_LABEL[r.level]) },
        { key: 'parent_id', label: 'Rattachement', render: r => esc(zonePath(r.parent_id)) || '<span class="muted">racine</span>' },
        { key: 'active', label: 'État', render: r => yes(r.active) + (r.is_demo ? ' <span class="badge b-warn">Démo</span>' : '') }],
      fields: [{ key: 'level', label: 'Niveau', type: 'select', options: () => LEVELS, required: true },
        { key: 'parent_id', label: 'Rattachée à', type: 'select', options: () => REF.zones.map(z => [z.id, LEVEL_LABEL[z.level] + ' : ' + zonePath(z.id)]), hint: 'Doit être du niveau juste au-dessus.' },
        { key: 'name', label: 'Nom', required: true }, { key: 'code', label: 'Code (facultatif)' }, { key: 'active', label: 'Active', type: 'bool', default: 1 }],
      onFormRender(form) {
        const lv = $('#fld-level', form), par = $('#fld-parent_id', form);
        const sync = () => { const i = LEVELS.findIndex(l => l[0] === lv.value); const want = i > 0 ? LEVELS[i - 1][0] : null; const cur = par.value;
          par.innerHTML = '<option value="">' + (want ? 'Choisir…' : 'Aucun (province)') + '</option>' + (want ? REF.zones.filter(z => z.level === want).map(z => `<option value="${z.id}" ${z.id === cur ? 'selected' : ''}>${esc(zonePath(z.id))}</option>`).join('') : ''); par.disabled = !want; };
        lv.addEventListener('change', sync); sync();
      },
      afterSave: loadRef });
  },

  points(el) {
    listView(el, { entity: 'collection_points', title: 'Points de collecte', sub: 'Lieux de pesée, rattachés à un village, avec leurs coordonnées GPS.',
      filters: [{ key: 'village_id', label: 'Village', options: () => REF.zones.filter(z => z.level === 'village').map(z => [z.id, z.name]) }],
      columns: [{ key: 'name', label: 'Point de collecte', render: r => `<b>${esc(r.name)}</b>` }, { key: 'village_id', label: 'Localisation', render: r => esc(zonePath(r.village_id)) },
        { key: 'lat', label: 'GPS', render: r => `<span class="mono small">${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}</span>` }, { key: 'active', label: 'État', render: r => yes(r.active) }],
      fields: [{ key: 'village_id', label: 'Village', type: 'select', required: true, options: () => REF.zones.filter(z => z.level === 'village').map(z => [z.id, zonePath(z.id)]) },
        { key: 'name', label: 'Nom du point', required: true }, { key: 'lat', label: 'Latitude', type: 'number', required: true, hint: 'Degrés décimaux, ex. -1.7050' },
        { key: 'lng', label: 'Longitude', type: 'number', required: true, hint: 'Ex. 29.0300' }, { key: 'active', label: 'Actif', type: 'bool', default: 1 }],
      afterSave: loadRef });
  },

  commodities(el) {
    listView(el, { entity: 'commodities', title: 'Filières', sub: 'Produits achetés et leur unité. Les filières concernées par l\'EUDR exigent la géolocalisation des parcelles.',
      columns: [{ key: 'name_fr', label: 'Filière', render: r => `<b>${esc(r.name_fr)}</b> <span class="muted">· ${esc(r.name_sw)}</span>` }, { key: 'code', label: 'Code', render: r => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'unit', label: 'Unité' }, { key: 'hs_code', label: 'Code SH' }, { key: 'eudr_scope', label: 'EUDR', render: r => r.eudr_scope ? '<span class="badge b-pri">Concernée</span>' : '<span class="muted small">Non</span>' }, { key: 'active', label: 'État', render: r => yes(r.active) }],
      fields: [{ key: 'name_fr', label: 'Nom (français)', required: true }, { key: 'name_sw', label: 'Nom (swahili)', required: true }, { key: 'code', label: 'Code', required: true, hint: 'Ex. CAFE_ARABICA' },
        { key: 'unit', label: 'Unité', required: true, default: 'kg' }, { key: 'hs_code', label: 'Code SH (douane)' }, { key: 'eudr_scope', label: 'Concernée par le règlement EUDR', type: 'bool' }, { key: 'active', label: 'Active', type: 'bool', default: 1 }],
      afterSave: loadRef });
  },

  grades(el) {
    listView(el, { entity: 'grades', title: 'Grades', sub: 'Grades par filière, définis par des critères mesurables. L\'agent choisit le grade à la pesée ; l\'ordre d\'achat impose un grade.',
      filters: [{ key: 'commodity_id', label: 'Filière', options: () => REF.commodities.map(c => [c.id, c.name_fr]) }],
      columns: [{ key: 'commodity_id', label: 'Filière', render: r => esc(commodityById(r.commodity_id)?.name_fr || '?') }, { key: 'label_fr', label: 'Grade', render: r => `<b>${esc(r.label_fr)}</b> <span class="muted">· ${esc(r.label_sw)}</span>` },
        { key: 'criteria', label: 'Critères', render: r => JSON.parse(r.criteria || '[]').map(c => `<span class="badge">${esc(c.label)} ${c.min != null ? '≥ ' + c.min : ''}${c.max != null ? '≤ ' + c.max : ''} ${esc(c.unit)}</span>`).join(' ') },
        { key: 'rank', label: 'Rang' }, { key: 'active', label: 'État', render: r => yes(r.active) }],
      fields: [{ key: 'commodity_id', label: 'Filière', type: 'select', required: true, options: () => REF.commodities.map(c => [c.id, c.name_fr]) }, { key: 'code', label: 'Code', required: true, hint: 'Ex. G1' },
        { key: 'label_fr', label: 'Libellé (français)', required: true }, { key: 'label_sw', label: 'Libellé (swahili)', required: true }, { key: 'rank', label: 'Rang (1 = meilleur)', type: 'number', required: true, default: 1 },
        { key: 'active', label: 'Actif', type: 'bool', default: 1 }, { key: 'criteria', label: 'Critères mesurables', type: 'criteria', hint: 'Ex. Humidité, %, max 12 ; Défauts pour 350 g, nb, max 5.' }],
      afterSave: loadRef });
  },

  users(el) {
    listView(el, { entity: 'users', title: 'Utilisateurs', sub: 'Comptes et rôles. Chaque rôle ne voit que son espace. Un nouveau compte reçoit un mot de passe provisoire à changer à la 1re connexion.', importCsv: false,
      filters: [{ key: 'role', label: 'Rôle', options: () => ROLES }, { key: 'status', label: 'État', options: () => [['active', 'Actif'], ['blocked', 'Bloqué']] }],
      columns: [{ key: 'full_name', label: 'Nom', render: r => `<b>${esc(r.full_name)}</b><div class="tiny muted">${esc(r.login)}</div>` }, { key: 'role', label: 'Rôle', render: r => `<span class="badge b-pri">${esc(ROLE_LABEL[r.role])}</span>${r.agent_code ? ` <span class="mono small">${esc(r.agent_code)}</span>` : ''}` },
        { key: 'status', label: 'État', render: r => (r.status === 'blocked' ? '<span class="badge b-err">Bloqué</span>' : '<span class="badge b-ok">Actif</span>') + (r.locked_until > Date.now() ? ' <span class="badge b-warn">Verrouillé</span>' : '') + (r.is_demo ? ' <span class="badge b-warn">Démo</span>' : '') },
        { key: 'role', label: 'Double auth.', render: r => r.role === 'admin' ? (r.totp_enabled ? '<span class="badge b-ok">Active</span>' : '<span class="badge b-warn">À activer</span>') : '<span class="muted small">—</span>' },
        { key: 'last_login_at', label: 'Dernière connexion', render: r => esc(dateTime(r.last_login_at)) || '<span class="muted small">jamais</span>' }],
      fields: [{ key: 'full_name', label: 'Nom complet', required: true }, { key: 'login', label: 'Identifiant', required: true, hint: 'Ex. prenom.nom' },
        { key: 'role', label: 'Rôle', type: 'select', required: true, options: () => ROLES }, { key: 'agent_code', label: 'Code agent', hint: 'Obligatoire pour un agent, ex. AG07. Il préfixe les codes producteurs.' },
        { key: 'email', label: 'E-mail' }, { key: 'phone', label: 'Téléphone' }, { key: 'lang', label: 'Langue', type: 'select', options: () => [['fr', 'Français'], ['sw', 'Swahili']], default: 'fr' },
        { key: 'status', label: 'État', type: 'select', options: () => [['active', 'Actif'], ['blocked', 'Bloqué']], default: 'active' },
        { key: 'temp_password', label: 'Mot de passe provisoire', type: 'password', createOnly: true, required: true, hint: '10 caractères minimum, lettres et chiffres. À transmettre à la personne.' }],
      async beforeSave(d, row) {
        if (!row) { const pb = passwordProblem(d.temp_password || ''); if (pb) throw new Error('Mot de passe provisoire : ' + pb); d.password = await makePassword(d.temp_password); }
        delete d.temp_password; return d;
      },
      rowActions: (r) => [{ label: 'Réinitialiser le mot de passe', icon: 'key-round', onClick: (row, reload) => resetPassword(row, reload) },
        ...(r.role === 'admin' ? [{ label: 'Réinitialiser la double authentification', icon: 'shield', onClick: (row, reload) => confirmBox('Réinitialiser la double authentification ?', 'La personne devra scanner un nouveau QR code à sa prochaine connexion.', 'Réinitialiser', async () => { await api(`/api/admin/users/${row.id}/reset-totp`, { method: 'POST' }); closeModal(); toast('Double authentification réinitialisée.', 'ok'); reload(); }) }] : [])],
      afterSave: loadRef });
  },

  assignments(el) {
    listView(el, { entity: 'agent_assignments', title: 'Affectations des agents', sub: 'Un agent ne voit et n\'inscrit que les producteurs de ses points de collecte.',
      filters: [{ key: 'agent_id', label: 'Agent', options: () => AGENTS.map(a => [a.id, a.full_name]) }, { key: 'collection_point_id', label: 'Point', options: () => REF.collection_points.map(p => [p.id, p.name]) }],
      columns: [{ key: 'agent_id', label: 'Agent', render: r => { const a = AGENTS.find(x => x.id === r.agent_id); return a ? `<b>${esc(a.full_name)}</b> <span class="mono small">${esc(a.agent_code)}</span>` : '?'; } },
        { key: 'collection_point_id', label: 'Point de collecte', render: r => esc(pointById(r.collection_point_id)?.name || '?') }, { key: 'start_date', label: 'Du' }, { key: 'end_date', label: 'Au', render: r => esc(r.end_date) || '<span class="muted small">sans fin</span>' }],
      fields: [{ key: 'agent_id', label: 'Agent', type: 'select', required: true, options: () => AGENTS.map(a => [a.id, a.full_name + ' (' + a.agent_code + ')']) },
        { key: 'collection_point_id', label: 'Point de collecte', type: 'select', required: true, options: () => REF.collection_points.map(p => [p.id, p.name]) },
        { key: 'start_date', label: 'Date de début', type: 'date' }, { key: 'end_date', label: 'Date de fin', type: 'date' }] });
  },

  producers(el) {
    listView(el, { entity: 'producers', title: 'Producteurs', sub: 'Correction des fiches, fusion de doublons, export ou effacement des données à la demande du producteur. L\'inscription se fait par l\'application agent.', create: false,
      filters: [{ key: 'consent_status', label: 'Consentement', options: () => [['granted', 'Validé'], ['pending', 'En attente'], ['refused', 'Refusé'], ['withdrawn', 'Retiré']] },
        { key: 'collection_point_id', label: 'Point', options: () => REF.collection_points.map(p => [p.id, p.name]) }, { key: 'status', label: 'Statut', options: () => [['active', 'Actif'], ['merged', 'Fusionné'], ['anonymized', 'Anonymisé']] }],
      columns: [{ key: 'code', label: 'Code', render: r => `<span class="mono">${esc(r.code)}</span>` }, { key: 'full_name', label: 'Producteur', render: r => `<b>${esc(r.full_name)}</b><div class="tiny muted">${r.sex === 'F' ? 'Femme' : 'Homme'}${r.birth_year ? ' · ' + r.birth_year : ''}</div>` },
        { key: 'phone', label: 'Téléphone', render: r => esc(fmtPhone(r.phone)) }, { key: 'village_id', label: 'Village / point', render: r => `${esc(zoneById(r.village_id)?.name || '')}<div class="tiny muted">${esc(pointById(r.collection_point_id)?.name || '')}</div>` },
        { key: 'consent_status', label: 'Consentement', render: r => consentBadge(r.consent_status) + (r.status !== 'active' ? ` <span class="badge">${r.status === 'merged' ? 'Fusionné' : 'Anonymisé'}</span>` : '') + (r.is_demo ? ' <span class="badge b-warn">Démo</span>' : '') }],
      fields: [{ key: 'full_name', label: 'Nom complet', required: true }, { key: 'sex', label: 'Sexe', type: 'select', options: () => [['F', 'Femme'], ['M', 'Homme']], required: true },
        { key: 'birth_year', label: 'Année de naissance', type: 'number' }, { key: 'phone', label: 'Téléphone' }, { key: 'lang', label: 'Langue des SMS', type: 'select', options: () => [['sw', 'Swahili'], ['fr', 'Français']] },
        { key: 'momo_operator', label: 'Opérateur Mobile Money', type: 'select', options: () => [['MPESA', 'M-Pesa'], ['AIRTEL', 'Airtel Money'], ['ORANGE', 'Orange Money']] },
        { key: 'voter_last4', label: 'Carte d\'électeur (4 derniers caractères)' }, { key: 'village_id', label: 'Village', type: 'select', options: () => REF.zones.filter(z => z.level === 'village').map(z => [z.id, zonePath(z.id)]) },
        { key: 'collection_point_id', label: 'Point de collecte', type: 'select', options: () => REF.collection_points.map(p => [p.id, p.name]) },
        { key: 'household_size', label: 'Taille du ménage', type: 'number' }, { key: 'female_headed', label: 'Ménage dirigé par une femme', type: 'bool' }],
      rowActions: () => [
        { label: 'Fiche et téléphone', icon: 'eye', onClick: (r, reload) => producerSheet(r, reload) },
        { label: 'Exporter ses données', icon: 'download', onClick: async (r) => { const d = await api(`/api/admin/producers/${r.id}/export`); download(`donnees_${r.code}_${stamp()}.json`, JSON.stringify(d, null, 2), 'application/json'); toast('Données exportées.', 'ok'); } },
        { label: 'Fusionner un doublon', icon: 'git-merge', onClick: (r, reload) => mergeDialog(r, reload) },
        { label: 'Effacer ses données (demande du producteur)', icon: 'user-x', danger: true, onClick: (r, reload) => confirmBox('Effacer les données de ' + r.full_name + ' ?',
          'Si le producteur a déjà livré, ses données personnelles sont anonymisées et ses livraisons gardées 5 ans (obligation EUDR). Sinon, tout est supprimé définitivement. Cette action ne passe pas par la corbeille.', 'Effacer', async () => {
            try { const x = await api(`/api/admin/producers/${r.id}/erase`, { method: 'POST' }); closeModal(); toast(x.outcome === 'anonymized' ? 'Producteur anonymisé.' : 'Données supprimées.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } }, true) }
      ] });
  },

  templates(el) {
    listView(el, { entity: 'sms_templates', title: 'Modèles de SMS', sub: 'Textes envoyés aux producteurs, en swahili et en français. Variables : ' + VARS.map(v => '{' + v + '}').join(' '),
      filters: [{ key: 'lang', label: 'Langue', options: () => [['sw', 'Swahili'], ['fr', 'Français']] }, { key: 'code', label: 'Modèle', options: () => TPL_CODES.map(c => [c, c]) }],
      columns: [{ key: 'code', label: 'Modèle', render: r => `<span class="mono">${esc(r.code)}</span><div class="tiny muted">${esc(r.description || '')}</div>` }, { key: 'lang', label: 'Langue', render: r => r.lang === 'sw' ? 'Swahili' : 'Français' },
        { key: 'body', label: 'Texte', render: r => `<span class="small">${esc(r.body)}</span>` }],
      fields: [{ key: 'code', label: 'Modèle', type: 'select', required: true, options: () => TPL_CODES.map(c => [c, c]) }, { key: 'lang', label: 'Langue', type: 'select', required: true, options: () => [['sw', 'Swahili'], ['fr', 'Français']] },
        { key: 'description', label: 'Description' }, { key: 'body', label: 'Texte du SMS', type: 'textarea', required: true }],
      onFormRender(form) {
        const body = $('#fld-body', form);
        const box = document.createElement('div'); box.className = 'full';
        box.innerHTML = `<div class="lbl">Aperçu</div><div class="card small" id="pv" style="background:var(--surface-2)"></div><div class="row" style="margin-top:6px">${VARS.map(v => `<button type="button" class="btn sm ghost" data-var="${v}">{${v}}</button>`).join('')}</div>`;
        body.parentElement.after(box);
        const upd = debounce(async () => { try { const r = await api('/api/admin/sms_preview', { method: 'POST', body: { body: body.value } });
          $('#pv').innerHTML = esc(r.text) + `<div class="tiny muted" style="margin-top:6px">${r.length} caractères · ${r.segments} SMS${r.unknown.length ? ` · <span style="color:var(--err)">variables inconnues : ${esc(r.unknown.join(', '))}</span>` : ''}</div>`; } catch {} }, 250);
        body.addEventListener('input', upd); upd();
        box.addEventListener('click', e => { const b = e.target.closest('[data-var]'); if (!b) return; const s = body.selectionStart ?? body.value.length; body.value = body.value.slice(0, s) + '{' + b.dataset.var + '}' + body.value.slice(s); body.focus(); upd(); });
      } });
  },

  async simulator(el) {
    const r = await api('/api/admin/producers?f.status=active');
    el.innerHTML = `<div class="page-h"><div><h1>Téléphone producteur</h1><p>Le producteur n'a pas d'application : ce téléphone simulé reçoit ses SMS et lui permet de répondre (NDIYO pour consentir).</p></div></div>
      <div class="row" style="align-items:flex-start;gap:24px"><div class="card" style="flex:1 1 280px"><label class="lbl" for="sp">Producteur</label>
        <select class="input" id="sp">${r.rows.map(p => `<option value="${p.id}">${esc(p.full_name)} · ${esc(p.code)}</option>`).join('')}</select><div id="spInfo" style="margin-top:10px"></div></div>
        <div id="phone" style="flex:0 0 280px"></div></div>`;
    const show = async () => { const p = r.rows.find(x => x.id === $('#sp').value); if (!p) return; $('#spInfo').innerHTML = consentBadge(p.consent_status);
      await phoneSim($('#phone'), p, async () => { const u = await api(`/api/admin/producers/${p.id}`); Object.assign(p, u.row); $('#spInfo').innerHTML = consentBadge(p.consent_status); }); };
    $('#sp').onchange = show; show();
  },

  async settings(el) {
    const r = await api('/api/admin/settings');
    const s = r.settings;
    el.innerHTML = `<div class="page-h"><div><h1>Paramètres et modules</h1><p>Valeurs utilisées par toute la plateforme.</p></div></div>
      <div class="stack">
      <div class="card stack"><h3>Paramètres généraux</h3><div class="fgrid c2">
        <div><label class="lbl" for="sRate">Taux du jour : CDF pour 1 USD</label><input class="input" id="sRate" type="number" step="any" value="${esc(s.exchange_rate)}"><div class="hint">Figé dans chaque pesée au moment de la saisie.</div></div>
        <div><label class="lbl" for="sCoop">Nom de la coopérative ou de l'ONG</label><input class="input" id="sCoop" value="${esc(s.cooperative_name)}"><div class="hint">Variable {cooperative} des SMS.</div></div>
        <div><label class="lbl" for="sUssd">Code USSD</label><input class="input" id="sUssd" value="${esc(s.ussd_code)}"></div></div>
        <div><button class="btn primary" id="sSave">Enregistrer</button></div></div>
      <div class="card stack"><div class="row"><h3 class="grow">Données de démonstration</h3>${s.demo_enabled === '1' ? '<span class="badge b-warn">Actives</span>' : '<span class="badge">Désactivées</span>'}</div>
        <p class="small">Producteurs, zones et comptes fictifs (marqués « Démo »). Un bandeau « Données fictives » s'affiche sur chaque écran tant qu'elles sont actives. Les désactiver les supprime toutes ; les réactiver les recrée.</p>
        ${s.demo_enabled === '1' ? `<div class="small card" style="background:var(--surface-2)">Comptes de démonstration (mot de passe <span class="mono">Demo-Kivu-2026</span>) : <span class="mono">agent.demo</span>, <span class="mono">agent2.demo</span>, <span class="mono">coord.demo</span>, <span class="mono">acheteur.demo</span>. Désactivez-les avant le pilote réel.</div>` : ''}
        <div><button class="btn ${s.demo_enabled === '1' ? 'danger' : 'primary'}" id="demo">${s.demo_enabled === '1' ? 'Désactiver et supprimer les données de démonstration' : 'Activer les données de démonstration'}</button></div></div>
      <div class="card stack"><h3>Modules</h3>${r.modules.map(m => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="grow"><b>${esc(m.code.toUpperCase())} · ${esc(m.label)}</b></div>
          ${m.availability === 'live' ? `<label class="check"><input type="checkbox" data-mod="${m.code}" ${m.enabled ? 'checked' : ''}> Activé</label>` : '<span class="badge">Bientôt disponible</span><label class="check" style="opacity:.5"><input type="checkbox" disabled> Activé</label>'}</div>`).join('')}</div>
      <div class="card stack"><h3>Mon compte</h3><div><button class="btn" id="myPw">${icon('key-round')}Changer mon mot de passe</button></div></div>
      </div>`;
    $('#sSave').onclick = async () => { try { await api('/api/admin/settings', { method: 'PATCH', body: { exchange_rate: $('#sRate').value, cooperative_name: $('#sCoop').value, ussd_code: $('#sUssd').value } }); toast('Paramètres enregistrés.', 'ok'); } catch (e) { toast(e.message, 'err'); } };
    $('#demo').onclick = () => {
      const on = s.demo_enabled !== '1';
      confirmBox(on ? 'Activer la démonstration ?' : 'Désactiver la démonstration ?', on ? 'Des producteurs, zones et comptes fictifs seront créés.' : 'Toutes les données marquées « Démo » seront supprimées. Les données réelles ne sont pas touchées.', on ? 'Activer' : 'Désactiver et supprimer', async () => {
        try { await api('/api/admin/demo', { method: 'POST', body: { enabled: on } }); closeModal(); toast(on ? 'Démonstration activée.' : 'Données de démonstration supprimées.', 'ok'); await loadRef(); demoBanner(); go('settings'); } catch (e) { toast(e.message, 'err'); }
      }, !on);
    };
    $$('[data-mod]', el).forEach(c => c.onchange = async () => { try { await api('/api/admin/modules/' + c.dataset.mod, { method: 'PATCH', body: { enabled: c.checked } }); toast('Module mis à jour.', 'ok'); } catch (e) { toast(e.message, 'err'); c.checked = !c.checked; } });
    $('#myPw').onclick = () => forcePassword(session.get().user);
  },

  async trash(el) {
    const r = await api('/api/admin/trash');
    el.innerHTML = `<div class="page-h"><div><h1>Corbeille</h1><p>Les éléments supprimés restent récupérables 30 jours, puis sont effacés définitivement.</p></div></div>
      <div class="table-wrap">${r.rows.length ? `<table class="t"><thead><tr><th>Élément</th><th>Liste</th><th>Supprimé le</th><th>Effacement définitif</th><th></th></tr></thead><tbody>${r.rows.map((x, i) =>
        `<tr><td><b>${esc(x.label)}</b></td><td>${esc(x.entity_label)}</td><td>${esc(dateTime(x.deleted_at))}</td><td class="small muted">${esc(date(new Date(Date.parse(x.deleted_at) + 30 * 864e5).toISOString()))}</td><td style="text-align:right"><button class="btn sm" data-r="${i}">${icon('rotate-ccw')}Restaurer</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${icon('archive', 'xl')}<p>La corbeille est vide.</p></div>`}</div>`;
    el.onclick = async e => { const b = e.target.closest('[data-r]'); if (!b) return; const x = r.rows[+b.dataset.r];
      try { await api(`/api/admin/${x.entity}/${x.id}/restore`, { method: 'POST' }); toast('Élément restauré.', 'ok'); await loadRef(); go('trash'); } catch (ex) { toast(ex.message, 'err'); } };
  },

  async audit(el) {
    el.innerHTML = `<div class="page-h"><div><h1>Journal</h1><p>Toutes les modifications : qui, quoi, quand, ancienne et nouvelle valeur.</p></div></div>
      <div class="toolbar"><input class="input search" type="search" id="aq" placeholder="Rechercher (personne, action, valeur)…"><select class="input" id="ae"><option value="">Toutes les listes</option>${['users', 'zones', 'collection_points', 'agent_assignments', 'commodities', 'grades', 'sms_templates', 'producers', 'plots', 'settings', 'modules'].map(e => `<option>${e}</option>`).join('')}</select></div>
      <div id="al">${skeleton(5)}</div>`;
    const load = async () => { const r = await api('/api/admin/audit?q=' + encodeURIComponent($('#aq').value) + '&entity=' + $('#ae').value); $('#al').innerHTML = auditTable(r.rows); };
    $('#aq').oninput = debounce(load, 300); $('#ae').onchange = load; load();
  }
};

function auditTable(rows) {
  if (!rows.length) return '<div class="empty">Aucune entrée.</div>';
  const fmt = (j) => { if (!j) return ''; try { const o = JSON.parse(j); return Object.entries(o).map(([k, v]) => `<div><span class="muted">${esc(k)} :</span> ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</div>`).join(''); } catch { return esc(j); } };
  return `<div class="table-wrap"><table class="t"><thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th>Ancienne valeur</th><th>Nouvelle valeur</th></tr></thead><tbody>${rows.map(a =>
    `<tr><td class="small" style="white-space:nowrap">${esc(dateTime(a.at))}</td><td><b>${esc(a.user_name)}</b></td><td><span class="mono small">${esc(a.action)}</span><div class="tiny muted">${esc(a.entity || '')}</div></td><td class="small">${fmt(a.before)}</td><td class="small">${fmt(a.after)}</td></tr>`).join('')}</tbody></table></div>`;
}

function resetPassword(row, reload) {
  modal({ title: 'Nouveau mot de passe pour ' + row.full_name, body: `<label class="lbl" for="np">Mot de passe provisoire</label><input class="input" id="np" type="text" autocomplete="off"><div class="hint">À transmettre à la personne ; il devra être changé à la connexion. Ses sessions ouvertes sont fermées.</div><div class="err" id="npe"></div>`,
    actions: [{ label: 'Annuler', onClick: () => closeModal() }, { label: 'Réinitialiser', cls: 'primary', onClick: async () => {
      const pw = $('#np').value; const pb = passwordProblem(pw); if (pb) { $('#npe').textContent = pb; return; }
      try { await api(`/api/admin/users/${row.id}/password`, { method: 'POST', body: await makePassword(pw) }); closeModal(); toast('Mot de passe réinitialisé.', 'ok'); reload(); } catch (e) { $('#npe').textContent = e.message; }
    } }] });
}

async function producerSheet(r, reload) {
  const d = await api(`/api/producers/${r.id}`);
  const p = d.producer, bl = d.baseline;
  modal({ title: p.full_name + ' · ' + p.code, wide: true, body: `<div class="row" style="align-items:flex-start;gap:24px"><div class="stack" style="flex:1 1 320px">
      <div id="cbadge">${consentBadge(p.consent_status)}</div>
      <table class="t"><tbody>
        <tr><td class="muted">Téléphone</td><td>${esc(fmtPhone(p.phone))} · ${esc(p.momo_operator || '')}</td></tr>
        <tr><td class="muted">Sexe, naissance</td><td>${p.sex === 'F' ? 'Femme' : 'Homme'} · ${esc(p.birth_year || '')}</td></tr>
        <tr><td class="muted">Ménage</td><td>${esc(p.household_size ?? '?')} personne(s)${p.female_headed ? ' · dirigé par une femme' : ''}</td></tr>
        <tr><td class="muted">Localisation</td><td>${esc(zonePath(p.village_id))}<div class="tiny muted">${esc(pointById(p.collection_point_id)?.name || '')}</div></td></tr>
        <tr><td class="muted">Carte d'électeur</td><td>${p.voter_last4 ? '••••' + esc(p.voter_last4) : '<span class="muted">non saisie</span>'}</td></tr>
        <tr><td class="muted">Référence ${esc(bl?.season || '')}</td><td>${bl ? `${esc(bl.production_kg ?? '?')} kg · revenu ${esc(bl.income_cdf ?? '?')} CDF · dernier prix ${esc(bl.last_price_amount ?? '?')} ${esc(bl.last_price_currency || '')}/kg` : '<span class="muted">non renseignée</span>'}</td></tr>
        <tr><td class="muted">Parcelles</td><td>${d.plots.map(pl => `${pl.geometry_type === 'point' ? 'Point GPS' : 'Polygone'} · ${pl.declared_area_ha} ha déclarés${pl.computed_area_ha ? ' (' + pl.computed_area_ha + ' ha mesurés)' : ''} · relevé le ${esc(date(pl.captured_at))}`).join('<br>') || '<span class="muted">aucune</span>'}</td></tr>
      </tbody></table></div><div id="sheetPhone" style="flex:0 0 280px"></div></div>`,
    actions: [{ label: 'Fermer', cls: 'primary', onClick: () => { closeModal(); reload(); } }] });
  phoneSim($('#sheetPhone'), { ...p, id: r.id }, async () => { const u = await api('/api/producers/' + r.id); $('#cbadge').innerHTML = consentBadge(u.producer.consent_status); });
}

async function mergeDialog(source, reload) {
  const r = await api('/api/admin/producers?f.status=active');
  const others = r.rows.filter(x => x.id !== source.id);
  modal({ title: 'Fusionner ' + source.code, body: `<p class="small">La fiche <b>${esc(source.full_name)} (${esc(source.code)})</b> sera fusionnée dans la fiche choisie : parcelles, messages, consentement et livraisons y sont déplacés. La fiche source passe en statut « Fusionné ».</p>
    <label class="lbl" for="mt" style="margin-top:12px">Fiche à conserver</label><select class="input" id="mt">${others.map(o => `<option value="${o.id}">${esc(o.full_name)} · ${esc(o.code)} · ${esc(fmtPhone(o.phone))}</option>`).join('')}</select>`,
    actions: [{ label: 'Annuler', onClick: () => closeModal() }, { label: 'Fusionner', cls: 'primary', onClick: async () => {
      try { await api('/api/admin/producers/merge', { method: 'POST', body: { source_id: source.id, target_id: $('#mt').value } }); closeModal(); toast('Fiches fusionnées.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
    } }] });
}

start();
