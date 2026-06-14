const CACHE_NAME = "cachetao-pro-pwa-v1";

self.addEventListener("install", (event) => {
  console.log("[PWA] Service Worker instalado");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[PWA] Service Worker ativado");

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Não mexe em WebSocket nem API
  if (
    event.request.url.includes("/api/") ||
    event.request.url.startsWith("ws:") ||
    event.request.url.startsWith("wss:")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});