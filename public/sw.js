// Service worker : met en cache l'application agent pour qu'elle s'ouvre sans réseau.
// L'API (/api/*) n'est jamais mise en cache ici : la synchronisation hors ligne est gérée par l'application (étape b).
const VERSION = 'kt-agent-v2-a1';
const SHELL = ['/agent', '/assets/app.css', '/assets/icons.svg', '/assets/logo-mark.png', '/assets/icon-192.png', '/manifest.webmanifest',
  '/js/pages/agent.js', '/js/socle/api.js', '/js/socle/auth.js', '/js/socle/util.js', '/js/socle/i18n.js', '/js/socle/geo.js', '/js/ui/ui.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Réseau d'abord (version à jour), cache en secours hors ligne
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('/agent'))));
});
