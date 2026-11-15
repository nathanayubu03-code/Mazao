// Page d'accueil publique : traduction (FR, EN, SW, LN et remplacements saisis dans /admin),
// onglets « Pour qui ? », statut des services, chiffres, coordonnées, formulaire de démonstration.
// Ne charge aucun code des espaces connectés ni de l'application de terrain.
import { S, t, $, $$, loadAll, pickLang } from './core.js';

const TABS = ['acheteurs', 'producteurs', 'partenaires'];

// Textes : chaque élément data-i18n reçoit la traduction (le français est déjà dans le HTML)
function translate() {
  document.documentElement.lang = S.lang;
  for (const el of $$('[data-i18n]')) {
    const v = t(el.dataset.i18n);
    if (v !== el.dataset.i18n) el.textContent = v;
  }
  document.title = 'KivuTrace & Market : ' + t('acc.hero.title') + ' ' + t('acc.hero.title_em');
  $('#kt-lang').value = S.lang;
}

// Emplacement : valeur saisie dans /admin si elle existe, sinon l'emplacement entre crochets reste affiché
function fillPlaceholders() {
  const site = S.site || {};
  for (const el of $$('[data-contact]')) {
    const v = site.global?.[el.dataset.contact];
    el.textContent = v ? v : (el.dataset.contact === 'contact_phone' ? '[Téléphone]' : '[E-mail]');
  }
  for (const el of $$('[data-ussd]')) el.textContent = site.ussd ? site.ussd : '*[CODE]#';
  // Chiffres : [N] tant que le pilote n'a pas de données réelles (mode démonstration actif ou valeur inconnue)
  const st = site.stats || {};
  const fmt = (v, d = 0) => Number(v).toLocaleString(S.lang === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: d });
  for (const el of $$('[data-stat]')) {
    const v = st[el.dataset.stat];
    el.textContent = site.demo || v == null ? '[N]' : fmt(v, el.dataset.stat === 'tonnes' ? 1 : 0);
  }
  // Dates EUDR saisies dans /admin (format JJ/MM/AAAA), affichées comme dans la maquette : « 30 déc. 2026 »
  for (const el of $$('[data-eudr]')) {
    const v = site.global?.[el.dataset.eudr] || '';
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      const loc = { fr: 'fr-FR', en: 'en-GB', sw: 'sw', ln: 'fr-FR' }[S.lang];
      el.textContent = d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } else if (v) el.textContent = v;
  }
  $('#demoBanner').hidden = !site.demo;
}

// Statut des services choisi dans /admin : disponible, bientôt ou masqué
function services() {
  for (const card of $$('[data-svc]')) {
    const st = S.site?.services?.find(s => s.code === card.dataset.svc)?.status || (card.dataset.svc === 'm1' ? 'available' : 'soon');
    card.hidden = st === 'hidden';
    const b = $('[data-badge]', card);
    b.textContent = t(st === 'available' ? 'common.available' : 'common.soon');
    b.className = 'a-badge ' + (st === 'available' ? 'a-badge-ok' : 'a-badge-soon');
  }
}

/* Onglets « Pour qui ? » : un petit script affiche ou masque les trois panneaux */
function selectTab(id, focus = false) {
  for (const name of TABS) {
    const on = name === id;
    const tab = $('#tab-' + name);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $('#panel-' + name).hidden = !on;
    if (on && focus) tab.focus();
  }
}
function bindTabs() {
  for (const b of $$('[data-tab]')) b.addEventListener('click', () => selectTab(b.dataset.tab));
  $('.a-tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(document.activeElement?.dataset?.tab); if (i < 0) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); selectTab(TABS[(i + 1) % 3], true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); selectTab(TABS[(i + 2) % 3], true); }
  });
  // Les liens Acheteurs, Producteurs et Partenaires du menu ouvrent le bon onglet
  for (const a of $$('[data-tab-link]')) a.addEventListener('click', () => selectTab(a.dataset.tabLink));
}

/* Demande de démonstration : enregistrée dans /admin › Demandes de démonstration */
function bindDemo() {
  const f = $('#demo-form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const err = $('#demo-err');
    if (!d.name.trim() || !d.phone.trim()) { err.textContent = t('acc.demo.err'); return; }
    const btn = $('.a-send', f); btn.disabled = true; err.textContent = '';
    try {
      const r = await fetch('/api/public/demo-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...d, lang: S.lang }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || t('common.error'));
      f.innerHTML = '';
      const ok = document.createElement('p'); ok.className = 'a-done'; ok.setAttribute('role', 'status'); ok.textContent = t('demo.ok');
      f.appendChild(ok);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
}

function render() { translate(); fillPlaceholders(); services(); }

async function boot() {
  bindTabs(); bindDemo();
  await loadAll(pickLang());
  render();
  $('#kt-lang').addEventListener('change', async (e) => {
    const l = e.target.value;
    try { localStorage.setItem('kt.site.lang', l); } catch {}
    await loadAll(l); render();
  });
}
boot();
