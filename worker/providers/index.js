// Interface unique vers les fournisseurs externes (SMS, USSD, Mobile Money).
// Aujourd'hui : implémentations simulées. Pour brancher un vrai agrégateur
// (ex. Africa's Talking), il suffit d'écrire un autre objet qui respecte les
// mêmes signatures et de le choisir ici selon env.SMS_PROVIDER / env.MOMO_PROVIDER.
//
// sms.send({ to, body, producerId, userId, orgId, templateCode, lang, related }) -> { id, status, provider }
// email.send({ to, subject, body, userId, orgId, templateCode, lang }) -> { id, status, provider }
// ussd.session(...)  : géré dans module1 (étape d), même principe
// momo.disburse({ to, amount, currency, operator, reference }) -> { ref, status }

import { uuid, now } from '../socle/util.js';

const simulatedSms = (env) => ({
  name: 'simulateur',
  async send({ to, body, producerId = null, userId = null, orgId = null, templateCode = null, lang = null, related = null, isDemo = 0 }) {
    const id = uuid();
    // Le simulateur « livre » le message immédiatement : il apparaît dans le téléphone simulé
    await env.DB.prepare(`INSERT INTO messages (id, producer_id, user_id, org_id, phone, direction, channel, template_code, lang, body, status, provider, related_type, related_id, created_at, is_demo)
      VALUES (?, ?, ?, ?, ?, 'out', 'sms', ?, ?, ?, 'delivered', 'simulateur', ?, ?, ?, ?)`)
      .bind(id, producerId, userId, orgId, to, templateCode, lang, body, related?.type ?? null, related?.id ?? null, now(), isDemo).run();
    return { id, status: 'delivered', provider: 'simulateur' };
  }
});

// E-mail simulé : Cloudflare ne permet pas d'écrire à n'importe quelle adresse sur le plan gratuit.
// Le message est enregistré comme « envoyé » et visible dans /admin et dans l'espace du destinataire.
// Pour un vrai envoi (Resend, Brevo…), écrire un objet { send } de même signature et le choisir ici.
const simulatedEmail = (env) => ({
  name: 'simulateur',
  async send({ to, subject, body, userId = null, orgId = null, templateCode = null, lang = null, isDemo = 0 }) {
    const id = uuid();
    await env.DB.prepare(`INSERT INTO messages (id, user_id, org_id, email, subject, direction, channel, template_code, lang, body, status, provider, created_at, is_demo)
      VALUES (?, ?, ?, ?, ?, 'out', 'email', ?, ?, ?, 'delivered', 'simulateur', ?, ?)`)
      .bind(id, userId, orgId, to, subject, templateCode, lang, body, now(), isDemo).run();
    return { id, status: 'delivered', provider: 'simulateur' };
  }
});

const simulatedMomo = () => ({
  name: 'simulateur',
  async disburse({ operator, reference }) {
    const prefix = { MPESA: 'MP', AIRTEL: 'AM', ORANGE: 'OM' }[operator] || 'MM';
    const d = new Date();
    const ref = prefix + String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0') + '.' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return { ref, status: 'confirmed', reference };
  }
});

export function providers(env) {
  return {
    sms: simulatedSms(env),   // remplacer par africasTalkingSms(env) le moment venu
    email: simulatedEmail(env),
    momo: simulatedMomo(env)
  };
}
