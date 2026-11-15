// Page d'accueil : connexion des agents, acheteurs et coordination.
// Les administrateurs ont leur propre lien (/admin) avec double authentification.
import { login, HOME } from '../socle/auth.js';
import { session } from '../socle/api.js';
import { $, demoBanner } from '../ui/ui.js';

demoBanner();
const next = new URLSearchParams(location.search).get('next');
const s = session.get();
if (s?.token && ['buyer', 'coordination'].includes(s.user?.role)) location.replace(HOME[s.user.role]);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit'), err = $('#err');
  const id = $('#login').value.trim(), pw = $('#password').value;
  if (!id || !pw) { err.textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
  btn.disabled = true; btn.textContent = 'Vérification…'; err.textContent = '';
  try {
    const r = await login(id, pw, 'web');
    if (r.stage !== 'ok') {
      // Compte administrateur : il se connecte uniquement par /admin
      session.clear();
      err.innerHTML = 'Ce compte est un compte administrateur. Connectez-vous sur <a href="/admin">la page d\'administration</a>.';
      return;
    }
    if (r.user.role === 'agent') { session.setFor('agent', session.get()); session.clear(); location.href = '/agent'; return; }
    const target = HOME[r.user.role];
    location.href = next && next.startsWith(target) ? next : target;
  } catch (ex) {
    err.textContent = ex.message;
    $('#password').value = '';
  } finally { btn.disabled = false; btn.textContent = 'Se connecter'; }
});
