const SHELL_CACHE = "tailor-erp-mobile-shell-v7";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/brand/tafsell-icon-192.png",
  "/brand/tafsell-icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/manus-storage/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          // One shell entry, never the requested URL: links such as /?reset_token=...
          // carry one-time secrets that must not be written to Cache Storage.
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("/index.html") || caches.match("/"))),
    );
    return;
  }

  const isApplicationAsset = request.destination === "script"
    || request.destination === "style"
    || request.destination === "font"
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".css");

  if (isApplicationAsset) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const fresh = fetch(request)
        .then(response => {
          if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
