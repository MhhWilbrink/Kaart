/* Service worker for the owner app: offline app shell + push notifications */
const CACHE = 'owner-app-v8';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', '../config.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: answer from cache instantly, update the cache in the background.
// API calls (other origin, POST) are never cached.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || network;
  }));
});

/* ---------- tiny IndexedDB reader (same store the page writes to) ---------- */
function idbGet(key) {
  return new Promise(resolve => {
    const open = indexedDB.open('owner-app', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const req = open.result.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (err) { resolve(null); }
    };
  });
}

// The push itself carries no data. We fetch the newest contact from your own backend,
// so names never pass through Apple's or Google's push servers.
async function newestContact() {
  const [token, endpoint] = await Promise.all([idbGet('token'), idbGet('endpoint')]);
  if (!token || !endpoint) return null;
  const res = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'latest', token })
  });
  const j = await res.json();
  return j.ok ? j.data : null;
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = 'New contact';
    let body = 'Someone shared their details with you. Tap to add a note.';
    let url = './';
    try {
      const c = await newestContact();
      if (c) {
        const name = String(c.name || '').replace(/^'/, '');
        title = 'New contact: ' + name;
        body = [String(c.company || '').replace(/^'/, ''), c.cardId ? 'via ' + c.cardId : ''].filter(Boolean).join(' · ') || 'Tap to add a note.';
        url = './#c=' + encodeURIComponent(c.id);
      }
    } catch (err) { /* offline or signed out: show the generic notification */ }
    await self.registration.showNotification(title, {
      body, tag: 'new-contact', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        w.postMessage({ type: 'open', url });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
