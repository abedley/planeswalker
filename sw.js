/**
 * Offline support and fast repeat visits. The app's own files are served from the
 * cache and refreshed in the background (so a new version shows on the next
 * visit); card images from Scryfall's CDN and fonts are cached once and kept.
 */
const VERSION = 'planeswalker-v17';
const SHELL = [
  './', 'index.html', 'app/app.css', 'app/main.js', 'manifest.webmanifest', 'app/icons/icon.svg',
  'app/vendor/symbols.css', 'app/vendor/mana.woff2', 'app/vendor/keyrune.woff2',
  'app/vendor/fonts.css', 'app/vendor/faustina.woff2', 'app/vendor/crimson-pro.woff2', 'app/vendor/crimson-pro-italic.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

const LONG_LIVED = ['cards.scryfall.io', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (LONG_LIVED.includes(url.hostname)) {
    event.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Network first, so a new version is used as soon as it's deployed; the cache is for offline.
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const hit = await cache.match(request);
      if (hit) return hit;
      throw error;
    }
  }));
});
