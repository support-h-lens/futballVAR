// Service worker — enables "install to home screen". Network-FIRST so the app
// always shows the latest version when online (falls back to cache only offline).
const CACHE = 'lensvar-v2';
const ASSETS = ['/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/replay/') || u.pathname.startsWith('/live/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
