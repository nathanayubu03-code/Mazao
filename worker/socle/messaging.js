// Messages producteurs : rendu des modèles, envoi, traitement des réponses (consentement).
import { providers } from '../providers/index.js';
import { uuid, now } from './util.js';

export async function getSetting(env, key, fallback = null) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return r ? r.value : fallback;
}

export function render(body, vars) {
  return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

export async function renderTemplate(env, code, lang, vars, fallback = 'sw') {
  let t = await env.DB.prepare('SELECT body FROM sms_templates WHERE code = ? AND lang = ? AND deleted_at IS NULL').bind(code, lang).first();
  if (!t && lang !== fallback) t = await env.DB.prepare('SELECT body FROM sms_templates WHERE code = ? AND lang = ? AND deleted_at IS NULL').bind(code, fallback).first();
  if (!t) return null;
  const base = { cooperative: await getSetting(env, 'cooperative_name', ''), ussd: await getSetting(env, 'ussd_code', '') };
  return render(t.body, { ...base, ...vars });
}

const firstName = (n) => String(n || '').split(/\s+/)[0];

export async function sendTemplate(env, producer, code, vars = {}, related = null) {
  if (!producer.phone) return null;
  const lang = producer.lang || 'sw';
  const body = await renderTemplate(env, code, lang, { nom: firstName(producer.full_name), ...vars });
  if (!body) return null;
  return providers(env).sms.send({ to: producer.phone, body, producerId: producer.id, templateCode: code, lang, related, isDemo: producer.is_demo || 0 });
}

export async function logInbound(env, producer, phone, text, channel = 'sms') {
  const id = uuid();
  await env.DB.prepare(`INSERT INTO messages (id, producer_id, phone, direction, channel, body, status, provider, created_at, is_demo)
    VALUES (?, ?, ?, 'in', ?, ?, 'received', 'simulateur', ?, ?)`).bind(id, producer?.id ?? null, phone, channel, text, now(), producer?.is_demo || 0).run();
  return id;
}

export async function setConsent(env, producer, status, channel, messageId) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE producers SET consent_status = ?, consent_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').bind(status, t, t, producer.id),
    env.DB.prepare('INSERT INTO consent_events (id, producer_id, event, channel, message_id, at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid(), producer.id, status, channel, messageId, t, producer.is_demo || 0)
  ]);
}

// Point d'entrée unique des SMS entrants (simulateur aujourd'hui, webhook de l'agrégateur demain).
// Les extensions des modules (ex. « NDIYO 120 » pour un ordre) s'enregistrent dans inboundHandlers.
export const inboundHandlers = [];

export async function handleInbound(env, phone, text) {
  const producer = await env.DB.prepare("SELECT * FROM producers WHERE phone = ? AND deleted_at IS NULL AND status = 'active'").bind(phone).first();
  const msgId = await logInbound(env, producer, phone, text);
  if (!producer) return { handled: false, reason: 'Numéro inconnu' };
  const words = String(text).trim().toUpperCase().split(/\s+/);
  for (const h of inboundHandlers) {
    const r = await h(env, producer, words, msgId);
    if (r) return r;
  }
  if (words[0] === 'NDIYO' && words.length === 1) {
    if (producer.consent_status !== 'granted') await setConsent(env, producer, 'granted', 'sms', msgId);
    await sendTemplate(env, producer, 'CONSENT_OK');
    return { handled: true, action: 'consent_granted' };
  }
  if (words[0] === 'HAPANA') {
    await setConsent(env, producer, 'refused', 'sms', msgId);
    await sendTemplate(env, producer, 'CONSENT_REFUSED');
    return { handled: true, action: 'consent_refused' };
  }
  if (words[0] === 'SITISHA' || words[0] === 'STOP') {
    await setConsent(env, producer, 'withdrawn', 'sms', msgId);
    await sendTemplate(env, producer, 'CONSENT_REFUSED');
    return { handled: true, action: 'consent_withdrawn' };
  }
  await sendTemplate(env, producer, 'HELP');
  return { handled: false, reason: 'Message non compris' };
}
