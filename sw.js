// 圏外でも開けるよう、アプリ本体をこの端末に保存しておく（データは localStorage 側）
const VERSION = 'jushoroku-20261003071129';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'itaiji.js', 'store-core.js', 'zipcode.js', 'zipdata.json.gz', 'sample.json',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // Dropbox への通信はそのまま
  // 本体は通信できればそれを使い（更新を反映）、圏外なら保存しておいたものを使う
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(VERSION).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
