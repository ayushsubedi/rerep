/* Jaggasignal service worker. A plot visit in the hills often has no signal, so the app shell, the data and every listing you have opened are kept on the
 * device and the site opens offline. `jagga site` fills in BUILD and SHELL (every shipped file) when it writes the site, so the cache name changes with each
 * build (old caches are dropped) and the file list can never go stale. Map tiles are cross-origin and are not cached: offline, the list works and the map
 * is blank. Data files go network-first (a new build shows at once; on a slow link the saved copy wins after 4 s), the rest cache-first. */
const BUILD = "2026-11-03T09:52", CACHE = "jagga-" + BUILD, SHELL = ["./", "app.js", "data.js", "finder.js", "fonts/LICENSE-FONTS.md", "fonts/bricolage-grotesque-500-800-latin.woff2", "fonts/ibm-plex-mono-400-latin.woff2", "fonts/ibm-plex-mono-500-latin.woff2", "fonts/ibm-plex-sans-var-latin.woff2", "fonts/noto-sans-devanagari-var-devanagari.woff2", "guide.js", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "index.html", "lib.js", "manifest.webmanifest", "messages.js", "picks.js", "places.js", "style.css", "vendor/leaflet/LICENSE", "vendor/leaflet/images/layers-2x.png", "vendor/leaflet/images/layers.png", "vendor/leaflet/images/marker-icon.png", "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js"];
const DATA = /\/(data\.js|places\.js|guide\.js|d\/[A-Za-z0-9]+\.js)$/;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("jagga-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** Only a plain answer from this site is kept. A response that was redirected, opaque or an error is never cached: behind a sign-in gate (Cloudflare Access) an expired session answers every
 *  request with the gate's login page, and caching that as data.js would break the app until the cache was cleared. */
const clean = (res) => res && res.ok && res.type === "basic" && !res.redirected;

async function networkFirst(req) {
  const cache = await caches.open(CACHE), hit = await cache.match(req);
  try {
    const res = await (hit ? Promise.race([fetch(req), new Promise((_, rej) => setTimeout(rej, 4000))]) : fetch(req));
    if (clean(res)) { cache.put(req, res.clone()); return res; }
    return hit || res;                                                    // not a clean answer (a login page, a server error): the saved copy is better than that
  } catch (err) { if (hit) return hit; throw err; }
}
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (clean(res)) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}
/** The page itself: the network gets 2 s to answer (so a sign-in gate can send the browser to its login page and a new build shows at once), then the saved copy opens it, at once when offline. */
async function navigate(req) {
  const home = new URL("./", self.location).href, saved = () => caches.match(req, { ignoreSearch: true }).then((h) => h || caches.match(home));
  if (self.navigator && self.navigator.onLine === false) { const h = await saved(); if (h) return h; }
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(rej, 2000))]);
    if (res.type === "opaqueredirect") return res;                       // a redirect (the sign-in page of an access gate): let the browser follow it, never cache it
    if (clean(res) && new URL(req.url).href === home) (await caches.open(CACHE)).put(home, res.clone());
    return clean(res) ? res : (await saved()) || res;
  } catch (err) { const h = await saved(); if (h) return h; throw err; }
}
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== self.location.origin) return;
  e.respondWith(req.mode === "navigate" ? navigate(req) : DATA.test(u.pathname) ? networkFirst(req) : cacheFirst(req));
});
