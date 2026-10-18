/* Jaggasignal front end. No framework: state object + render functions.
 * All data-derived strings go through L.esc; hrefs through L.safeUrl (listing text is scraped, so untrusted). */
(function () {
  "use strict";
  const L = window.JaggaLib, D = window.JAGGA, T = L.unitTable(D.meta.units);
  const $ = (id) => document.getElementById(id);
  const PAGE = 40;
  const F = window.JaggaFinder, FLAGS = D.meta.flags || [];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: degrade silently */ } }
  };

  const S = { f: { unit: "aana", aunit: "aana", sort: "new" }, cmp: [], shown: PAGE, sel: null, watch: store.get("jagga.watch", {}), bounds: null, fitNext: true, lastFocus: null };
  const byId = new Map(D.listings.map((l) => [l.id, l]));
  let FR = null, FRMAP = new Map(), PLACES = null, placesP = null, SINCE = null;       // the finder's last run, by listing id; the places picker's data (loaded on demand)
  let visible = [], map = null, layerA = null, layerS = null, layerL = null, layerC = null, layerB = null, markers = new Map(), canvas = null;

  // ---------- detail shards: X-Ray text and price history load on demand (d/<first id char>.js) ----------
  const DETAIL = {}, shardP = {};
  window.JAGGA_DETAIL_LOAD = (k, obj) => { Object.assign(DETAIL, obj); if (shardP[k]) shardP[k].res(); };
  function loadDetail(ids) {
    return Promise.all([...new Set(ids.map((i) => i[0]))].map((k) => {
      if (shardP[k]) return shardP[k].p;
      let res, rej; const p = new Promise((a, b) => { res = a; rej = b; });
      shardP[k] = { p, res };
      const sc = document.createElement("script"); sc.src = "d/" + k + ".js";
      sc.onerror = () => { delete shardP[k]; rej(new Error("could not load listing details")); };
      document.head.appendChild(sc);
      return p;
    }));
  }
  const detailOf = (id) => DETAIL[id] || { x: { ok: [], no: [] }, h: [] };

  // ---------- helpers ----------
  const UNIT_LABEL = { aana: "aana", ropani: "ropani", kattha: "kattha", dhur: "dhur", bigha: "bigha", sqft: "sq ft", sqm: "m²" };
  const pctColor = (c) => (!c ? "#7a7391" : c.p < 25 ? "#00ffff" : c.p > 75 ? "#ff00ff" : "#b48cff");
  function priceText(l) { return l.p != null ? L.fmtMoney(L.perUnit(l.p, S.f.unit, T)) : l.tot ? L.fmtMoney(l.tot) + " total" : "Price n/a"; }   // area unreadable: the total is the price
  const perText = (l) => (l.p != null ? " <small>/" + UNIT_LABEL[S.f.unit] + "</small>" : "");
  function areaText(l) {
    if (l.a == null) return "area n/a";
    const sqm = Math.round(l.a).toLocaleString("en-US") + " m²";
    return l.sys ? (L.areaPlain(l.a, l.sys, D.meta.units) || L.areaNotation(l.a, l.sys, D.meta.units)) + " (" + sqm + ")" : sqm + " · " + (l.a / T.aana).toFixed(1) + " aana";
  }
  // Lead with the RESOLVED place; raw portal text is shown only when short and clean (it is often a jumble).
  const placeText = (l) => [l.pal, l.dis, l.loc && l.loc.length <= 36 ? l.loc : ""].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  const ago = (d) => { const n = L.daysSince(d); return n == null ? "" : n === 0 ? "today" : n + "d ago"; };
  const isNew = (l) => L.isNewAd(l);

  // ---------- filters <-> UI <-> hash ----------
  function readUI() {
    const f = S.f;
    f.q = $("q").value; f.dis = $("fDis").value; f.src = $("fSrc").value; f.unit = $("fUnit").value;
    f.pmin = $("fPmin").value.replace(/,/g, ""); f.pmax = $("fPmax").value.replace(/,/g, "");
    f.aunit = $("fAunit").value; f.amin = $("fAmin").value; f.amax = $("fAmax").value; f.road = $("fRoad").value;
    f.age = $("fAge").value; f.cut = $("fCut").checked; f.dups = $("fDups").checked; f.sort = $("fSort").value;
  }
  function writeUI() {
    const f = S.f;
    $("q").value = f.q || ""; $("fDis").value = f.dis || ""; $("fSrc").value = f.src || ""; $("fUnit").value = f.unit || "aana";
    $("fPmin").value = f.pmin || ""; $("fPmax").value = f.pmax || ""; $("fAunit").value = f.aunit || "aana";
    $("fAmin").value = f.amin || ""; $("fAmax").value = f.amax || ""; $("fRoad").value = f.road || "";
    $("fAge").value = f.age || ""; $("fCut").checked = !!f.cut; $("fDups").checked = !!f.dups; $("fSort").value = f.sort || "new";
  }
  function hashState() { const m = /(?:^|&)l=([0-9a-f]+)/.exec(location.hash.slice(1)); return m ? m[1] : null; }
  function pushHash() {
    const fp = F.activeIds(S.profile, FLAGS).length ? "fp=" + F.encode(S.profile) : "";          // the finder rides in the link only when it has criteria
    const h = [L.toHash(S.f), S.sel ? "l=" + S.sel : "", fp].filter(Boolean).join("&");
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  // ---------- list ----------
  function compute() {
    const f = Object.assign({}, S.f, { bounds: $("fMapOnly").checked && S.bounds ? S.bounds : null });
    let rows = L.filter(D.listings, f, T);
    if (FR) rows = rows.filter((l) => { const it = FRMAP.get(l.id); return it && S.tiers[it.tier]; });
    visible = S.f.sort === "fit" && FR ? rows.sort((a, b) => F.byFit(FRMAP.get(a.id), FRMAP.get(b.id))) : L.sort(rows, S.f.sort === "fit" ? "new" : S.f.sort || "new");
  }
  function cardHTML(l) {
    const c = l.c, tags = [];
    if (c) tags.push('<span class="tag ' + (c.p < 25 ? "cheap" : c.p > 75 ? "dear" : "") + '" title="At the ' + c.p + 'th percentile of ' + c.n + ' similar ads (lower is cheaper)"><i>' + L.esc(L.compsPlain(c)) + "</i></span>");
    if (c && c.rel === "weak") tags.push('<span class="tag weak" title="Compared with the whole district: locations differ"><i>weak comparison</i></span>');
    if (l.pc === "low") tags.push('<span class="tag weak" title="Low confidence: see the X-Ray for why"><i>price uncertain</i></span>');
    if (l.pb === "total_reread") tags.push('<span class="tag weak" title="The ad put a total price in the per-unit field; it has been read as a total"><i>read as total</i></span>');
    const fit = FRMAP.get(l.id);
    if (fit && fit.tier) tags.unshift('<span class="tag ideal t' + fit.tier + '" title="' + (fit.tier === 3 ? "every must-have passes" : fit.tier === 2 ? "nothing fails, some must-haves are unknown (the ad does not say)" : "exactly one must-have fails: see the checklist") + '"><i>' + F.TIER[fit.tier] + (fit.wishTotal ? " · " + fit.wishes + "/" + fit.wishTotal + " wishes" : "") + "</i></span>");
    if (L.isCut(l)) tags.push('<span class="tag cut"><i>price cut</i></span>');
    if (isNew(l)) tags.push('<span class="tag new"><i>new this week</i></span>');
    if (l.tw) tags.push('<span class="tag weak" title="Same district, area, price and place as other postings, so probably the same plot. Photos and contacts are not used, so this cannot be proven: two plots in one subdivision can match too."><i>listed ' + (l.tw + 1) + '× (likely the same plot)</i></span>');
    const age = L.daysSince(l.po);
    if (age != null && age > 180) tags.push('<span class="tag weak" title="The portal dates this ad long ago and still lists it; confirm it is still for sale"><i>old ad: check it is still for sale</i></span>');
    const place = placeText(l);
    const starred = !!S.watch[l.id];
    return '<li class="card' + (S.sel === l.id ? " sel" : "") + '" data-id="' + l.id + '">' +
      '<div class="price">' + L.esc(priceText(l)) + perText(l) + "</div>" +
      '<span class="card-actions"><button class="cmp" type="button" data-cmp="' + l.id + '" aria-pressed="' + (S.cmp.indexOf(l.id) >= 0) + '" aria-label="' + (S.cmp.indexOf(l.id) >= 0 ? "Remove from comparison" : "Add to comparison (up to 3)") + '">' + (S.cmp.indexOf(l.id) >= 0 ? "✓ Compare" : "＋ Compare") + "</button> " +
      '<button class="star" type="button" data-star="' + l.id + '" aria-pressed="' + starred + '" aria-label="' + (starred ? "Remove from saved plots" : "Save this plot") + '">' + (starred ? "★ Saved" : "☆ Save") + "</button></span>" +
      '<h3><button type="button" data-open="' + l.id + '">' + L.esc(l.t) + "</button></h3>" +
      '<div class="facts"><span>' + L.esc(areaText(l)) + "</span>" + (l.tot && l.p != null ? "<span>" + L.esc(L.fmtMoney(l.tot)) + " total</span>" : "") +
      (l.road ? "<span>" + l.road + " ft road</span>" : "") + '<span class="dim">' + L.esc(place) + "</span>" +
      '<span class="dim">' + L.esc(l.src) + " · " + L.whenText(l) + "</span></div>" +
      (tags.length ? '<div class="tags">' + tags.join("") + "</div>" : "") + "</li>";
  }
  // ---------- price histogram: the distribution under every filter EXCEPT price, so you can see where a budget sits ----------
  function renderHist() {
    const f = Object.assign({}, S.f, { pmin: "", pmax: "", bounds: null });
    const vals = L.filter(D.listings, f, T).map((l) => L.perUnit(l.p, S.f.unit, T));
    const h = L.histogram(vals, 24), fig = $("hist");
    if (!h) { fig.hidden = true; return; }
    fig.hidden = false;
    const lo = S.f.pmin ? +S.f.pmin : 0, hi = S.f.pmax ? +S.f.pmax : Infinity, max = Math.max.apply(null, h.counts), W = 400 / h.counts.length;
    $("histSvg").innerHTML = h.counts.map((c, i) => '<rect class="' + (h.edges[i + 1] > lo && h.edges[i] < hi ? "in" : "") + '" data-lo="' + h.edges[i] + '" data-hi="' + h.edges[i + 1] +
      '" x="' + (i * W + 0.5) + '" width="' + (W - 1) + '" y="' + (62 - (c / max) * 58) + '" height="' + (c / max) * 58 + '"><title>' + c + " listing(s): " + L.esc(L.fmtMoney(h.edges[i])) + " – " + L.esc(L.fmtMoney(h.edges[i + 1])) + "</title></rect>").join("") +
      '<line x1="' + (((Math.log(h.median) - Math.log(h.min)) / ((Math.log(h.max) - Math.log(h.min)) || 1)) * 400) + '" x2="' + (((Math.log(h.median) - Math.log(h.min)) / ((Math.log(h.max) - Math.log(h.min)) || 1)) * 400) + '" y1="0" y2="64"></line>';
    $("histSvg").setAttribute("aria-label", "Price distribution per " + UNIT_LABEL[S.f.unit] + ": " + vals.length + " listings, median " + L.fmtMoney(h.median) + ", from " + L.fmtMoney(h.min) + " to " + L.fmtMoney(h.max));
    $("histCap").textContent = "Per " + UNIT_LABEL[S.f.unit] + ": median " + L.fmtMoney(h.median) + " · range " + L.fmtMoney(h.min) + " – " + L.fmtMoney(h.max) + " · click a bar to filter to it";
  }

  /** How many filters are set, for the phone's "Filters (n)" button. */
  function countFilters() {
    const f = S.f;
    return [f.dis, f.src, f.pmin || f.pmax, f.amin || f.amax, f.road, f.age, f.cut, f.dups, f.q].filter(Boolean).length;
  }
  function renderList() {
    compute(); renderHist();
    const nf = countFilters(); $("filterCount").textContent = nf ? "(" + nf + ")" : "";
    $("resultsHead").textContent = visible.length + (visible.length === 1 ? " listing" : " listings") +
      (FR ? " · " + FR.counts[3] + " match my finder" : "");
    const shown = visible.slice(0, S.shown);
    $("results").innerHTML = shown.length ? shown.map(cardHTML).join("") :
      '<li class="empty"><b>No listings match these filters.</b> Try removing one, or <button class="btn btn-outline" type="button" id="emptyReset"><span>Clear all filters</span></button><br>Most ads are in the Kathmandu valley; <button class="btn btn-ghost" type="button" data-cov="1"><span>see where data exists</span></button>.</li>';
    $("btnMore").hidden = visible.length <= S.shown;
    $("btnMore").firstElementChild.textContent = "Show more (" + (visible.length - S.shown) + " left)";
    renderMap();
    pushHash();
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L || !document.getElementById("map")) { $("map").innerHTML = '<p class="empty">Map library unavailable. The list works without it.</p>'; return; }
    map = window.L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([28.2, 84.2], 7);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
    canvas = window.L.canvas({ padding: 0.5 });
    layerL = window.L.layerGroup().addTo(map); layerS = window.L.layerGroup().addTo(map); layerC = window.L.layerGroup();
    const have = {}; D.meta.districts.forEach((d) => { have[d.district_id] = d.n; });
    layerB = window.L.geoJSON(D.boundaries, {
      style: (f) => (have[f.properties.id] ? { color: "#7656b8", weight: 1, fillColor: "#00ffff", fillOpacity: 0.09 } : { color: "#4a3578", weight: 1, fillOpacity: 0, dashArray: "3 4" }),
      onEachFeature: (f, layer) => layer.bindTooltip(L.esc(f.properties.name) + ": " + (have[f.properties.id] ? have[f.properties.id] + " listings" : "no data (not crawled, or none found)"), { sticky: true })
    });
    D.catalysts.forEach((c) => {
      const tip = "<b>" + L.esc(c.name) + "</b><br>" + L.esc(c.kind) + " · stage: " + L.esc(c.stage) +
        '<br><span class="judge">stage and “priced in ' + Math.round((c.priced_in || 0) * 100) + '%” are judgement calls, not measurements</span>';
      if (c.path) window.L.polyline(c.path, { color: "#ff9900", weight: 3, dashArray: "6 6" }).bindPopup(tip).addTo(layerC);
      window.L.circle([c.lat, c.lon], { radius: (c.radius_km || 0) * 1000, color: "#ff9900", weight: 1, fillOpacity: 0.06 }).bindPopup(tip).addTo(layerC);
    });
    layerA = window.L.layerGroup().addTo(map); window.JAGGA_ANCHORS = layerA;       // exposed for the browser test, like JAGGA_MAP
    window.JAGGA_MAP = map; map.on("zoomend", drawMarkers); map.on("click", onMapClick);
    map.on("moveend", () => { const b = map.getBounds(); S.bounds = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; if ($("fMapOnly").checked && !S.fitNext) { S.shown = PAGE; renderList(); } S.fitNext = false; });
  }
  // ---------- map: distance clustering, recomputed on zoom (no library) ----------
  const CELL = 56;                                   // px: listings closer than this on screen merge into one numbered circle
  function drawMarkers() {
    if (!map) return;
    layerL.clearLayers(); markers = new Map();
    const zoom = map.getZoom(), cells = new Map();
    visible.forEach((l) => {
      if (l.lat == null) return;
      const p = map.project([l.lat, l.lon], zoom), k = Math.floor(p.x / CELL) + ":" + Math.floor(p.y / CELL);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(l);
    });
    cells.forEach((g) => {
      if (g.length === 1) {
        const l = g[0];
        const m = window.L.circleMarker([l.lat, l.lon], { renderer: canvas, radius: 6, color: "#000", weight: 1, fillColor: pctColor(l.c), fillOpacity: 0.92 });
        m.on("click", () => openDrawer(l.id, true));
        m.on("mouseover", () => hot(l.id, true)); m.on("mouseout", () => hot(l.id, false));
        m.bindTooltip(L.esc(priceText(l)) + "/" + UNIT_LABEL[S.f.unit] + (l.prec && l.prec !== "exact" ? " (approx. location)" : ""), { direction: "top" });
        m.addTo(layerL); markers.set(l.id, m);
        return;
      }
      const lat = g.reduce((a, l) => a + l.lat, 0) / g.length, lon = g.reduce((a, l) => a + l.lon, 0) / g.length;
      const ps = g.map((l) => l.p).filter((x) => x != null).sort((a, b) => a - b);
      const lo = ps[0], hi = ps[ps.length - 1];
      const icon = window.L.divIcon({ className: "", iconSize: [36, 36], html: '<div class="cl" role="img" aria-label="' + g.length + ' listings">' + g.length + "</div>" });
      const m = window.L.marker([lat, lon], { icon: icon, keyboard: false });
      m.bindTooltip(g.length + " listings" + (ps.length ? ": " + L.esc(L.fmtMoney(L.perUnit(lo, S.f.unit, T))) + " – " + L.esc(L.fmtMoney(L.perUnit(hi, S.f.unit, T))) + "/" + UNIT_LABEL[S.f.unit] : ""), { direction: "top" });
      m.on("click", () => {
        const b = window.L.latLngBounds(g.map((l) => [l.lat, l.lon]));
        if (b.getNorthEast().equals(b.getSouthWest()) || map.getZoom() >= 17) {          // same point (a locality centroid): list them instead of zooming forever
          window.L.popup().setLatLng([lat, lon]).setContent('<div class="foot">' + g.length + " listings here</div>" + g.slice(0, 12).map((l) => '<button class="btn btn-ghost" type="button" data-open="' + l.id + '"><span>' + L.esc(priceText(l)) + " · " + L.esc(l.t.slice(0, 28)) + "</span></button>").join("")).openOn(map);
        } else map.fitBounds(b, { padding: [50, 50], maxZoom: 17 });
      });
      m.addTo(layerL);
    });
    pinSelected();
  }
  function renderMap() {
    if (!map) return;
    const pts = visible.filter((l) => l.lat != null).map((l) => [l.lat, l.lon]);
    if (S.fitNext && pts.length && !$("fMapOnly").checked) { map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); }
    S.fitNext = false;
    drawMarkers();
  }
  /** The selected listing gets its own pin on a separate layer, so it stays visible even when clustering hides its marker. */
  function settleMap() { if (map) setTimeout(() => map.invalidateSize(), 60); }       // the map column changes width when the X-Ray opens or closes
  function pinSelected() {
    if (!layerS) return;
    layerS.clearLayers();
    const l = S.sel && byId.get(S.sel);
    if (!l || l.lat == null) return;
    window.L.circleMarker([l.lat, l.lon], { radius: 15, color: "#ff00ff", weight: 3, fillColor: "#ff00ff", fillOpacity: 0.12, interactive: false }).addTo(layerS);
    window.L.circleMarker([l.lat, l.lon], { radius: 7, color: "#fff", weight: 2, fillColor: pctColor(l.c), fillOpacity: 1, interactive: false }).addTo(layerS);
  }
  function showOnMap(l) {
    if (!map || l.lat == null) return;
    if (window.matchMedia("(max-width: 900px)").matches && !document.body.classList.contains("show-map")) return;   // map hidden on phones until its tab is open
    const z = Math.max(map.getZoom(), l.prec === "palika" ? 11 : 15);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) map.setView([l.lat, l.lon], z); else map.flyTo([l.lat, l.lon], z, { duration: 0.6 });
  }
  function hot(id, on) {
    const m = markers.get(id), card = document.querySelector('.card[data-id="' + id + '"]');
    if (m) m.setStyle({ radius: on || S.sel === id ? 10 : 6, weight: on || S.sel === id ? 3 : 1, color: on || S.sel === id ? "#fff" : "#000" });
    if (card) card.classList.toggle("hot", on);
  }

  // ---------- drawer ----------
  /** The listing under MY finder: every criterion I switched on, pass / fail / unknown, with the ad's evidence. */
  function finderCheck(l) {
    const it = FRMAP.get(l.id);
    if (!it || !it.results.length) return "";
    const mark = { pass: "✓", fail: "✗", unknown: "?" };
    const rows = it.results.map((x) => '<li class="ic ' + x.s + '"><b>' + mark[x.s] + " " + L.esc(x.label) + (x.must ? "" : " <small>(nice to have)</small>") + "</b><br>" + L.esc(x.e) + "</li>").join("");
    return '<h3 class="sec">◎ My finder · ' + (F.TIER[it.tier] || "outside it") + '</h3><ul class="factors ideal-list">' + rows + "</ul>" +
      '<p class="foot">Pass, fail or unknown: unknown means the ad does not say, not that it is bad. A view, water, soil and tourism demand cannot be measured from this data.</p>';
  }
  function spark(h, unit) {
    if (!h || h.length < 2) return "";
    const vs = h.map((x) => x[1]), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), W = 300, H = 50;
    const pts = h.map((x, i) => (i / (h.length - 1) * W).toFixed(1) + "," + (H - 4 - (hi === lo ? 0.5 : (x[1] - lo) / (hi - lo)) * (H - 8)).toFixed(1)).join(" ");
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Price history, ' + h.length + ' observations"><polyline fill="none" stroke="#ff9900" stroke-width="2" points="' + pts + '"/></svg>';
  }
  function openDrawer(id, fromMap) {
    const l = byId.get(id); if (!l) return;
    if (!$("finder").hidden) hideFinder();                 // the finder and the X-Ray share the left side: opening a plot puts the finder away (its criteria stay)
    if ($("drawer").hidden) S.lastFocus = document.activeElement;
    S.sel = id; updateStepper(id);
    $("dBody").innerHTML = '<h2 id="dTitle">' + L.esc(l.t) + '</h2><p class="foot" role="status">Loading details…</p>';
    $("drawer").hidden = false; document.body.classList.add("sel-open"); settleMap(); $("dClose").focus();
    loadDetail([id]).then(() => { if (S.sel === id) renderDrawer(id, fromMap); },
      () => { if (S.sel === id) $("dBody").insertAdjacentHTML("beforeend", '<p class="empty">Could not load the details. Check your connection and try again.</p>'); });
  }
  function renderDrawer(id, fromMap) {
    const l = byId.get(id), dt = detailOf(id);
    document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
    const card = document.querySelector('.card[data-id="' + id + '"]');
    if (card) { card.classList.add("sel"); if (fromMap) card.scrollIntoView({ block: "center" }); }
    const ok = dt.x.ok.map((f) => '<li><b>' + L.esc(f.f) + "</b><br>" + L.esc(f.d).replace(/JUDGEMENT CALLS?/g, '<span class="judge">judgement calls</span>') +
      (f.s ? '<br><a class="src" href="' + L.esc(L.safeUrl(f.s)) + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : "") + "</li>").join("");
    const no = dt.x.no.map((m) => '<li class="no"><b>' + L.esc(m.f) + "</b> — missing<br>" + L.esc(m.w) + "</li>").join("");
    const per = ["aana", "ropani", "sqft", "sqm"].map((u) => "<dt>per " + UNIT_LABEL[u] + "</dt><dd>" + L.esc(L.fmtMoney(L.perUnit(l.p, u, T))) + "</dd>").join("");
    const approx = l.prec === "palika" ? " (palika centre only)" : l.prec === "locality" ? " (approximate)" : "";
    $("dBody").innerHTML =
      '<h2 id="dTitle">' + L.esc(l.t) + "</h2>" +
      '<div class="price">' + L.esc(priceText(l)) + perText(l) + "</div>" +
      '<h3 class="sec">At a glance</h3><ul class="glance">' + L.glance(l, { today: new Date(), unit: S.f.unit, T: T, flags: D.meta.flags }).map((x) => "<li>" + L.esc(x) + "</li>").join("") + "</ul>" +
      '<h3 class="sec">The numbers</h3><dl class="kv"><dt>total</dt><dd>' + L.esc(l.tot ? L.fmtMoney(l.tot) : "n/a") + "</dd><dt>area</dt><dd>" + L.esc(areaText(l)) + "</dd>" +
      (l.p != null ? per : "") + "<dt>place</dt><dd>" + L.esc(placeText(l)) + L.esc(approx) + "</dd>" +
      (l.po ? "<dt>ad dated</dt><dd>" + L.esc(l.po) + "</dd>" : "") + (l.fac ? "<dt>facing</dt><dd>" + L.esc(l.fac) + "</dd>" : "") + "<dt>first found here</dt><dd>" + L.esc(l.fs || "?") + "</dd><dt>last seen listed</dt><dd>" + L.esc(l.ls || "?") + "</dd></dl>" +
      finderCheck(l) +
      '<h3 class="sec">The evidence, factor by factor <small class="foot">(each one cited; nothing is estimated)</small></h3><ul class="factors">' + ok + no + "</ul>" +
      (dt.ask && dt.ask.length ? '<details class="ask"><summary>Before you pay: ' + dt.ask.length + " things to ask or check</summary><ol class=\"factors\">" + L.askHTML(dt.ask) + "</ol></details>" : "") +
      (dt.h && dt.h.length > 1 ? '<h3 class="sec">Price history (NPR/m²)</h3>' + spark(dt.h) : "") +
      '<p><a class="btn btn-primary" href="' + L.esc(L.safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer"><span>View original ad ↗</span></a> ' +
      '<button class="btn btn-outline" type="button" data-star="' + l.id + '" aria-pressed="' + !!S.watch[l.id] + '"><span>' + (S.watch[l.id] ? "★ Saved" : "☆ Save") + "</span></button> " +
      (l.lat != null ? '<button class="btn btn-ghost only-narrow" type="button" data-showmap="' + l.id + '"><span>Show on map</span></button> ' : "") +
      '<button class="btn btn-ghost" type="button" data-copy="1"><span>Copy link</span></button></p>' +
      '<h3 class="sec">Your notes (stored only in this browser)</h3><label class="sr" for="note">Notes</label><textarea id="note" class="notes" placeholder="> road 13ft, owner flexible…"></textarea>';
    const note = $("note"); note.value = store.get("jagga.note." + id, ""); note.addEventListener("input", () => store.set("jagga.note." + id, note.value));
    pinSelected(); showOnMap(l);
    pushHash();
  }
  /** Step through the list as currently filtered and sorted. Beyond the rendered page it loads the next page first. */
  function step(dir) {
    if (!S.sel) return;
    const i = visible.findIndex((l) => l.id === S.sel), j = i + dir;
    if (i < 0 || j < 0 || j >= visible.length) return;
    if (j >= S.shown) { S.shown = Math.min(visible.length, j + 1 + PAGE); renderList(); }
    openDrawer(visible[j].id, true);
  }
  function updateStepper(id) {
    const i = visible.findIndex((l) => l.id === id);
    $("dPos").textContent = i < 0 ? "" : (i + 1) + " / " + visible.length;
    $("dPrev").disabled = i <= 0; $("dNext").disabled = i < 0 || i >= visible.length - 1;
  }
  /** Language: hand the page to Google Translate's proxy (every word, including listings and X-Ray text) rather than a partial dictionary.
   *  Only works from the published github.io address; the link flips to 'English' on the translated copy. */
  function initTranslate() {
    const b = $("btnLang"), h = location.hostname;
    if (h.endsWith(".translate.goog")) {
      b.hidden = false; b.firstElementChild.textContent = "English"; b.removeAttribute("lang");
      b.href = "https://" + h.replace(/\.translate\.goog$/, "").replace(/--/g, "\0").replace(/-/g, ".").replace(/\0/g, "-") + location.pathname + location.hash;
      b.removeAttribute("title");
    } else if (h.endsWith(".github.io")) {
      b.hidden = false;
      b.href = "https://" + h.replace(/-/g, "--").replace(/\./g, "-") + ".translate.goog" + location.pathname + "?_x_tr_sl=en&_x_tr_tl=ne&_x_tr_hl=en&_x_tr_pto=wapp" + location.hash;
    }
  }
  function closeDrawer() {
    $("drawer").hidden = true; document.body.classList.remove("sel-open"); settleMap(); S.sel = null; pinSelected(); document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
    if (S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus(); pushHash();
  }

  // ---------- modals ----------
  function openModal(title, html) { $("mTitle").textContent = "> " + title; $("mBody").innerHTML = html; $("modal").showModal(); }
  function coverageHTML() {
    const m = D.meta, n = m.nation, max = Math.max.apply(null, m.districts.map((d) => d.n).concat([1]));
    const have = new Set(m.districts.map((d) => d.district_id));
    return "<p><b>" + n.districts[0] + " of " + n.districts[1] + "</b> districts and <b>" + n.palikas[0] + " of " + n.palikas[1] + "</b> local levels have any listing. " +
      n.land_for_sale + " land-for-sale listings, " + n.priced + " with a derived price.</p>" +
      "<h3 class=\"sec\">Sources</h3><table><tr><th>source</th><th class=n>listings</th><th>last seen</th><th>last fetched</th></tr>" +
      m.sources.map((s) => "<tr><td>" + L.esc(s.source) + '</td><td class="n">' + s.n + "</td><td>" + L.esc(s.last_seen || "never") + "</td><td>" + L.esc(s.last_fetch || "never") + "</td></tr>").join("") + "</table>" +
      "<h3 class=\"sec\">Districts with data</h3><table><tr><th>district</th><th class=n>n</th><th class=n>priced</th><th class=n>palika</th><th class=n>road</th><th></th></tr>" +
      m.districts.map((d) => "<tr><td>" + L.esc(d.district) + '</td><td class="n">' + d.n + '</td><td class="n">' + d.priced + '</td><td class="n">' + d.with_palika + '</td><td class="n">' + d.with_road + '</td><td><span class="bar" style="width:' + Math.max(2, Math.round(d.n / max * 100)) + 'px"></span></td></tr>').join("") + "</table>" +
      "<h3 class=\"sec\">No data</h3><p>" + L.esc(m.all_districts.filter((d) => !have.has(d.id)).map((d) => d.name).join(", ")) + "</p>" +
      "<p class=\"foot\">No data means not crawled or nothing found there. It is <b>not</b> evidence that no land is for sale.</p>";
  }
  function aboutHTML() {
    const m = D.meta;
    return "<p>A personal screening tool for Nepali land. Listings are gathered from public classifieds portals; each links back to the original ad. Contact details, photos and full descriptions are not republished.</p>" +
      '<h3 class="sec">How to read it</h3><p>There is no single score. Each ad has a fact-check (the “X-Ray”) made of separate factors, each with its source. A factor with no data is shown as <b>missing</b>, never estimated. “Similar ads” (comps) are other ads of similar size, nearest first (same municipality, then a radius, then the district); a district-wide comparison is marked <b>weak</b>.</p>' +
      '<h3 class="sec">My finder</h3><p>Say what you want: districts, size, budget, a road, ground elevation, places to be near (a palika, a landmark, or any point you click on the map), distance to a city, how recently posted, price against comparable ads, and what the ad says (a view, farming, water…). Each criterion is a <b>must</b> or a <b>nice to have</b> and is judged pass, fail or <b>unknown</b>; the funnel shows where ads drop out and how many more would match if you relaxed one. Your criteria stay in this browser. There is no score.</p>' +
      '<h3 class="sec">Units</h3><p>Every price is stored as NPR per m² and only shown in the unit you pick. Hill and Terai units are not interchangeable by eye: 1 aana ≈ 1.88 dhur. Positional notation like 2-10-5 is shown only where the district’s system is known.</p>' +
      '<h3 class="sec">Government valuation</h3><p>' + (m.govt_valuation_rows ? m.govt_valuation_rows + " real rate rows are loaded" + (m.govt_valuation_sources.indexOf("news") >= 0 ? ", <b>partial</b>: taken from a news report of the committee’s decision and covering only some Kathmandu-valley road segments. Everywhere else the comparison is shown as missing." : ".") : "<b>No real government minimum-valuation data is loaded yet</b>, so that comparison is shown as missing everywhere.") + " Minimum valuations are set per district by a committee chaired by the Chief District Officer.</p>" +
      '<h3 class="sec">Not advice</h3><p>This is a screening tool. Check the lalpurja, the napi naksa, a physical visit with the neighbours, and the current malpot rate before paying anything.</p>' +
      '<h3 class="sec">Data and credits</h3><p>Boundaries: Survey Department of Nepal via UN OCHA / HDX (CC BY-IGO). Places: GeoNames (CC BY 4.0). Map tiles: © OpenStreetMap contributors. Leaflet (BSD-2). Fonts Orbitron and Share Tech Mono (OFL).</p>' +
      "<p class=\"foot\">Built " + L.esc(m.built_at) + ".</p>";
  }
  function watchHTML() {
    const ids = Object.keys(S.watch).filter((i) => byId.has(i));
    if (!ids.length) return '<p class="empty">Nothing saved yet. Tap ☆ Save on a plot to shortlist it. Saved plots and notes live only in this browser; export them to keep a copy.</p>';
    return "<table><tr><th>listing</th><th class=n>price</th><th>note</th></tr>" + ids.map((i) => { const l = byId.get(i), n = store.get("jagga.note." + i, "");
      return '<tr><td><button class="btn btn-ghost" type="button" data-open="' + i + '"><span>' + L.esc(l.t.slice(0, 48)) + '</span></button></td><td class="n">' + L.esc(priceText(l)) + "</td><td>" + L.esc(n.slice(0, 80)) + "</td></tr>"; }).join("") + "</table>" +
      '<p><button class="btn btn-primary" type="button" id="wPrint"><span>Print shortlist</span></button> <button class="btn btn-outline" type="button" id="wExport"><span>Export JSON</span></button> <label class="btn btn-outline" style="display:inline-block"><span>Import JSON</span><input id="wImport" type="file" accept="application/json" class="sr"></label></p>';
  }

  // ---------- downloads ----------
  function download(name, mime, text) {
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: mime }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function doExport(kind) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    if (kind === "csv") download("jaggasignal-" + stamp + ".csv", "text/csv", L.toCSV(visible));
    else if (kind === "geojson") download("jaggasignal-" + stamp + ".geojson", "application/geo+json", JSON.stringify(L.toGeoJSON(visible)));
    else download("jaggasignal-" + stamp + ".kml", "application/vnd.google-earth.kml+xml", L.toKML(visible));
  }

  // ---------- events ----------
  function toggleWatch(id) {
    if (S.watch[id]) delete S.watch[id]; else { S.watch[id] = "watching"; loadDetail([id]).catch(() => {}); }          // saved now, so the shortlist works offline later
    store.set("jagga.watch", S.watch); $("watchCount").textContent = Object.keys(S.watch).length; renderList();
    if (S.sel === id) openDrawer(id);
  }
  function refresh() { readUI(); S.shown = PAGE; S.fitNext = true; renderList(); }
  function syncTopHeight() {            // header height varies with viewport; the map pane and drawer anchor to it
    const h = document.querySelector("header.top").getBoundingClientRect().height;
    document.documentElement.style.setProperty("--top-h", Math.round(h) + "px"); if (map) map.invalidateSize();
  }
  // ---------- saved searches (browser-local; the filter state is already a URL hash, so a search is just that string) ----------
  const saved = () => store.get("jagga.saved", {});
  function renderSaved() {
    const sel = $("savedSel"), cur = sel.value, all = saved();
    sel.innerHTML = '<option value="">Saved searches…</option>' + Object.keys(all).sort().map((n) => '<option value="' + L.esc(n) + '">' + L.esc(n) + "</option>").join("");
    sel.value = all[cur] !== undefined ? cur : "";
  }
  function savedHTML() {
    const names = Object.keys(saved()).sort();
    return '<form id="saveForm"><label for="saveName">Name this search (the current filters)</label>' +
      '<p><input id="saveName" class="notes" style="min-height:0;height:44px" maxlength="60" placeholder="e.g. 4 aana near Chabahil under 30 lakh" autocomplete="off"></p>' +
      '<p><button class="btn btn-primary" type="submit"><span>Save</span></button></p></form>' +
      (names.length ? '<h3 class="sec">Your saved searches</h3><table>' + names.map((n) => "<tr><td>" + L.esc(n) + '</td><td><button class="btn btn-ghost" type="button" data-delsaved="' + L.esc(n) + '"><span>Delete</span></button></td></tr>').join("") + "</table>" : "") +
      '<p class="foot">Stored only in this browser. Copy the page address to share a search; it contains the filters.</p>';
  }
  // ---------- compare (up to 3) ----------
  function toggleCompare(id) {
    const i = S.cmp.indexOf(id);
    if (i >= 0) S.cmp.splice(i, 1); else if (S.cmp.length < 3) S.cmp.push(id); else { $("cmpCount").textContent = "3 max"; setTimeout(() => { $("cmpCount").textContent = S.cmp.length; }, 1200); return; }
    $("cmpCount").textContent = S.cmp.length; renderList();
  }
  function compareHTML() {
    const ls = S.cmp.map((i) => byId.get(i)).filter(Boolean);
    if (ls.length < 2) return '<p class="empty">Pick two or three listings with “compare” on their cards, then open this again.</p>';
    const row = (label, fn) => "<tr><th scope=\"row\">" + label + "</th>" + ls.map((l) => "<td>" + fn(l) + "</td>").join("") + "</tr>";
    const factor = (l, name) => { const x = detailOf(l.id).x, f = x.ok.find((q) => q.f === name); return f ? L.esc(f.d) : (x.no.find((q) => q.f === name) ? "<i>missing</i>" : "–"); };
    return '<table class="cmp-table"><thead><tr><th></th>' + ls.map((l) => '<th scope="col"><button class="btn btn-ghost" type="button" data-open="' + l.id + '"><span>' + L.esc(l.t.slice(0, 34)) + "</span></button></th>").join("") + "</tr></thead><tbody>" +
      row("price /" + UNIT_LABEL[S.f.unit], (l) => L.esc(priceText(l))) + row("total", (l) => L.esc(l.tot ? L.fmtMoney(l.tot) : "n/a")) +
      row("area", (l) => L.esc(areaText(l))) + row("road", (l) => (l.road ? l.road + " ft" : "–")) + row("place", (l) => L.esc(placeText(l))) +
      row("vs comps", (l) => L.esc(L.compsLabel(l.c) || "no comps")) + row("govt valuation", (l) => factor(l, "vs government minimum valuation")) +
      row("time on market", (l) => factor(l, "time on market")) + row("infrastructure", (l) => factor(l, "infrastructure nearby")) +
      row("source", (l) => '<a href="' + L.esc(L.safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">' + L.esc(l.src) + " ↗</a>") + "</tbody></table>";
  }
  // ---------- printable shortlist: a plain light page of the starred listings, their cited X-Ray and your own notes ----------
  function shortlistHTML(ids) {
    const rows = ids.map((id) => {
      const l = byId.get(id), dt = detailOf(id), note = store.get("jagga.note." + id, "");
      const ok = dt.x.ok.map((f) => "<li><b>" + L.esc(f.f) + "</b>: " + L.esc(f.d) + "</li>").join("");
      const no = dt.x.no.map((m) => "<li class=\"no\"><b>" + L.esc(m.f) + "</b>: missing, " + L.esc(m.w) + "</li>").join("");
      return "<section><h2>" + L.esc(l.t) + "</h2><p class=\"big\">" + L.esc(priceText(l)) + (l.p != null ? " /" + UNIT_LABEL[S.f.unit] : "") + (l.tot && l.p != null ? " · total " + L.esc(L.fmtMoney(l.tot)) : "") + "</p>" +
        "<p>" + L.esc(areaText(l)) + " · " + L.esc(placeText(l)) + (l.road ? " · " + l.road + " ft road" : "") + (l.po ? " · ad dated " + L.esc(l.po) : "") + "</p>" +
        "<ul>" + ok + no + "</ul>" + (dt.ask && dt.ask.length ? "<h3>Before you pay: ask and check</h3><ol class=\"ask\">" + L.askHTML(dt.ask, "why") + "</ol>" : "") + (note ? "<p class=\"note\"><b>My notes:</b> " + L.esc(note) + "</p>" : "") +
        "<p class=\"src\">Original ad: " + L.esc(L.safeUrl(l.url)) + "</p></section>";
    }).join("");
    return "<!doctype html><meta charset=\"utf-8\"><title>Shortlist</title><style>body{font:13px/1.45 Georgia,serif;max-width:780px;margin:20px auto;padding:0 14px;color:#111}" +
      "h1{font:700 20px sans-serif}h2{font:700 15px sans-serif;margin:0}section{border-top:2px solid #111;padding:10px 0;break-inside:avoid}.big{font:700 17px sans-serif;margin:2px 0}" +
      "ul,ol{margin:6px 0;padding-left:18px}h3{font:700 13px sans-serif;margin:10px 0 2px}.who{font:700 10px sans-serif;text-transform:uppercase;border:1px solid #111;padding:0 4px;margin-right:4px}.why{display:block;color:#555;font-size:11px}.no{color:#666}.note{background:#f3f3f3;padding:6px 8px}.src{font-size:11px;color:#444;word-break:break-all}.fine{font-size:11px;color:#444}</style>" +
      "<h1>Land shortlist (" + ids.length + ")</h1><p class=\"fine\">Printed " + new Date().toISOString().slice(0, 10) + " from the Jaggasignal screening tool. Screening only, not advice: check the lalpurja, napi naksa, a site visit and the current malpot rate. Prices are asking prices.</p>" + rows;
  }
  function printShortlist() {
    const ids = Object.keys(S.watch).filter((i) => byId.has(i));
    if (!ids.length) return;
    const w = window.open("", "_blank");
    if (!w) { $("mBody").insertAdjacentHTML("afterbegin", '<p class="empty">Your browser blocked the print window. Allow pop-ups for this site and try again.</p>'); return; }
    w.document.write("<p>Preparing…</p>");
    loadDetail(ids).then(() => { w.document.open(); w.document.write(shortlistHTML(ids)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); },
      () => { w.document.body.textContent = "Could not load the listing details."; });
  }
  function copyLink() {
    const done = () => { $("dBody").insertAdjacentHTML("afterbegin", '<p class="judge" role="status">Link copied.</p>'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, () => window.prompt("Copy this link:", location.href));
    else window.prompt("Copy this link:", location.href);
  }

  // ---------- my finder: the panel, in the visitor's browser ----------
  const fctx = () => ({ table: T, flags: FLAGS, today: new Date() });
  function loadProfile() {
    const m = /(?:^|&)fp=([A-Za-z0-9_-]+)/.exec(location.hash.slice(1)), raw = m ? m[1] : store.get("jagga.profile", "");
    return raw ? F.decode(raw, FLAGS) : F.ensureRows(F.defaultProfile(), FLAGS);
  }
  function saveProfile() { store.set("jagga.profile", F.activeIds(S.profile, FLAGS).length ? F.encode(S.profile) : ""); }
  function recomputeFinder() {
    FR = S.fon && F.activeIds(S.profile, FLAGS).length ? F.run(D.listings, S.profile, fctx()) : null;
    FRMAP = new Map(FR ? FR.items.map((it) => [it.l.id, it]) : []);
    $("finderCount").textContent = FR ? "· " + FR.counts[3] + " match" : "";
    drawAnchors();
  }
  /** The places chosen under "near": a circle each, so the radius is visible on the map. */
  function drawAnchors() {
    if (!layerA) return;
    layerA.clearLayers();
    const r = S.profile.rows.near;
    if (!FR || !r || !r.on) return;
    r.places.forEach((p) => window.L.circle([p.lat, p.lon], { radius: p.km * 1000, color: "#ff00ff", weight: 1, dashArray: "5 5", fillOpacity: 0.05, interactive: false }).addTo(layerA)
      && window.L.circleMarker([p.lat, p.lon], { radius: 4, color: "#ff00ff", fillColor: "#ff00ff", fillOpacity: 1, interactive: false }).bindTooltip(L.esc(p.n) + ": " + p.km + " km", { permanent: false }).addTo(layerA));
  }
  function loadPlaces() {
    if (PLACES) return Promise.resolve(PLACES);
    if (!placesP) placesP = new Promise((res, rej) => {
      const sc = document.createElement("script"); sc.src = "places.js";
      sc.onload = () => { PLACES = window.JAGGA_PLACES || []; res(PLACES); };
      sc.onerror = () => { placesP = null; rej(new Error("places unavailable")); };
      document.head.appendChild(sc);
    });
    return placesP;
  }
  const placeLabel = (p) => p[0] + (p[1] === "landmark" ? " (landmark)" : p[1] ? " (" + p[1] + ")" : "");
  const dname = (id) => (D.meta.districts.find((d) => d.district_id === id) || { district: id }).district;

  function rowHTML(id) {
    const r = S.profile.rows[id], def = F.ROWS.find((x) => x.id === id), flag = id.slice(0, 5) === "flag_" ? FLAGS.find((f) => "flag_" + f.k === id) : null;
    const label = flag ? "The ad mentions: " + flag.label : def.label;
    const num = (p, ph, w) => '<input class="num" inputmode="decimal" data-fr="' + id + '" data-fp="' + p + '" value="' + L.esc(r[p]) + '" placeholder="' + ph + '" aria-label="' + L.esc(label + ": " + (w || p)) + '">';
    const unit = (p, opts) => '<select data-fr="' + id + '" data-fp="' + p + '" aria-label="unit">' + opts.map((u) => "<option" + (r[p] === u ? " selected" : "") + ">" + u + "</option>").join("") + "</select>";
    let body = "";
    if (id === "where") {
      body = '<div class="chips">' + r.dis.map((d) => '<span class="pchip">' + L.esc(dname(d)) + '<button type="button" data-rmdis="' + L.esc(d) + '" aria-label="Remove ' + L.esc(dname(d)) + '">✕</button></span>').join("") + "</div>" +
        '<select data-adddis="1" aria-label="Add a district"><option value="">Add a district…</option>' + D.meta.districts.filter((d) => r.dis.indexOf(d.district_id) < 0).map((d) => '<option value="' + L.esc(d.district_id) + '">' + L.esc(d.district) + " (" + d.n + ")</option>").join("") + "</select>";
    } else if (id === "size") body = "from " + num("min", "min") + " to " + num("max", "max") + " " + unit("unit", ["ropani", "aana", "kattha", "dhur", "bigha", "sqm"]);
    else if (id === "budget") body = "total up to Rs " + num("total", "any", "total price up to") + " &nbsp;or per " + unit("punit", ["aana", "ropani", "kattha", "dhur", "sqft", "sqm"]) + " up to Rs " + num("pmax", "any", "price per unit up to");
    else if (id === "road") body = num("min", "ft") + " ft wide";
    else if (id === "hills") body = "from " + num("min", "min") + " to " + num("max", "max") + " m above sea level" + '<span class="hint">Kathmandu valley floor ≈ 1,300 m; Chitwan plain ≈ 200 m; Nuwakot hills 700 m and up. Where only the palika is known, the whole palika must agree.</span>';
    else if (id === "near") {
      body = '<div class="chips">' + r.places.map((p, i) => '<span class="pchip">' + L.esc(p.n) + ' within <input class="num" inputmode="decimal" data-place="' + i + '" value="' + p.km + '" aria-label="Kilometres from ' + L.esc(p.n) + '"> km<button type="button" data-rmplace="' + i + '" aria-label="Remove ' + L.esc(p.n) + '">✕</button></span>').join("") + "</div>" +
        '<input data-addplace="1" list="placeList" placeholder="type a place: Nuwakot Durbar, Bandipur, Pokhara…" aria-label="Add a place to be near" style="flex:1;min-width:180px"><datalist id="placeList"></datalist>' +
        '<button class="btn btn-outline" type="button" data-pick="1" style="min-height:36px"><span>＋ point on the map</span></button>' +
        '<span class="hint">Any of these places will do. Where an ad is located only to its palika centre, a tight radius is "unknown", not a guess.</span>';
    } else if (id === "city") body = "within " + num("km", "km") + " km of a metropolitan or sub-metropolitan city";
    else if (id === "fresh") body = "within " + num("days", "days") + " days, by the portal's own posting date" + '<span class="hint">Ads stay listed for years, so this hides ads that are still live. An ad that is only dated "updated" is unknown.</span>';
    else if (id === "value") body = "at or below the " + num("pct", "25", "percentile") + "th percentile of comparable ads";
    else if (id === "trust") body = "the price reading is high confidence (unit stated, area read cleanly)";
    return '<section class="fr ' + (r.on ? "on" : "off") + '" data-row="' + id + '"><header><label><input type="checkbox" data-fr="' + id + '" data-fp="on"' + (r.on ? " checked" : "") + "> <b>" + L.esc(label) + "</b></label>" +
      '<select data-fr="' + id + '" data-fp="must" aria-label="' + L.esc(label) + ' is a"><option value="1"' + (r.must ? " selected" : "") + '>must</option><option value="0"' + (r.must ? "" : " selected") + ">nice to have</option></select></header>" +
      (body ? '<div class="body">' + body + "</div>" : "") + "</section>";
  }
  function renderFinderForm() {
    const groups = {};
    F.ROWS.forEach((r) => { (groups[r.group] = groups[r.group] || []).push(r.id); });
    $("fBody").innerHTML = '<div id="fSum" class="f-sum"></div>' +
      '<h3>Start from</h3><div class="presets">' + F.PRESETS.map((p) => '<button class="btn btn-outline" type="button" data-preset="' + p.id + '" title="' + L.esc(p.blurb) + '"><span>' + L.esc(p.label) + "</span></button>").join("") +
      '<button class="btn btn-ghost" type="button" data-fclear="1"><span>Clear</span></button></div>' +
      Object.keys(groups).map((g) => "<h3>" + L.esc(g) + "</h3>" + groups[g].map(rowHTML).join("")).join("") +
      "<h3>What the ad says</h3>" + FLAGS.map((f) => rowHTML("flag_" + f.k)).join("") +
      '<div class="f-foot"><label class="chip check"><input id="fOn" type="checkbox"' + (S.fon ? " checked" : "") + '><span>Filter the list with my finder</span></label>' +
      '<button class="btn btn-outline" type="button" data-fcopy="1"><span>Copy link to this finder</span></button></div>' +
      '<p class="foot">Your criteria stay in this browser. They travel only in a link you copy. There is no score: each criterion is pass, fail or unknown, and a "must" is what decides the tier.</p>';
    renderFinderSummary();
    if (S.profile.rows.near.on) loadPlaces().then((ps) => { const dl = $("placeList"); if (dl) dl.innerHTML = ps.map((p) => '<option value="' + L.esc(placeLabel(p)) + '">').join(""); }, () => {});
  }
  function renderFinderSummary() {
    const el = $("fSum"); if (!el) return;
    if (!FR) { el.innerHTML = '<div class="foot" style="border:0;margin:0;padding:0">' + (F.activeIds(S.profile, FLAGS).length ? "Turned off: the list shows every ad." : "Tick what matters to you below, or start from an example. The list narrows as you go and says why.") + "</div>"; return; }
    const c = FR.counts, tier = (n, label) => '<button type="button" data-tier="' + n + '" aria-pressed="' + !!S.tiers[n] + '">' + label + " <b>" + c[n] + "</b></button>";
    const max = Math.max(1, FR.funnel[0].left);
    const gains = FR.relax.filter((x) => x.gain > 0 && FR.counts[3] < 200).sort((a, b) => b.gain - a.gain);
    el.innerHTML = '<div class="tiers" role="group" aria-label="Show in the list">' + tier(3, "match") + tier(2, "possible") + tier(1, "near miss") + "</div>" +
      (c[3] === 0 ? '<p class="judge" role="status" style="margin:8px 0 0">No ad meets every must-have. The funnel shows where they drop out' + (gains.length ? "; each button below shows how many more would match if you relaxed one." : ".") + "</p>" : "") +
      '<details class="funnel" open><summary>Why this many? The must-haves, one after another</summary><ol>' +
      FR.funnel.map((f, i) => '<li' + (f.left === 0 ? ' class="zero"' : "") + "><span>" + (i ? "+ " : "") + L.esc(f.label) + (f.unknown ? " <small>(" + f.unknown + " unknown)</small>" : "") + '</span><b>' + f.left + '</b><span class="bar" style="width:' + Math.max(1, Math.round(f.left / max * 100)) + '%"></span></li>').join("") + "</ol></details>" +
      (gains.length ? '<div class="relax" role="group" aria-label="Relax a must-have">' + gains.map((g) => '<button class="btn btn-outline" type="button" data-relax="' + L.esc(g.id) + '" title="Make this a nice-to-have instead of a must"><span>Drop “' + L.esc(g.label) + "” → +" + g.gain + " match" + (g.gain === 1 ? "" : "es") + "</span></button>").join("") + "</div>" : "");
  }
  function finderChanged(structural) {
    saveProfile(); recomputeFinder();
    if (structural) renderFinderForm(); else renderFinderSummary();
    S.shown = PAGE; S.fitNext = true; renderList();
  }
  function openFinder() {
    if (!$("drawer").hidden) closeDrawer();
    $("finder").hidden = false; document.body.classList.add("finder-open"); settleMap(); $("btnFinder").setAttribute("aria-expanded", "true"); renderFinderForm();
    const first = $("fBody").querySelector("input,select"); if (first) first.focus();
  }
  function hideFinder() { $("finder").hidden = true; document.body.classList.remove("finder-open"); settleMap(); $("btnFinder").setAttribute("aria-expanded", "false"); }
  function closeFinder() { hideFinder(); $("btnFinder").focus(); }
  function addPlace(p) {
    const r = S.profile.rows.near; if (r.places.length >= F.MAX_PLACES || r.places.some((x) => x.n === p.n && x.lat === p.lat && x.lon === p.lon)) return;
    r.places.push(p); r.on = true; finderChanged(true);
  }
  function onMapClick(e) {
    if (!S.pick) return;
    S.pick = false; document.body.classList.remove("picking");
    addPlace({ n: "a point on the map", lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4), km: 10 });
    if (window.matchMedia("(max-width: 900px)").matches) $("tabList").click();
    openFinder();
  }
  function startPick() {
    S.pick = true; document.body.classList.add("picking"); hideFinder();
    if (window.matchMedia("(max-width: 900px)").matches) $("tabMap").click();
    $("resultsHead").textContent = "Click the map to place the point (Esc to cancel)";
  }
  function finderEvents() {
    const root = $("fBody");
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.place !== undefined) { const p = S.profile.rows.near.places[+t.dataset.place]; if (p && +t.value > 0) { p.km = Math.min(500, +t.value); finderChanged(false); } return; }
      if (!t.dataset.fr || t.type === "checkbox" || t.tagName === "SELECT") return;
      S.profile.rows[t.dataset.fr][t.dataset.fp] = t.value; finderChanged(false);
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "fOn") { S.fon = t.checked; store.set("jagga.fon", S.fon); finderChanged(false); return; }
      if (t.dataset.adddis && t.value) { S.profile.rows.where.dis.push(t.value); S.profile.rows.where.on = true; finderChanged(true); return; }
      if (t.dataset.addplace) {
        const p = (PLACES || []).find((x) => placeLabel(x) === t.value);
        if (p) { addPlace({ n: p[0], lat: p[2], lon: p[3], km: 15 }); const i = $("fBody").querySelector("[data-addplace]"); if (i) i.focus(); }
        return;
      }
      if (!t.dataset.fr || (t.tagName === "INPUT" && t.type !== "checkbox")) return;          // typed values are taken on 'input'; redrawing on blur would eat the click that caused the blur
      const row = S.profile.rows[t.dataset.fr], p = t.dataset.fp;
      if (p === "on") row.on = t.checked; else if (p === "must") row.must = t.value === "1"; else row[p] = t.value;
      finderChanged(p === "on");
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (d.preset) { S.profile = F.applyPreset(d.preset, FLAGS); S.fon = true; store.set("jagga.fon", true); finderChanged(true); }
      else if (d.fclear) { S.profile = F.ensureRows(F.defaultProfile(), FLAGS); finderChanged(true); }
      else if (d.tier) { S.tiers[d.tier] = !S.tiers[d.tier]; renderFinderSummary(); S.shown = PAGE; renderList(); }
      else if (d.relax) { S.profile.rows[d.relax].must = false; finderChanged(true); }
      else if (d.rmdis) { const r = S.profile.rows.where; r.dis = r.dis.filter((x) => x !== d.rmdis); finderChanged(true); }
      else if (d.rmplace) { S.profile.rows.near.places.splice(+d.rmplace, 1); finderChanged(true); }
      else if (d.pick) startPick();
      else if (d.fcopy) { pushHash(); copyLink(); }
    });
  }
  /** Field mode: keep the shell, data and opened listings on the device, say so when offline, and save the details of starred plots before you go. */
  function initOffline() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) navigator.serviceWorker.register("sw.js").catch(() => {});
    const note = () => {
      const b = $("netBanner"); b.hidden = navigator.onLine;
      b.textContent = navigator.onLine ? "" : "Offline: showing what was saved on this device (built " + D.meta.built_at + "). Listings you have opened and your saved plots work; map tiles and new ads need a connection.";
    };
    window.addEventListener("online", note); window.addEventListener("offline", note); note();
    const starred = Object.keys(S.watch).filter((i) => byId.has(i));
    if (navigator.onLine && starred.length) loadDetail(starred).catch(() => {});
  }
  /** One honest line about how old the data is, computed when the page is opened: it keeps growing if the nightly crawl stops. */
  function renderFresh() {
    const f = L.freshness(D.meta.refresh, new Date()), el = $("freshLine");
    if (!f) { el.hidden = true; return; }
    el.hidden = false; el.classList.toggle("stale", f.stale); el.textContent = (f.stale ? "⚠ " : "● ") + f.text; el.title = f.detail;
  }
  /** "New since your last visit": by the date the PORTAL gives the ad, never by when WE first found it (a sweep can find hundreds of old ads in a day).
   *  Older ads that were merely found since are counted apart. The narrowing stays visible on the banner. */
  function renderSince() {
    const b = $("sinceBanner"), prev = SINCE; if (!prev) { b.hidden = true; return; }
    const live = D.listings.filter((l) => !l.dup), n = live.filter((l) => L.postedSince(l, prev)).length;
    const found = live.filter((l) => l.fs && l.fs > prev && !L.postedSince(l, prev)).length, on = !!S.f.since;
    b.hidden = !n && !found; if (b.hidden) return;
    const older = found ? " " + found + " older ad" + (found === 1 ? " was" : "s were") + " also newly found by this tool: they are in the list, dated as the portal dates them." : "";
    b.innerHTML = (on ? "<span>Showing only the <b>" + n + "</b> ad" + (n === 1 ? "" : "s") + " the portals posted since your last visit on " + L.esc(prev) + "." + older + "</span>"
        : n ? "<span><b>" + n + "</b> ad" + (n === 1 ? "" : "s") + " posted since your last visit on " + L.esc(prev) + ", by the portal's own date." + older + "</span>"
        : "<span>No ad was posted since your last visit on " + L.esc(prev) + "." + older + "</span>") +
      (on ? '<button class="btn btn-outline" type="button" id="sinceAll" style="min-height:34px"><span>Show all</span></button>'
        : n ? '<button class="btn btn-outline" type="button" id="sinceOnly" style="min-height:34px"><span>Show only these</span></button>' : "");
    const go = $(on ? "sinceAll" : "sinceOnly");
    if (go) go.addEventListener("click", () => { if (on) delete S.f.since; else S.f.since = prev; renderSince(); refresh(); });
  }
  function initSince() {
    const today = new Date().toISOString().slice(0, 10), prev = store.get("jagga.lastVisit", null);
    store.set("jagga.lastVisit", today);
    SINCE = prev && prev < today ? prev : null;
    renderSince();
  }

  function init() {
    D.meta.districts.forEach((d) => $("fDis").insertAdjacentHTML("beforeend", '<option value="' + L.esc(d.district_id) + '">' + L.esc(d.district) + " (" + d.n + ")</option>"));
    D.meta.sources.forEach((s) => $("fSrc").insertAdjacentHTML("beforeend", '<option value="' + L.esc(s.source) + '">' + L.esc(s.source) + " (" + s.n + ")</option>"));
    const cuts = D.listings.filter((l) => L.isCut(l)).length;     // honest filter: no genuine seller price cut observed yet => say so
    if (!cuts) { $("fCut").disabled = true; $("fCut").parentElement.title = "No seller price cut has been observed yet; this fills in as listings are re-checked over time."; $("fCut").nextElementSibling.textContent = "Price cut (none seen yet)"; }
    S.profile = loadProfile(); S.tiers = { 3: true, 2: true, 1: false }; S.fon = store.get("jagga.fon", true); S.pick = false;
    Object.assign(S.f, L.parseHash(location.hash));
    if (S.f.fresh) { S.f.age = "7"; delete S.f.fresh; }          // old shared links used fresh=1 ("new this week")
    writeUI();
    $("watchCount").textContent = Object.keys(S.watch).length;
    $("foot").innerHTML = "Built " + L.esc(D.meta.built_at) + " · " + D.meta.sources.map((s) => L.esc(s.source) + " fetched " + L.esc(s.last_fetch || "never")).join(" · ") +
      ' · <button class="btn btn-ghost" type="button" data-cov="1"><span>' + D.meta.nation.districts[0] + "/" + D.meta.nation.districts[1] + " districts covered</span></button><br>Screening tool, not advice.";
    initMap(); recomputeFinder(); initSince(); renderFresh(); initOffline(); syncTopHeight(); window.addEventListener("resize", debounce(syncTopHeight, 100)); readUI(); renderList();
    const want = hashState(); if (want && byId.has(want)) openDrawer(want, false);

    ["fDis", "fSrc", "fUnit", "fAunit", "fSort", "fAge", "fCut", "fDups"].forEach((id) => $(id).addEventListener("change", refresh));
    finderEvents(); $("btnFinder").addEventListener("click", () => ($("finder").hidden ? openFinder() : closeFinder())); $("fClose").addEventListener("click", closeFinder);
    ["fPmin", "fPmax", "fAmin", "fAmax", "fRoad"].forEach((id) => $(id).addEventListener("input", debounce(refresh, 250)));
    $("q").addEventListener("input", debounce(refresh, 200)); $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); refresh(); });
    $("fMapOnly").addEventListener("change", () => { S.shown = PAGE; renderList(); });
    $("histSvg").addEventListener("click", (e) => {
      const r = e.target.closest("rect"); if (!r) return;
      const round = (x) => String(+(x >= 1000 ? Math.round(x / 100) * 100 : x.toPrecision(2)));
      S.f.pmin = round(+r.dataset.lo); S.f.pmax = round(+r.dataset.hi); writeUI(); refresh();
    });
    $("btnFilters").addEventListener("click", () => {
      const open = document.body.classList.toggle("filters-open"); $("btnFilters").setAttribute("aria-expanded", open); syncTopHeight();
    });
    document.addEventListener("click", (e) => { if (e.target.closest("#emptyReset")) $("btnReset").click(); });
    if (!store.get("jagga.welcomed", false) && !hashState() && !/(?:^|&)fp=/.test(location.hash.slice(1))) $("welcome").hidden = false;
    $("welcomeOk").addEventListener("click", () => { $("welcome").hidden = true; store.set("jagga.welcomed", true); });
    $("btnReset").addEventListener("click", () => { S.f = { unit: "aana", aunit: "aana", sort: "new" }; renderSince(); S.profile = F.ensureRows(F.defaultProfile(), FLAGS); saveProfile(); recomputeFinder(); writeUI(); if (!$("finder").hidden) renderFinderForm(); refresh(); });
    $("btnMore").addEventListener("click", () => { S.shown += PAGE; renderList(); });
    $("lyL").addEventListener("change", (e) => map && (e.target.checked ? layerL.addTo(map) : map.removeLayer(layerL)));
    $("lyB").addEventListener("change", (e) => map && (e.target.checked ? layerB.addTo(map).bringToBack() : map.removeLayer(layerB)));
    $("lyC").addEventListener("change", (e) => map && (e.target.checked ? layerC.addTo(map) : map.removeLayer(layerC)));
    $("dClose").addEventListener("click", closeDrawer); $("mClose").addEventListener("click", () => $("modal").close());
    $("btnCoverage").addEventListener("click", () => openModal("coverage", coverageHTML()));
    $("btnAbout").addEventListener("click", () => openModal("about", aboutHTML()));
    $("btnCompare").addEventListener("click", () => { openModal("compare", '<p class="foot" role="status">Loading…</p>'); loadDetail(S.cmp).then(() => { $("mBody").innerHTML = compareHTML(); }, () => { $("mBody").innerHTML = '<p class="empty">Could not load the details.</p>'; }); });
    renderSaved();
    $("savedSel").addEventListener("change", (e) => {
      const h = saved()[e.target.value]; if (h === undefined) return;
      S.f = Object.assign({ unit: "aana", aunit: "aana", sort: "new" }, L.parseHash("#" + h)); writeUI(); refresh();
    });
    $("btnSave").addEventListener("click", () => { openModal("save search", savedHTML()); $("saveName").focus(); });
    $("btnWatch").addEventListener("click", () => openModal("saved plots", watchHTML()));
    $("tabList").addEventListener("click", () => { document.body.classList.remove("show-map"); $("tabList").classList.add("on"); $("tabMap").classList.remove("on"); });
    $("tabMap").addEventListener("click", () => { document.body.classList.add("show-map"); $("tabMap").classList.add("on"); $("tabList").classList.remove("on"); if (map) setTimeout(() => map.invalidateSize(), 50); });
    initTranslate();
    $("dPrev").addEventListener("click", () => step(-1)); $("dNext").addEventListener("click", () => step(1));
    document.addEventListener("keydown", (e) => {
      if ($("drawer").hidden || $("modal").open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) return;
      if (e.key === "j" || e.key === "J") { e.preventDefault(); step(1); } else if (e.key === "k" || e.key === "K") { e.preventDefault(); step(-1); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || $("modal").open) return;
      if (S.pick) { S.pick = false; document.body.classList.remove("picking"); renderList(); openFinder(); }
      else if (!$("finder").hidden) closeFinder();
      else if (!$("drawer").hidden) closeDrawer();
    });
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-star],[data-cmp],[data-open],[data-showmap],[data-cov],[data-export],.card"); if (!t) return;
      if (t.dataset.cmp) { e.stopPropagation(); toggleCompare(t.dataset.cmp); }
      else if (t.dataset.star) { e.stopPropagation(); toggleWatch(t.dataset.star); }
      else if (t.dataset.open) { if ($("modal").open) $("modal").close(); openDrawer(t.dataset.open, false); }
      else if (t.dataset.showmap) {                      // phones: leave the X-Ray, open the map tab on this listing, keep its pin
        const id = t.dataset.showmap, l = byId.get(id);
        $("drawer").hidden = true; document.body.classList.remove("sel-open"); $("tabMap").click();
        setTimeout(() => { if (map) { map.invalidateSize(); S.sel = id; pinSelected(); showOnMap(l); } }, 80);
      }
      else if (t.dataset.cov) openModal("coverage", coverageHTML());
      else if (t.dataset.export) { doExport(t.dataset.export); t.closest("details").open = false; }
      else if (t.classList.contains("card")) openDrawer(t.dataset.id, false);
    });
    document.addEventListener("mouseover", (e) => { const c = e.target.closest(".card"); if (c) hot(c.dataset.id, true); });
    document.addEventListener("mouseout", (e) => { const c = e.target.closest(".card"); if (c) hot(c.dataset.id, false); });
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "saveForm") return;
      e.preventDefault(); const name = $("saveName").value.trim(); if (!name) return;
      const all = saved(); all[name] = L.toHash(S.f); store.set("jagga.saved", all); renderSaved(); $("savedSel").value = name; $("modal").close();
    });
    document.addEventListener("click", (e) => {
      const d = e.target.closest("[data-delsaved]");
      if (d) { const all = saved(); delete all[d.dataset.delsaved]; store.set("jagga.saved", all); renderSaved(); $("mBody").innerHTML = savedHTML(); }
      if (e.target.closest("[data-copy]")) copyLink();
      if (e.target.closest("#wPrint")) printShortlist();
      if (e.target.id === "wExport") download("jaggasignal-watchlist.json", "application/json", JSON.stringify({ watch: S.watch, notes: Object.keys(S.watch).reduce((o, i) => (o[i] = store.get("jagga.note." + i, ""), o), {}) }, null, 2));
    });
    document.addEventListener("change", (e) => {
      if (e.target.id !== "wImport" || !e.target.files[0]) return;
      e.target.files[0].text().then((t) => { try { const j = JSON.parse(t);
        Object.keys(j.watch || {}).forEach((i) => { if (byId.has(i)) S.watch[i] = String(j.watch[i]).slice(0, 20); });
        Object.keys(j.notes || {}).forEach((i) => { if (byId.has(i)) store.set("jagga.note." + i, String(j.notes[i]).slice(0, 4000)); });
        store.set("jagga.watch", S.watch); $("watchCount").textContent = Object.keys(S.watch).length; $("mBody").innerHTML = watchHTML(); renderList();
      } catch (err) { $("mBody").insertAdjacentHTML("afterbegin", '<p class="empty">That file is not a valid saved-plots export.</p>'); } });
    });
  }
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  init();
})();
