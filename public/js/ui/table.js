// Liste générique : recherche, filtres, export et import CSV, formulaire de création et d'édition.
// Utilisée par toutes les listes de /admin.
import { esc, toCSV, parseCSV, download, pickFile, stamp, debounce } from '../socle/util.js';
import { api } from '../socle/api.js';
import { $, $$, icon, toast, modal, closeModal, confirmBox, skeleton } from './ui.js';

/*
 cfg = {
   entity, title, sub,
   columns: [{ key, label, render(row) }],
   filters: [{ key, label, options: () => [[value, label]] }],
   fields:  [{ key, label, type: text|textarea|select|number|bool|date|phone|criteria, options(), required, hint, help }],
   rowActions(row) -> [{ label, icon, onClick, danger }],
   create: true|false, importCsv: true|false, canDelete: true|false,
   beforeSave(data, row) -> data (peut lever une Error), afterSave(), onFormRender(form, row)
 }
*/
export function listView(host, cfg) {
  // Conteneur neuf à chaque affichage : les écouteurs d'une liste précédente ne s'accumulent pas
  const root = document.createElement('div');
  host.replaceChildren(root);
  const state = { q: '', f: {}, rows: [] };
  root.innerHTML = `
    <div class="page-h"><div class="grow"><h1>${esc(cfg.title)}</h1>${cfg.sub ? `<p>${cfg.sub}</p>` : ''}</div>
      <div class="row">
        ${cfg.importCsv !== false ? `<button class="btn sm" data-a="import">${icon('upload')}Importer CSV</button>` : ''}
        <button class="btn sm" data-a="export">${icon('download')}Exporter CSV</button>
        ${cfg.create !== false ? `<button class="btn primary sm" data-a="new">${icon('plus')}Ajouter</button>` : ''}
      </div></div>
    <div class="toolbar">
      <input class="input search" type="search" placeholder="Rechercher…" aria-label="Rechercher">
      ${(cfg.filters || []).map(f => `<select class="input" data-f="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)} : tous</option>${f.options().map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`).join('')}
      <span class="small muted right" data-count></span>
    </div>
    <div class="table-wrap"><div style="padding:14px">${skeleton(5)}</div></div>`;
  const wrap = $('.table-wrap', root);

  async function load() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    for (const [k, v] of Object.entries(state.f)) if (v) p.set('f.' + k, v);
    try {
      const r = await api(`/api/admin/${cfg.entity}?${p}`);
      state.rows = r.rows; render();
    } catch (e) { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function render() {
    $('[data-count]', root).textContent = state.rows.length + ' élément(s)';
    if (!state.rows.length) { wrap.innerHTML = `<div class="empty">${icon('search', 'xl')}<p>Aucun résultat.</p></div>`; return; }
    wrap.innerHTML = `<table class="t"><thead><tr>${cfg.columns.map(c => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>${state.rows.map((r, i) =>
      `<tr>${cfg.columns.map(c => `<td>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}<td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" data-edit="${i}" title="Modifier" aria-label="Modifier">${icon('pencil')}</button>
        ${(cfg.rowActions ? cfg.rowActions(r) : []).map((a, j) => `<button class="icon-btn" data-ra="${i}:${j}" title="${esc(a.label)}" aria-label="${esc(a.label)}" ${a.danger ? 'style="color:var(--err)"' : ''}>${icon(a.icon)}</button>`).join('')}
        ${cfg.canDelete !== false ? `<button class="icon-btn" data-del="${i}" title="Mettre à la corbeille" aria-label="Supprimer" style="color:var(--err)">${icon('trash-2')}</button>` : ''}
      </td></tr>`).join('')}</tbody></table>`;
  }

  root.addEventListener('input', debounce((e) => {
    if (e.target.matches('.search')) { state.q = e.target.value.trim(); load(); }
  }, 300));
  root.addEventListener('change', (e) => { if (e.target.dataset.f) { state.f[e.target.dataset.f] = e.target.value; load(); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'new') openForm(null);
    if (b.dataset.a === 'export') exportCsv();
    if (b.dataset.a === 'import') importCsv();
    if (b.dataset.edit) openForm(state.rows[+b.dataset.edit]);
    if (b.dataset.del) {
      const r = state.rows[+b.dataset.del];
      confirmBox('Mettre à la corbeille ?', 'L\'élément reste récupérable 30 jours dans la corbeille.', 'Mettre à la corbeille', async () => {
        try { await api(`/api/admin/${cfg.entity}/${r.id}`, { method: 'DELETE' }); closeModal(); toast('Élément mis à la corbeille.', 'ok'); load(); }
        catch (ex) { toast(ex.message, 'err'); }
      }, true);
    }
    if (b.dataset.ra) { const [i, j] = b.dataset.ra.split(':').map(Number); cfg.rowActions(state.rows[i])[j].onClick(state.rows[i], load); }
  });

  function fieldHtml(f, v) {
    const id = 'fld-' + f.key, req = f.required ? ' *' : '';
    const lab = `<label class="lbl" for="${id}">${esc(f.label)}${req}</label>`;
    const hint = f.hint ? `<div class="hint">${f.hint}</div>` : '';
    if (f.type === 'bool') return `<div><label class="check"><input type="checkbox" id="${id}" ${v == 1 || v === true ? 'checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
    if (f.type === 'select') return `<div>${lab}<select class="input" id="${id}"><option value="">Choisir…</option>${f.options().map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${hint}</div>`;
    if (f.type === 'textarea') return `<div class="full">${lab}<textarea class="input" id="${id}">${esc(v)}</textarea>${hint}</div>`;
    if (f.type === 'criteria') return `<div class="full">${lab}<div id="${id}" class="stack" data-criteria='${esc(typeof v === 'string' ? v : JSON.stringify(v || []))}'></div>${hint}</div>`;
    const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'password' ? 'password' : 'text';
    return `<div class="${f.full ? 'full' : ''}">${lab}<input class="input" id="${id}" type="${type}" ${f.type === 'number' ? 'step="any"' : ''} value="${esc(v)}" autocomplete="off">${hint}</div>`;
  }
  function criteriaEditor(el) {
    let list = []; try { list = JSON.parse(el.dataset.criteria || '[]'); } catch {}
    const draw = () => {
      el.innerHTML = list.map((c, i) => `<div class="row" data-i="${i}"><input class="input" style="flex:2" placeholder="Critère (ex. Humidité)" value="${esc(c.label)}" data-k="label"><input class="input" style="flex:1" placeholder="Unité" value="${esc(c.unit)}" data-k="unit"><input class="input" style="flex:1" type="number" step="any" placeholder="Min" value="${esc(c.min)}" data-k="min"><input class="input" style="flex:1" type="number" step="any" placeholder="Max" value="${esc(c.max)}" data-k="max"><button type="button" class="icon-btn" data-rm="${i}" aria-label="Retirer">${icon('x')}</button></div>`).join('')
        + `<button type="button" class="btn sm" data-add>${icon('plus')}Ajouter un critère</button>`;
    };
    el.addEventListener('input', e => { const r = e.target.closest('[data-i]'); if (r) list[+r.dataset.i][e.target.dataset.k] = e.target.value; });
    el.addEventListener('click', e => { if (e.target.closest('[data-add]')) { list.push({ label: '', unit: '', min: '', max: '' }); draw(); } const rm = e.target.closest('[data-rm]'); if (rm) { list.splice(+rm.dataset.rm, 1); draw(); } });
    el.getValue = () => list.filter(c => c.label).map(c => ({ key: c.key || c.label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_'), label: c.label, unit: c.unit || '', ...(c.min !== '' && c.min != null ? { min: Number(c.min) } : {}), ...(c.max !== '' && c.max != null ? { max: Number(c.max) } : {}) }));
    draw();
  }
  function readForm(form) {
    const data = {};
    for (const f of cfg.fields) {
      const el = $('#fld-' + f.key, form); if (!el) continue;
      if (f.type === 'bool') data[f.key] = el.checked ? 1 : 0;
      else if (f.type === 'criteria') data[f.key] = el.getValue();
      else data[f.key] = el.value.trim();
    }
    return data;
  }
  function openForm(row) {
    const fields = cfg.fields.filter(f => !(row && f.createOnly));
    const m = modal({ title: row ? 'Modifier' : 'Ajouter', wide: fields.length > 6,
      body: `<form class="fgrid c2" novalidate>${fields.map(f => fieldHtml(f, row ? row[f.key] : f.default)).join('')}<div class="err full" id="formErr"></div></form>`,
      actions: [{ label: 'Annuler', onClick: () => closeModal() }, { label: 'Enregistrer', cls: 'primary', id: 'saveBtn', onClick: save }] });
    const form = $('form', m);
    $$('[data-criteria]', form).forEach(criteriaEditor);
    cfg.onFormRender?.(form, row);
    form.addEventListener('submit', e => { e.preventDefault(); save(); });
    async function save() {
      const btn = $('#saveBtn'); btn.disabled = true;
      try {
        let data = readForm(form);
        if (cfg.beforeSave) data = await cfg.beforeSave(data, row);
        if (row) await api(`/api/admin/${cfg.entity}/${row.id}`, { method: 'PATCH', body: data });
        else await api(`/api/admin/${cfg.entity}`, { method: 'POST', body: data });
        closeModal(); toast('Enregistré.', 'ok'); cfg.afterSave?.(); load();
      } catch (ex) { $('#formErr').textContent = ex.message; btn.disabled = false; }
    }
  }
  function exportCsv() {
    const cols = ['id', ...cfg.fields.filter(f => f.type !== 'password').map(f => f.key)];
    download(`${cfg.entity}_${stamp()}.csv`, toCSV(cols, state.rows.map(r => cols.map(c => typeof r[c] === 'object' && r[c] ? JSON.stringify(r[c]) : r[c]))), 'text/csv;charset=utf-8');
  }
  async function importCsv() {
    const file = await pickFile('.csv,text/csv'); if (!file) return;
    const rows = parseCSV(await file.text());
    if (!rows.length) { toast('Fichier vide.', 'err'); return; }
    modal({ title: 'Importer ' + rows.length + ' ligne(s)', body: `<p class="small">Colonnes attendues : <span class="mono">${['id (facultatif, pour mettre à jour)', ...cfg.fields.map(f => f.key)].join(', ')}</span>.</p><p class="small muted" style="margin-top:8px">Astuce : exportez d'abord la liste en CSV pour obtenir le bon modèle.</p>`,
      actions: [{ label: 'Annuler', onClick: () => closeModal() }, { label: 'Importer', cls: 'primary', onClick: async () => {
        try {
          const r = await api(`/api/admin/${cfg.entity}/import`, { method: 'POST', body: { rows } });
          closeModal();
          modal({ title: 'Résultat de l\'import', body: `<p>${r.created} créé(s), ${r.updated} mis à jour, ${r.errors.length} erreur(s).</p>${r.errors.length ? `<div class="table-wrap" style="margin-top:10px"><table class="t"><tbody>${r.errors.map(x => `<tr><td>Ligne ${x.line}</td><td>${esc(x.error)}</td></tr>`).join('')}</tbody></table></div>` : ''}`, actions: [{ label: 'Fermer', cls: 'primary', onClick: () => closeModal() }] });
          load();
        } catch (ex) { toast(ex.message, 'err'); }
      } }] });
  }
  load();
  return { reload: load };
}
