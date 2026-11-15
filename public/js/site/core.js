// Cadre commun du site public : langue, textes (avec remplacements saisis dans /admin),
// menu fixe, pied de page, bandeau « données fictives ». Ne charge aucun code des espaces connectés.
export const LANGS = [['fr', 'Français', 'FR'], ['en', 'English', 'EN'], ['sw', 'Kiswahili', 'SW'], ['ln', 'Lingála', 'LN']];
const CODES = LANGS.map(l => l[0]);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"/></svg>`;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const S = { lang: 'fr', dict: {}, fr: {}, site: null };

export function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (CODES.includes(q)) { try { localStorage.setItem('kt.site.lang', q); } catch {} return q; }
  try { const s = localStorage.getItem('kt.site.lang'); if (CODES.includes(s)) return s; } catch {}
  // Français par défaut (public congolais) ; le choix du visiteur est ensuite mémorisé
  return 'fr';
}

// Texte : remplacement /admin > langue choisie > français > clé
export function t(key, vars = {}) {
  let s = S.site?.content?.[key] ?? S.dict[key] ?? S.fr[key] ?? key;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}
export const list = (key) => t(key).split('|').map(x => x.trim()).filter(Boolean);
export const paras = (key, vars) => t(key, vars).split(/\n\n+/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
export const g = (k) => S.site?.global?.[k] || '';

export async function loadAll(lang) {
  S.lang = lang;
  const [fr, d, site] = await Promise.all([
    import('./i18n/fr.js').then(m => m.default),
    lang === 'fr' ? null : import(`./i18n/${lang}.js`).then(m => m.default).catch(() => null),
    fetch('/api/public/site?lang=' + lang).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);
  S.fr = fr; S.dict = d || fr; S.site = site || { content: {}, global: {}, services: [], demo: false, ussd: '', stats: null };
}

const PAGES = [['home', '/', 'nav.home'], ['services', '/services', 'nav.services'], ['buyers', '/acheteurs', 'nav.buyers'], ['producers', '/producteurs', 'nav.producers'],
  ['partners', '/partenaires', 'nav.partners'], ['impact', '/impact', 'nav.impact']];

// Espace déjà ouvert sur cet appareil : le menu propose d'y retourner
function openSpace() {
  const HOME = { agent: '/app', buyer: '/acheteur', coordination: '/coordination', cooperative: '/coordination', partner: '/coordination', admin: '/admin' };
  for (const k of ['web', 'agent', 'admin']) {
    try { const s = JSON.parse(localStorage.getItem('kt.session.' + k)); if (s?.token && HOME[s.user?.role]) return HOME[s.user.role]; } catch {}
  }
  return null;
}

export function shell(page, onLang) {
  document.documentElement.lang = S.lang;
  const space = openSpace();
  const langBtns = LANGS.map(([c, name, short]) => `<button type="button" data-lang="${c}" aria-pressed="${c === S.lang}" title="${esc(name)}" lang="${c}">${short}</button>`).join('');
  document.body.innerHTML = `<a class="skip" href="#main">${esc(t('nav.skip'))}</a>
  ${S.site.demo ? `<div class="demo-banner" role="note">${esc(t('demo.banner'))}</div>` : ''}
  <header class="site-h" id="top"><div class="wrap site-h-in">
    <a class="site-brand" href="/" aria-label="KivuTrace & Market"><img src="/assets/logo-mark.png" alt="" width="36" height="36"><span>KivuTrace <b>&amp;</b> Market</span></a>
    <button class="burger icon-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="${esc(t('nav.menu'))}">${icon('menu')}</button>
    <nav class="site-nav" id="site-nav" aria-label="Menu">
      ${PAGES.map(([id, href, k]) => `<a href="${href}" ${id === page ? 'aria-current="page"' : ''}>${esc(t(k))}</a>`).join('')}
      <div class="langs" role="group" aria-label="${esc(t('nav.lang'))}">${langBtns}</div>
      ${space ? `<a class="nav-login" href="${space}">${icon('layout-dashboard')}${esc(t('nav.login'))}</a>` : `<a class="nav-login" href="/connexion" ${page === 'login' ? 'aria-current="page"' : ''}>${esc(t('nav.login'))}</a>`}
      <a class="btn primary nav-cta" href="/inscription">${esc(t('nav.signup'))}</a>
    </nav></div></header>
  <main id="main" tabindex="-1"></main>
  <footer class="site-f"><div class="wrap site-f-in">
    <div><a class="site-brand" href="/"><img src="/assets/logo-mark.png" alt="" width="32" height="32"><span>KivuTrace <b>&amp;</b> Market</span></a>
      <p class="muted small" style="margin-top:8px">${esc(t('footer.tagline'))}</p></div>
    <div><h4>${esc(t('footer.contact'))}</h4>${contactLines() || `<p class="muted small">${esc(t('footer.address_missing'))}</p>`}</div>
    <div><h4>${esc(t('footer.links'))}</h4><p><a href="/confidentialite">${esc(t('footer.privacy'))}</a></p><p><a href="/mentions-legales">${esc(t('footer.legal'))}</a></p>
      <p><a href="/connexion">${esc(t('nav.login'))}</a> · <a href="/inscription">${esc(t('nav.signup'))}</a></p></div>
    <div><h4>${esc(t('footer.lang'))}</h4><div class="langs foot" role="group" aria-label="${esc(t('nav.lang'))}">${langBtns}</div></div>
  </div><div class="wrap tiny muted site-f-note">${esc(t('footer.proto'))} © ${new Date().getFullYear()} KivuTrace &amp; Market</div></footer>`;

  const burger = $('.burger'), nav = $('#site-nav');
  burger.onclick = () => { const o = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(o)); };
  $$('[data-lang]').forEach(b => b.onclick = async () => {
    const l = b.dataset.lang; if (l === S.lang) return;
    try { localStorage.setItem('kt.site.lang', l); } catch {}
    const u = new URL(location.href); u.searchParams.delete('lang'); history.replaceState(null, '', u);
    await loadAll(l); onLang();
  });
  return $('#main');
}

function contactLines() {
  const out = [];
  if (g('contact_phone')) out.push(`<p>${icon('phone')} <a href="tel:${esc(g('contact_phone').replace(/\s/g, ''))}">${esc(g('contact_phone'))}</a></p>`);
  if (g('contact_email')) out.push(`<p>${icon('mail')} <a href="mailto:${esc(g('contact_email'))}">${esc(g('contact_email'))}</a></p>`);
  if (g('contact_address')) out.push(`<p>${icon('map-pin')} ${esc(g('contact_address'))}</p>`);
  return out.join('');
}

export function setMeta(titleKey) {
  document.title = titleKey ? t(titleKey) + ' · KivuTrace & Market' : t('meta.title');
  const m = $('meta[name="description"]'); if (m) m.content = t('meta.description');
}

// Compteur qui monte (texte seulement)
export function countUp(el, value, fmt) {
  if (reducedMotion() || !value) { el.textContent = fmt(value); return; }
  const t0 = performance.now(), dur = 900;
  const step = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(value * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
export const fmtNum = (v, d = 0) => Number(v).toLocaleString(S.lang === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });

// Apparition des sections au défilement (opacity + transform, 300 ms)
export function reveal(root) {
  if (reducedMotion() || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.rv', root).forEach(el => { el.classList.add('rv-on'); io.observe(el); });
}

export function photo(slot) { const id = g('img.' + slot); return id ? '/api/public/file/' + id : null; }
