// Interface unique vers les fournisseurs externes (SMS, USSD, Mobile Money).
// Aujourd'hui : implémentations simulées. Pour brancher un vrai agrégateur
// (ex. Africa's Talking), il suffit d'écrire un autre objet qui respecte les
// mêmes signatures et de le choisir ici selon env.SMS_PROVIDER / env.MOMO_PROVIDER.
//
// sms.send({ to, body, producerId, templateCode, lang, related }) -> { id, status, provider }
// ussd.session(...)  : géré dans module1 (étape d), même principe
// momo.disburse({ to, amount, currency, operator, reference }) -> { ref, status }

import { uuid, now } from '../socle/util.js';

const simulatedSms = (env) => ({
  name: 'simulateur',
  async send({ to, body, producerId = null, templateCode = null, lang = null, related = null, isDemo = 0 }) {
    const id = uuid();
    // Le simulateur « livre » le message immédiatement : il apparaît dans le téléphone simulé
    await env.DB.prepare(`INSERT INTO messages (id, producer_id, phone, direction, channel, template_code, lang, body, status, provider, related_type, related_id, created_at, is_demo)
      VALUES (?, ?, ?, 'out', 'sms', ?, ?, ?, 'delivered', 'simulateur', ?, ?, ?, ?)`)
      .bind(id, producerId, to, templateCode, lang, body, related?.type ?? null, related?.id ?? null, now(), isDemo).run();
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
    momo: simulatedMomo(env)
  };
}
