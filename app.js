/* Jaggasignal front end. No framework: state object + render functions.
 * All data-derived strings go through L.esc; hrefs through L.safeUrl (listing text is scraped, so untrusted). */
(function () {
  "use strict";
  const L = window.JaggaLib, D = window.JAGGA, T = L.unitTable(D.meta.units);
  const $ = (id) => document.getElementById(id);
  const PAGE = 40;
  const IDEAL_LABEL = ["", "near miss", "possible", "must-haves met", "IDEAL"];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: degrade silently */ } }
  };

  const S = { f: { unit: "aana", aunit: "aana", sort: "price" }, cmp: [], shown: PAGE, sel: null, watch: store.get("jagga.watch", {}), bounds: null, fitNext: true, lastFocus: null };
  const byId = new Map(D.listings.map((l) => [l.id, l]));
  let visible = [], map = null, layerI = null, layerS = null, layerL = null, layerC = null, layerB = null, markers = new Map(), canvas = null;

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
  function priceText(l) { return l.p == null ? "Price n/a" : L.fmtMoney(L.perUnit(l.p, S.f.unit, T)); }
  function areaText(l) {
    if (l.a == null) return "area n/a";
    const sqm = Math.round(l.a).toLocaleString("en-US") + " m²";
    return l.sys ? L.areaNotation(l.a, l.sys, D.meta.units) + " (" + sqm + ")" : sqm + " · " + (l.a / T.aana).toFixed(1) + " aana";
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
    f.age = $("fAge").value; f.cut = $("fCut").checked; f.dups = $("fDups").checked; f.ideal = $("fIdeal").checked; f.sort = $("fSort").value;
  }
  function writeUI() {
    const f = S.f;
    $("q").value = f.q || ""; $("fDis").value = f.dis || ""; $("fSrc").value = f.src || ""; $("fUnit").value = f.unit || "aana";
    $("fPmin").value = f.pmin || ""; $("fPmax").value = f.pmax || ""; $("fAunit").value = f.aunit || "aana";
    $("fAmin").value = f.amin || ""; $("fAmax").value = f.amax || ""; $("fRoad").value = f.road || "";
    $("fAge").value = f.age || ""; $("fCut").checked = !!f.cut; $("fDups").checked = !!f.dups; $("fIdeal").checked = !!f.ideal; $("fSort").value = f.sort || "price";
  }
  function hashState() { const m = /(?:^|&)l=([0-9a-f]+)/.exec(location.hash.slice(1)); return m ? m[1] : null; }
  function pushHash() {
    const h = L.toHash(S.f) + (S.sel ? (L.toHash(S.f) ? "&" : "") + "l=" + S.sel : "");
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  // ---------- list ----------
  function compute() {
    const f = Object.assign({}, S.f, { bounds: $("fMapOnly").checked && S.bounds ? S.bounds : null });
    visible = L.sort(L.filter(D.listings, f, T), S.f.sort || "price");
  }
  function cardHTML(l) {
    const c = l.c, tags = [];
    if (c) tags.push('<span class="tag ' + (c.p < 25 ? "cheap" : c.p > 75 ? "dear" : "") + '"><i>' + L.esc(L.compsLabel(c)) + "</i></span>");
    if (c && c.rel === "weak") tags.push('<span class="tag weak" title="Compared with the whole district: locations differ"><i>weak comps</i></span>');
    if (l.pc === "low") tags.push('<span class="tag weak" title="Low confidence: see the X-Ray for why"><i>price uncertain</i></span>');
    if (l.pb === "total_reread") tags.push('<span class="tag weak" title="The ad put a total price in the per-unit field; it has been read as a total"><i>read as total</i></span>');
    if (S.f.ideal && l.ia >= 1) tags.unshift('<span class="tag ideal t' + l.ia + '" title="Hard criteria: ' + (l.ia === 4 ? "every criterion passes" : l.ia === 3 ? "all must-haves pass; some wishes not evidenced" : l.ia === 2 ? "none fails, some unknown" : "exactly one fails (see the X-Ray)") + '"><i>' + IDEAL_LABEL[l.ia] + " · " + l.iz + "/5 wishes evidenced</i></span>");
    if (L.isCut(l)) tags.push('<span class="tag cut"><i>price cut</i></span>');
    if (isNew(l)) tags.push('<span class="tag new"><i>new</i></span>');
    if (l.tw) tags.push('<span class="tag weak" title="Same district, area, price and place seen in other postings"><i>posted ' + (l.tw + 1) + "×</i></span>");
    const age = L.daysSince(l.po);
    if (age != null && age > 180) tags.push('<span class="tag weak" title="The portal dates this ad long ago; it may no longer be available"><i>ad ' + (age > 365 ? Math.round(age / 365 * 10) / 10 + "y" : Math.round(age / 30) + "mo") + " old</i></span>");
    const place = placeText(l);
    const starred = !!S.watch[l.id];
    return '<li class="card' + (S.sel === l.id ? " sel" : "") + '" data-id="' + l.id + '">' +
      '<div class="price">' + L.esc(priceText(l)) + (l.p != null ? " <small>/" + UNIT_LABEL[S.f.unit] + "</small>" : "") + "</div>" +
      '<span class="card-actions"><button class="cmp" type="button" data-cmp="' + l.id + '" aria-pressed="' + (S.cmp.indexOf(l.id) >= 0) + '" aria-label="' + (S.cmp.indexOf(l.id) >= 0 ? "Remove from comparison" : "Add to comparison (up to 3)") + '">' + (S.cmp.indexOf(l.id) >= 0 ? "✓ compare" : "compare") + "</button> " +
      '<button class="star" type="button" data-star="' + l.id + '" aria-pressed="' + starred + '" aria-label="' + (starred ? "Remove from watchlist" : "Add to watchlist") + '">' + (starred ? "★" : "☆") + "</button></span>" +
      '<h3><button type="button" data-open="' + l.id + '">' + L.esc(l.t) + "</button></h3>" +
      '<div class="facts"><span>' + L.esc(areaText(l)) + "</span>" + (l.tot ? "<span>" + L.esc(L.fmtMoney(l.tot)) + " total</span>" : "") +
      (l.road ? "<span>" + l.road + " ft road</span>" : "") + '<span class="dim">' + L.esc(place) + "</span>" +
      '<span class="dim">' + L.esc(l.src) + (l.fs ? " · seen " + ago(l.fs) : "") + "</span></div>" +
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

  function renderList() {
    compute(); renderHist();
    $("resultsHead").textContent = visible.length + (visible.length === 1 ? " listing" : " listings") +
      (S.f.ideal ? " · " + visible.filter((l) => l.ia === 4).length + " ideal" : "");
    const shown = visible.slice(0, S.shown);
    $("results").innerHTML = shown.length ? shown.map(cardHTML).join("") :
      '<li class="empty">No listings match. Coverage is limited — see <button class="btn btn-ghost" type="button" data-cov="1"><span>Coverage</span></button> for where data exists.</li>';
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
    if (D.ideal) {
      $("idealChip").hidden = false;
      if (D.ideal.zones) {
        $("lyIWrap").hidden = false;
        layerI = window.L.layerGroup();
        const c = D.ideal.zones.cell;
        D.ideal.zones.cells.forEach((z) => {
          const hot = z[2] > 0, warm = z[3] > 0;
          const r = window.L.rectangle([[z[0], z[1]], [z[0] + c, z[1] + c]], { weight: hot || warm ? 1 : 0, color: "#ff00ff", fillColor: hot ? "#ff00ff" : warm ? "#ff9900" : "#00ffff", fillOpacity: hot ? 0.5 : warm ? 0.4 : 0.1, interactive: hot || warm });
          if (hot || warm) r.bindTooltip(z[2] + " ideal, " + z[3] + " candidate parcel(s) here (~2 km cell)");
          r.addTo(layerI);
        });
        (D.ideal.anchors || []).forEach((an) => window.L.circle([an.lat, an.lon], { radius: an.radius_km * 1000, color: "#ff9900", weight: 1, dashArray: "4 4", fillOpacity: 0.04 })
          .bindTooltip(L.esc(an.name) + ": " + an.radius_km + " km").addTo(layerI));
      }
    }
    window.JAGGA_MAP = map; map.on("zoomend", drawMarkers);
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
  function idealHTML(dt, l) {
    if (!dt.xi || !(l.ia >= 1)) return "";
    const mark = { pass: "✓", fail: "✗", unknown: "?" };
    const rows = dt.xi.map((k) => '<li class="ic ' + k[1] + '"><b>' + mark[k[1]] + " " + L.esc(k[0]) + (k[3] ? "" : " <small>(wish)</small>") + "</b><br>" + L.esc(k[2]) + "</li>").join("");
    return '<h3 class="sec">✦ ' + L.esc((D.ideal && D.ideal.name) || "Ideal") + " checklist · " + IDEAL_LABEL[l.ia] + '</h3><ul class="factors ideal-list">' + rows + "</ul>" +
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
      '<div class="price">' + L.esc(priceText(l)) + " <small>/" + UNIT_LABEL[S.f.unit] + "</small></div>" +
      '<dl class="kv"><dt>total</dt><dd>' + L.esc(l.tot ? L.fmtMoney(l.tot) : "n/a") + "</dd><dt>area</dt><dd>" + L.esc(areaText(l)) + "</dd>" +
      (l.p != null ? per : "") + "<dt>place</dt><dd>" + L.esc(placeText(l)) + L.esc(approx) + "</dd>" +
      (l.po ? "<dt>ad dated</dt><dd>" + L.esc(l.po) + "</dd>" : "") + (l.fac ? "<dt>facing</dt><dd>" + L.esc(l.fac) + "</dd>" : "") + "<dt>first seen</dt><dd>" + L.esc(l.fs || "?") + "</dd><dt>last seen</dt><dd>" + L.esc(l.ls || "?") + "</dd></dl>" +
      idealHTML(dt, l) +
      '<h3 class="sec">X-Ray · each factor cited, none estimated</h3><ul class="factors">' + ok + no + "</ul>" +
      (dt.h && dt.h.length > 1 ? '<h3 class="sec">Price history (NPR/m²)</h3>' + spark(dt.h) : "") +
      '<p><a class="btn btn-primary" href="' + L.esc(L.safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer"><span>View original ad ↗</span></a> ' +
      '<button class="btn btn-outline" type="button" data-star="' + l.id + '" aria-pressed="' + !!S.watch[l.id] + '"><span>' + (S.watch[l.id] ? "★ Watching" : "☆ Watch") + "</span></button> " +
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
      '<h3 class="sec">How to read it</h3><p>There is no single score. Each listing has an X-Ray of separate, cited factors. A factor with no data is shown as <b>missing</b>, never estimated. “Comps” are other listings of similar size, nearest first (same palika, then radius, then district); a district-wide comparison is marked <b>weak</b>.</p>' +
      '<h3 class="sec">Units</h3><p>Every price is stored as NPR per m² and only shown in the unit you pick. Hill and Terai units are not interchangeable by eye: 1 aana ≈ 1.88 dhur. Positional notation like 2-10-5 is shown only where the district’s system is known.</p>' +
      '<h3 class="sec">Government valuation</h3><p>' + (m.govt_valuation_rows ? m.govt_valuation_rows + " real rate rows are loaded" + (m.govt_valuation_sources.indexOf("news") >= 0 ? ", <b>partial</b>: taken from a news report of the committee’s decision and covering only some Kathmandu-valley road segments. Everywhere else the comparison is shown as missing." : ".") : "<b>No real government minimum-valuation data is loaded yet</b>, so that comparison is shown as missing everywhere.") + " Minimum valuations are set per district by a committee chaired by the Chief District Officer.</p>" +
      '<h3 class="sec">Not advice</h3><p>This is a screening tool. Check the lalpurja, the napi naksa, a physical visit with the neighbours, and the current malpot rate before paying anything.</p>' +
      '<h3 class="sec">Data and credits</h3><p>Boundaries: Survey Department of Nepal via UN OCHA / HDX (CC BY-IGO). Places: GeoNames (CC BY 4.0). Map tiles: © OpenStreetMap contributors. Leaflet (BSD-2). Fonts Orbitron and Share Tech Mono (OFL).</p>' +
      "<p class=\"foot\">Built " + L.esc(m.built_at) + ".</p>";
  }
  function watchHTML() {
    const ids = Object.keys(S.watch).filter((i) => byId.has(i));
    if (!ids.length) return '<p class="empty">Nothing starred yet. Your watchlist and notes live only in this browser; export them to keep a copy.</p>';
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
    if (S.watch[id]) delete S.watch[id]; else S.watch[id] = "watching";
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
      return "<section><h2>" + L.esc(l.t) + "</h2><p class=\"big\">" + L.esc(priceText(l)) + " /" + UNIT_LABEL[S.f.unit] + (l.tot ? " · total " + L.esc(L.fmtMoney(l.tot)) : "") + "</p>" +
        "<p>" + L.esc(areaText(l)) + " · " + L.esc(placeText(l)) + (l.road ? " · " + l.road + " ft road" : "") + (l.po ? " · ad dated " + L.esc(l.po) : "") + "</p>" +
        "<ul>" + ok + no + "</ul>" + (note ? "<p class=\"note\"><b>My notes:</b> " + L.esc(note) + "</p>" : "") +
        "<p class=\"src\">Original ad: " + L.esc(L.safeUrl(l.url)) + "</p></section>";
    }).join("");
    return "<!doctype html><meta charset=\"utf-8\"><title>Shortlist</title><style>body{font:13px/1.45 Georgia,serif;max-width:780px;margin:20px auto;padding:0 14px;color:#111}" +
      "h1{font:700 20px sans-serif}h2{font:700 15px sans-serif;margin:0}section{border-top:2px solid #111;padding:10px 0;break-inside:avoid}.big{font:700 17px sans-serif;margin:2px 0}" +
      "ul{margin:6px 0;padding-left:18px}.no{color:#666}.note{background:#f3f3f3;padding:6px 8px}.src{font-size:11px;color:#444;word-break:break-all}.fine{font-size:11px;color:#444}</style>" +
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

  function init() {
    D.meta.districts.forEach((d) => $("fDis").insertAdjacentHTML("beforeend", '<option value="' + L.esc(d.district_id) + '">' + L.esc(d.district) + " (" + d.n + ")</option>"));
    D.meta.sources.forEach((s) => $("fSrc").insertAdjacentHTML("beforeend", '<option value="' + L.esc(s.source) + '">' + L.esc(s.source) + " (" + s.n + ")</option>"));
    const cuts = D.listings.filter((l) => L.isCut(l)).length;     // honest filter: no genuine seller price cut observed yet => say so
    if (!cuts) { $("fCut").disabled = true; $("fCut").parentElement.title = "No seller price cut has been observed yet; this fills in as listings are re-checked over time."; $("fCut").nextElementSibling.textContent = "Price cut (none seen yet)"; }
    Object.assign(S.f, L.parseHash(location.hash));
    if (S.f.fresh) { S.f.age = "7"; delete S.f.fresh; }          // old shared links used fresh=1 ("new this week")
    writeUI();
    $("watchCount").textContent = Object.keys(S.watch).length;
    $("foot").innerHTML = "Built " + L.esc(D.meta.built_at) + " · " + D.meta.sources.map((s) => L.esc(s.source) + " fetched " + L.esc(s.last_fetch || "never")).join(" · ") +
      ' · <button class="btn btn-ghost" type="button" data-cov="1"><span>' + D.meta.nation.districts[0] + "/" + D.meta.nation.districts[1] + " districts covered</span></button><br>Screening tool, not advice.";
    initMap(); syncTopHeight(); window.addEventListener("resize", debounce(syncTopHeight, 100)); readUI(); renderList();
    const want = hashState(); if (want && byId.has(want)) openDrawer(want, false);

    ["fDis", "fSrc", "fUnit", "fAunit", "fSort", "fAge", "fCut", "fDups"].forEach((id) => $(id).addEventListener("change", refresh));
    $("fIdeal").addEventListener("change", () => { if ($("fIdeal").checked) $("fSort").value = "ideal"; else if ($("fSort").value === "ideal") $("fSort").value = "price"; refresh(); });
    ["fPmin", "fPmax", "fAmin", "fAmax", "fRoad"].forEach((id) => $(id).addEventListener("input", debounce(refresh, 250)));
    $("q").addEventListener("input", debounce(refresh, 200)); $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); refresh(); });
    $("fMapOnly").addEventListener("change", () => { S.shown = PAGE; renderList(); });
    $("histSvg").addEventListener("click", (e) => {
      const r = e.target.closest("rect"); if (!r) return;
      const round = (x) => String(+(x >= 1000 ? Math.round(x / 100) * 100 : x.toPrecision(2)));
      S.f.pmin = round(+r.dataset.lo); S.f.pmax = round(+r.dataset.hi); writeUI(); refresh();
    });
    $("btnReset").addEventListener("click", () => { S.f = { unit: "aana", aunit: "aana", sort: "price" }; writeUI(); refresh(); });
    $("btnMore").addEventListener("click", () => { S.shown += PAGE; renderList(); });
    $("lyL").addEventListener("change", (e) => map && (e.target.checked ? layerL.addTo(map) : map.removeLayer(layerL)));
    $("lyB").addEventListener("change", (e) => map && (e.target.checked ? layerB.addTo(map).bringToBack() : map.removeLayer(layerB)));
    $("lyI").addEventListener("change", (e) => map && layerI && (e.target.checked ? layerI.addTo(map) : map.removeLayer(layerI)));
    $("lyC").addEventListener("change", (e) => map && (e.target.checked ? layerC.addTo(map) : map.removeLayer(layerC)));
    $("dClose").addEventListener("click", closeDrawer); $("mClose").addEventListener("click", () => $("modal").close());
    $("btnCoverage").addEventListener("click", () => openModal("coverage", coverageHTML()));
    $("btnAbout").addEventListener("click", () => openModal("about", aboutHTML()));
    $("btnCompare").addEventListener("click", () => { openModal("compare", '<p class="foot" role="status">Loading…</p>'); loadDetail(S.cmp).then(() => { $("mBody").innerHTML = compareHTML(); }, () => { $("mBody").innerHTML = '<p class="empty">Could not load the details.</p>'; }); });
    renderSaved();
    $("savedSel").addEventListener("change", (e) => {
      const h = saved()[e.target.value]; if (h === undefined) return;
      S.f = Object.assign({ unit: "aana", aunit: "aana", sort: "price" }, L.parseHash("#" + h)); writeUI(); refresh();
    });
    $("btnSave").addEventListener("click", () => { openModal("save search", savedHTML()); $("saveName").focus(); });
    $("btnWatch").addEventListener("click", () => openModal("watchlist", watchHTML()));
    $("tabList").addEventListener("click", () => { document.body.classList.remove("show-map"); $("tabList").classList.add("on"); $("tabMap").classList.remove("on"); });
    $("tabMap").addEventListener("click", () => { document.body.classList.add("show-map"); $("tabMap").classList.add("on"); $("tabList").classList.remove("on"); if (map) setTimeout(() => map.invalidateSize(), 50); });
    initTranslate();
    $("dPrev").addEventListener("click", () => step(-1)); $("dNext").addEventListener("click", () => step(1));
    document.addEventListener("keydown", (e) => {
      if ($("drawer").hidden || $("modal").open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) return;
      if (e.key === "j" || e.key === "J") { e.preventDefault(); step(1); } else if (e.key === "k" || e.key === "K") { e.preventDefault(); step(-1); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("drawer").hidden && !$("modal").open) closeDrawer(); });
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
      } catch (err) { $("mBody").insertAdjacentHTML("afterbegin", '<p class="empty">That file is not a valid watchlist export.</p>'); } });
    });
  }
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  init();
})();
