
var _cacheName = 'cimbar-recv-js-v2026-01-20T0312';
var _cacheFiles = [
  '/',
  '/recv.html',
  '/cimbar_js.2026-01-20T0312.js',
  '/cimbar_js.2026-01-20T0312.wasm',
  '/favicon.ico',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-512x512-maskable.png',
  '/recv.2026-01-20T0312.js',
  '/recv-worker.2026-01-20T0312.js',
  '/pwa-recv.2026-01-20T0312.json',
  '/zstd.2026-01-20T0312.js'
];

// fetch files
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(_cacheName).then(function (cache) {
      return cache.addAll(_cacheFiles);
    })
  );
  self.skipWaiting();
});

// serve from cache
self.addEventListener('fetch', function (e) {
  e.respondWith(
    caches.match(e.request).then(function (response) {
      return response || fetch(e.request);
    })
  );
});

// clean old caches
self.addEventListener('activate', function (e) {
  e.waitUntil(function () {
    caches.keys().then(function (names) {
      for (var i in names)
        if (names[i] != _cacheName)
          caches.delete(names[i]);
    });
  });
});
