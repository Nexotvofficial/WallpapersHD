const CACHE_NAME = 'nekutoon-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/categories.html',
  '/style.css',
  '/app.js',
  '/community.js',
  '/firebase-init.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  // Exclude Firebase Auth and API calls
  if (event.request.url.includes('identitytoolkit.googleapis.com') || event.request.url.includes('firestore.googleapis.com')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if found
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Otherwise fetch from network
      return fetch(event.request).then((networkResponse) => {
        // Cache dynamic resources like images and json
        if (event.request.url.includes('wallpapers.json') || event.request.url.includes('img/')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback
        return new Response('Offline content not available');
      });
    })
  );
});
