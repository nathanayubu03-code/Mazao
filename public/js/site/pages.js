// Pages du site public : accueil, services, acheteurs, producteurs, partenaires, impact, pages légales.
import { S, t, list, paras, esc, icon, $, $$, g, shell, setMeta, loadAll, pickLang, countUp, fmtNum, reveal, reducedMotion, photo } from './core.js';

const PAGE = document.body.dataset.page || 'home';
const SVC = [['m1', 'route'], ['m2', 'hand-coins'], ['m3', 'sprout'], ['m4', 'banknote']];
const statusOf = (code) => S.site.services.find(s => s.code === code)?.status || 'soon';
const badge = (st) => st === 'available' ? `<span class="badge b-ok">${icon('circle-check')}${esc(t('common.available'))}</span>` : `<span class="badge b-warn">${icon('clock')}${esc(t('common.soon'))}</span>`;
const bullets = (key, ic = 'check') => `<ul class="ticks">${list(key).map(x => `<li>${icon(ic)}<span>${esc(x)}</span></li>`).join('')}</ul>`;
const head = (title, lead, img) => `<section class="page-hero"><div class="wrap ${img ? 'with-img' : ''}"><div><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p></div>${img ? `<img class="page-img" src="${img}" alt="" loading="lazy">` : ''}</div></section>`;

/* ------------------------------------------------------------------ Parcours d'un lot (animation d'ouverture) */
function journey() {
  return `<div class="journey" id="journey" role="img" aria-label="${esc(t('journey.field'))} → ${esc(t('journey.collect'))} → ${esc(t('journey.pay'))}">
    <div class="j-track"><i></i></div>
    <div class="j-runner"><div class="j-lot"><span class="j-sack">${icon('package')}<span class="j-tag">${esc(t('journey.lot'))} OA-0007</span></span></div></div>
    ${[['field', 'sprout', 16], ['collect', 'scale', 50], ['pay', 'smartphone', 84]].map(([k, ic, x], i) => `
      <div class="j-stop s${i}" style="left:${x}%"><span class="j-dot">${icon(ic)}</span>
        <b>${esc(t('journey.' + k))}</b><small>${esc(t('journey.' + k + '_d'))}</small></div>`).join('')}
    <span class="j-pop p1">${icon('scale')} 120 kg · G1</span>
    <span class="j-pop p2">${icon('circle-check')} 756 000 CDF</span>
    <button type="button" class="j-skip btn sm ghost">${icon('skip-forward')}${esc(t('journey.skip'))}</button>
    <button type="button" class="j-replay btn sm ghost">${icon('rotate-ccw')}${esc(t('journey.replay'))}</button>
  </div>`;
}
function playJourney() {
  const j = $('#journey'); if (!j) return;
  let seen = false; try { seen = sessionStorage.getItem('kt.journey') === '1'; } catch {}
  const finish = () => { j.classList.remove('play'); j.classList.add('done'); try { sessionStorage.setItem('kt.journey', '1'); } catch {} };
  const play = () => { j.classList.remove('done', 'play'); void j.offsetWidth; j.classList.add('play'); };
  if (seen || reducedMotion()) finish(); else play();
  $('.j-runner', j).addEventListener('animationend', (e) => { if (e.animationName === 'jRun') finish(); });
  $('.j-skip', j).onclick = finish;
  $('.j-replay', j).onclick = () => (reducedMotion() ? finish() : play());
}

/* ------------------------------------------------------------------ Carte schématique des territoires */
// Position approximative (colonne, ligne) de chaque territoire du Nord et du Sud-Kivu, du nord au sud
const TILES = { Beni: [3, 1], Lubero: [3, 2], Walikale: [1, 3], Rutshuru: [4, 3], Masisi: [2, 4], Nyiragongo: [4, 4], Kalehe: [2, 5], Idjwi: [3, 5],
  Shabunda: [1, 6], Kabare: [2, 6], Walungu: [3, 6], Mwenga: [2, 7], Uvira: [4, 7], Fizi: [3, 8] };
function impactMap(big = false) {
  const st = S.site.stats; if (!st) return '';
  const by = Object.fromEntries(st.territories.map(x => [x.name, x]));
  const lvl = (x) => !x ? 0 : x.lt5 ? 1 : x.producers < 20 ? 2 : x.producers < 100 ? 3 : 4;
  return `<div class="tmap ${big ? 'big' : ''}" aria-label="${esc(t('impact.schema'))}">${Object.entries(TILES).map(([name, [c, r]]) => {
    const x = by[name]; const v = !x ? esc(t('impact.none')) : x.lt5 ? esc(t('common.lt5')) : fmtNum(x.producers);
    return `<div class="tile l${lvl(x)}" style="grid-column:${c};grid-row:${r}"><b>${esc(name)}</b><span>${v}</span></div>`;
  }).join('')}</div><p class="tiny muted" style="margin-top:8px">${esc(t('impact.schema'))}. ${esc(t('impact.legend_lt5'))}</p>`;
}

function kpis() {
  const st = S.site.stats;
  if (!st) return '';
  const items = [['users', 'kpi.producers', st.producers, v => fmtNum(v)], ['package', 'kpi.tonnes', st.tonnes, v => fmtNum(v, 1)],
    ['wallet', 'kpi.paid', st.paid_cdf, v => fmtNum(v)], ['user-check', 'kpi.women', st.women_pct, v => fmtNum(v) + ' %']];
  return `<div class="kpi-row">${items.map(([ic, k, v, f], i) => `<div class="kpi-c rv">${icon(ic, 'lg')}<b data-k="${i}">${v == null ? esc(t('kpi.na')) : f(0)}</b><span>${esc(t(k))}</span></div>`).join('')}</div>
    <p class="tiny muted kpi-note">${esc(t(S.site.demo ? 'kpi.demo_note' : 'kpi.live_note'))}</p>`;
}
function animateKpis(root) {
  const st = S.site.stats; if (!st) return;
  const vals = [[st.producers, v => fmtNum(v)], [st.tonnes, v => fmtNum(v, 1)], [st.paid_cdf, v => fmtNum(v)], [st.women_pct, v => fmtNum(v) + ' %']];
  $$('[data-k]', root).forEach(el => { const [v, f] = vals[+el.dataset.k]; if (v != null) countUp(el, v, f); });
}

function demoForm() {
  return `<form class="card demo-form stack" id="demoForm" novalidate>
    <div class="fgrid c2">
      <div><label class="lbl" for="dName">${esc(t('demo.name'))} *</label><input class="input" id="dName" name="name" autocomplete="name" required></div>
      <div><label class="lbl" for="dOrg">${esc(t('demo.org'))}</label><input class="input" id="dOrg" name="organization" autocomplete="organization"></div>
      <div><label class="lbl" for="dPhone">${esc(t('demo.phone'))}</label><input class="input" id="dPhone" name="phone" type="tel" autocomplete="tel" placeholder="+243 …"></div>
      <div><label class="lbl" for="dEmail">${esc(t('demo.email'))}</label><input class="input" id="dEmail" name="email" type="email" autocomplete="email"></div>
      <div class="full"><label class="lbl" for="dMsg">${esc(t('demo.message'))}</label><textarea class="input" id="dMsg" name="message" rows="3"></textarea></div>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    </div>
    <div class="err" id="dErr" role="alert"></div>
    <div><button class="btn primary" id="dSend">${icon('send')}${esc(t('demo.send'))}</button></div></form>`;
}
function bindDemoForm() {
  const f = $('#demoForm'); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)); d.lang = S.lang;
    if (!d.name.trim() || (!d.phone.trim() && !d.email.trim())) { $('#dErr').textContent = t('demo.err_required'); return; }
    const b = $('#dSend'); b.disabled = true; $('#dErr').textContent = '';
    try {
      const r = await fetch('/api/public/demo-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || t('common.error'));
      f.innerHTML = `<div class="done-box">${icon('circle-check', 'xl')}<p>${esc(t('demo.ok'))}</p></div>`;
    } catch (ex) { $('#dErr').textContent = ex.message; b.disabled = false; }
  };
}

/* ------------------------------------------------------------------ Pages */
const R = {
  home(m) {
    setMeta();
    const hp = photo('hero');
    const svcs = SVC.filter(([c]) => statusOf(c) !== 'hidden');
    m.innerHTML = `
    <section class="hero ${hp ? 'has-photo' : ''}" ${hp ? `style="--hero-img:url('${hp}')"` : ''}><div class="wrap hero-in">
      <div class="hero-txt"><span class="kicker">${icon('map-pin')}${esc(t('home.hero.kicker'))}</span>
        <h1>${esc(t('home.hero.title'))}</h1><p class="lead">${esc(t('home.hero.lead'))}</p>
        <div class="row cta"><a class="btn primary lg" href="/acheteurs">${icon('shopping-cart')}${esc(t('home.hero.cta_buyer'))}</a>
          <a class="btn lg" href="/partenaires">${icon('handshake')}${esc(t('home.hero.cta_partner'))}</a></div></div>
      <div class="hero-anim">${journey()}</div></div></section>

    <section class="sec sec-kpi"><div class="wrap"><h2 class="sr">${esc(t('home.kpi.title'))}</h2>${kpis()}</div></section>

    <section class="sec" id="services"><div class="wrap"><div class="sec-h rv"><h2>${esc(t('home.services.title'))}</h2><p class="lead">${esc(t('home.services.lead'))}</p></div>
      <div class="svc-grid">${svcs.map(([c, ic]) => `<a class="svc rv ${statusOf(c)}" href="/services#${c}">
        <div class="row"><span class="svc-ic">${icon(ic, 'lg')}</span>${badge(statusOf(c))}</div>
        <h3>${esc(t('svc.' + c + '.title'))}</h3><p>${esc(t('svc.' + c + '.short'))}</p><span class="more">${esc(t('svc.see'))}${icon('arrow-right')}</span></a>`).join('')}</div></div></section>

    <section class="sec alt"><div class="wrap"><div class="sec-h rv"><h2>${esc(t('home.how.title'))}</h2></div>
      <ol class="how">${[['clipboard-list', 1], ['message-square-text', 2], ['scale', 3], ['wallet', 4]].map(([ic, n]) => `<li class="rv"><span class="how-n">${n}</span><span class="how-ic">${icon(ic, 'lg')}</span>
        <h3>${esc(t('how.' + n + '.t'))}</h3><p>${esc(t('how.' + n + '.d'))}</p></li>`).join('')}</ol></div></section>

    <section class="sec"><div class="wrap"><div class="sec-h rv"><h2>${esc(t('home.who.title'))}</h2></div>
      <div class="who">${[['buyers', 'shopping-cart', '/acheteurs'], ['producers', 'sprout', '/producteurs'], ['partners', 'handshake', '/partenaires']].map(([k, ic, href]) => `
        <a class="who-c rv" href="${href}"><span class="svc-ic">${icon(ic, 'lg')}</span><h3>${esc(t('who.' + k + '.t'))}</h3><p>${esc(t('who.' + k + '.d'))}</p><span class="more">${esc(t('common.more'))}${icon('arrow-right')}</span></a>`).join('')}</div></div></section>

    <section class="sec alt" id="eudr"><div class="wrap"><div class="sec-h rv"><h2>${esc(t('home.eudr.title'))}</h2><p class="lead">${esc(t('eudr.lead'))}</p></div>
      <div class="two"><div class="card rv"><h3>${icon('badge-check')} ${esc(t('eudr.gives.t'))}</h3>${bullets('eudr.gives')}</div>
        <div class="card rv"><h3>${icon('triangle-alert')} ${esc(t('eudr.not.t'))}</h3>${bullets('eudr.not', 'chevron-right')}</div></div>
      <p class="note rv">${icon('calendar')}<span>${esc(t('eudr.dates', { large: g('eudr_date_large') || '30/12/2026', small: g('eudr_date_small') || '30/06/2027' }))} ${esc(t('eudr.disclaimer'))}</span></p></div></section>

    <section class="sec"><div class="wrap two map-sec"><div class="rv"><h2>${esc(t('home.impact.title'))}</h2><p class="lead">${esc(t('impact.lead'))}</p>
        <p style="margin-top:16px"><a class="btn" href="/impact">${icon('chart-column')}${esc(t('impact.more'))}</a></p></div>
      <div class="rv">${impactMap()}</div></div></section>

    <section class="sec alt" id="demo"><div class="wrap two"><div class="rv"><h2>${esc(t('home.demo.title'))}</h2><p class="lead">${esc(t('demo.lead'))}</p></div>
      <div class="rv">${demoForm()}</div></div></section>`;
    playJourney(); bindDemoForm(); reveal(m);
    // Les chiffres montent quand ils deviennent visibles
    const k = $('.sec-kpi', m);
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { animateKpis(m); io.disconnect(); } }); io.observe(k); } else animateKpis(m);
    if (location.hash) $(location.hash)?.scrollIntoView();
  },

  services(m) {
    setMeta('services.title');
    m.innerHTML = head(t('services.title'), t('services.lead')) + `<div class="wrap svc-detail">${SVC.filter(([c]) => statusOf(c) !== 'hidden').map(([c, ic]) => `
      <section class="card svc-d rv" id="${c}"><div class="row"><span class="svc-ic">${icon(ic, 'lg')}</span><h2 class="grow">${esc(t('svc.' + c + '.title'))}</h2>${badge(statusOf(c))}</div>
        <p>${esc(t('svc.' + c + '.long'))}</p>${bullets('svc.' + c + '.points')}
        ${c === 'm1' ? `<div class="row" style="margin-top:6px"><a class="btn primary" href="/inscription?profil=buyer">${esc(t('buyers.cta'))}</a><a class="btn" href="/#eudr">${esc(t('home.eudr.title'))}</a></div>` : ''}</section>`).join('')}
      <section class="card rv"><h2>${esc(t('home.how.title'))}</h2><ol class="how compact">${[1, 2, 3, 4].map(n => `<li><span class="how-n">${n}</span><h3>${esc(t('how.' + n + '.t'))}</h3><p>${esc(t('how.' + n + '.d'))}</p></li>`).join('')}</ol></section></div>`;
    reveal(m);
    if (location.hash) setTimeout(() => $(location.hash)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }), 50);
  },

  buyers(m) {
    setMeta('buyers.title');
    m.innerHTML = head(t('buyers.title'), t('buyers.lead'), photo('buyers')) + `<div class="wrap stack-lg">
      <div class="two"><section class="card rv"><h2>${esc(t('buyers.why.t'))}</h2>${bullets('buyers.why')}</section>
        <section class="card rv"><h2>${esc(t('buyers.steps.t'))}</h2><ol class="steps-list">${list('buyers.steps').map((s, i) => `<li><span class="how-n">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}</ol>
          <div class="row" style="margin-top:12px"><a class="btn primary lg" href="/inscription?profil=buyer">${icon('user-plus')}${esc(t('buyers.cta'))}</a><a class="btn ghost" href="/connexion">${esc(t('buyers.have'))}</a></div></section></div>
      <section class="card rv"><h2>${esc(t('home.eudr.title'))}</h2><p>${esc(t('eudr.lead'))}</p>${bullets('eudr.gives')}<p class="tiny muted">${esc(t('eudr.disclaimer'))}</p></section></div>`;
    reveal(m);
  },

  producers(m) {
    setMeta('producers.title');
    m.innerHTML = head(t('producers.title'), t('producers.lead'), photo('producers')) + `<div class="wrap stack-lg">
      <section class="rv"><h2>${esc(t('producers.how.t'))}</h2><p class="note">${icon('info')}<span>${esc(t('producers.how.note'))}</span></p>
        <div class="two"><div class="card"><h3>${icon('users')} ${esc(t('producers.how.agent.t'))}</h3><p>${esc(t('producers.how.agent'))}</p></div>
          <div class="card"><h3>${icon('smartphone')} ${esc(t('producers.how.ussd.t'))}</h3><p>${esc(t('producers.how.ussd', { ussd: S.site.ussd || '*384*20#' }))}</p><p class="ussd">${esc(S.site.ussd || '*384*20#')}</p></div></div></section>
      <div class="two"><section class="card rv"><h2>${esc(t('producers.rights.t'))}</h2>${bullets('producers.rights', 'shield-check')}</section>
        <section class="rv"><h2>${esc(t('producers.sms.t'))}</h2><div class="sms-demo"><div class="sms-screen"><div class="sms">${esc(t('producers.sms'))}</div><div class="sms me">NDIYO 120</div></div></div></section></div>
      <section class="card rv"><h2>${esc(t('how.4.t'))}</h2><p>${esc(t('how.4.d'))}</p></section></div>`;
    reveal(m);
  },

  partners(m) {
    setMeta('partners.title');
    m.innerHTML = head(t('partners.title'), t('partners.lead'), photo('partners')) + `<div class="wrap stack-lg">
      <div class="two"><section class="card rv"><h2>${esc(t('partners.for.t'))}</h2>${bullets('partners.for', 'building-2')}</section>
        <section class="card rv"><h2>${esc(t('partners.offer.t'))}</h2>${bullets('partners.offer')}</section></div>
      <div class="row rv"><a class="btn primary lg" href="/inscription?profil=cooperative">${icon('user-plus')}${esc(t('partners.cta'))}</a><a class="btn lg" href="/#demo">${icon('calendar')}${esc(t('partners.demo'))}</a></div>
      <section class="rv"><h2>${esc(t('home.services.title'))}</h2><div class="svc-grid">${SVC.filter(([c]) => c !== 'm1' && statusOf(c) !== 'hidden').map(([c, ic]) => `<a class="svc" href="/services#${c}"><div class="row"><span class="svc-ic">${icon(ic, 'lg')}</span>${badge(statusOf(c))}</div><h3>${esc(t('svc.' + c + '.title'))}</h3><p>${esc(t('svc.' + c + '.short'))}</p></a>`).join('')}</div></section></div>`;
    reveal(m);
  },

  impact(m) {
    setMeta('impact.title');
    const st = S.site.stats || { territories: [] };
    const rows = [...st.territories].sort((a, b) => (b.producers || 0) - (a.producers || 0) || a.name.localeCompare(b.name));
    m.innerHTML = head(t('impact.title'), t('impact.page_lead')) + `<div class="wrap stack-lg"><section>${kpis()}</section>
      <div class="two map-sec"><section class="card">${impactMap(true)}</section>
        <section class="card"><table class="t"><thead><tr><th>${esc(t('impact.table.territory'))}</th><th>${esc(t('impact.table.province'))}</th><th class="num">${esc(t('impact.table.producers'))}</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.province)}</td><td class="num">${r.lt5 ? esc(t('common.lt5')) : fmtNum(r.producers)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">${esc(t('impact.none'))}</td></tr>`}</tbody></table>
          <p class="small" style="margin-top:12px">${esc(t('impact.with_plot'))} : <b>${st.producers >= 5 ? fmtNum(st.with_plot) : esc(t('common.lt5'))}</b></p></section></div>
      <section class="card"><h2>${esc(t('impact.method.t'))}</h2><p>${esc(t('impact.method'))}</p></section></div>`;
    animateKpis(m);
  },

  privacy(m) { setMeta('privacy.title'); m.innerHTML = head(t('privacy.title'), '') + `<div class="wrap prose card">${paras('privacy.body')}</div>`; },
  legal(m) {
    setMeta('legal.title');
    const miss = t('legal.missing');
    m.innerHTML = head(t('legal.title'), '') + `<div class="wrap prose card">${paras('legal.body', { publisher: g('legal_publisher') || miss, address: g('contact_address') || miss, email: g('contact_email') || miss, phone: g('contact_phone') || miss })}</div>`;
  }
};

async function boot() {
  await loadAll(pickLang());
  const render = () => { const m = shell(PAGE, render); (R[PAGE] || R.home)(m); };
  render();
}
boot();
