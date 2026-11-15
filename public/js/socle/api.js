// Accès à l'API du Worker. Le jeton de session est gardé sur l'appareil.
// Une session distincte par espace (web, agent, admin) : se connecter comme
// administrateur ne détourne plus les autres liens vers /admin, et inversement.
export const SPACE = location.pathname.startsWith('/admin') ? 'admin' : location.pathname.startsWith('/agent') ? 'agent' : 'web';
const keyOf = (space) => 'kt.session.' + space;
const KEY = keyOf(SPACE);

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
  set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
  // Transmet une session à un autre espace (ex. un agent qui se connecte depuis la page principale)
  setFor(space, s) { try { localStorage.setItem(keyOf(space), JSON.stringify(s)); } catch {} }
};
try { localStorage.removeItem('kt.session'); } catch {} // ancienne clé commune

export async function api(path, { method = 'GET', body, token } = {}) {
  const tok = token ?? session.get()?.token;
  let r;
  try {
    r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Pas de connexion au serveur');
  }
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/totp') session.clear();
    throw new ApiError(r.status, data.error || 'Erreur ' + r.status, data);
  }
  return data;
}
