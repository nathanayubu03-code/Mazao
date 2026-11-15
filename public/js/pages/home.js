// Page d'accueil : connexion et redirection vers l'espace du rôle.
import { login, HOME } from '../socle/auth.js';
import { session } from '../socle/api.js';
import { $, demoBanner } from '../ui/ui.js';

demoBanner();
const next = new URLSearchParams(location.search).get('next');
const s = session.get();
if (s?.token && s.user && s.user.role !== 'admin') location.replace(HOME[s.user.role]);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit'), err = $('#err');
  const id = $('#login').value.trim(), pw = $('#password').value;
  if (!id || !pw) { err.textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
  btn.disabled = true; btn.textContent = 'Vérification…'; err.textContent = '';
  try {
    const r = await login(id, pw, 'web');
    if (r.stage !== 'ok') { location.href = '/admin'; return; }
    const target = HOME[r.user.role];
    location.href = next && next.startsWith(target) ? next : target;
  } catch (ex) {
    err.textContent = ex.message;
    $('#password').value = '';
  } finally { btn.disabled = false; btn.textContent = 'Se connecter'; }
});
