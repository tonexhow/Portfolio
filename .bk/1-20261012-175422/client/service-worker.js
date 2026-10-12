// Retire the previous portfolio worker instead of retaining an obsolete cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("jpano-public-")) await caches.delete(key);
  await self.registration.unregister();
})()));
