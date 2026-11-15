// Journal des modifications : qui, quoi, quand, ancienne et nouvelle valeur.
import { uuid, now } from './util.js';

const SECRET_FIELDS = ['pw_hash', 'pw_salt', 'totp_secret', 'token_hash'];
const clean = (o) => {
  if (!o) return null;
  const c = { ...o };
  for (const f of SECRET_FIELDS) if (f in c) c[f] = '•••';
  return JSON.stringify(c);
};

export async function audit(env, user, action, entity, entityId, before, after, req) {
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, user_name, action, entity, entity_id, before, after, at, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uuid(), user?.id ?? null, user?.full_name ?? 'système', action, entity, entityId, clean(before), clean(after), now(), req?.headers.get('cf-connecting-ip') ?? null).run();
}

// Ne garde dans before/after que les champs réellement modifiés
export function diff(before, after) {
  const b = {}, a = {};
  for (const k of Object.keys(after)) if (String(before?.[k] ?? '') !== String(after[k] ?? '')) { b[k] = before?.[k] ?? null; a[k] = after[k]; }
  return [b, a];
}
