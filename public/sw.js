// Cache app shell; API/CDN (cross-origin) luôn đi thẳng mạng.
const CACHE = 'q2b-v2-12';
const SHELL = ['./', 'app.js', 'emvco-parser.js', 'style.css', 'manifest.json', 'icons/icon-v2-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate cho file cùng origin.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Điều hướng trang: network-first, không bao giờ trả phản hồi redirect từ cache (gây ERR_FAILED).
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
