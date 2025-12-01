const CACHE_NAME = 'dvdr-cache-v1.3.0';
const urlsToCache = [
  // Archivos principales
  '/',
  'index.html',
  'script.js',
  'style.css',
  'manifest.json',
  // Librerías externas
  'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap',
  // Íconos
  'icons/favicon.ico',
  'icons/favicon.svg',
  'icons/favicon-96x96.png',
  'icons/apple-touch-icon.png',
  'icons/icon-maskable-192x192.png',
  'icons/icon-maskable-512x512.png'
];
// Evento de instalación: se abre la caché y se almacenan los assets principales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});
// Evento de activación: se limpian las cachés antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
// Evento fetch: intercepta las peticiones y responde desde la caché si es posible
self.addEventListener('fetch', event => {
  // Estrategia para Google Fonts (archivos .woff2)
  if (event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(response => {
          return response || fetch(event.request).then(networkResponse => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }
  // Estrategia por defecto (Cache First, fallback to Network)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
