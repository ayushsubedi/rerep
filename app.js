/* Jaggasignal front end. No framework: state object + render functions.
 * All data-derived strings go through L.esc; hrefs through L.safeUrl (listing text is scraped, so untrusted). */
(function () {
  "use strict";
  const L = window.JaggaLib, D = window.JAGGA, T = L.unitTable(D.meta.units);
  const $ = (id) => document.getElementById(id);
  const PAGE = 40;
  const F = window.JaggaFinder, P = window.JaggaPicks, FLAGS = D.meta.flags || [];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: degrade silently */ } }
  };

  // ---------- language: the visitor's choice, kept in this browser (never in a shared link, so a link does not force a language on whoever opens it) ----------
  const LANGPREF = (() => {
    const saved = store.get("jagga.lang", null), first = String((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
    return { lang: saved && saved.lang ? (saved.lang === "ne" ? "ne" : "en") : first.indexOf("ne") === 0 ? "ne" : "en", digits: saved && saved.digits === "deva" ? "deva" : "latin" };
  })();
  L.setLang(LANGPREF.lang, LANGPREF.digits);
  document.documentElement.lang = L.getLang();

  // ---------- scripts and data from different builds: say so, never print what cannot be read ----------
  // A browser keeps the scripts (cache-first) from the build it first saw while the data is fetched fresh, so after a change in the data's shape an open or installed copy can pair old scripts with new data.
  if ((D.meta.format || 1) !== L.FORMAT) { staleCopy(); return; }
  /** Ask the browser for the newest copy once (this tab, this session); if the mismatch is still there, tell the visitor how to get past it. */
  function staleCopy() {
    const key = "jagga.fmt", seen = (() => { try { return sessionStorage.getItem(key) === String(D.meta.format || 1); } catch (e) { return true; } })();
    const b = $("staleBanner"); b.textContent = L.t("ui.stale"); b.hidden = false;
    if (seen) return;
    try { sessionStorage.setItem(key, String(D.meta.format || 1)); } catch (e) { return; }
    const reload = () => location.reload(), reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration() : null;
    if (reg) reg.then((r) => r && r.update()).catch(() => {}).then(() => setTimeout(reload, 1500)); else reload();
  }
  /** English is the page as written; in Nepali the marked text, attributes and option lists are swapped for the catalog's. The first text node is replaced and its children (the counters) kept. */
  function applyStatic() {
    if (L.getLang() === "en") return;
    const swap = (el, text) => {
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) { const old = n.nodeValue.trim(); n.nodeValue = n.nodeValue.replace(old, () => text); return; }
      el.insertBefore(document.createTextNode(text), el.firstChild);
    };
    document.querySelectorAll("[data-i18n]").forEach((el) => swap(el, L.t(el.dataset.i18n)));
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = L.t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => el.dataset.i18nAttr.split(";").forEach((pair) => { const [a, k] = pair.split(":"); el.setAttribute(a, L.t(k)); }));
    document.title = L.t("ui.page.title");
    document.querySelectorAll("#fUnit option").forEach((o) => { o.textContent = L.t("ui.per", { unit: L.t("unit." + o.value) }); });
    document.querySelectorAll("#fAunit option").forEach((o) => { o.textContent = L.t("unit." + o.value); });
    const AGE = { "": ["ui.age.any"], 7: ["ui.age.days", 7], 30: ["ui.age.days", 30], 90: ["ui.age.months", 3], 180: ["ui.age.months", 6], 365: ["ui.age.year"] };
    document.querySelectorAll("#fAge option").forEach((o) => { const a = AGE[o.value]; if (a) o.textContent = L.t(a[0], { n: a[1] }); });
  }
  /** Each button shows the OTHER choice, in its own script; choosing saves it and reloads (the address, saved plots and notes all survive a reload). */
  function initLangButtons() {
    const ne = L.getLang() === "ne", b = $("btnLang"), d = $("btnDigits"), go = (lang, digits) => { store.set("jagga.lang", { lang, digits }); location.reload(); };
    b.firstElementChild.textContent = ne ? "English" : "नेपाली"; b.lang = ne ? "en" : "ne";
    d.hidden = !ne; d.firstElementChild.textContent = LANGPREF.digits === "deva" ? "123" : "१२३";
    b.addEventListener("click", () => go(ne ? "en" : "ne", LANGPREF.digits));
    d.addEventListener("click", () => go("ne", LANGPREF.digits === "deva" ? "latin" : "deva"));
  }

  const S = { f: { unit: "aana", aunit: "aana", sort: "new" }, cmp: [], shown: PAGE, sel: null, watch: store.get("jagga.watch", {}), bounds: null, fitNext: true, lastFocus: null, picks: false, picksY: 0, sortTouched: false };
  D.listings.forEach(L.multiSize);                                  // ads for a range of sizes: no single area or total (see lib.js)
  const byId = new Map(D.listings.map((l) => [l.id, l]));
  let FR = null, FRMAP = new Map(), PLACES = null, placesP = null, SINCE = null;       // the finder's last run, by listing id; the places picker's data (loaded on demand)
  let visible = [], map = null, layerA = null, layerS = null, layerL = null, layerH = null, layerC = null, layerB = null, markers = new Map(), clusterOf = new Map(), canvas = null, hovId = null, hovTimer = 0;

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
  const UNIT_LABEL = new Proxy({}, { get: (_, u) => (typeof u === "string" && L.t("unit." + u) !== "unit." + u ? L.t("unit." + u) : undefined) });          // unit names in the chosen language; unknown units stay undefined
  const pctColor = (c) => (!c ? "#98a1b0" : c.p < 25 ? "#2a7548" : c.p > 75 ? "#bd3519" : "#6c7f99");
  function priceText(l) { return l.p != null ? L.fmtMoney(L.perUnit(l.p, S.f.unit, T)) : l.tot ? L.t("price.total", { m: L.fmtMoney(l.tot) }) : l.ms && l.msTot ? L.t("price.onesize", { m: L.fmtMoney(l.msTot) }) : L.t("price.na"); }   // area unreadable: the total is the price
  const perText = (l) => (l.p != null ? " <small>/" + UNIT_LABEL[S.f.unit] + "</small>" : "");
  function areaText(l) {
    if (l.ms) return l.ms === "plots of different sizes" ? L.t("area.diff") : L.t("area.several", { ms: L.msText(l.ms) });
    if (l.a == null) return L.t("area.none");
    const sqm = L.nfmt(Math.round(l.a)) + " " + L.t("unit.sqm");
    return l.sys ? (L.areaPlain(l.a, l.sys, D.meta.units) || L.digits(L.areaNotation(l.a, l.sys, D.meta.units))) + " (" + sqm + ")" : sqm + " · " + L.digits((l.a / T.aana).toFixed(1)) + " " + L.t("unit.aana");
  }
  // Lead with the RESOLVED place; raw portal text is shown only when short and clean (it is often a jumble).
  const placeText = (l) => [l.pal, l.dis, l.loc && l.loc.length <= 36 ? l.loc : ""].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  const isNew = (l) => L.isNewAd(l);

  // ---------- filters <-> UI <-> hash ----------
  function readUI() {
    const f = S.f;
    f.q = $("q").value; f.dis = $("fDis").value; f.src = $("fSrc").value; f.unit = $("fUnit").value;
    f.pmin = L.toAscii($("fPmin").value).replace(/,/g, ""); f.pmax = L.toAscii($("fPmax").value).replace(/,/g, "");          // a Nepali keyboard types ०-९: read as 0-9
    f.aunit = $("fAunit").value; f.amin = L.toAscii($("fAmin").value); f.amax = L.toAscii($("fAmax").value); f.road = L.toAscii($("fRoad").value);
    f.age = $("fAge").value; f.cut = $("fCut").checked; f.dups = $("fDups").checked; f.sort = $("fSort").value;
  }
  function writeUI() {
    const f = S.f;
    $("q").value = f.q || ""; $("fDis").value = f.dis || ""; $("fSrc").value = f.src || ""; $("fUnit").value = f.unit || "aana";
    $("fPmin").value = f.pmin || ""; $("fPmax").value = f.pmax || ""; $("fAunit").value = f.aunit || "aana";
    $("fAmin").value = f.amin || ""; $("fAmax").value = f.amax || ""; $("fRoad").value = f.road || "";
    $("fAge").value = f.age || ""; $("fCut").checked = !!f.cut; $("fDups").checked = !!f.dups; $("fSort").value = f.sort || "new";
  }
  function hashState(h) { const m = /(?:^|&)l=([0-9a-f]+)/.exec(h == null ? location.hash.slice(1) : h); return m ? m[1] : null; }
  function pushHash() {
    const fp = F.activeIds(S.profile, FLAGS).length ? "fp=" + F.encode(S.profile) : "";          // the finder rides in the link only when it has criteria
    const h = [L.toHash(S.f), S.sel ? "l=" + S.sel : "", S.picks && !S.sel ? "picks" : "", fp].filter(Boolean).join("&");
    history.replaceState(history.state, "", h ? "#" + h : location.pathname + location.search);
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
    if (c) tags.push('<span class="tag ' + (c.p < 25 ? "cheap" : c.p > 75 ? "dear" : "") + '" title="' + L.esc(L.t("card.pct.title", { p: c.p, n: c.n })) + '"><i>' + L.esc(L.compsPlain(c)) + "</i></span>");
    if (c && c.rel === "weak") tags.push('<span class="tag weak" title="' + L.esc(L.t("card.weak.title")) + '"><i>' + L.esc(L.t("card.weak")) + '</i></span>');
    if (l.pc === "low") tags.push('<span class="tag weak" title="' + L.esc(L.t("card.unsure.title")) + '"><i>' + L.esc(L.t("card.unsure")) + '</i></span>');
    if (l.pb === "total_reread") tags.push('<span class="tag weak" title="' + L.esc(L.t("card.total_reread.title")) + '"><i>' + L.esc(L.t("card.total_reread")) + '</i></span>');
    const fit = FRMAP.get(l.id);
    if (fit && fit.tier) tags.unshift('<span class="tag ideal t' + fit.tier + '" title="' + L.esc(L.t("card.fit." + fit.tier + ".title")) + '"><i>' + F.TIER[fit.tier] + (fit.wishTotal ? " · " + L.t("card.wishes", { a: fit.wishes, b: fit.wishTotal }) : "") + "</i></span>");
    if (L.isCut(l)) tags.push('<span class="tag cut"><i>' + L.esc(L.t("card.cut")) + "</i></span>");
    if (isNew(l)) tags.push('<span class="tag new"><i>' + L.esc(L.t("card.new")) + "</i></span>");
    if (l.tw) tags.push('<span class="tag weak" title="' + L.esc(L.t("card.twin.title")) + '"><i>' + L.esc(L.t("card.twin", { n: l.tw + 1 })) + "</i></span>");
    const age = L.daysSince(l.po);
    if (age != null && age > 180) tags.push('<span class="tag weak" title="' + L.esc(L.t("card.old.title")) + '"><i>' + L.esc(L.t("card.old")) + '</i></span>');
    const unseen = L.daysSince(l.ls);
    if (unseen != null && unseen > 14) tags.push('<span class="tag weak" title="' + L.esc(L.t("card.stale.title", { d: l.ls })) + '"><i>' + L.esc(L.t("card.stale", { d: l.ls })) + "</i></span>");
    const place = placeText(l);
    const starred = !!S.watch[l.id];
    const actions_html = '<span class="card-actions"><button class="cmp" type="button" data-cmp="' + l.id + '" aria-pressed="' + (S.cmp.indexOf(l.id) >= 0) + '" aria-label="' + L.esc(L.t(S.cmp.indexOf(l.id) >= 0 ? "card.cmp.remove" : "card.cmp.add")) + '">' + L.esc(L.t(S.cmp.indexOf(l.id) >= 0 ? "card.cmp.on" : "card.cmp.off")) + "</button> " +
      '<button class="star" type="button" data-star="' + l.id + '" aria-pressed="' + starred + '" aria-label="' + L.esc(L.t(starred ? "card.unstar" : "card.star")) + '">' + L.esc(L.t(starred ? "card.saved" : "card.save")) + "</button></span>";
    return '<li class="card' + (S.sel === l.id ? " sel" : "") + '" data-id="' + l.id + '">' +
      '<div class="price">' + L.esc(priceText(l)) + perText(l) + "</div>" +
      '<h3><button type="button" data-open="' + l.id + '">' + L.esc(L.niceTitle(l.t)) + "</button></h3>" +
      '<div class="facts"><span>' + L.esc(areaText(l)) + "</span>" + (l.tot && l.p != null ? "<span>" + L.esc(L.t("price.total", { m: L.fmtMoney(l.tot) })) + "</span>" : "") +
      (l.road ? "<span>" + L.esc(L.t("card.road", { n: l.road })) + "</span>" : "") + '<span class="dim">' + L.esc(place) + "</span>" +
      '<span class="dim">' + L.esc(l.src) + " · " + L.whenText(l) + "</span></div>" +
      '<div class="card-foot">' + (tags.length ? '<div class="tags">' + tags.join("") + "</div>" : "") + actions_html + "</div></li>";
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
      '" x="' + (i * W + 0.5) + '" width="' + (W - 1) + '" y="' + (62 - (c / max) * 58) + '" height="' + (c / max) * 58 + '"><title>' + L.esc(L.t("hist.bar", { c: c, a: L.fmtMoney(h.edges[i]), b: L.fmtMoney(h.edges[i + 1]) })) + "</title></rect>").join("") +
      '<line x1="' + (((Math.log(h.median) - Math.log(h.min)) / ((Math.log(h.max) - Math.log(h.min)) || 1)) * 400) + '" x2="' + (((Math.log(h.median) - Math.log(h.min)) / ((Math.log(h.max) - Math.log(h.min)) || 1)) * 400) + '" y1="0" y2="64"></line>';
    $("histSvg").setAttribute("aria-label", L.t("hist.aria", { unit: UNIT_LABEL[S.f.unit], n: vals.length, med: L.fmtMoney(h.median), lo: L.fmtMoney(h.min), hi: L.fmtMoney(h.max) }));
    $("histCap").textContent = L.t("hist.cap", { unit: UNIT_LABEL[S.f.unit], med: L.fmtMoney(h.median), lo: L.fmtMoney(h.min), hi: L.fmtMoney(h.max) });
  }

  /** How many filters are set, for the phone's "Filters (n)" button. */
  function countFilters() {
    const f = S.f;
    return [f.dis, f.src, f.pmin || f.pmax, f.amin || f.amax, f.road, f.age, f.cut, f.dups, f.q].filter(Boolean).length;
  }
  function renderList() {
    compute(); renderHist();
    const nf = countFilters(); $("filterCount").textContent = nf ? "(" + L.digits(nf) + ")" : "";
    const nm = [S.f.src, S.f.cut, S.f.dups].filter(Boolean).length; $("moreCount").textContent = nm ? "(" + L.digits(nm) + ")" : "";
    $("resultsHead").textContent = L.t(visible.length === 1 ? "list.count.one" : "list.count.many", { n: visible.length }) + (FR ? L.t("list.finder", { n: FR.counts[3] }) : "");
    const shown = visible.slice(0, S.shown);
    $("results").innerHTML = shown.length ? shown.map(cardHTML).join("") :
      '<li class="empty">' + L.t("list.empty", { clear: '<button class="btn btn-outline" type="button" id="emptyReset"><span>' + L.esc(L.t("list.empty.clear")) + "</span></button>", cov: '<button class="btn btn-ghost" type="button" data-cov="1"><span>' + L.esc(L.t("list.empty.cov")) + "</span></button>" }) + "</li>";
    $("btnMore").hidden = visible.length <= S.shown;
    $("btnMore").firstElementChild.textContent = L.t("list.more", { n: visible.length - S.shown });
    renderChips();
    renderMap();
    pushHash();
  }

  // ---------- what is filtering the list, as chips you can take off one by one ----------
  const DUPS = D.listings.filter((l) => l.dup).length;
  const nfmt = L.nfmt;
  function activeChips() {
    const f = S.f, out = [], add = (key, text) => out.push({ key, text }), u = UNIT_LABEL[f.unit] || L.t("unit.aana");
    if (f.q) add("q", "\u201c" + f.q + "\u201d");
    if (f.dis) add("dis", dname(f.dis));
    if (f.src) add("src", f.src);
    if (f.pmin || f.pmax) add("price", f.pmin && f.pmax ? L.t("chip.price.range", { a: nfmt(f.pmin), b: nfmt(f.pmax), u: u }) : f.pmin ? L.t("chip.price.from", { a: nfmt(f.pmin), u: u }) : L.t("chip.price.upto", { b: nfmt(f.pmax), u: u }));
    if (f.amin || f.amax) { const au = UNIT_LABEL[f.aunit] || L.t("unit.aana"); add("area", f.amin && f.amax ? L.t("chip.area.range", { a: L.digits(f.amin), b: L.digits(f.amax), u: au }) : f.amin ? L.t("chip.area.min", { a: L.digits(f.amin), u: au }) : L.t("chip.area.max", { b: L.digits(f.amax), u: au })); }
    if (f.road) add("road", L.t("chip.road", { n: L.digits(f.road) }));
    if (f.age) add("age", L.t("chip.age", { n: L.digits(f.age) }));
    if (f.cut) add("cut", L.t("ui.pricecut"));
    if ($("fMapOnly").checked) add("maponly", L.t("chip.maponly"));
    if (FR) add("finder", FR.counts[2] ? L.t("chip.finder.poss", { n: FR.counts[3], m: FR.counts[2] }) : L.t("chip.finder", { n: FR.counts[3] }));
    return out;
  }
  function renderChips() {
    const el = $("activeChips"), chips = activeChips(), dup = !S.f.dups && DUPS ? '<span class="dim">' + L.t("chip.dups", { n: nfmt(DUPS), btn: '<button type="button" class="linkish" data-showdups="1">' + L.esc(L.t("chip.dups.show")) + "</button>" }) + "</span>" : "";
    el.hidden = !chips.length && !dup;
    el.innerHTML = chips.map((c) => '<button type="button" class="fchip" data-clear="' + c.key + '" aria-label="' + L.esc(L.t("chip.remove", { t: c.text })) + '"><span>' + L.esc(c.text) + '</span><b aria-hidden="true">✕</b></button>').join("") +
      (chips.length > 1 ? '<button type="button" class="linkish" data-clearall="1">' + L.esc(L.t("chip.clearall")) + "</button>" : "") + dup;
  }
  function clearChip(key) {
    const f = S.f;
    if (key === "q") f.q = ""; else if (key === "dis") f.dis = ""; else if (key === "src") f.src = ""; else if (key === "price") f.pmin = f.pmax = ""; else if (key === "area") f.amin = f.amax = "";
    else if (key === "road") f.road = ""; else if (key === "age") f.age = ""; else if (key === "cut") f.cut = false; else if (key === "maponly") $("fMapOnly").checked = false;
    else if (key === "finder") { S.fon = false; store.set("jagga.fon", false); recomputeFinder(); if (!$("finder").hidden) renderFinderForm(); }
    writeUI(); S.shown = PAGE; S.fitNext = true; renderList();
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L || !document.getElementById("map")) { $("map").innerHTML = '<p class="empty">' + L.esc(L.t("map.unavailable")) + "</p>"; return; }
    map = window.L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([28.2, 84.2], 7);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
    canvas = window.L.canvas({ padding: 0.5 });
    layerL = window.L.layerGroup().addTo(map); layerS = window.L.layerGroup().addTo(map); layerH = window.L.layerGroup().addTo(map); layerC = window.L.layerGroup();
    const have = {}; D.meta.districts.forEach((d) => { have[d.district_id] = d.n; });
    layerB = window.L.geoJSON(D.boundaries, {
      style: (f) => (have[f.properties.id] ? { color: "#1d3f66", weight: 1, fillColor: "#1d3f66", fillOpacity: 0.07 } : { color: "#aab2c0", weight: 1, fillOpacity: 0, dashArray: "3 4" }),
      onEachFeature: (f, layer) => layer.bindTooltip(L.esc(L.t(have[f.properties.id] ? "map.dis.n" : "map.dis.none", { name: f.properties.name, n: have[f.properties.id] })), { sticky: true })
    });
    D.catalysts.forEach((c) => {
      const word = (pre, v) => (L.t(pre + "." + v) !== pre + "." + v ? L.t(pre + "." + v) : v);                 // a known kind or stage in the chosen language, else as the data says it
      const tip = "<b>" + L.esc(c.name) + "</b><br>" + L.esc(L.t("map.cat.line", { kind: word("cat.kind", c.kind), stage: word("cat.stage", c.stage) })) +
        '<br><span class="judge">' + L.esc(L.t("map.cat.judge", { p: Math.round((c.priced_in || 0) * 100) })) + "</span>";
      if (c.path) window.L.polyline(c.path, { color: "#9c7640", weight: 3, dashArray: "6 6" }).bindPopup(tip).addTo(layerC);
      window.L.circle([c.lat, c.lon], { radius: (c.radius_km || 0) * 1000, color: "#9c7640", weight: 1, fillOpacity: 0.06 }).bindPopup(tip).addTo(layerC);
    });
    layerA = window.L.layerGroup().addTo(map); window.JAGGA_ANCHORS = layerA;       // exposed for the browser test, like JAGGA_MAP
    window.JAGGA_MAP = map; window.JAGGA_HOVER = layerH; window.JAGGA_MARKERS = () => markers; map.on("zoomend", drawMarkers); map.on("click", onMapClick);
    map.on("moveend", () => { if (!mapShown()) return; const b = map.getBounds(); S.bounds = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; if ($("fMapOnly").checked && !S.fitNext) { S.shown = PAGE; renderList(); } S.fitNext = false; });
  }
  // ---------- map: distance clustering, recomputed on zoom (no library) ----------
  const CELL = 56;                                   // px: listings closer than this on screen merge into one numbered circle
  function drawMarkers() {
    if (!map) return;
    layerL.clearLayers(); markers = new Map(); clusterOf = new Map();
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
        const area = l.prec === "palika";            // located only to its municipality's centre: a dashed ring, so it is never read as "the plot is here"
        const m = window.L.circleMarker([l.lat, l.lon], area ? { renderer: canvas, radius: 9, color: pctColor(l.c), weight: 2.5, dashArray: "3 3", fillColor: pctColor(l.c), fillOpacity: 0.14 }
          : { renderer: canvas, radius: 6, color: "#ffffff", weight: 1.5, fillColor: pctColor(l.c), fillOpacity: 0.92 });
        m.on("click", () => openDrawer(l.id, true));
        m.on("mouseover", () => hover(l.id, true, "pin")); m.on("mouseout", () => hover(l.id, false, "pin"));
        m.bindTooltip(L.esc(priceText(l)) + "/" + UNIT_LABEL[S.f.unit] + (l.prec === "palika" ? L.esc(L.t("map.pin.palika")) : l.prec && l.prec !== "exact" ? L.esc(L.t("map.pin.approx")) : ""), { direction: "top" });
        m.addTo(layerL); markers.set(l.id, m);
        return;
      }
      const lat = g.reduce((a, l) => a + l.lat, 0) / g.length, lon = g.reduce((a, l) => a + l.lon, 0) / g.length;
      const ps = g.map((l) => l.p).filter((x) => x != null).sort((a, b) => a - b);
      const lo = ps[0], hi = ps[ps.length - 1];
      const nArea = g.filter((l) => l.prec === "palika").length, mostlyArea = nArea * 2 >= g.length;          // a circle made of ads placed only to a municipality sits on that municipality's centre, not on any plot
      const icon = window.L.divIcon({ className: "", iconSize: [36, 36], html: '<div class="cl' + (mostlyArea ? " area" : "") + '" role="img" aria-label="' + L.esc(L.t("map.cl.n", { n: g.length }) + (mostlyArea ? L.t("map.cl.area") : "")) + '">' + L.digits(g.length) + "</div>" });
      const m = window.L.marker([lat, lon], { icon: icon, keyboard: false });
      m.bindTooltip(L.esc(L.t("map.cl.n", { n: g.length }) + (mostlyArea ? L.t("map.cl.tip.area", { n: nArea }) : "") + (ps.length ? L.t("map.cl.range", { lo: L.fmtMoney(L.perUnit(lo, S.f.unit, T)), hi: L.fmtMoney(L.perUnit(hi, S.f.unit, T)), unit: UNIT_LABEL[S.f.unit] }) : "")), { direction: "top" });
      m.on("click", () => {
        const b = window.L.latLngBounds(g.map((l) => [l.lat, l.lon]));
        if (b.getNorthEast().equals(b.getSouthWest()) || map.getZoom() >= 17) {          // same point (a locality centroid): list them instead of zooming forever
          window.L.popup().setLatLng([lat, lon]).setContent('<div class="foot">' + L.esc(L.t("map.cl.here", { n: g.length })) + "</div>" + g.slice(0, 12).map((l) => '<button class="btn btn-ghost" type="button" data-open="' + l.id + '"><span>' + L.esc(priceText(l)) + " · " + L.esc(l.t.slice(0, 28)) + "</span></button>").join("")).openOn(map);
        } else map.fitBounds(b, { padding: [50, 50], maxZoom: 17 });
      });
      g.forEach((x) => clusterOf.set(x.id, m));
      m.on("mouseover", () => g.slice(0, 60).forEach((x) => { const c = cardEl(x.id); if (c) c.classList.add("hot"); }));       // a circle lights every card it holds
      m.on("mouseout", () => document.querySelectorAll(".card.hot").forEach((c) => c.classList.remove("hot")));
      m.addTo(layerL);
    });
    pinSelected();
    if (hovId) paintHover(hovId);
  }
  function renderMap() {
    if (!map) return;
    const pts = visible.filter((l) => l.lat != null).map((l) => [l.lat, l.lon]);
    if (S.fitNext && pts.length && !$("fMapOnly").checked) { map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); }
    S.fitNext = false;
    drawMarkers();
  }
  /** The selected listing gets its own pin on a separate layer, so it stays visible even when clustering hides its marker. */
  const mapShown = () => !!map && map.getContainer().offsetWidth > 0 && map.getContainer().offsetHeight > 0;      // hidden (the shortlist page, a phone's list tab): Leaflet cannot measure it
  function settleMap() { if (map) setTimeout(() => { if (mapShown()) map.invalidateSize(); }, 60); }       // the map column changes width when the X-Ray opens or closes
  function pinSelected() {
    if (!layerS) return;
    layerS.clearLayers();
    const l = S.sel && byId.get(S.sel);
    if (!l || l.lat == null) return;
    window.L.circleMarker([l.lat, l.lon], { radius: 15, color: "#1d3f66", weight: 3, fillColor: "#1d3f66", fillOpacity: 0.12, interactive: false }).addTo(layerS);
    window.L.circleMarker([l.lat, l.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: pctColor(l.c), fillOpacity: 1, interactive: false }).addTo(layerS);
  }
  function showOnMap(l) {
    if (!map || l.lat == null) return;
    if (window.matchMedia("(max-width: 900px)").matches && !document.body.classList.contains("show-map")) return;   // map hidden on phones until its tab is open
    const z = Math.max(map.getZoom(), l.prec === "palika" ? 11 : 15);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if ($("fMapOnly").checked) S.fitNext = true;           // this move comes from a card click: do not re-filter the list under the reader (moveend clears the flag)
    if (calm) map.setView([l.lat, l.lon], z); else map.flyTo([l.lat, l.lon], z, { duration: 0.6 });
  }
  // ---------- two-way hover: a card lights its pin, a pin or a circle lights its card(s) ----------
  const cardEl = (id) => document.querySelector('.card[data-id="' + id + '"]');
  const cssVar = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
  /** The pin under the pointer (or keyboard focus) gets a ring on its own layer, so it shows even when clustering has merged it into a numbered circle (that circle is lit too). */
  function paintHover(id) {
    if (layerH) layerH.clearLayers();
    document.querySelectorAll(".cl.hl").forEach((e) => e.classList.remove("hl"));
    const l = id && byId.get(id);
    if (!l) return;
    const cm = clusterOf.get(id);
    if (cm && cm._icon && cm._icon.firstElementChild) cm._icon.firstElementChild.classList.add("hl");
    if (!layerH || l.lat == null) return;
    const c = cssVar("--brand", "#1d3f66");
    window.L.circleMarker([l.lat, l.lon], { radius: 17, color: c, weight: 3, fillColor: c, fillOpacity: 0.16, interactive: false }).addTo(layerH);
    window.L.circleMarker([l.lat, l.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: pctColor(l.c), fillOpacity: 1, interactive: false }).addTo(layerH);
  }
  /** After a short dwell (so sweeping across pins does not make the list jump), bring a card that is off screen into view. */
  function revealCard(card) {
    const top = parseInt(cssVar("--top-h", "132"), 10) || 132, r = card.getBoundingClientRect();
    if (r.top < top + 8 || r.bottom > window.innerHeight - 8) card.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function hover(id, on, from) {
    const m = markers.get(id), card = cardEl(id), big = on || S.sel === id;
    if (m) m.setStyle({ radius: big ? 10 : 6, weight: big ? 3 : 1, color: big ? "#131d2b" : "#ffffff" });
    if (card) card.classList.toggle("hot", on);
    if (on) { hovId = id; paintHover(id); } else if (hovId === id) { hovId = null; paintHover(null); }
    clearTimeout(hovTimer);
    if (on && from === "pin" && card) hovTimer = setTimeout(() => revealCard(card), 160);
  }

  // ---------- navigation: Back closes what is open, one layer at a time (the browser's button, a phone's, or the arrow in a panel) ----------
  const NAV = { n: 0, popping: false };
  const navKind = () => (history.state && history.state.app ? history.state.v : null);
  const NAV_REPLACES = { modal: ["modal"], plot: ["plot", "finder", "modal"], finder: ["plot", "finder", "modal"], picks: ["plot", "finder", "modal", "picks"] };
  /** An overlay opens. One history entry per overlay (opening a second replaces the first); a plot or the finder opened FROM the shortlist stacks on it, so Back returns there. */
  function enter(v, id) {
    if (NAV.popping) return;
    const cur = navKind(), st = { app: 1, v: v, id: id || null, n: NAV.n };
    if (cur && NAV_REPLACES[v].indexOf(cur) >= 0) history.replaceState(st, "", location.href);
    else { st.n = ++NAV.n; history.pushState(st, "", location.href); }
  }
  /** The user closes an overlay: unwind its history entry and let the popstate do the closing, so the Back button and the close button are one thing. */
  function leave(kind) { if (NAV.popping || navKind() !== kind) return false; history.back(); return true; }
  function applyView(st) {
    if ($("modal").open) $("modal").close();
    if (st.v === "plot" && st.id && byId.has(st.id)) {
      if (!$("finder").hidden) hideFinder();
      if ($("drawer").hidden || S.sel !== st.id) openDrawer(st.id, false);
    } else if (st.v === "finder") { closeDrawerNow(); if ($("finder").hidden) openFinder(); }
    else if (st.v === "picks") { closeDrawerNow(); if (!$("finder").hidden) hideFinder(); showPicks(); }
    else { closeDrawerNow(); if (!$("finder").hidden) hideFinder(); hidePicks(); }
  }
  window.addEventListener("popstate", (e) => {
    const st = e.state && e.state.app ? e.state : { v: "list", n: 0 };
    NAV.n = st.n || 0; NAV.popping = true;
    try { applyView(st); } finally { NAV.popping = false; }
  });
  /** Filters back to nothing, finder switched off (its criteria are kept), every panel shut, list at the top and the map on all the ads. */
  function resetFilters() {
    S.f = { unit: "aana", aunit: "aana", sort: "new" }; S.sortTouched = false; S.tiers = { 3: true, 2: true, 1: false };
    S.fon = false; store.set("jagga.fon", false); $("fMapOnly").checked = false;
    recomputeFinder(); writeUI(); renderSince(); if (!$("finder").hidden) renderFinderForm();
    S.shown = PAGE; S.fitNext = true; renderList();
  }
  function goHome() {
    NAV.popping = true;
    try { if ($("modal").open) $("modal").close(); closeDrawerNow(); hideFinder(); hidePicks(); } finally { NAV.popping = false; }
    document.body.classList.remove("filters-open", "show-map"); $("tabList").classList.add("on"); $("tabMap").classList.remove("on"); $("tabPicks").classList.remove("on");
    resetFilters();
    history.replaceState({ app: 0 }, "", location.pathname + location.search); NAV.n = 0;
    window.scrollTo(0, 0);
  }

  // ---------- drawer ----------
  /** The listing under MY finder: every criterion I switched on, pass / fail / unknown, with the ad's evidence. */
  function finderCheck(l) {
    const it = FRMAP.get(l.id);
    if (!it || !it.results.length) return "";
    const mark = { pass: "✓", fail: "✗", unknown: "?" };
    const rows = it.results.map((x) => '<li class="ic ' + x.s + '"><b>' + mark[x.s] + " " + L.esc(x.label) + (x.must ? "" : " <small>" + L.esc(L.t("drawer.nice")) + "</small>") + "</b><br>" + L.esc(x.e) + "</li>").join("");
    return '<h3 class="sec">' + L.esc(L.t("drawer.finder", { tier: F.TIER[it.tier] || L.t("drawer.finder.out") })) + '</h3><ul class="factors ideal-list">' + rows + "</ul>" +
      '<p class="foot">' + L.esc(L.t("drawer.finder.foot")) + "</p>";
  }
  function spark(h, unit) {
    if (!h || h.length < 2) return "";
    const vs = h.map((x) => x[1]), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), W = 300, H = 50;
    const pts = h.map((x, i) => (i / (h.length - 1) * W).toFixed(1) + "," + (H - 4 - (hi === lo ? 0.5 : (x[1] - lo) / (hi - lo)) * (H - 8)).toFixed(1)).join(" ");
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + L.esc(L.t("drawer.spark", { n: h.length })) + '"><polyline fill="none" stroke="#bd3519" stroke-width="2" points="' + pts + '"/></svg>';
  }
  function openDrawer(id, fromMap) {
    const l = byId.get(id); if (!l) return;
    if (!$("finder").hidden) hideFinder();                 // the finder and the X-Ray share the left side: opening a plot puts the finder away (its criteria stay)
    if ($("drawer").hidden) S.lastFocus = document.activeElement;
    S.sel = id; updateStepper(id);
    if (S.picks && $("drawer").hidden) S.picksY = window.scrollY;           // coming from the shortlist: Back returns to the same place in it
    enter("plot", id);
    $("dBody").innerHTML = '<h2 id="dTitle">' + L.esc(L.niceTitle(l.t)) + '</h2><p class="foot" role="status">' + L.esc(L.t("drawer.loading")) + "</p>";
    $("drawer").hidden = false; document.body.classList.add("sel-open"); settleMap(); $("dClose").focus();
    loadDetail([id]).then(() => { if (S.sel === id) renderDrawer(id, fromMap); },
      () => { if (S.sel === id) $("dBody").insertAdjacentHTML("beforeend", '<p class="empty">' + L.esc(L.t("drawer.loaderr")) + "</p>"); });
  }
  /** A server sentence in the chosen language, HTML-escaped, with its 'JUDGEMENT CALLS' marker shown as the translated label (the drawer, the compare table and the print window all use it:
   *  the compare table once showed the English marker inside a Nepali sentence). */
  const judged = (m) => L.esc(L.msg(m)).replace(/JUDGEMENT CALLS?/g, '<span class="judge">' + L.esc(L.t("drawer.judge")) + "</span>");

  function renderDrawer(id, fromMap) {
    const l = byId.get(id), dt = detailOf(id);
    document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
    let card = cardEl(id);
    if (!card && fromMap) {                                  // a pin whose card is beyond the rendered page: load pages up to it
      const j = visible.findIndex((x) => x.id === id);
      if (j >= S.shown) { S.shown = Math.min(visible.length, j + 1 + PAGE); renderList(); card = cardEl(id); }
    }
    if (card) { card.classList.add("sel"); if (fromMap) card.scrollIntoView({ block: "center" }); }
    const ok = dt.x.ok.map((f) => '<li><b>' + L.esc(L.factor(f.f)) + "</b><br>" + judged(f.d) +
      (f.s ? '<br><a class="src" href="' + L.esc(L.safeUrl(f.s)) + '" target="_blank" rel="noopener noreferrer">' + L.esc(L.t("drawer.src")) + "</a>" : "") + "</li>").join("");
    const no = dt.x.no.map((m) => '<li class="no"><b>' + L.esc(L.factor(m.f)) + "</b> " + L.esc(L.t("drawer.missing")) + "<br>" + L.esc(L.msg(m.w)) + "</li>").join("");
    const per = ["aana", "ropani", "sqft", "sqm"].map((u) => "<dt>" + L.esc(L.t("ui.per", { unit: UNIT_LABEL[u] })) + "</dt><dd>" + L.esc(L.fmtMoney(L.perUnit(l.p, u, T))) + "</dd>").join("");
    const approx = l.prec === "palika" ? L.t("drawer.approx.palika") : l.prec === "locality" ? L.t("drawer.approx.locality") : "";
    $("dBody").innerHTML =
      '<h2 id="dTitle">' + L.esc(L.niceTitle(l.t)) + "</h2>" +
      '<div class="price">' + L.esc(priceText(l)) + perText(l) + "</div>" +
      '<h3 class="sec">' + L.esc(L.t("drawer.glance")) + '</h3><ul class="glance">' + L.glance(l, { today: new Date(), unit: S.f.unit, T: T, flags: D.meta.flags }).map((x) => "<li>" + L.esc(x) + "</li>").join("") + "</ul>" +
      '<h3 class="sec">' + L.esc(L.t("drawer.numbers")) + '</h3><dl class="kv"><dt>' + L.esc(L.t("kv.total")) + "</dt><dd>" + L.esc(l.tot ? L.fmtMoney(l.tot) : l.ms ? L.t("kv.total.depends") : L.t("kv.na")) + "</dd><dt>" + L.esc(L.t("kv.area")) + "</dt><dd>" + L.esc(areaText(l)) + "</dd>" +
      (l.p != null ? per : "") + "<dt>" + L.esc(L.t("kv.place")) + "</dt><dd>" + L.esc(placeText(l)) + L.esc(approx) + "</dd>" +
      (l.po ? "<dt>" + L.esc(L.t("kv.dated")) + "</dt><dd>" + L.esc(L.digits(l.po)) + "</dd>" : "") + (l.fac ? "<dt>" + L.esc(L.t("kv.facing")) + "</dt><dd>" + L.esc(l.fac) + "</dd>" : "") +
      "<dt>" + L.esc(L.t("kv.first")) + "</dt><dd>" + L.esc(L.digits(l.fs || "?")) + "</dd><dt>" + L.esc(L.t("kv.last")) + "</dt><dd>" + L.esc(L.digits(l.ls || "?")) + "</dd></dl>" + earthBlock(l) + neverRemoves(l) +
      finderCheck(l) +
      '<h3 class="sec">' + L.esc(L.t("drawer.evidence")) + ' <small class="foot">' + L.esc(L.t("drawer.evidence.note")) + '</small></h3><ul class="factors">' + ok + no + "</ul>" +
      (dt.ask && dt.ask.length ? '<details class="ask"><summary>' + L.esc(L.t("drawer.ask", { n: dt.ask.length })) + "</summary><ol class=\"factors\">" + L.askHTML(dt.ask) + "</ol></details>" : "") +
      (dt.h && dt.h.length > 1 ? '<h3 class="sec">' + L.esc(L.t("drawer.history")) + "</h3>" + spark(dt.h) : "") +
      '<p><a class="btn btn-primary" href="' + L.esc(L.safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer"><span>' + L.esc(L.t("drawer.ad")) + "</span></a> " +
      '<button class="btn btn-outline" type="button" data-star="' + l.id + '" aria-pressed="' + !!S.watch[l.id] + '"><span>' + L.esc(L.t(S.watch[l.id] ? "card.saved" : "card.save")) + "</span></button> " +
      (l.lat != null ? '<button class="btn btn-ghost only-narrow" type="button" data-showmap="' + l.id + '"><span>' + L.esc(L.t("drawer.showmap")) + "</span></button> " : "") +
      '<button class="btn btn-ghost" type="button" data-copy="1"><span>' + L.esc(L.t("drawer.copylink")) + "</span></button></p>" +
      '<h3 class="sec">' + L.esc(L.t("drawer.notes")) + '</h3><label class="sr" for="note">' + L.esc(L.t("drawer.notes.label")) + '</label><textarea id="note" class="notes" placeholder="' + L.esc(L.t("drawer.notes.ph")) + '"></textarea>';
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
    $("dPos").textContent = i < 0 ? "" : L.digits((i + 1) + " / " + visible.length);
    $("dPrev").disabled = i <= 0; $("dNext").disabled = i < 0 || i >= visible.length - 1;
  }
  function closeDrawerNow() {
    $("drawer").hidden = true; document.body.classList.remove("sel-open"); settleMap(); S.sel = null; pinSelected(); document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
    if (S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus(); pushHash();
  }
  function closeDrawer() { if (!leave("plot")) closeDrawerNow(); }

  // ---------- modals ----------
  function openModal(title, html) { $("mTitle").textContent = L.t("modal." + title.replace(/ /g, "_")); $("mBody").innerHTML = html; $("modal").showModal(); enter("modal", title); }
  /** Close the dialog and, unless another one opens at once (`keepEntry`), drop its history entry so Back does not stop on a dialog that is gone. */
  function closeModal(keepEntry) {
    if (!$("modal").open) return;
    $("modal").close();
    if (!keepEntry && navKind() === "modal" && !NAV.popping) history.back();
  }
  function coverageHTML() {
    const m = D.meta, n = m.nation, max = Math.max.apply(null, m.districts.map((d) => d.n).concat([1]));
    const have = new Set(m.districts.map((d) => d.district_id));
    const never = L.t("cov.never");
    return "<p>" + L.t("cov.intro", { d1: n.districts[0], d2: n.districts[1], p1: n.palikas[0], p2: n.palikas[1], land: n.land_for_sale, priced: n.priced }) + "</p>" +
      "<h3 class=\"sec\">" + L.esc(L.t("cov.h.sources")) + "</h3><table><tr><th>" + L.esc(L.t("cov.th.source")) + "</th><th class=n>" + L.esc(L.t("cov.th.listings")) + "</th><th>" + L.esc(L.t("cov.th.lastseen")) + "</th><th>" + L.esc(L.t("cov.th.lastfetch")) + "</th></tr>" +
      m.sources.map((s) => "<tr><td>" + L.esc(s.source) + '</td><td class="n">' + L.digits(s.n) + "</td><td>" + L.esc(s.last_seen ? L.digits(s.last_seen) : never) + "</td><td>" + L.esc(s.last_fetch ? L.digits(s.last_fetch) : never) + "</td></tr>").join("") + "</table>" +
      "<h3 class=\"sec\">" + L.esc(L.t("cov.h.districts")) + "</h3><table><tr><th>" + L.esc(L.t("cov.th.district")) + "</th><th class=n>" + L.esc(L.t("cov.th.n")) + "</th><th class=n>" + L.esc(L.t("cov.th.priced")) + "</th><th class=n>" + L.esc(L.t("cov.th.palika")) + "</th><th class=n>" + L.esc(L.t("cov.th.road")) + "</th><th></th></tr>" +
      m.districts.map((d) => "<tr><td>" + L.esc(d.district) + '</td><td class="n">' + L.digits(d.n) + '</td><td class="n">' + L.digits(d.priced) + '</td><td class="n">' + L.digits(d.with_palika) + '</td><td class="n">' + L.digits(d.with_road) + '</td><td><span class="bar" style="width:' + Math.max(2, Math.round(d.n / max * 100)) + 'px"></span></td></tr>').join("") + "</table>" +
      "<h3 class=\"sec\">" + L.esc(L.t("cov.h.nodata")) + "</h3><p>" + L.esc(m.all_districts.filter((d) => !have.has(d.id)).map((d) => d.name).join(", ")) + "</p>" +
      "<p class=\"foot\">" + L.t("cov.foot") + "</p>";
  }
  /** How accurate the numbers are, as measured by an AI reader against the ads' own words (meta.accuracy); nothing at all when nothing was measured. */
  function accuracyHTML(m) {
    const v = L.accuracyView(m.accuracy);
    if (!v) return "";
    const rows = v.rows.map((r) => "<tr><td>" + L.esc(r.source) + "<small>" + L.esc(L.t("acc.n", { n: r.n })) + "</small></td>" + r.cells.map((c) => '<td class="n' + (c.miss ? " bad" : "") + '">' + L.digits(c.text) + "</td>").join("") + "</tr>").join("");
    return '<h3 class="sec">' + L.esc(L.t("acc.h")) + "</h3>" +
      "<p>" + L.t("acc.intro", { line: L.esc(v.line) }) + "</p>" +
      '<div class="tbl-wrap"><table class="acc"><tr><th>' + L.esc(L.t("acc.th.portal")) + '</th><th class="n">' + L.esc(L.t("kv.area")) + '</th><th class="n">' + L.esc(L.t("acc.th.price")) + '</th><th class="n">' + L.esc(L.t("kv.total")) + '</th><th class="n">' + L.esc(L.t("cov.th.district")) + "</th></tr>" + rows + "</table></div>" +
      "<p>" + L.t("acc.foot", { asof: L.esc(L.digits(m.accuracy.as_of)) }) + "</p>" +
      (m.accuracy.note ? '<p class="foot">' + L.esc(L.msg(m.accuracy.note)) + "</p>" : "");
  }
  /** How old the data is, said where the reader is deciding how far to trust the page. */
  function dataAgeHTML(m) {
    const f = L.freshness(m.refresh, new Date());
    return '<h3 class="sec">' + L.esc(L.t("age.h")) + "</h3><p>" + (f ? L.esc(f.text) + L.esc(L.t("age.counted")) : "") + L.esc(L.t("age.p2", { built: L.digits(m.built_at) })) + "</p>";
  }
  function aboutHTML() {
    const m = D.meta;
    const sec = (k) => '<h3 class="sec">' + L.esc(L.t(k)) + "</h3>";
    return "<p>" + L.esc(L.t("about.p1")) + "</p>" + sec("about.h.is") +
      "<p>" + L.t("about.is", { n: m.sources.filter((x) => x.n > 0).length }) + "</p>" +
      "<p>" + L.t("about.isnot") + "</p>" +
      "<p>" + L.t("about.missing") + "</p>" +
      accuracyHTML(m) + dataAgeHTML(m) + sec("about.h.read") + "<p>" + L.t("about.read") + "</p>" + sec("about.h.finder") + "<p>" + L.t("about.finder") + "</p>" + sec("about.h.units") + "<p>" + L.t("about.units") + "</p>" + sec("about.h.govt") +
      "<p>" + (m.govt_valuation_rows ? L.t("about.govt.rows", { n: m.govt_valuation_rows }) + (m.govt_valuation_sources.indexOf("news") >= 0 ? L.t("about.govt.partial") : L.t("about.govt.end")) : L.t("about.govt.none")) + L.t("about.govt.tail") + "</p>" +
      sec("about.h.advice") + "<p>" + L.esc(L.t("about.advice")) + "</p>" + sec("about.h.credits") +
      "<p>" + L.esc(L.t("about.credits", { l1: "CC BY-IGO", l2: "CC BY 4.0", l3: "BSD-2", l4: "SIL OFL 1.1" })) + "</p>" +
      "<p class=\"foot\">" + L.esc(L.t("about.built", { built: L.digits(m.built_at) })) + "</p>";
  }
  const snapKey = (i) => "jagga.snap." + i;
  /** Where a portal has never been seen to take an ad down or mark it sold, a re-check cannot tell a live ad from a dead one: say so. */
  function neverRemoves(l) {
    const s = D.meta.sources.find((x) => x.source === l.src);
    return s && s.n >= 30 && s.removed === 0 ? '<p class="foot">' + L.esc(L.t("drawer.never", { src: l.src })) + "</p>" : "";
  }
  function watchRows() {
    return Object.keys(S.watch).map((i) => {
      const l = byId.get(i), n = store.get("jagga.note." + i, "");
      if (l) return '<tr><td><button class="btn btn-ghost" type="button" data-open="' + i + '"><span>' + L.esc(l.t.slice(0, 48)) + '</span></button></td><td class="n">' + L.esc(priceText(l)) + "</td><td>" + L.esc(n.slice(0, 80)) + "</td></tr>";
      const sn = store.get(snapKey(i), null), title = L.esc(((sn && sn.t) || L.t("watch.untitled")).slice(0, 48));                   // the portal took the ad down: the plot, its price and your note are still yours
      return '<tr class="gone-row"><td>' + (sn && sn.url ? '<a href="' + L.esc(L.safeUrl(sn.url)) + '" target="_blank" rel="noopener noreferrer">' + title + " ↗</a>" : title) +
        '<br><span class="dim">' + L.esc(L.t("watch.gone")) + '</span></td><td class="n">' + (sn && sn.tot != null ? L.esc(L.t("price.total", { m: L.fmtMoney(sn.tot) })) : "") + "</td><td>" + L.esc(n.slice(0, 80)) + "</td></tr>";
    }).join("");
  }
  function watchHTML(msg) {
    const ids = Object.keys(S.watch);
    return (msg ? '<p class="status" role="status">' + L.esc(msg) + "</p>" : "") +
      (ids.length ? "<table><tr><th>" + L.esc(L.t("watch.th.listing")) + "</th><th class=n>" + L.esc(L.t("watch.th.price")) + "</th><th>" + L.esc(L.t("watch.th.note")) + "</th></tr>" + watchRows() + "</table>"
        : '<p class="empty">' + L.esc(L.t("watch.empty")) + "</p>") +
      "<p>" + (ids.length ? '<button class="btn btn-primary" type="button" id="wPrint"><span>' + L.esc(L.t("watch.print")) + "</span></button> " : "") +
      '<button class="btn btn-outline" type="button" id="wExport"><span>' + L.esc(L.t("watch.backup")) + '</span></button> <label class="btn btn-outline" style="display:inline-block"><span>' + L.esc(L.t("watch.restore")) + '</span><input id="wImport" type="file" accept="application/json,.json" class="sr"></label></p>' +
      '<p class="foot">' + L.esc(L.t("watch.foot")) + "</p>";
  }
  function backupNow() {
    const notes = {}, snaps = {};
    Object.keys(S.watch).forEach((i) => {
      const n = store.get("jagga.note." + i, ""); if (n) notes[i] = n;
      const sn = byId.has(i) ? L.snapOf(byId.get(i)) : store.get(snapKey(i), null); if (sn) snaps[i] = sn;
    });
    return L.makeBackup({ watch: S.watch, notes, snaps, searches: saved(), profile: store.get("jagga.profile", "") }, new Date());
  }
  /** Bring a backup file in: merges (the file wins for the same plot), never removes what is already here. -> the sentence to show. */
  function restoreBackup(text) {
    const r = L.parseBackup(text);
    if (!r.ok) return r.error;
    let gone = 0;
    Object.keys(r.watch).forEach((i) => { S.watch[i] = r.watch[i]; if (!byId.has(i)) gone++; });
    Object.keys(r.notes).forEach((i) => store.set("jagga.note." + i, r.notes[i]));
    Object.keys(r.snaps).forEach((i) => { if (!store.get(snapKey(i), null)) store.set(snapKey(i), r.snaps[i]); });
    const all = saved(); Object.keys(r.searches).forEach((n) => { all[n] = r.searches[n]; }); store.set("jagga.saved", all);
    let crit = "";
    if (r.profile && !F.activeIds(S.profile, FLAGS).length) { store.set("jagga.profile", r.profile); S.profile = loadProfile(); recomputeFinder(); crit = L.t("bk.crit"); }
    store.set("jagga.watch", S.watch); $("watchCount").textContent = L.digits(Object.keys(S.watch).length); renderSaved(); renderList();
    const np = Object.keys(r.watch).length, nn = Object.keys(r.notes).length, ns = Object.keys(r.searches).length;
    return L.t("bk.restored", { plots: L.t(np === 1 ? "bk.plot.one" : "bk.plot.many", { n: np }), gone: gone ? L.t("bk.gone", { n: gone }) : "", notes: L.t(nn === 1 ? "bk.note.one" : "bk.note.many", { n: nn }),
      searches: L.t(ns === 1 ? "bk.search.one" : "bk.search.many", { n: ns }), crit: crit, dropped: r.dropped ? L.t(r.dropped === 1 ? "bk.dropped.one" : "bk.dropped.many", { n: r.dropped }) : "" });
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
    else downloadKML(visible, L.t("earth.doc.all", { d: stamp }), "jaggasignal-" + stamp + ".kml", false);
  }

  // ---------- Google Earth ----------
  /** What a placemark says in Earth: the price, area and place the screen shows (the pin's own meaning is added by lib.js). */
  const kmlLines = (l) => [priceText(l) + (l.p != null ? " " + L.t("ui.per", { unit: UNIT_LABEL[S.f.unit] }) : ""), areaText(l), placeText(l)];
  const niceName = (l) => L.niceTitle(l.t);
  function downloadKML(list, name, file, lookAt) { download(file, "application/vnd.google-earth.kml+xml", L.toKML(list, { name, describe: kmlLines, lookAt })); }
  /** A link that opens Earth at the plot, a file that carries its name, price and what the pin means, and the coordinates for Earth's search box.
   *  Google documents no link format, so the file is the dependable route and the text says so. */
  function earthBlock(l) {
    const url = L.earthUrl(l); if (!url) return "";
    return '<p class="earth"><a class="btn btn-outline" href="' + L.esc(url) + '" target="_blank" rel="noopener noreferrer"><span>' + L.esc(L.t("earth.open")) + "</span></a> " +
      '<button class="btn btn-outline" type="button" data-kml="' + l.id + '"><span>' + L.esc(L.t("earth.kml")) + "</span></button> " +
      '<button class="btn btn-ghost" type="button" data-coords="' + l.id + '"><span>' + L.esc(L.t("earth.coords")) + '</span></button> <span class="earth-msg" id="dEarthMsg" role="status"></span>' +
      '<small class="earth-note">' + L.esc(L.earthNote(l) + L.t("earth.help")) + "</small></p>";
  }
  function copyCoords(l, where) {
    const txt = L.coordsText(l), done = () => { where.textContent = L.t("earth.copied", { c: L.digits(txt) }); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => window.prompt(L.t("earth.prompt"), txt));
    else window.prompt(L.t("earth.prompt"), txt);
  }

  // ---------- events ----------
  function toggleWatch(id) {
    if (S.watch[id]) delete S.watch[id]; else { S.watch[id] = "watching"; if (byId.has(id)) store.set(snapKey(id), L.snapOf(byId.get(id))); loadDetail([id]).catch(() => {}); }          // saved now, so the shortlist works offline later
    store.set("jagga.watch", S.watch); $("watchCount").textContent = L.digits(Object.keys(S.watch).length); renderList();
    if (S.sel === id) openDrawer(id);
  }
  function refresh() { readUI(); S.shown = PAGE; S.fitNext = true; renderList(); }
  function syncTopHeight() {            // header height varies with viewport; the map pane and drawer anchor to it
    const h = document.querySelector("header.top").getBoundingClientRect().height;
    document.documentElement.style.setProperty("--top-h", Math.round(h) + "px"); if (mapShown()) map.invalidateSize();
  }
  // ---------- saved searches (browser-local; the filter state is already a URL hash, so a search is just that string) ----------
  const saved = () => store.get("jagga.saved", {});
  function renderSaved() {
    const sel = $("savedSel"), cur = sel.value, all = saved();
    sel.innerHTML = '<option value="">' + L.esc(L.t("ui.savedsearches.ph")) + "</option>" + Object.keys(all).sort().map((n) => '<option value="' + L.esc(n) + '">' + L.esc(n) + "</option>").join("");
    sel.value = all[cur] !== undefined ? cur : "";
  }
  function savedHTML() {
    const names = Object.keys(saved()).sort();
    return '<form id="saveForm"><label for="saveName">' + L.esc(L.t("ss.name")) + "</label>" +
      '<p><input id="saveName" class="notes" style="min-height:0;height:44px" maxlength="60" placeholder="' + L.esc(L.t("ss.ph")) + '" autocomplete="off"></p>' +
      '<p><button class="btn btn-primary" type="submit"><span>' + L.esc(L.t("ss.save")) + "</span></button></p></form>" +
      (names.length ? '<h3 class="sec">' + L.esc(L.t("ss.yours")) + "</h3><table>" + names.map((n) => "<tr><td>" + L.esc(n) + '</td><td><button class="btn btn-ghost" type="button" data-delsaved="' + L.esc(n) + '"><span>' + L.esc(L.t("ss.delete")) + "</span></button></td></tr>").join("") + "</table>" : "") +
      '<p class="foot">' + L.esc(L.t("ss.foot")) + "</p>";
  }
  // ---------- compare (up to 3) ----------
  function toggleCompare(id) {
    const i = S.cmp.indexOf(id);
    if (i >= 0) S.cmp.splice(i, 1); else if (S.cmp.length < 3) S.cmp.push(id); else { $("cmpCount").textContent = L.t("cmp.max"); setTimeout(() => { $("cmpCount").textContent = L.digits(S.cmp.length); }, 1200); return; }
    $("cmpCount").textContent = L.digits(S.cmp.length); renderList();
  }
  function compareHTML() {
    const ls = S.cmp.map((i) => byId.get(i)).filter(Boolean);
    if (ls.length < 2) return '<p class="empty">' + L.esc(L.t("cmp.empty")) + "</p>";
    const row = (label, fn) => "<tr><th scope=\"row\">" + label + "</th>" + ls.map((l) => "<td>" + fn(l) + "</td>").join("") + "</tr>";
    const factor = (l, name) => { const x = detailOf(l.id).x, f = x.ok.find((q) => q.f === name); return f ? judged(f.d) : (x.no.find((q) => q.f === name) ? "<i>" + L.esc(L.t("cmp.missing")) + "</i>" : "–"); };
    return '<table class="cmp-table"><thead><tr><th></th>' + ls.map((l) => '<th scope="col"><button class="btn btn-ghost" type="button" data-open="' + l.id + '"><span>' + L.esc(l.t.slice(0, 34)) + "</span></button></th>").join("") + "</tr></thead><tbody>" +
      row(L.esc(L.t("cmp.row.price", { unit: UNIT_LABEL[S.f.unit] })), (l) => L.esc(priceText(l))) + row(L.esc(L.t("kv.total")), (l) => L.esc(l.tot ? L.fmtMoney(l.tot) : L.t("kv.na"))) +
      row(L.esc(L.t("kv.area")), (l) => L.esc(areaText(l))) + row(L.esc(L.t("cmp.row.road")), (l) => (l.road ? L.esc(L.t("cmp.ft", { n: l.road })) : "–")) + row(L.esc(L.t("kv.place")), (l) => L.esc(placeText(l))) +
      row(L.esc(L.t("cmp.row.comps")), (l) => L.esc(L.compsLabel(l.c) || L.t("cmp.nocomps"))) + row(L.esc(L.t("cmp.row.govt")), (l) => factor(l, "vs government minimum valuation")) +
      row(L.esc(L.t("cmp.row.time")), (l) => factor(l, "time on market")) + row(L.esc(L.t("cmp.row.infra")), (l) => factor(l, "infrastructure nearby")) +
      row(L.esc(L.t("cmp.row.src")), (l) => '<a href="' + L.esc(L.safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">' + L.esc(l.src) + " ↗</a>") + "</tbody></table>";
  }
  // ---------- printable shortlist: a plain light page of the starred listings, their cited X-Ray and your own notes ----------
  function shortlistHTML(ids) {
    const rows = ids.map((id) => {
      const l = byId.get(id), dt = detailOf(id), note = store.get("jagga.note." + id, "");
      const ok = dt.x.ok.map((f) => "<li><b>" + L.esc(L.factor(f.f)) + "</b>: " + judged(f.d) + "</li>").join("");
      const no = dt.x.no.map((m) => "<li class=\"no\"><b>" + L.esc(L.factor(m.f)) + "</b>: " + L.esc(L.t("print.no", { w: L.msg(m.w) })) + "</li>").join("");
      return "<section><h2>" + L.esc(l.t) + "</h2><p class=\"big\">" + L.esc(priceText(l)) + (l.p != null ? " /" + UNIT_LABEL[S.f.unit] : "") + (l.tot && l.p != null ? L.esc(L.t("print.totaltag", { m: L.fmtMoney(l.tot) })) : "") + "</p>" +
        "<p>" + L.esc(areaText(l)) + " · " + L.esc(placeText(l)) + (l.road ? " · " + L.esc(L.t("card.road", { n: l.road })) : "") + (l.po ? L.esc(L.t("print.dated", { d: L.digits(l.po) })) : "") + "</p>" +
        "<ul>" + ok + no + "</ul>" + (dt.ask && dt.ask.length ? "<h3>" + L.esc(L.t("print.ask")) + "</h3><ol class=\"ask\">" + L.askHTML(dt.ask, "why") + "</ol>" : "") + (note ? "<p class=\"note\"><b>" + L.esc(L.t("print.notes")) + "</b> " + L.esc(note) + "</p>" : "") +
        "<p class=\"src\">" + L.esc(L.t("print.orig", { u: L.safeUrl(l.url) })) + "</p></section>";
    }).join("");
    return "<!doctype html><meta charset=\"utf-8\"><title>" + L.esc(L.t("print.title")) + "</title><style>body{font:13px/1.45 Georgia,'Noto Sans Devanagari','Nirmala UI',Mangal,serif;max-width:780px;margin:20px auto;padding:0 14px;color:#111}" +
      "h1{font:700 20px sans-serif}h2{font:700 15px sans-serif;margin:0}section{border-top:2px solid #111;padding:10px 0;break-inside:avoid}.big{font:700 17px sans-serif;margin:2px 0}" +
      "ul,ol{margin:6px 0;padding-left:18px}h3{font:700 13px sans-serif;margin:10px 0 2px}.who{font:700 10px sans-serif;text-transform:uppercase;border:1px solid #111;padding:0 4px;margin-right:4px}.why{display:block;color:#555;font-size:11px}.no{color:#666}.note{background:#f3f3f3;padding:6px 8px}.src{font-size:11px;color:#444;word-break:break-all}.fine{font-size:11px;color:#444}</style>" +
      "<h1>" + L.esc(L.t("print.h1", { n: ids.length })) + "</h1><p class=\"fine\">" + L.esc(L.t("print.fine", { d: L.digits(new Date().toISOString().slice(0, 10)) })) + "</p>" + rows;
  }
  function printShortlist() {
    const ids = Object.keys(S.watch).filter((i) => byId.has(i));
    if (!ids.length) return;
    const w = window.open("", "_blank");
    if (!w) { $("mBody").insertAdjacentHTML("afterbegin", '<p class="empty">' + L.esc(L.t("print.blocked")) + "</p>"); return; }
    w.document.write("<p>" + L.esc(L.t("print.preparing")) + "</p>");
    loadDetail(ids).then(() => { w.document.open(); w.document.write(shortlistHTML(ids)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); },
      () => { w.document.body.textContent = L.t("print.err"); });
  }
  function copyLink(where) {
    const done = () => { if (where) where.textContent = L.t("link.copied"); else $("dBody").insertAdjacentHTML("afterbegin", '<p class="judge" role="status">' + L.esc(L.t("link.copied")) + "</p>"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, () => window.prompt(L.t("link.prompt"), location.href));
    else window.prompt(L.t("link.prompt"), location.href);
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
    $("finderCount").textContent = FR ? L.t("finder.count", { n: FR.counts[3] }) : "";
    drawAnchors();
    syncFit();
  }
  /** "Best fit" is the finder's order, so it means nothing without criteria: say so, and switch to it by itself the first time criteria exist (until the reader picks an order). */
  function syncFit() {
    const opt = $("fSort").querySelector('option[value="fit"]'); if (!opt) return;
    const has = F.activeIds(S.profile, FLAGS).length > 0;
    opt.disabled = !FR; opt.textContent = L.t(FR ? "ui.sort.fit.on" : has ? "ui.sort.fit.off" : "ui.sort.fit");
    if (FR && !S.sortTouched && S.f.sort !== "fit") { S.f.sort = "fit"; $("fSort").value = "fit"; }
    else if (!FR && S.f.sort === "fit") { S.f.sort = "new"; $("fSort").value = "new"; }
  }
  /** The places chosen under "near": a circle each, so the radius is visible on the map. */
  function drawAnchors() {
    if (!layerA) return;
    layerA.clearLayers();
    const r = S.profile.rows.near;
    if (!FR || !r || !r.on) return;
    r.places.forEach((p) => window.L.circle([p.lat, p.lon], { radius: p.km * 1000, color: "#bd3519", weight: 1.5, dashArray: "5 5", fillOpacity: 0.06, interactive: false }).addTo(layerA)
      && window.L.circleMarker([p.lat, p.lon], { radius: 5, color: "#ffffff", weight: 2, fillColor: "#bd3519", fillOpacity: 1, interactive: false }).bindTooltip(L.esc(p.n) + ": " + p.km + " km", { permanent: false }).addTo(layerA));
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
  const placeLabel = (p) => p[0] + (p[1] === "landmark" ? L.t("place.landmark") : p[1] ? " (" + (L.t("kind." + String(p[1]).replace(/-/g, "_")) !== "kind." + String(p[1]).replace(/-/g, "_") ? L.t("kind." + String(p[1]).replace(/-/g, "_")) : p[1]) + ")" : "");
  const dname = (id) => (D.meta.districts.find((d) => d.district_id === id) || { district: id }).district;

  function rowHTML(id) {
    const r = S.profile.rows[id], def = F.ROWS.find((x) => x.id === id), flag = id.slice(0, 5) === "flag_" ? FLAGS.find((f) => "flag_" + f.k === id) : null;
    const label = flag ? L.t("finder.flag.row", { w: L.flagLabel(flag) }) : def.label;
    const ph = (k) => L.esc(L.t("finder.ph." + k));
    const num = (p, phk, w) => '<input class="num" inputmode="decimal" data-fr="' + id + '" data-fp="' + p + '" value="' + L.esc(r[p]) + '" placeholder="' + (/^\d+$/.test(phk) ? L.esc(L.digits(phk)) : ph(phk)) + '" aria-label="' + L.esc(label + ": " + L.t("finder.aria." + (w || p))) + '">';
    const unit = (p, opts) => '<select data-fr="' + id + '" data-fp="' + p + '" aria-label="' + L.esc(L.t("finder.unit.label")) + '">' + opts.map((u) => '<option value="' + u + '"' + (r[p] === u ? " selected" : "") + ">" + L.esc(L.t("finder.unit." + u)) + "</option>").join("") + "</select>";
    let body = "";
    if (id === "where") {
      body = '<div class="chips">' + r.dis.map((d) => '<span class="pchip">' + L.esc(dname(d)) + '<button type="button" data-rmdis="' + L.esc(d) + '" aria-label="' + L.esc(L.t("finder.remove", { n: dname(d) })) + '">✕</button></span>').join("") + "</div>" +
        '<select data-adddis="1" aria-label="' + L.esc(L.t("finder.where.add")) + '"><option value="">' + L.esc(L.t("finder.where.add.ph")) + "</option>" + D.meta.districts.filter((d) => r.dis.indexOf(d.district_id) < 0).map((d) => '<option value="' + L.esc(d.district_id) + '">' + L.esc(d.district) + " (" + L.digits(d.n) + ")</option>").join("") + "</select>";
    } else if (id === "size") body = L.t("finder.f.size", { min: num("min", "min"), max: num("max", "max"), unit: unit("unit", ["ropani", "aana", "kattha", "dhur", "bigha", "sqm"]) });
    else if (id === "budget") body = L.t("finder.f.budget", { total: num("total", "any", "total"), punit: unit("punit", ["aana", "ropani", "kattha", "dhur", "sqft", "sqm"]), pmax: num("pmax", "any", "pmax") });
    else if (id === "road") body = L.t("finder.f.road", { min: num("min", "ft") });
    else if (id === "hills") body = L.t("finder.f.hills", { min: num("min", "min"), max: num("max", "max") }) + '<span class="hint">' + L.esc(L.t("finder.hint.hills")) + "</span>";
    else if (id === "near") {
      body = '<div class="chips">' + r.places.map((p, i) => '<span class="pchip">' + L.t("finder.f.near.item", { n: L.esc(p.n), input: '<input class="num" inputmode="decimal" data-place="' + i + '" value="' + p.km + '" aria-label="' + L.esc(L.t("finder.aria.kmfrom", { n: p.n })) + '">' }) + '<button type="button" data-rmplace="' + i + '" aria-label="' + L.esc(L.t("finder.remove", { n: p.n })) + '">✕</button></span>').join("") + "</div>" +
        '<input data-addplace="1" list="placeList" placeholder="' + L.esc(L.t("finder.near.ph")) + '" aria-label="' + L.esc(L.t("finder.near.add")) + '" style="flex:1;min-width:180px"><datalist id="placeList"></datalist>' +
        '<button class="btn btn-outline" type="button" data-pick="1" style="min-height:36px"><span>' + L.esc(L.t("finder.near.pick")) + "</span></button>" +
        '<span class="hint">' + L.esc(L.t("finder.hint.near")) + "</span>";
    } else if (id === "city") body = L.t("finder.f.city", { km: num("km", "km") });
    else if (id === "fresh") body = L.t("finder.f.fresh", { days: num("days", "days") }) + '<span class="hint">' + L.esc(L.t("finder.hint.fresh")) + "</span>";
    else if (id === "value") body = L.t("finder.f.value", { pct: num("pct", "25", "pct") });
    else if (id === "trust") body = L.t("finder.f.trust");
    return '<section class="fr ' + (r.on ? "on" : "off") + '" data-row="' + id + '"><header><label><input type="checkbox" data-fr="' + id + '" data-fp="on"' + (r.on ? " checked" : "") + "> <b>" + L.esc(label) + "</b></label>" +
      '<select data-fr="' + id + '" data-fp="must" aria-label="' + L.esc(L.t("finder.isa", { label: label })) + '"><option value="1"' + (r.must ? " selected" : "") + ">" + L.esc(L.t("finder.must")) + '</option><option value="0"' + (r.must ? "" : " selected") + ">" + L.esc(L.t("finder.nice")) + "</option></select></header>" +
      (body ? '<div class="body">' + body + "</div>" : "") + "</section>";
  }
  function renderFinderForm() {
    const groups = {};
    F.ROWS.forEach((r) => { (groups[r.group] = groups[r.group] || []).push(r.id); });
    $("fBody").innerHTML = '<div id="fSum" class="f-sum"></div>' +
      "<h3>" + L.esc(L.t("finder.start")) + '</h3><div class="presets">' + F.PRESETS.map((p) => '<button class="btn btn-outline" type="button" data-preset="' + p.id + '" title="' + L.esc(p.blurb) + '"><span>' + L.esc(p.label) + "</span></button>").join("") +
      '<button class="btn btn-ghost" type="button" data-fclear="1"><span>' + L.esc(L.t("finder.clear")) + "</span></button></div>" +
      Object.keys(groups).map((g) => "<h3>" + L.esc(g) + "</h3>" + groups[g].map(rowHTML).join("")).join("") +
      "<h3>" + L.esc(L.t("finder.h.says")) + "</h3>" + FLAGS.map((f) => rowHTML("flag_" + f.k)).join("") +
      '<div class="f-foot"><label class="chip check"><input id="fOn" type="checkbox"' + (S.fon ? " checked" : "") + "><span>" + L.esc(L.t("finder.filterlist")) + "</span></label>" +
      '<button class="btn btn-outline" type="button" data-fcopy="1"><span>' + L.esc(L.t("finder.copylink")) + "</span></button></div>" +
      '<p class="foot">' + L.esc(L.t("finder.foot")) + "</p>";
    renderFinderSummary();
    if (S.profile.rows.near.on) loadPlaces().then((ps) => { const dl = $("placeList"); if (dl) dl.innerHTML = ps.map((p) => '<option value="' + L.esc(placeLabel(p)) + '">').join(""); }, () => {});
  }
  function renderFinderSummary() {
    const el = $("fSum"); if (!el) return;
    if (!FR) { el.innerHTML = '<div class="foot" style="border:0;margin:0;padding:0">' + L.esc(L.t(F.activeIds(S.profile, FLAGS).length ? "finder.sum.off" : "finder.sum.empty")) + "</div>"; return; }
    const c = FR.counts, tier = (n, label) => '<button type="button" data-tier="' + n + '" aria-pressed="' + !!S.tiers[n] + '">' + L.esc(label) + " <b>" + L.digits(c[n]) + "</b></button>";
    const max = Math.max(1, FR.funnel[0].left);
    const gains = FR.relax.filter((x) => x.gain > 0 && FR.counts[3] < 200).sort((a, b) => b.gain - a.gain);
    el.innerHTML = '<div class="tiers" role="group" aria-label="' + L.esc(L.t("finder.sum.show")) + '">' + tier(3, F.TIER[3]) + tier(2, F.TIER[2]) + tier(1, F.TIER[1]) + "</div>" +
      (c[3] === 0 ? '<p class="judge" role="status" style="margin:8px 0 0">' + L.esc(L.t("finder.sum.nomatch", { tail: L.t(gains.length ? "finder.sum.tail.gains" : "finder.sum.tail.none") })) + "</p>" : "") +
      '<details class="funnel" open><summary>' + L.esc(L.t("finder.funnel.sum")) + "</summary><ol>" +
      FR.funnel.map((f, i) => '<li' + (f.left === 0 ? ' class="zero"' : "") + "><span>" + (i ? L.esc(L.t("finder.funnel.plus")) : "") + L.esc(f.label) + (f.unknown ? " <small>" + L.esc(L.t("finder.funnel.unk", { n: f.unknown })) + "</small>" : "") + "</span><b>" + L.digits(f.left) + '</b><span class="bar" style="width:' + Math.max(1, Math.round(f.left / max * 100)) + '%"></span></li>').join("") + "</ol></details>" +
      (gains.length ? '<div class="relax" role="group" aria-label="' + L.esc(L.t("finder.relax.group")) + '">' + gains.map((g) => '<button class="btn btn-outline" type="button" data-relax="' + L.esc(g.id) + '" title="' + L.esc(L.t("finder.relax.title")) + '"><span>' + L.esc(L.t(g.gain === 1 ? "finder.relax.one" : "finder.relax.many", { label: g.label, n: g.gain })) + "</span></button>").join("") + "</div>" : "");
  }
  function finderChanged(structural) {
    saveProfile(); recomputeFinder();
    if (structural) renderFinderForm(); else renderFinderSummary();
    S.shown = PAGE; S.fitNext = true; renderList();
  }
  function openFinder() {
    if (!$("drawer").hidden) closeDrawerNow();
    if (S.picks) S.picksY = window.scrollY;
    $("finder").hidden = false; document.body.classList.add("finder-open"); settleMap(); $("btnFinder").setAttribute("aria-expanded", "true"); renderFinderForm(); enter("finder");
    const first = $("fBody").querySelector("input,select"); if (first) first.focus();
  }
  function hideFinder() { $("finder").hidden = true; document.body.classList.remove("finder-open"); settleMap(); $("btnFinder").setAttribute("aria-expanded", "false"); }
  function closeFinder() { if (!leave("finder")) { hideFinder(); $("btnFinder").focus(); } }
  function addPlace(p) {
    const r = S.profile.rows.near; if (r.places.length >= F.MAX_PLACES || r.places.some((x) => x.n === p.n && x.lat === p.lat && x.lon === p.lon)) return;
    r.places.push(p); r.on = true; finderChanged(true);
  }
  function onMapClick(e) {
    if (!S.pick) return;
    S.pick = false; document.body.classList.remove("picking");
    addPlace({ n: L.t("finder.mappoint"), lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4), km: 10 });
    if (window.matchMedia("(max-width: 900px)").matches) $("tabList").click();
    openFinder();
  }
  function startPick() {
    S.pick = true; document.body.classList.add("picking"); hideFinder();
    if (window.matchMedia("(max-width: 900px)").matches) $("tabMap").click();
    $("resultsHead").textContent = L.t("finder.pick");
  }
  function finderEvents() {
    const root = $("fBody");
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.place !== undefined) { const p = S.profile.rows.near.places[+t.dataset.place]; if (p && +L.toAscii(t.value) > 0) { p.km = Math.min(500, +L.toAscii(t.value)); finderChanged(false); } return; }
      if (!t.dataset.fr || t.type === "checkbox" || t.tagName === "SELECT") return;
      S.profile.rows[t.dataset.fr][t.dataset.fp] = L.toAscii(t.value); finderChanged(false);
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
      if (p === "on") row.on = t.checked; else if (p === "must") row.must = t.value === "1"; else row[p] = L.toAscii(t.value);
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
      b.textContent = navigator.onLine ? "" : L.t("net.offline", { built: L.digits(D.meta.built_at) });
    };
    window.addEventListener("online", note); window.addEventListener("offline", note); note();
    const starred = Object.keys(S.watch).filter((i) => byId.has(i));
    if (navigator.onLine && starred.length) loadDetail(starred).catch(() => {});
  }
  // ---------- shortlist: the plots that fit, in plain words (the same finder, a quieter page) ----------
  const picksRun = () => (F.activeIds(S.profile, FLAGS).length ? (FR || F.run(D.listings, S.profile, fctx())) : null);
  const mark = { pass: "✓", fail: "✗", unknown: "?" };
  const pm = (v) => L.fmtMoney(v);
  function pickCard(it, n) {
    const l = it.l, checks = it.results.map((x) => '<li class="' + x.s + '"><b class="mk">' + mark[x.s] + '</b><span class="cl2">' + L.esc(x.label) + (x.must ? "" : " <small>" + L.esc(L.t("picks.nice")) + "</small>") +
      '</span><span class="ev">' + L.esc(x.e) + "</span></li>").join("");
    const starred = !!S.watch[l.id];
    return '<article class="pk" data-id="' + l.id + '"><header><span class="pk-n">' + L.digits(n) + '</span><div class="pk-t"><h3><button type="button" data-open="' + l.id + '">' + L.esc(L.niceTitle(l.t)) + "</button></h3>" +
      '<p class="pk-where">' + L.esc(placeText(l)) + " · " + L.esc(l.src) + " · " + L.esc(L.whenText(l)) + "</p></div>" +
      '<div class="pk-price"><b>' + L.esc(priceText(l)) + "</b><small>" + (l.p != null ? "/" + UNIT_LABEL[S.f.unit] + (l.tot ? " · " + L.esc(L.t("price.total", { m: pm(l.tot) })) : "") : "") + "</small></div></header>" +
      '<p class="pk-facts">' + L.esc(areaText(l)) + (l.road ? " · " + L.esc(L.t("card.road", { n: l.road })) : "") + "</p>" +
      '<ul class="pk-checks">' + checks + "</ul>" +
      '<details class="pk-askd" data-ask="' + l.id + '"><summary>' + L.esc(L.t("picks.ask")) + '</summary><div class="pk-ask">' + L.esc(L.t("common.loading")) + "</div></details>" +
      '<p class="pk-actions"><button class="btn btn-primary" type="button" data-open="' + l.id + '"><span>' + L.esc(L.t("picks.details")) + "</span></button> " + '<a class="btn btn-outline" href="' + L.esc(L.safeUrl(l.url)) +
      '" target="_blank" rel="noopener noreferrer"><span>' + L.esc(L.t("picks.orig")) + "</span></a> " + (L.earthUrl(l) ? '<a class="btn btn-outline" href="' + L.esc(L.earthUrl(l)) + '" target="_blank" rel="noopener noreferrer" title="' + L.esc(L.earthNote(l)) + '"><span>' + L.esc(L.t("earth.card")) + "</span></a> " : "") +
      '<button class="btn btn-outline" type="button" data-star="' + l.id + '" aria-pressed="' + starred + '"><span>' + L.esc(L.t(starred ? "card.saved" : "card.save")) + "</span></button></p></article>";
  }
  /** The plots the shortlist page is showing now, in order. */
  const picksShown = () => { const run = picksRun(); return run ? P.sections(run, F, S.picksN || 12).reduce((a, s) => a.concat(s.items.map((it) => it.l)), []) : []; };
  function picksHTML() {
    const run = picksRun(), back = '<button class="btn btn-ghost pk-back" type="button" data-pkback="1"><span>' + L.esc(L.t("picks.all")) + "</span></button>";
    const saved_ = Object.keys(S.watch).filter((i) => byId.has(i));
    const savedBlock = saved_.length ? '<section class="pk-sec"><h2>' + L.esc(L.t("picks.saved")) + " <small>" + L.digits(saved_.length) + '</small></h2><ul class="pk-saved">' + saved_.map((i) => { const l = byId.get(i);
      return '<li><button type="button" class="linkish" data-open="' + i + '">' + L.esc(L.niceTitle(l.t)) + "</button><span>" + L.esc(priceText(l)) + "</span><span class=\"dim\">" + L.esc(placeText(l)) + "</span></li>"; }).join("") + "</ul></section>" : "";
    if (!run) {
      return '<div class="pk-top">' + back + '</div><p class="pk-eyebrow">' + L.esc(L.t("picks.eyebrow")) + "</p><h1>" + L.esc(L.t("picks.h1")) + "</h1>" +
        '<p class="pk-lede">' + L.esc(L.t("picks.lede")) + "</p>" +
        '<div class="pk-presets">' + F.PRESETS.map((x) => '<button type="button" class="pk-preset" data-pkpreset="' + x.id + '"><b>' + L.esc(x.label) + "</b><span>" + L.esc(x.blurb) + "</span></button>").join("") + "</div>" +
        '<p><button class="btn btn-outline" type="button" data-pkbuild="1"><span>' + L.esc(L.t("picks.own")) + "</span></button></p>" + savedBlock;
    }
    const asked = P.describe(S.profile, FLAGS, F, { money: pm, district: dname }), v = P.verdict(run), secs = P.sections(run, F, S.picksN || 12);
    const list = (xs, empty) => xs.length ? "<ul>" + xs.map((x) => "<li>" + L.esc(x.text) + "</li>").join("") + "</ul>" : "<p class=\"dim\">" + L.esc(empty) + "</p>";
    const total = Math.max(1, run.funnel[0].left);
    const funnel = '<ol class="pk-funnel">' + run.funnel.map((f, i) => '<li' + (f.left === 0 ? ' class="zero"' : "") + '><span class="pk-fl">' + (i ? L.esc(L.t("finder.funnel.and")) : "") + L.esc(f.label) + (f.unknown ? " <small>" + L.esc(L.t("finder.funnel.unk", { n: nfmt(f.unknown) })) + "</small>" : "") +
      '</span><span class="pk-fb"><i style="width:' + Math.max(0.6, f.left / total * 100).toFixed(1) + '%"></i></span><span class="pk-fn">' + nfmt(f.left) + "</span></li>").join("") + "</ol>";
    let n = 0;
    const shown = secs.reduce((a, x) => a + x.items.length, 0), more = run.counts[3] + run.counts[2] + (secs.some((x) => x.tier === 1) ? run.counts[1] : 0);
    const cards = secs.map((sec) => '<section class="pk-sec"><h2>' + L.esc(sec.label) + " <small>" + L.digits(sec.total) + "</small></h2>" + sec.items.map((it) => pickCard(it, ++n)).join("") + "</section>").join("");
    return '<div class="pk-top">' + back + '<button class="btn btn-outline" type="button" data-pkbuild="1"><span>' + L.esc(L.t("picks.change")) + "</span></button></div>" +
      '<p class="pk-eyebrow">' + L.esc(L.t("picks.eyebrow")) + (S.profile.name ? " · " + L.esc(S.profile.name) : "") + " · " + L.esc(L.t("picks.checked", { n: nfmt(run.funnel[0].left) })) + "</p>" +
      '<section class="pk-verdict ' + v.tone + '"><h1>' + L.esc(v.head) + "</h1>" + v.lines.map((x) => "<p>" + L.esc(x) + "</p>").join("") + "</section>" +
      '<div class="pk-two"><section class="pk-panel"><h2>' + L.esc(L.t("picks.musts")) + " <small>" + L.esc(L.t("picks.musts.sub")) + "</small></h2>" + list(asked.musts, L.t("picks.musts.none")) + "</section>" +
      '<section class="pk-panel"><h2>' + L.esc(L.t("picks.wishes")) + " <small>" + L.esc(L.t("picks.wishes.sub")) + "</small></h2>" + list(asked.wishes, L.t("picks.wishes.none")) + "</section></div>" +
      '<section class="pk-sec"><h2>' + L.esc(L.t("picks.narrowed")) + "</h2>" + funnel + '<p class="pk-note">' + L.esc(L.t("picks.narrowed.note")) + "</p></section>" +
      (cards || '<section class="pk-sec"><p class="empty">' + L.esc(L.t("picks.nothing")) + "</p></section>") +
      (more > shown ? '<p class="pk-more"><button class="btn btn-outline" type="button" data-pkmore="1"><span>' + L.esc(L.t("picks.more", { n: more - shown })) + "</span></button></p>" : "") +
      savedBlock + earthSection() +
      '<section class="pk-sec pk-share"><h2>' + L.esc(L.t("picks.share.h")) + "</h2><p>" + L.esc(L.t("picks.share.p")) + "</p>" +
      '<p><button class="btn btn-outline" type="button" data-pkcopy="1"><span>' + L.esc(L.t("drawer.copylink")) + '</span></button> <span class="pk-copied" role="status"></span></p></section>' +
      '<p class="pk-note">' + L.esc(L.t("picks.note")) + "</p>";
  }
  function earthSection() {
    const n = picksShown().filter(L.hasPoint).length; if (!n) return "";
    return '<section class="pk-sec pk-share"><h2>' + L.esc(L.t("earth.sl.h")) + "</h2><p>" + L.esc(L.t(n === 1 ? "earth.sl.one" : "earth.sl.many", { n: n })) + "</p>" +
      '<p><button class="btn btn-outline" type="button" data-pkkml="1"><span>' + L.esc(L.t("earth.sl.btn")) + "</span></button></p></section>";
  }
  function renderPicks() { $("pkBody").innerHTML = picksHTML(); }
  function showPicks() {
    if (!$("drawer").hidden) closeDrawerNow();
    if (!$("finder").hidden) hideFinder();
    const was = S.picks;
    S.picks = true; document.body.classList.add("picks-open"); $("picks").hidden = false; renderPicks();
    $("tabPicks").classList.add("on"); $("tabList").classList.remove("on"); $("tabMap").classList.remove("on"); document.body.classList.remove("show-map");
    syncTopHeight(); window.scrollTo(0, was ? S.picksY : 0); enter("picks"); pushHash();
  }
  function hidePicks() {
    if (!S.picks) return;
    S.picks = false; $("picks").hidden = true; document.body.classList.remove("picks-open"); $("tabPicks").classList.remove("on"); $("tabList").classList.add("on"); syncTopHeight();
  }
  function closePicks() { if (!leave("picks")) { hidePicks(); pushHash(); } }
  function picksEvents() {
    const root = $("pkBody");
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (d.pkback) closePicks();
      else if (d.pkbuild) openFinder();
      else if (d.pkpreset) { S.profile = F.applyPreset(d.pkpreset, FLAGS); S.fon = true; store.set("jagga.fon", true); finderChanged(true); if (!S.sortTouched) { S.f.sort = "fit"; writeUI(); } renderPicks(); }
      else if (d.pkmore) { S.picksN = (S.picksN || 12) + 12; const y = window.scrollY; renderPicks(); window.scrollTo(0, y); }
      else if (d.pkcopy) { pushHash(); copyLink(root.querySelector(".pk-copied")); }
      else if (d.pkkml) { const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ""); downloadKML(picksShown(), L.t("earth.doc.sl", { d: stamp }), "jaggasignal-shortlist-" + stamp + ".kml", false); }
      else if (d.star) { e.stopPropagation(); toggleWatch(d.star); const y = window.scrollY; renderPicks(); window.scrollTo(0, y); }
    });
    root.addEventListener("toggle", (e) => {                       // the seller questions load when asked for: they live in the detail shards
      const t = e.target; if (!t.dataset || !t.dataset.ask || !t.open) return;
      loadDetail([t.dataset.ask]).then(() => { const dt = detailOf(t.dataset.ask); t.querySelector(".pk-ask").innerHTML = dt.ask && dt.ask.length ? '<ol class="factors">' + L.askHTML(dt.ask) + "</ol>" : '<p class="dim">' + L.esc(L.t("picks.ask.none")) + "</p>"; },
        () => { t.querySelector(".pk-ask").textContent = L.t("picks.ask.err"); });
    }, true);
  }

  // ---------- price guide: what sellers ask per place, with the reported government rate beside it ----------
  const GS = { size: "all", sort: "n", q: "" };
  let guideP = null;
  function loadGuide() {
    if (window.JAGGA_GUIDE) return Promise.resolve(window.JAGGA_GUIDE);
    if (!guideP) guideP = new Promise((res, rej) => {
      const sc = document.createElement("script"); sc.src = "guide.js";
      sc.onload = () => res(window.JAGGA_GUIDE); sc.onerror = () => { guideP = null; rej(new Error("price guide unavailable")); };
      document.head.appendChild(sc);
    });
    return guideP;
  }
  function guideTable() {
    const rows = L.guideRows(window.JAGGA_GUIDE, { size: GS.size, sort: GS.sort, q: GS.q, unit: S.f.unit, T: T });
    if (!rows.length) return '<p class="empty">' + L.esc(L.t("guide.empty")) + "</p>";
    const ask = (c) => !c ? '<span class="dim">' + L.esc(L.t("guide.none")) + "</span>" : c.thin ? '<span class="dim">' + L.esc(L.t(c.n === 1 ? "guide.thin.one" : "guide.thin.many", { c: c.text, n: c.n })) + "</span>"
      : "<b>" + L.esc(c.text) + "</b><br><small>" + L.esc(L.t("guide.cell", { range: c.range, n: c.n })) + "</small>";
    const dl = (k) => ' data-label="' + L.esc(L.t(k)) + '"';
    return '<div class="tbl-wrap"><table class="guide"><thead><tr><th>' + L.esc(L.t("guide.th.place")) + "</th><th>" + L.esc(L.t("guide.th.recent", { unit: UNIT_LABEL[S.f.unit] })) + "</th><th>" + L.esc(L.t("guide.th.any")) + "</th><th>" + L.esc(L.t("guide.th.govt")) + "</th><th></th></tr></thead><tbody>" +
      rows.map((r) => "<tr><td" + dl("guide.th.place") + ">" + L.esc(r.label) + "</td><td" + dl("guide.dl.recent") + ">" + ask(r.recent) + "</td><td" + dl("guide.th.any") + ">" + ask(r.any) + "</td>" +
        "<td" + dl("guide.dl.govt") + ">" + (r.govt ? "<b>" + L.esc(r.govt.text) + "</b><br><small>" + L.esc(L.t(r.govt.n === 1 ? "guide.govt.one" : "guide.govt.many", { fy: r.govt.fy, n: r.govt.n })) + ' · <a class="src" href="' + L.esc(L.safeUrl(r.govt.url)) + '" target="_blank" rel="noopener noreferrer">' + L.esc(r.govt.source) + " ↗</a></small>" : '<span class="dim">' + L.esc(L.t("guide.notloaded")) + "</span>") + "</td>" +
        '<td><button class="btn btn-ghost" type="button" data-gshow="' + L.esc(r.id) + '"><span>' + L.esc(L.t("guide.show")) + "</span></button></td></tr>").join("") + "</tbody></table></div>";
  }
  /** The phone's menu: what the wide screen keeps in the top bar. Each button hands over to the real one. */
  function openMenu() {
    const item = (id, label) => '<button class="btn btn-outline" type="button" data-menu="' + id + '"><span>' + label + "</span></button>";
    openModal("menu", '<div class="menu-list">' + item("btnWatch", L.esc(L.t("menu.saved", { n: Object.keys(S.watch).length }))) + item("btnCompare", L.esc(L.t("menu.compare", { n: S.cmp.length }))) + item("btnGuide", L.esc(L.t("ui.guide"))) +
      item("btnCoverage", L.esc(L.t("menu.cov"))) + item("btnAbout", L.esc(L.t("menu.about"))) +
      item("btnLang", $("btnLang").textContent.trim()) + ($("btnDigits").hidden ? "" : item("btnDigits", $("btnDigits").textContent.trim())) +
      '</div><h3 class="sec">' + L.esc(L.t("menu.dl")) + '</h3><div class="exports"><button class="btn btn-ghost" type="button" data-export="csv"><span>CSV</span></button>' +
      '<button class="btn btn-ghost" type="button" data-export="geojson"><span>GeoJSON</span></button><button class="btn btn-ghost" type="button" data-export="kml"><span>' + L.esc(L.t("ui.export.kml")) + "</span></button></div>");
  }
  function guideHTML() {
    const g = window.JAGGA_GUIDE, opt = (v, label, cur) => '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + label + "</option>";
    return "<p>" + L.t("guide.intro", { n: g.n_asks, r: g.n_recent }) + "</p>" +
      '<div class="gctl"><label class="chip"><span class="lbl">' + L.esc(L.t("guide.l.plots")) + '</span><select data-g="size" aria-label="' + L.esc(L.t("guide.l.size")) + '">' + opt("all", L.esc(L.t("guide.o.all")), GS.size) + opt("small", L.esc(L.t("guide.o.small", { n: g.small_max_aana })), GS.size) + "</select></label>" +
      '<label class="chip"><span class="lbl">' + L.esc(L.t("guide.l.priceper")) + '</span><select data-g="unit" aria-label="' + L.esc(L.t("ui.priceunit")) + '">' + ["aana", "ropani", "kattha", "dhur", "bigha", "sqft", "sqm"].map((u) => opt(u, UNIT_LABEL[u], S.f.unit)).join("") + "</select></label>" +
      '<label class="chip"><span class="lbl">' + L.esc(L.t("ui.sort")) + '</span><select data-g="sort" aria-label="' + L.esc(L.t("guide.l.sortplaces")) + '">' + opt("n", L.esc(L.t("guide.o.n")), GS.sort) + opt("high", L.esc(L.t("guide.o.high")), GS.sort) + opt("low", L.esc(L.t("guide.o.low")), GS.sort) + opt("name", L.esc(L.t("guide.o.name")), GS.sort) + "</select></label>" +
      '<label class="chip"><span class="sr">' + L.esc(L.t("guide.find")) + '</span><input data-g="q" placeholder="' + L.esc(L.t("guide.find.ph")) + '" value="' + L.esc(GS.q) + '"></label></div>' +
      '<div id="gTable">' + guideTable() + "</div>" +
      '<p class="foot">' + L.t("guide.foot", { k: g.min_asks }) + "</p>";
  }
  function openGuide() {
    loadGuide().then(() => openModal("price guide", guideHTML()), () => openModal("price guide", '<p class="empty">' + L.esc(L.t("guide.err")) + "</p>"));
  }
  function guideEvents() {
    const root = $("mBody");
    const upd = (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.g) return;
      if (t.dataset.g === "unit") { S.f.unit = t.value; $("fUnit").value = t.value; refresh(); } else GS[t.dataset.g] = t.value;
      $("gTable").innerHTML = guideTable();
    };
    root.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.g === "q") upd(e); });
    root.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.g && e.target.dataset.g !== "q") upd(e); });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-gshow]"); if (!b) return;
      const r = window.JAGGA_GUIDE.rows.find((x) => x.id === b.dataset.gshow); if (!r) return;
      S.f.dis = r.district_id || ""; S.f.q = r.level === "district" ? "" : r.name; writeUI(); closeModal(); refresh();
    });
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
    const older = found ? L.t(found === 1 ? "since.older.one" : "since.older.many", { n: found }) : "", d = L.esc(L.digits(prev));
    b.innerHTML = (on ? "<span>" + L.t(n === 1 ? "since.on.one" : "since.on.many", { n: n, d: d, older: older }) + "</span>"
        : n ? "<span>" + L.t(n === 1 ? "since.n.one" : "since.n.many", { n: n, d: d, older: older }) + "</span>"
        : "<span>" + L.t("since.none", { d: d, older: older }) + "</span>") +
      (on ? '<button class="btn btn-outline" type="button" id="sinceAll" style="min-height:34px"><span>' + L.esc(L.t("since.all")) + "</span></button>"
        : n ? '<button class="btn btn-outline" type="button" id="sinceOnly" style="min-height:34px"><span>' + L.esc(L.t("since.only")) + "</span></button>" : "");
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
    applyStatic(); initLangButtons();
    D.meta.districts.forEach((d) => $("fDis").insertAdjacentHTML("beforeend", '<option value="' + L.esc(d.district_id) + '">' + L.esc(d.district) + " (" + L.digits(d.n) + ")</option>"));
    D.meta.sources.forEach((s) => $("fSrc").insertAdjacentHTML("beforeend", '<option value="' + L.esc(s.source) + '">' + L.esc(s.source) + " (" + L.digits(s.n) + ")</option>"));
    const cuts = D.listings.filter((l) => L.isCut(l)).length;     // honest filter: no genuine seller price cut observed yet => say so
    if (!cuts) { $("fCut").disabled = true; $("fCut").parentElement.title = L.t("ui.pricecut.none.title"); $("fCut").nextElementSibling.textContent = L.t("ui.pricecut.none"); }
    S.profile = loadProfile(); S.tiers = { 3: true, 2: true, 1: false }; S.fon = store.get("jagga.fon", true); S.pick = false;
    const BOOT = location.hash.slice(1);                         // read once: starting the finder and the list rewrites the fragment (pushHash) before the deep link below is looked at
    Object.assign(S.f, L.parseHash(location.hash));
    S.sortTouched = /(?:^|&)sort=/.test(BOOT);                // an order chosen in a shared link stays
    if (S.f.fresh) { S.f.age = "7"; delete S.f.fresh; }          // old shared links used fresh=1 ("new this week")
    writeUI();
    $("watchCount").textContent = L.digits(Object.keys(S.watch).length); $("cmpCount").textContent = L.digits(S.cmp.length);
    Object.keys(S.watch).forEach((i) => { if (byId.has(i) && !store.get(snapKey(i), null)) store.set(snapKey(i), L.snapOf(byId.get(i))); });          // plots saved before records existed
    $("foot").innerHTML = L.esc(L.t("foot.built", { built: L.digits(D.meta.built_at) })) + " · " + D.meta.sources.map((s) => L.esc(L.t("foot.fetched", { source: s.source, d: s.last_fetch ? L.digits(s.last_fetch) : L.t("cov.never") }))).join(" · ") +
      ' · <button class="btn btn-ghost" type="button" data-cov="1"><span>' + L.esc(L.t("foot.cov", { a: D.meta.nation.districts[0], b: D.meta.nation.districts[1] })) + "</span></button><br>" + L.esc(L.t("foot.tool"));
    initMap(); recomputeFinder(); initSince(); renderFresh(); initOffline(); syncTopHeight(); window.addEventListener("resize", debounce(syncTopHeight, 100)); readUI(); renderList();
    const want = hashState(BOOT); if (want && byId.has(want)) openDrawer(want, false);
    else if (/(?:^|&)picks(?:&|$)/.test(BOOT)) showPicks();


    $("fSort").addEventListener("change", () => { S.sortTouched = true; });
    ["fDis", "fSrc", "fUnit", "fAunit", "fSort", "fAge", "fCut", "fDups"].forEach((id) => $(id).addEventListener("change", refresh));
    finderEvents(); $("btnFinder").addEventListener("click", () => ($("finder").hidden ? openFinder() : closeFinder())); $("fClose").addEventListener("click", closeFinder); $("fBack").addEventListener("click", closeFinder);
    ["fPmin", "fPmax", "fAmin", "fAmax", "fRoad"].forEach((id) => $(id).addEventListener("input", debounce(refresh, 250)));
    $("q").addEventListener("input", debounce(refresh, 200)); $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); refresh(); });
    $("fMapOnly").addEventListener("change", () => { S.shown = PAGE; renderList(); });
    $("histSvg").addEventListener("click", (e) => {
      const r = e.target.closest("rect"); if (!r) return;
      const round = (x) => String(+(x >= 1000 ? Math.round(x / 100) * 100 : x.toPrecision(2)));
      S.f.pmin = round(+r.dataset.lo); S.f.pmax = round(+r.dataset.hi); writeUI(); refresh();
    });
    $("btnGuide").addEventListener("click", openGuide); guideEvents();
    if (window.matchMedia("(max-width: 900px)").matches) $("moreFilters").open = true;                  // on a phone the filters panel shows everything
    document.addEventListener("click", (e) => { const m = $("moreFilters"); if (m.open && !m.contains(e.target) && !window.matchMedia("(max-width: 900px)").matches) m.open = false; });
    $("btnMenu").addEventListener("click", openMenu);
    $("mBody").addEventListener("click", (e) => { const b = e.target.closest("[data-menu]"); if (b) { closeModal(true); $(b.dataset.menu).click(); } });
    $("btnFilters").addEventListener("click", () => {
      const open = document.body.classList.toggle("filters-open"); $("btnFilters").setAttribute("aria-expanded", open); syncTopHeight();
    });
    document.addEventListener("click", (e) => { if (e.target.closest("#emptyReset")) $("btnReset").click(); });
    if (!store.get("jagga.welcomed", false) && !hashState(BOOT) && !/(?:^|&)(fp=|picks(?:&|$))/.test(BOOT)) $("welcome").hidden = false;
    $("welcomeOk").addEventListener("click", () => { $("welcome").hidden = true; store.set("jagga.welcomed", true); });
    $("btnReset").addEventListener("click", resetFilters);
    $("brand").addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); goHome(); });
    $("btnPicks").addEventListener("click", () => (S.picks ? closePicks() : showPicks())); $("tabPicks").addEventListener("click", () => (S.picks ? closePicks() : showPicks()));
    $("activeChips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.clear) clearChip(b.dataset.clear); else if (b.dataset.clearall) resetFilters(); else if (b.dataset.showdups) { S.f.dups = true; writeUI(); refresh(); } });
    picksEvents();
    $("btnMore").addEventListener("click", () => { S.shown += PAGE; renderList(); });
    $("lyL").addEventListener("change", (e) => map && (e.target.checked ? layerL.addTo(map) : map.removeLayer(layerL)));
    $("lyB").addEventListener("change", (e) => map && (e.target.checked ? layerB.addTo(map).bringToBack() : map.removeLayer(layerB)));
    $("lyC").addEventListener("change", (e) => map && (e.target.checked ? layerC.addTo(map) : map.removeLayer(layerC)));
    $("dClose").addEventListener("click", closeDrawer); $("dBack").addEventListener("click", closeDrawer); $("mClose").addEventListener("click", () => closeModal()); $("modal").addEventListener("cancel", (e) => { e.preventDefault(); closeModal(); });
    $("btnCoverage").addEventListener("click", () => openModal("coverage", coverageHTML()));
    $("btnAbout").addEventListener("click", () => openModal("about", aboutHTML()));
    $("btnCompare").addEventListener("click", () => { openModal("compare", '<p class="foot" role="status">' + L.esc(L.t("common.loading")) + "</p>"); loadDetail(S.cmp).then(() => { $("mBody").innerHTML = compareHTML(); }, () => { $("mBody").innerHTML = '<p class="empty">Could not load the details.</p>'; }); });
    renderSaved();
    $("savedSel").addEventListener("change", (e) => {
      const h = saved()[e.target.value]; if (h === undefined) return;
      S.f = Object.assign({ unit: "aana", aunit: "aana", sort: "new" }, L.parseHash("#" + h)); writeUI(); refresh();
    });
    $("btnSave").addEventListener("click", () => { openModal("save search", savedHTML()); $("saveName").focus(); });
    $("btnWatch").addEventListener("click", () => openModal("saved plots", watchHTML()));
    $("tabList").addEventListener("click", () => { if (S.picks) closePicks(); document.body.classList.remove("show-map"); $("tabList").classList.add("on"); $("tabMap").classList.remove("on"); });
    $("tabMap").addEventListener("click", () => { if (S.picks) hidePicks(); document.body.classList.add("show-map"); $("tabMap").classList.add("on"); $("tabList").classList.remove("on"); if (map) setTimeout(() => map.invalidateSize(), 50); });
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
      const t = e.target.closest("[data-star],[data-cmp],[data-open],[data-showmap],[data-kml],[data-coords],[data-cov],[data-export],.card"); if (!t) return;
      if (t.dataset.cmp) { e.stopPropagation(); toggleCompare(t.dataset.cmp); }
      else if (t.dataset.kml) { const l = byId.get(t.dataset.kml); if (l) downloadKML([l], niceName(l), "jaggasignal-plot-" + l.id + ".kml", true); }
      else if (t.dataset.coords) { const l = byId.get(t.dataset.coords); if (l) copyCoords(l, $("dEarthMsg")); }
      else if (t.dataset.star) { e.stopPropagation(); toggleWatch(t.dataset.star); }
      else if (t.dataset.open) { closeModal(true); openDrawer(t.dataset.open, false); }
      else if (t.dataset.showmap) {                      // phones: leave the X-Ray, open the map tab on this listing, keep its pin
        const id = t.dataset.showmap, l = byId.get(id);
        $("drawer").hidden = true; document.body.classList.remove("sel-open"); $("tabMap").click();
        setTimeout(() => { if (map) { map.invalidateSize(); S.sel = id; pinSelected(); showOnMap(l); } }, 80);
      }
      else if (t.dataset.cov) openModal("coverage", coverageHTML());
      else if (t.dataset.export) { doExport(t.dataset.export); t.closest("details").open = false; }
      else if (t.classList.contains("card")) openDrawer(t.dataset.id, false);
    });
    const leaves = (c, e) => !(e.relatedTarget && c.contains(e.relatedTarget));          // moving between a card's own children is not leaving it
    document.addEventListener("mouseover", (e) => { const c = e.target.closest(".card"); if (c && c.dataset.id !== hovId) hover(c.dataset.id, true, "card"); });
    document.addEventListener("mouseout", (e) => { const c = e.target.closest(".card"); if (c && leaves(c, e)) hover(c.dataset.id, false, "card"); });
    document.addEventListener("focusin", (e) => { const c = e.target.closest && e.target.closest(".card"); if (c) hover(c.dataset.id, true, "card"); });
    document.addEventListener("focusout", (e) => { const c = e.target.closest && e.target.closest(".card"); if (c && leaves(c, e)) hover(c.dataset.id, false, "card"); });
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "saveForm") return;
      e.preventDefault(); const name = $("saveName").value.trim(); if (!name) return;
      const all = saved(); all[name] = L.toHash(S.f); store.set("jagga.saved", all); renderSaved(); $("savedSel").value = name; closeModal();
    });
    document.addEventListener("click", (e) => {
      const d = e.target.closest("[data-delsaved]");
      if (d) { const all = saved(); delete all[d.dataset.delsaved]; store.set("jagga.saved", all); renderSaved(); $("mBody").innerHTML = savedHTML(); }
      if (e.target.closest("[data-copy]")) copyLink();
      if (e.target.closest("#wPrint")) printShortlist();
      if (e.target.closest("#wExport")) download("jaggasignal-backup-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".json", "application/json", JSON.stringify(backupNow(), null, 2));
    });
    document.addEventListener("change", (e) => {
      if (e.target.id !== "wImport" || !e.target.files[0]) return;
      e.target.files[0].size > 2e6 ? ($("mBody").innerHTML = watchHTML(L.t("bk.toolarge"))) :
        e.target.files[0].text().then((t) => { $("mBody").innerHTML = watchHTML(restoreBackup(t)); }).catch(() => { $("mBody").innerHTML = watchHTML(L.t("bk.unreadable")); });
    });
  }
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  init();
})();
