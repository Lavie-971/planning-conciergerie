// Service worker : permet d'ouvrir l'app sans connexion (fichiers mis en cache).
// Les données, elles, sont gardées par l'app dans le navigateur et synchronisées au retour du réseau.
const CACHE = 'conciergerie-v37';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const keep = res => { if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  if (url.origin === self.location.origin) {
    // Page et fichiers de l'app : le réseau d'abord (mises à jour), sinon la copie en cache
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  } else if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // Polices Google : mises en cache à la première visite
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(keep)));
  }
  // Supabase (autre origine) : non intercepté
});
