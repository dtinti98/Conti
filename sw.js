// Service worker: rende l'app utilizzabile anche senza internet.
// Quando modifichi i file dell'app, aumenta VERSION così il telefono scarica la nuova versione.
const VERSION = 'conti-v14';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'bg/metro.jpg', 'zona-mura.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la rete (così gli aggiornamenti arrivano subito). Se non c'è connessione, o la rete
// non risponde entro 3 secondi (segnale debole), usa la copia salvata; il download continua
// comunque in background e aggiorna la copia per la volta successiva.
const TIMEOUT_MS = 3000;
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // I file dell'app vengono sempre ricontrollati sul server (niente copie vecchie della cache del browser)
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  const req = sameOrigin ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request);
  const network = req.then(res => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(finish), TIMEOUT_MS);
    network
      .then(res => { clearTimeout(timer); finish(res); })
      .catch(() => {
        clearTimeout(timer);
        cached().then(r => r || caches.match('index.html')).then(r => finish(r || Response.error()));
      });
    // se dopo il timeout non c'è copia salvata, si continua ad aspettare la rete
  }));
});
