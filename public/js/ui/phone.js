// Téléphone à touches simulé : affiche les SMS reçus par le producteur et lui fait répondre.
// (L'USSD *xxx# sera ajouté à l'étape d.)
import { api } from '../socle/api.js';
import { esc, dateTime, fmtPhone } from '../socle/util.js';
import { $, toast } from './ui.js';

export async function phoneSim(root, producer, onChange) {
  root.innerHTML = `<div class="phone" aria-label="Téléphone simulé de ${esc(producer.full_name)}">
    <div class="tiny" style="color:#9FB3C2;text-align:center;margin-bottom:6px">${esc(fmtPhone(producer.phone) || 'Sans numéro')}</div>
    <div class="phone-screen" data-screen></div>
    <div class="phone-input"><input data-text placeholder="Réponse…" maxlength="160" aria-label="Réponse du producteur"><button data-send aria-label="Envoyer">OK</button></div>
    <div class="phone-keys"><button data-k="NDIYO">NDIYO</button><button data-k="HAPANA">HAPANA</button><button data-k="SITISHA">SITISHA</button></div>
  </div>`;
  const screen = $('[data-screen]', root), input = $('[data-text]', root);
  async function refresh() {
    const r = await api(`/api/producers/${producer.id}/messages`);
    screen.innerHTML = r.rows.length ? r.rows.map(m => `<div class="msg ${m.direction === 'in' ? 'in' : ''}"><div class="meta">${m.direction === 'in' ? 'Envoyé' : 'Reçu'} · ${dateTime(m.created_at)}</div>${esc(m.body)}</div>`).join('') : '<div class="meta">Aucun message</div>';
    screen.scrollTop = screen.scrollHeight;
  }
  async function send(text) {
    if (!text) return;
    try {
      const r = await api('/api/sim/reply', { method: 'POST', body: { producer_id: producer.id, text } });
      input.value = '';
      await refresh();
      if (r.action === 'consent_granted') toast('Consentement validé par SMS.', 'ok');
      onChange?.(r);
    } catch (e) { toast(e.message, 'err'); }
  }
  root.addEventListener('click', e => {
    const k = e.target.closest('[data-k]'); if (k) send(k.dataset.k);
    if (e.target.closest('[data-send]')) send(input.value.trim());
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(input.value.trim()); });
  await refresh();
}
