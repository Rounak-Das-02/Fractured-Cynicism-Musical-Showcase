// Bump VERSION when shipping changed shell files. Updates activate on the next
// full close/reopen, so a new release never reloads a listener's active player.
const VERSION = 'v5';
const PREFIX = `fc-archive-${new URL(self.registration.scope).pathname}-`;
const SHELL = `${PREFIX}shell-${VERSION}`;
const METADATA = `${PREFIX}metadata-v1`;
const ASSETS = ['index.html','album.html','manifest.webmanifest'];
const scoped = path => new URL(path, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS.map(scoped))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== SHELL && name !== METADATA) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache streamed audio or intercept range requests.
  if (request.headers.has('range') || url.pathname.startsWith('/download/')) return;
  if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
    const relative = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    if (request.mode === 'navigate' && ['', 'index.html', 'album.html'].includes(relative)) {
      event.respondWith(caches.open(SHELL).then(cache => cache.match(scoped(relative || 'index.html'))).then(cached => cached || fetch(request)));
    } else if (ASSETS.includes(relative)) {
      event.respondWith(caches.open(SHELL).then(cache => cache.match(scoped(relative))).then(cached => cached || fetch(request)));
    }
  } else if (url.origin === 'https://archive.org' && url.pathname.startsWith('/metadata/')) {
    event.respondWith((async () => {
      const cache = await caches.open(METADATA);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(request, {signal:controller.signal});
        if (!response.ok) throw new Error('Metadata unavailable');
        await cache.put(request, response.clone());
        const entries = await cache.keys();
        if (entries.length > 100) await cache.delete(entries[0]);
        return response;
      } catch {
        return await cache.match(request) || new Response(JSON.stringify({error:'Offline: this album has not been cached yet.'}), {status:503,headers:{'Content-Type':'application/json'}});
      } finally { clearTimeout(timeout); }
    })());
  }
});
