/* Service worker for the owner app: offline app shell + push notifications */
const CACHE = 'owner-app-v22';
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
  // The app page itself and its settings: try the network first (so updates arrive on the first open),
  // fall back to the cached copy when offline or when the network is slow.
  const fresh = req.mode === 'navigate' || /\/(index\.html|config\.json)?$/.test(new URL(req.url).pathname);
  if (fresh) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
      if (!cached) return net;
      return Promise.race([net.catch(() => cached), new Promise(r => setTimeout(() => r(cached), 4000))]);
    }));
    return;
  }
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

// The push itself carries no data. We ask your own backend what it is about (a new contact, or the
// morning follow-up reminder), so names never pass through Apple's or Google's push servers.
async function pushInfo() {
  const [token, endpoint] = await Promise.all([idbGet('token'), idbGet('endpoint')]);
  if (!token || !endpoint) return null;
  const ask = async action => {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token }) });
    return res.json();
  };
  let j = await ask('pushInfo');
  if (!j.ok && j.error === 'unknown_action') j = await ask('latest');      // backend older than 2.12
  return j.ok ? j.data : null;
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = 'New contact';
    let body = 'Someone shared their details with you. Tap to add a note.';
    let url = './';
    let tag = 'new-contact';
    try {
      const c = await pushInfo();
      if (c && c.type === 'digest') {
        title = c.count === 1 ? '1 follow-up for today' : c.count + ' follow-ups for today';
        body = (c.names || []).join(', ') + (c.count > (c.names || []).length ? ' and more' : '');
        url = './#followups'; tag = 'follow-ups';
      } else if (c) {
        const name = String(c.name || '').replace(/^'/, '');
        title = (c.handover ? 'Handed over to you: ' : c.again ? 'Met again: ' : 'New contact: ') + name;
        body = c.handover ? 'From ' + c.handover + '. Tap to see the notes and follow-ups.'
          : c.again ? 'Their new details were added to the existing contact.'
          : [String(c.company || '').replace(/^'/, ''), c.cardId ? 'via ' + c.cardId : ''].filter(Boolean).join(' · ') || 'Tap to add a note.';
        url = './#c=' + encodeURIComponent(c.id);
      }
    } catch (err) { /* offline or signed out: show the generic notification */ }
    await self.registration.showNotification(title, {
      body, tag, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url }
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
