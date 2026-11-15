// /admin : rubriques du portail public. Demandes d'inscription (valider, refuser, demander un complément),
// demandes de démonstration, contenu du site (textes FR/EN/SW/LN, statut des services, coordonnées, photos).
import { api, session } from '../socle/api.js';
import { esc, dateTime, fmtPhone, debounce } from '../socle/util.js';
import { $, $$, icon, toast, modal, closeModal, skeleton } from '../ui/ui.js';

const ACC = { pending: ['En attente', 'b-warn'], info_requested: ['Complément demandé', 'b-warn'], approved: ['Validé', 'b-ok'], refused: ['Refusé', 'b-err'] };
const KIND = { buyer: 'Acheteur', cooperative: 'Coopérative', partner: 'ONG / partenaire' };
const TYPE = { exportateur: 'Exportateur', transformateur: 'Transformateur', cooperative_acheteuse: 'Coopérative acheteuse', commercant: 'Commerçant', ong_acheteuse: 'ONG acheteuse',
  cooperative: 'Coopérative', union: 'Union de coopératives', association: 'Association de producteurs', groupement: 'Groupement',
  ong_internationale: 'ONG internationale', ong_locale: 'ONG locale', bailleur: 'Bailleur', agence_publique: 'Agence publique', entreprise: 'Entreprise', autre: 'Autre' };
const COM = { cafe_arabica: 'Café arabica', cacao: 'Cacao', vivres: 'Vivres' };
const LANGS = [['fr', 'Français'], ['en', 'Anglais'], ['sw', 'Swahili'], ['ln', 'Lingala']];
const DEMO_ST = { new: ['Nouvelle', 'b-warn'], contacted: ['Contactée', 'b-pri'], closed: ['Close', 'b-ok'] };
const accBadge = (s) => `<span class="badge ${ACC[s]?.[1] || ''}">${esc(ACC[s]?.[0] || s)}</span>`;

let ZONES = null;
async function zoneName(id) {
  if (!ZONES) { try { ZONES = Object.fromEntries((await api('/api/ref')).zones.map(z => [z.id, z.name])); } catch { ZONES = {}; } }
  return ZONES[id] || id;
}

export async function refreshCounts() {
  try {
    const c = await api('/api/admin/portal_counts');
    for (const [k, n] of [['registrations', c.reg], ['demos', c.demo]]) {
      const b = $(`[data-count="${k}"]`); if (!b) continue;
      b.textContent = n; b.hidden = !n; b.title = n + ' en attente';
    }
  } catch {}
}

// Document protégé : récupéré avec le jeton, ouvert dans un nouvel onglet
async function openFile(id) {
  const w = window.open('', '_blank');
  try {
    const r = await fetch('/api/admin/files/' + id, { headers: { authorization: 'Bearer ' + session.get().token } });
    if (!r.ok) throw new Error('Document introuvable');
    const u = URL.createObjectURL(await r.blob());
    if (w) w.location = u; else location.href = u;
  } catch (ex) { if (w) w.close(); toast(ex.message, 'err'); }
}

/* ------------------------------------------------------------------ Demandes d'inscription */
async function registrations(el) {
  let status = 'pending';
  el.innerHTML = `<div class="page-h"><div><h1>Demandes d'inscription</h1><p>Acheteurs, coopératives et ONG inscrits sur le site. Chaque décision envoie un e-mail et un SMS (simulés).</p></div></div>
    <div class="toolbar"><div class="seg" id="st" style="flex:0 1 auto">${[['pending', 'En attente'], ['info_requested', 'Complément demandé'], ['approved', 'Validées'], ['refused', 'Refusées'], ['', 'Toutes']].map(([v, l]) => `<button type="button" data-st="${v}" aria-pressed="${v === status}" style="min-height:36px;padding:0 12px">${l}</button>`).join('')}</div>
      <input class="input search" type="search" id="q" placeholder="Nom, e-mail, responsable…"><span class="small muted right" id="cnt"></span></div><div id="list">${skeleton(5)}</div>`;
  let rows = [];
  const load = async () => {
    rows = (await api('/api/admin/registrations?' + new URLSearchParams({ status, q: $('#q').value.trim() }))).rows;
    $('#cnt').textContent = rows.length + ' demande(s)';
    $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Organisation</th><th>Profil</th><th>Responsable</th><th>Reçue le</th><th>Docs</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map((o, i) => `
      <tr><td><b>${esc(o.name)}</b><div class="tiny muted">${esc(TYPE[o.org_type] || o.org_type || '')} · ${esc(o.country || '')}</div></td><td>${esc(KIND[o.kind])}</td>
      <td>${esc(o.contact_name)}<div class="tiny muted">${esc(o.email)}</div></td><td class="small">${esc(dateTime(o.submitted_at))}</td>
      <td>${o.docs ? `<span class="badge b-pri">${icon('paperclip')}${o.docs}</span>` : '<span class="muted small">0</span>'}</td>
      <td>${accBadge(o.status)}${o.is_demo ? ' <span class="badge b-warn">Démo</span>' : ''}</td><td><button class="btn sm" data-i="${i}">${icon('eye')}Ouvrir</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="card empty">${icon('inbox', 'xl')}<p>Aucune demande${status ? ' dans cet état' : ''}.</p></div>`;
  };
  $('#st').onclick = (e) => { const b = e.target.closest('[data-st]'); if (!b) return; status = b.dataset.st; $$('[data-st]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); };
  $('#q').oninput = debounce(load, 300);
  $('#list').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) regSheet(rows[+b.dataset.i].id, load); };
  await load();
}

async function regSheet(id, reload) {
  const d = await api('/api/admin/registrations/' + id);
  const o = d.org, a = o.activity || {};
  const zones = await Promise.all((a.zones || []).map(zoneName));
  const line = (k, v) => v ? `<tr><td class="muted">${k}</td><td>${v}</td></tr>` : '';
  const done = o.status === 'approved' || o.status === 'refused';
  modal({ title: o.name, wide: true, body: `<div class="row" style="align-items:flex-start;gap:24px"><div class="stack" style="flex:1 1 380px">
      <div class="row">${accBadge(o.status)}<span class="badge b-pri">${esc(KIND[o.kind])}</span>${o.is_demo ? '<span class="badge b-warn">Démo</span>' : ''}<span class="tiny muted">Reçue le ${esc(dateTime(o.submitted_at))}</span></div>
      ${o.status_reason ? `<div class="card small" style="background:var(--warn-50);color:var(--warn-ink)"><b>Motif / complément :</b> ${esc(o.status_reason)}<div class="tiny">${esc(o.decided_by || '')} · ${esc(dateTime(o.decided_at))}</div></div>` : ''}
      <table class="t"><tbody>
        ${line('Type', esc(TYPE[o.org_type] || o.org_type))}${line('RCCM', esc(o.rccm) || '<span class="muted">non fourni</span>')}${line('ID national', esc(o.id_nat) || '<span class="muted">non fourni</span>')}${line('NIF', esc(o.nif) || '<span class="muted">non fourni</span>')}
        ${line('Adresse', esc([o.address, o.country].filter(Boolean).join(', ')))}
        ${line('Responsable', esc(o.contact_name) + (o.contact_role ? ` · ${esc(o.contact_role)}` : ''))}${line('Téléphone', esc(fmtPhone(o.phone) || o.phone))}${line('E-mail', `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`)}
        ${line('Langue', esc(LANGS.find(l => l[0] === o.lang)?.[1] || o.lang))}
        ${line('Filières', esc((a.commodities || []).map(c => COM[c] || c).join(', ')))}
        ${line('Volume annuel', a.volume_t != null ? esc(a.volume_t) + ' t' : '')}${line('Export UE', o.kind === 'buyer' ? (a.eu_export ? 'Oui' : 'Non') : '')}
        ${line('Membres / producteurs', a.members != null ? esc(a.members) : '')}${line('Zones', esc(zones.join(', ')))}${line('Bailleurs', esc(a.donors))}${line('Projets', esc(a.projects))}
      </tbody></table>
      <div><div class="lbl">Documents</div>${d.files.length ? d.files.map(f => `<button class="btn sm" data-file="${f.id}" style="margin:0 6px 6px 0">${icon('file-text')}${esc(f.name)} <span class="tiny muted">${Math.round(f.size / 1024)} Ko</span></button>`).join('') : '<p class="muted small">Aucun document.</p>'}</div>
      <div><div class="lbl">Compte de connexion</div>${d.users.map(u => `<div class="small"><span class="mono">${esc(u.login)}</span> · ${accBadge(u.account_status)} · dernière connexion : ${esc(dateTime(u.last_login_at)) || 'jamais'}</div>`).join('')}</div>
    </div>
    <div class="stack" style="flex:1 1 300px">
      <div><div class="lbl">Décision</div>${done ? `<p class="small muted">Demande ${o.status === 'approved' ? 'validée' : 'refusée'}. Vous pouvez encore changer la décision.</p>` : ''}
        <label class="lbl" for="reason" style="font-weight:500">Motif du refus ou informations à compléter</label>
        <textarea class="input" id="reason" rows="3" maxlength="400" placeholder="Ex. copie du RCCM illisible, merci de la renvoyer."></textarea>
        <div class="err" id="rErr"></div>
        <div class="row" style="margin-top:8px"><button class="btn ok" data-d="approve">${icon('circle-check')}Valider</button><button class="btn" data-d="info">${icon('message-circle')}Demander un complément</button><button class="btn danger" data-d="refuse">${icon('circle-x')}Refuser</button></div></div>
      <div><div class="lbl">Messages envoyés (simulés)</div>${d.messages.length ? d.messages.map(m => `<div class="card small" style="padding:10px;margin-bottom:6px"><div class="tiny muted">${icon(m.channel === 'email' ? 'mail' : 'message-square-text')} ${m.channel === 'email' ? 'E-mail à ' + esc(m.email) : 'SMS au ' + esc(m.phone)} · ${esc(dateTime(m.created_at))}</div>${m.subject ? `<b>${esc(m.subject)}</b><br>` : ''}${esc(m.body)}</div>`).join('') : '<p class="muted small">Aucun.</p>'}</div>
      <div><div class="lbl">Historique</div>${d.history.map(h => `<div class="tiny"><b>${esc(h.action.replace('registration.', ''))}</b> · ${esc(h.user_name)} · ${esc(dateTime(h.at))}</div>`).join('') || '<p class="muted small">—</p>'}</div>
    </div></div>`,
    actions: [{ label: 'Fermer', onClick: () => closeModal() }] });
  $$('[data-file]').forEach(b => b.onclick = () => openFile(b.dataset.file));
  $$('[data-d]').forEach(b => b.onclick = async () => {
    const decision = b.dataset.d, reason = $('#reason').value.trim();
    if (decision !== 'approve' && !reason) { $('#rErr').textContent = decision === 'refuse' ? 'Indiquez le motif du refus : il est envoyé à l\'organisation.' : 'Indiquez les informations à compléter : elles sont envoyées à l\'organisation.'; $('#reason').focus(); return; }
    b.disabled = true;
    try {
      await api(`/api/admin/registrations/${id}/decision`, { method: 'POST', body: { decision, reason } });
      toast({ approve: 'Demande validée. E-mail et SMS envoyés.', info: 'Complément demandé. E-mail et SMS envoyés.', refuse: 'Demande refusée. E-mail et SMS envoyés.' }[decision], 'ok');
      closeModal(); reload(); refreshCounts();
    } catch (ex) { $('#rErr').textContent = ex.message; b.disabled = false; }
  });
}

/* ------------------------------------------------------------------ Demandes de démonstration */
async function demos(el) {
  el.innerHTML = `<div class="page-h"><div><h1>Demandes de démonstration</h1><p>Formulaire « Demander une démonstration » de la page d'accueil.</p></div></div><div id="list">${skeleton(4)}</div>`;
  const load = async () => {
    const rows = (await api('/api/admin/demo_requests')).rows;
    $('#list', el).innerHTML = rows.length ? `<div class="stack">${rows.map(r => `<div class="card stack" style="gap:8px">
      <div class="row"><b class="grow">${esc(r.name)}${r.organization ? ` · ${esc(r.organization)}` : ''}</b><span class="badge ${DEMO_ST[r.status][1]}">${DEMO_ST[r.status][0]}</span>${r.is_demo ? '<span class="badge b-warn">Démo</span>' : ''}<span class="tiny muted">${esc(dateTime(r.created_at))}</span></div>
      <div class="small row">${r.phone ? `${icon('phone')}<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}${r.email ? `${icon('mail')}<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}<span class="muted">${esc(LANGS.find(l => l[0] === r.lang)?.[1] || '')}</span></div>
      ${r.message ? `<p class="small" style="white-space:pre-wrap">${esc(r.message)}</p>` : ''}
      <div class="row"><select class="input" data-st="${r.id}" style="width:auto">${Object.entries(DEMO_ST).map(([k, [l]]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="input grow" data-note="${r.id}" placeholder="Note interne" value="${esc(r.note || '')}"><button class="btn sm" data-save="${r.id}">${icon('save')}Enregistrer</button></div>
      ${r.handled_by ? `<div class="tiny muted">Mis à jour par ${esc(r.handled_by)} · ${esc(dateTime(r.handled_at))}</div>` : ''}</div>`).join('')}</div>`
      : `<div class="card empty">${icon('calendar', 'xl')}<p>Aucune demande de démonstration.</p></div>`;
  };
  $('#list', el).onclick = async (e) => {
    const b = e.target.closest('[data-save]'); if (!b) return;
    const id = b.dataset.save;
    try { await api('/api/admin/demo_requests/' + id, { method: 'PATCH', body: { status: $(`[data-st="${id}"]`).value, note: $(`[data-note="${id}"]`).value } }); toast('Demande mise à jour.', 'ok'); refreshCounts(); load(); }
    catch (ex) { toast(ex.message, 'err'); }
  };
  await load();
}

/* ------------------------------------------------------------------ Contenu du site */
const GROUPS = [
  ['Accueil', /^(home\.|journey\.|kpi\.|how\.|who\.|eudr\.|demo\.)/], ['Services', /^(svc\.|services\.)/], ['Acheteurs', /^buyers\./], ['Producteurs', /^producers\./],
  ['Partenaires', /^partners\./], ['Impact', /^impact\./], ['Pages légales', /^(privacy\.|legal\.)/], ['Menu et pied de page', /^(nav\.|footer\.|meta\.)/]
];
const SVC = [['m1', 'Traçabilité et ordres d\'achat'], ['m2', 'Paiements et bons électroniques pour ONG'], ['m3', 'Conseil agricole, prix et alertes élevage'], ['m4', 'Crédit à partir de l\'historique']];
const GLOBAL = [['contact_email', 'E-mail de contact'], ['contact_phone', 'Téléphone'], ['contact_address', 'Adresse (Goma)'], ['legal_publisher', 'Éditeur du site (mentions légales)'],
  ['eudr_date_large', 'EUDR : date pour les grandes et moyennes entreprises'], ['eudr_date_small', 'EUDR : date pour les micro et petites entreprises']];
const SLOTS = [['hero', 'Accueil (fond de l\'en-tête)'], ['buyers', 'Page Acheteurs'], ['producers', 'Page Producteurs'], ['partners', 'Page Partenaires']];

async function site(el) {
  el.innerHTML = `<div class="page-h"><div><h1>Contenu du site</h1><p>Textes, statut des services, coordonnées et photos du site public. Les changements sont visibles dès le prochain chargement de la page.</p></div>
    <a class="btn right" href="/" target="_blank" rel="noopener">${icon('external-link')}Voir le site</a></div>
    <div class="stack"><div class="card stack" id="svcBox"></div><div class="card stack" id="glBox"></div><div class="card stack" id="phBox"></div><div class="card stack" id="txBox"></div></div>`;
  const [data, dicts] = await Promise.all([api('/api/admin/site'), Promise.all(LANGS.map(([l]) => import(`/js/site/i18n/${l}.js`).then(m => [l, m.default])))]);
  const D = Object.fromEntries(dicts);
  const overrides = {}; for (const r of data.rows) (overrides[r.lang] ||= {})[r.key] = r.value;

  // Statut des services
  $('#svcBox').innerHTML = `<h3>Statut des services</h3><p class="small muted">« Disponible » ou « Bientôt » s'affiche sur la carte du service ; « Masqué » la retire de l'accueil et de /services.</p>
    ${data.services.map(m => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><b class="grow">${esc(m.code.toUpperCase())} · ${esc(SVC.find(s => s[0] === m.code)?.[1] || m.label)}</b>
      <div class="seg" style="flex:0 0 auto">${[['available', 'Disponible'], ['soon', 'Bientôt'], ['hidden', 'Masqué']].map(([v, l]) => `<button type="button" data-svc="${m.code}" data-v="${v}" aria-pressed="${m.site_status === v}" style="min-height:34px;padding:0 12px">${l}</button>`).join('')}</div></div>`).join('')}`;
  $('#svcBox').onclick = async (e) => {
    const b = e.target.closest('[data-svc]'); if (!b) return;
    try { await api('/api/admin/site/services', { method: 'PATCH', body: { code: b.dataset.svc, status: b.dataset.v } }); $$(`[data-svc="${b.dataset.svc}"]`).forEach(x => x.setAttribute('aria-pressed', String(x === b))); toast('Statut du service mis à jour.', 'ok'); }
    catch (ex) { toast(ex.message, 'err'); }
  };

  // Coordonnées et dates
  const gl = overrides['*'] || {};
  $('#glBox').innerHTML = `<h3>Coordonnées et dates</h3><div class="fgrid c2">${GLOBAL.map(([k, l]) => `<div><label class="lbl" for="g-${k}">${l}</label><input class="input" id="g-${k}" value="${esc(gl[k] || '')}"></div>`).join('')}</div>
    <p class="tiny muted">Les dates EUDR ont déjà été reportées par l'Union européenne : vérifiez-les avant chaque présentation.</p><div><button class="btn primary" id="glSave">${icon('save')}Enregistrer</button></div>`;
  $('#glSave').onclick = async () => {
    const values = Object.fromEntries(GLOBAL.map(([k]) => [k, $('#g-' + k).value.trim()]));
    try { await api('/api/admin/site/content', { method: 'PUT', body: { lang: '*', values } }); toast('Coordonnées enregistrées.', 'ok'); } catch (ex) { toast(ex.message, 'err'); }
  };

  // Photos
  const drawPhotos = (photos) => {
    $('#phBox').innerHTML = `<h3>Photos</h3><p class="small muted">JPG, PNG ou WebP, 1,5 Mo maximum. Préférez une image large (1600 px) et légère. Utilisez uniquement des photos dont vous avez les droits et l'accord des personnes visibles.</p>
      <div class="kpis">${SLOTS.map(([k, l]) => `<div class="kpi stack" style="gap:8px"><div class="k">${l}</div>
        ${photos[k] ? `<img src="/api/public/file/${photos[k]}" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:8px">` : `<div style="aspect-ratio:16/10;border-radius:8px;background:var(--surface-2);display:grid;place-items:center" class="muted">${icon('image', 'xl')}</div>`}
        <div class="row"><label class="btn sm">${icon('upload')}${photos[k] ? 'Remplacer' : 'Ajouter'}<input type="file" accept="image/jpeg,image/png,image/webp" data-slot="${k}" hidden></label>${photos[k] ? `<button class="btn sm danger" data-rm="${k}">${icon('trash-2')}Retirer</button>` : ''}</div></div>`).join('')}</div>`;
  };
  drawPhotos(data.photos);
  $('#phBox').onchange = async (e) => {
    const inp = e.target.closest('[data-slot]'); if (!inp) return;
    const f = inp.files[0]; if (!f) return;
    if (f.size > 1_500_000) { toast('Image trop lourde : 1,5 Mo maximum.', 'err'); return; }
    try {
      const r = await fetch('/api/admin/site/photo/' + inp.dataset.slot, { method: 'POST', headers: { authorization: 'Bearer ' + session.get().token, 'x-file-name': encodeURIComponent(f.name), 'content-type': f.type }, body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
      toast('Photo enregistrée.', 'ok'); drawPhotos((await api('/api/admin/site')).photos);
    } catch (ex) { toast(ex.message, 'err'); }
  };
  $('#phBox').onclick = async (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    try { await api('/api/admin/site/photo/' + b.dataset.rm, { method: 'DELETE' }); toast('Photo retirée.', 'ok'); drawPhotos((await api('/api/admin/site')).photos); } catch (ex) { toast(ex.message, 'err'); }
  };

  // Textes par langue et par page
  let lang = 'fr', group = 0;
  const drawTexts = () => {
    const keys = Object.keys(D.fr).filter(k => GROUPS[group][1].test(k));
    const ov = overrides[lang] || {};
    $('#txBox').innerHTML = `<h3>Textes du site</h3><p class="small muted">Chaque texte est prérempli avec la version actuelle. Modifiez-le puis enregistrez ; videz-le ou cliquez « Rétablir » pour revenir au texte d'origine. Dans les listes, séparez les éléments par « | ».</p>
      <div class="row"><div class="seg" style="flex:0 0 auto">${LANGS.map(([l, n]) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}" style="min-height:34px;padding:0 12px">${n}</button>`).join('')}</div>
        <select class="input" id="grp" style="width:auto">${GROUPS.map(([n], i) => `<option value="${i}" ${i === group ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${lang !== 'fr' ? '<p class="tiny muted">Traductions automatiques de départ : à faire relire par une personne qui parle la langue.</p>' : ''}
      <div class="stack" id="keys">${keys.map(k => { const def = D[lang]?.[k] ?? D.fr[k]; const cur = ov[k] ?? def; const long = def.length > 90;
        return `<div><div class="row" style="gap:6px"><label class="lbl grow" for="k-${k}" style="margin:0"><span class="mono tiny">${esc(k)}</span>${ov[k] != null ? ' <span class="badge b-pri">modifié</span>' : ''}</label>${ov[k] != null ? `<button type="button" class="btn sm ghost" data-reset="${esc(k)}">${icon('rotate-ccw')}Rétablir</button>` : ''}</div>
          ${long ? `<textarea class="input" id="k-${k}" data-key="${esc(k)}" rows="${Math.min(10, Math.ceil(def.length / 90) + 1)}">${esc(cur)}</textarea>` : `<input class="input" id="k-${k}" data-key="${esc(k)}" value="${esc(cur)}">`}
          ${lang !== 'fr' ? `<div class="hint">FR : ${esc((overrides.fr || {})[k] ?? D.fr[k])}</div>` : ''}</div>`; }).join('')}</div>
      <div class="row" style="position:sticky;bottom:0;background:var(--surface);padding:10px 0;border-top:1px solid var(--line)"><button class="btn primary" id="txSave">${icon('save')}Enregistrer les textes (${LANGS.find(l => l[0] === lang)[1]} · ${GROUPS[group][0]})</button><span class="small muted" id="txInfo"></span></div>`;
    $$('[data-lang]', $('#txBox')).forEach(b => b.onclick = () => { lang = b.dataset.lang; drawTexts(); });
    $('#grp').onchange = (e) => { group = +e.target.value; drawTexts(); };
    $$('[data-reset]', $('#txBox')).forEach(b => b.onclick = async () => {
      try { await api('/api/admin/site/content', { method: 'PUT', body: { lang, values: { [b.dataset.reset]: null } } }); delete overrides[lang][b.dataset.reset]; toast('Texte d\'origine rétabli.', 'ok'); drawTexts(); } catch (ex) { toast(ex.message, 'err'); }
    });
    $('#txSave').onclick = async () => {
      const values = {};
      for (const inp of $$('[data-key]', $('#txBox'))) {
        const k = inp.dataset.key, def = D[lang]?.[k] ?? D.fr[k], v = inp.value.trim(), prev = ov[k] ?? def;
        if (v === prev) continue;
        values[k] = (!v || v === def) ? null : v;
      }
      if (!Object.keys(values).length) { $('#txInfo').textContent = 'Aucun changement.'; return; }
      try {
        await api('/api/admin/site/content', { method: 'PUT', body: { lang, values } });
        for (const [k, v] of Object.entries(values)) { overrides[lang] ||= {}; if (v == null) delete overrides[lang][k]; else overrides[lang][k] = v; }
        toast(Object.keys(values).length + ' texte(s) enregistré(s).', 'ok'); drawTexts();
      } catch (ex) { toast(ex.message, 'err'); }
    };
  };
  drawTexts();
}

export const PORTAL_SECTIONS = { registrations, demos, site };
