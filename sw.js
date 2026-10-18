/* Jaggasignal service worker. A plot visit in the hills often has no signal, so the app shell, the data and every listing you have opened are kept on the
 * device and the site opens offline. `jagga site` fills in BUILD and SHELL (every shipped file) when it writes the site, so the cache name changes with each
 * build (old caches are dropped) and the file list can never go stale. Map tiles are cross-origin and are not cached: offline, the list works and the map
 * is blank. Data files go network-first (a new build shows at once; on a slow link the saved copy wins after 4 s), the rest cache-first. */
const BUILD = "2026-10-18T09:24", CACHE = "jagga-" + BUILD, SHELL = ["./", "app.js", "data.js", "finder.js", "fonts/LICENSE-FONTS.md", "fonts/noto-sans-devanagari.woff2", "fonts/orbitron-var-latin.woff2", "fonts/sharetechmono-latin.woff2", "i18n.js", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "index.html", "lib.js", "manifest.webmanifest", "places.js", "style.css", "vendor/leaflet/LICENSE", "vendor/leaflet/images/layers-2x.png", "vendor/leaflet/images/layers.png", "vendor/leaflet/images/marker-icon.png", "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js"];
const DATA = /\/(data\.js|places\.js|d\/[A-Za-z0-9]+\.js)$/;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("jagga-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE), hit = await cache.match(req);
  try {
    const res = await (hit ? Promise.race([fetch(req), new Promise((_, rej) => setTimeout(rej, 4000))]) : fetch(req));
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) { if (hit) return hit; throw err; }
}
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== self.location.origin) return;
  e.respondWith(DATA.test(u.pathname) ? networkFirst(req) : cacheFirst(req));
});
