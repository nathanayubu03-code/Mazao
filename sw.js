/* KivuTrace & Market : service worker (offline-first)
   - App shell (index.html) : réseau d'abord, cache en secours
   - Librairies CDN, polices : cache d'abord
   - Tuiles cartographiques : cache opportuniste (les zones déjà consultées restent visibles hors ligne) */
const VERSION = 'kivutrace-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
const CDN = [
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css'
];
const TILE_CACHE = 'kivutrace-tiles';
const TILE_MAX = 600;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled([...SHELL, ...CDN].map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles(){
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for(let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const isTile = /tile\.openstreetmap\.org|arcgisonline\.com/.test(url.host);
  const isShell = url.origin === self.location.origin && (req.mode === 'navigate' || url.pathname.endsWith('.html'));

  if(isShell){
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  if(isTile){
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req);
      if(hit) return hit;
      const r = await fetch(req);
      if(r.ok || r.type === 'opaque'){ c.put(req, r.clone()); trimTiles(); }
      return r;
    }).catch(() => new Response('', { status: 504 })));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if(r.ok && (url.host.includes('jsdelivr') || url.host.includes('fonts.g') || url.origin === self.location.origin)){
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy));
    }
    return r;
  })));
});
