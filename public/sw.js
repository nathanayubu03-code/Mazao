// Service worker : met en cache l'application agent (/app) pour qu'elle s'ouvre sans réseau.
// Le site public n'est pas mis en cache ici. L'API (/api/*) non plus : la file hors ligne arrive à l'étape b.
const VERSION = 'kt-agent-v2-p1';
const SHELL = ['/app', '/assets/app.css', '/assets/icons.svg', '/assets/logo-mark.png', '/assets/icon-192.png', '/manifest.webmanifest',
  '/js/pages/agent.js', '/js/socle/api.js', '/js/socle/auth.js', '/js/socle/util.js', '/js/socle/i18n.js', '/js/socle/geo.js', '/js/ui/ui.js'];
const isApp = (p) => p === '/app' || p === '/app.html' || p === '/agent';

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const nav = e.request.mode === 'navigate';
  // Seules l'application agent et ses fichiers passent par le cache ; le reste va directement au réseau
  if (nav ? !isApp(url.pathname) : !SHELL.includes(url.pathname)) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && !r.redirected) { const c = r.clone(); caches.open(VERSION).then(x => x.put(nav ? '/app' : e.request, c)); } return r; })
    .catch(() => caches.match(nav ? '/app' : e.request, { ignoreSearch: true })));
});
