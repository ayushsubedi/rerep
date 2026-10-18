/* Pure logic for the Jaggasignal site: units, Nepali money, filtering, sorting, exports.
 * No DOM access here, so it is unit-tested under Node (tests/js/lib.test.mjs).
 * Unit constants come from data.js (generated from units.py): one source of truth. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JaggaLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SQFT = 0.09290304;

  /** Square metres per unit. `units` is meta.units from data.js (ropani, aana, paisa, daam, bigha, kattha, dhur). */
  function unitTable(units) {
    return Object.assign({}, units, { sqft: SQFT, sqm: 1 });
  }

  function perUnit(pps, unit, table) {
    if (pps == null) return null;
    if (!(unit in table)) throw new Error("unknown unit " + unit);
    return pps * table[unit];
  }

  /** NPR/unit entered by the user -> NPR/m2. */
  function toPps(valuePerUnit, unit, table) {
    if (!(unit in table)) throw new Error("unknown unit " + unit);
    return valuePerUnit / table[unit];
  }

  function trim2(x) { return String(+x.toFixed(2)); }

  /** Nepali digit grouping words: crore (1e7), lakh (1e5), thousand. */
  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return "-";
    const a = Math.abs(n);
    if (a >= 1e7) return "Rs " + trim2(n / 1e7) + " crore";
    if (a >= 1e5) return "Rs " + trim2(n / 1e5) + " lakh";
    return "Rs " + Math.round(n).toLocaleString("en-US");   // below a lakh people say "Rs 45,000", not "45 thousand"
  }

  /** Same quantisation as units.Area.as_hill/as_terai: round to whole daam/dhur first, then divmod. */
  function areaNotation(sqm, system, units) {
    if (sqm == null) return "-";
    if (system === "terai") {
      const dhur = Math.round(sqm / (units.bigha / 400));
      const bigha = Math.floor(dhur / 400), rem = dhur % 400;
      return bigha + "-" + Math.floor(rem / 20) + "-" + (rem % 20);
    }
    const daam = Math.round(sqm / (units.ropani / 256));
    const ropani = Math.floor(daam / 256), rem = daam % 256;
    return ropani + "-" + Math.floor(rem / 16) + "-" + Math.floor((rem % 16) / 4) + "-" + (rem % 4);
  }

  function daysSince(dateStr, today) {
    if (!dateStr) return null;
    const d = Date.parse(dateStr + "T00:00:00Z"), t = (today instanceof Date ? today : new Date()).getTime();
    return Math.max(0, Math.floor((t - d) / 86400000));
  }

  /** Area in the words people use: "16 ropani", "4 aana 2 paisa", "2 kattha 16 dhur" (the dash notation 16-0-0-0 is for the X-Ray). '' when it is too small to say. */
  function areaPlain(sqm, system, units) {
    if (sqm == null) return "";
    const names = system === "terai" ? ["bigha", "kattha", "dhur"] : ["ropani", "aana", "paisa", "daam"];
    const parts = areaNotation(sqm, system, units).split("-").map(Number);
    return parts.map(function (n, i) { return n ? n + " " + names[i] : ""; }).filter(Boolean).join(" ");
  }

  /** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago", "2.8 years ago". */
  function relTime(days) {
    if (days == null) return "";
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return days + " days ago";
    if (days < 60) return Math.floor(days / 7) + " weeks ago";
    if (days < 365) return Math.floor(days / 30) + " months ago";
    return (Math.round(days / 36.5) / 10) + " years ago";
  }

  /** When the PORTAL says the ad was put up, in words: 'posted 6 days ago', 'updated 3 months ago', 're-listed ...', or that no date is stated. */
  function whenText(l, today) {
    if (!l.po) return "date not stated";
    const verb = l.pk === "updated" ? "updated" : l.pk === "relisted" ? "re-listed" : l.pk === "posted" ? "posted" : "dated";
    return verb + " " + relTime(daysSince(l.po, today));
  }

  /** How old the data is, from when each crawled portal last answered (meta.refresh: [{source, last_ok: "YYYY-MM-DD HH:MM", UTC}]).
   *  -> {text, stale, detail}: 'Data refreshed 5 hours ago'; stale (over 3 days) says what that means. null when nothing was ever crawled. */
  function freshness(refresh, now) {
    const t = (now instanceof Date ? now : new Date()).getTime();
    const rows = (refresh || []).filter(function (r) { return r.last_ok; }).map(function (r) {
      return { source: r.source, hours: Math.max(0, (t - Date.parse(r.last_ok.replace(" ", "T") + ":00Z")) / 36e5) };
    });
    if (!rows.length) return null;
    const say = function (h) { return h < 1 ? "less than an hour ago" : h < 24 ? Math.floor(h) + (Math.floor(h) === 1 ? " hour" : " hours") + " ago" : relTime(Math.floor(h / 24)); };
    const newest = Math.min.apply(null, rows.map(function (r) { return r.hours; }));
    const old = rows.filter(function (r) { return r.hours > 72; });
    const detail = rows.map(function (r) { return r.source + " " + say(r.hours); }).join(", ");
    if (newest > 72) return { stale: true, text: "Data last refreshed " + say(newest) + ". Ads posted, removed or re-priced since then are missing.", detail: detail };
    if (old.length) return { stale: true, text: "Data refreshed " + say(newest) + ", but " + old.map(function (r) { return r.source + " was last checked " + say(r.hours); }).join(", ") + ".", detail: detail };
    return { stale: false, text: "Data refreshed " + say(newest), detail: detail };
  }

  /** A price against its comparables, in plain words for a card. c: {p: percentile (low = cheap), n, rel}. */
  function compsPlain(c) {
    if (!c) return null;
    return c.p < 25 ? "cheaper than most similar ads" : c.p > 75 ? "dearer than most similar ads" : "mid-priced for its area";
  }

  var FLAG_WORDS = { view: "a view", farm: "farming", water: "water", stay: "tourism use", paved: "a paved road", flat: "level ground", quiet: "a quiet setting" };

  /** "At a glance": 4-8 plain sentences built ONLY from what is already known about the ad (nothing is estimated here).
   *  o: {today, unit (price unit key), T (unit table), units (area units), flags: meta.flags}. */
  function glance(l, o) {
    const out = [], T = o.T, per = function (u) { return fmtMoney(perUnit(l.p, u, T)); };
    if (l.p != null) out.push("Asking " + per(o.unit) + " per " + (o.unit === "sqft" ? "sq ft" : o.unit === "sqm" ? "m²" : o.unit) + (l.tot ? ", " + fmtMoney(l.tot) + " for the whole plot" : "") + ".");
    else if (l.tot) out.push("Asking " + fmtMoney(l.tot) + " for the whole plot. The area could not be read, so there is no price per aana to compare.");
    if (l.p != null) {
      if (l.c && l.c.rel !== "weak") out.push("Cheaper than about " + (100 - l.c.p) + "% of the " + l.c.n + " similar ads nearby (same area, land type and road).");
      else if (l.c) out.push("Only compared with the whole district, which is a weak comparison: locations differ a lot.");
      else out.push("Not enough similar ads nearby to say whether this price is high or low.");
    }
    out.push(l.road ? "Road: " + l.road + " ft wide, as the ad states." : "The ad does not state the road width: ask.");
    if (!l.po) out.push("The portal gives no posting date: ask how long it has been for sale.");
    else out.push("The portal says it was " + whenText(l, o.today) + (l.pk === "updated" || l.pk === "relisted" ? "; when it was first posted is not stated" : "") +
      (daysSince(l.po, o.today) > 180 ? ". It is still listed, but confirm it is still for sale" : "") + ".");
    out.push(l.prec === "exact" ? "The map pin comes from the ad itself." : l.prec === "locality" ? "Location is approximate (the village or area, not the plot): do not trust distances." :
      l.prec === "palika" ? "Only the municipality is known: the pin is at its centre, not at the plot." : "The ad gives no usable location.");
    if (l.el != null) out.push("About " + l.el.toLocaleString("en-US") + " m above sea level (terrain model, about 150 m resolution).");
    else if (l.er) out.push("The municipality spans about " + l.er[0].toLocaleString("en-US") + " to " + l.er[1].toLocaleString("en-US") + " m above sea level; the plot's own height is not known.");
    const names = (o.flags || []).map(function (f, i) { return (l.tf || 0) >> i & 1 ? FLAG_WORDS[f.k] || f.label : null; }).filter(Boolean);
    if (names.length) out.push("The ad mentions: " + names.join(", ") + ". That is what the seller wrote, not something we measured.");
    if (l.tw) out.push("Probably listed " + (l.tw + 1) + " times (same district, area, price and place). It counts once in comparisons.");
    return out;
  }

  /** "New" means the PORTAL dated the ad within a week. Being first seen by us recently only means we found it recently:
   *  a sweep can discover hundreds of old ads in one day. No posted date => never called new. */
  function isNewAd(l, today) {
    if (l.pk === "updated" || l.pk === "relisted") return false;       // a date the ad was touched is not the date it was posted
    const n = daysSince(l.po, today);
    return n != null && n <= 7;
  }

  /** Posted after the visitor's previous visit, by the PORTAL's date. When WE first found an ad says nothing about when it was posted (one sweep found 1,335 old ads in a day). */
  function postedSince(l, prev) {
    if (l.pk === "updated" || l.pk === "relisted") return false;
    return !!l.po && l.po > prev;
  }

  function isCut(l) {
    if (l.cut != null) return !!l.cut;                 // precomputed in the slim list payload
    const h = l.h || [];
    return h.length > 1 && h[h.length - 1][1] < h[h.length - 2][1];
  }

  /** Short, honest label for the comps position. Weak comparisons are marked as such. */
  function compsLabel(c) {
    if (!c) return null;
    const side = c.p < 25 ? "cheap vs comps" : c.p > 75 ? "dear vs comps" : "mid vs comps";
    return side + " (" + c.p + "th pct, " + c.n + (c.rel === "weak" ? ", weak" : "") + ")";
  }

  /** f: {q, dis, src, cls, unit, pmin, pmax, aunit, amin, amax, road, age, fresh, cut, bounds:[s,w,n,e]} */
  function filter(listings, f, table) {
    const q = (f.q || "").trim().toLowerCase();
    const pmin = f.pmin ? toPps(+f.pmin, f.unit || "aana", table) : null;
    const pmax = f.pmax ? toPps(+f.pmax, f.unit || "aana", table) : null;
    const amin = f.amin ? +f.amin * table[f.aunit || "aana"] : null;
    const amax = f.amax ? +f.amax * table[f.aunit || "aana"] : null;
    const today = f.today || new Date();
    return listings.filter(function (l) {
      if (q && !((l.t + " " + l.loc + " " + l.pal + " " + l.dis).toLowerCase().includes(q))) return false;
      if (f.dis && l.dk !== f.dis) return false;
      if (f.src && l.src !== f.src) return false;
      if (f.cls && (l.cls || "").toLowerCase() !== f.cls) return false;
      if ((pmin != null || pmax != null) && l.p == null) return false;
      if (pmin != null && l.p < pmin) return false;
      if (pmax != null && l.p > pmax) return false;
      if ((amin != null || amax != null) && l.a == null) return false;
      if (amin != null && l.a < amin) return false;
      if (amax != null && l.a > amax) return false;
      if (f.road && (l.road == null || l.road < +f.road)) return false;
      if (f.fresh && !isNewAd(l, today)) return false;
      if (f.age) {                                       // posted within N days, by the PORTAL's date; undated ads cannot qualify
        const n = daysSince(l.po, today);
        if (n == null || n > +f.age) return false;
      }
      if (l.dup && !f.dups) return false;
      if (f.cut && !isCut(l)) return false;
      if (f.since && !postedSince(l, f.since)) return false;         // posted (by the portal's date) after the visitor's previous visit
      if (f.bounds) {
        if (l.lat == null) return false;
        const b = f.bounds;
        if (l.lat < b[0] || l.lat > b[2] || l.lon < b[1] || l.lon > b[3]) return false;
      }
      return true;
    });
  }

  const SORTS = {
    price: function (a, b) { return nullsLast(a.p, b.p, 1); },
    "-price": function (a, b) { return nullsLast(a.p, b.p, -1); },
    total: function (a, b) { return nullsLast(a.tot, b.tot, 1); },
    "-area": function (a, b) { return nullsLast(a.a, b.a, -1); },
    new: function (a, b) { return (b.po || "").localeCompare(a.po || "") || (b.fs || "").localeCompare(a.fs || ""); },   // the portal's date: a sweep finds hundreds of old ads in one day
    value: function (a, b) { return nullsLast(a.c && a.c.p, b.c && b.c.p, 1); }
  };
  function nullsLast(x, y, dir) {
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  }
  function sort(list, key) { return list.slice().sort(SORTS[key] || SORTS.price); }

  /** Log-spaced histogram of positive values (prices span orders of magnitude). Returns {edges, counts, min, max, median}. */
  function histogram(values, bins) {
    const v = values.filter((x) => x != null && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const lo = Math.log(v[0]), hi = Math.log(v[v.length - 1]), n = bins || 24;
    const span = hi - lo || 1;
    const edges = [], counts = new Array(n).fill(0);
    for (let i = 0; i <= n; i++) edges.push(Math.exp(lo + (span * i) / n));
    // epsilon: a value exactly on an edge belongs to the upper bin (log() rounding would otherwise drop it into the lower one)
    v.forEach((x) => { counts[Math.min(n - 1, Math.floor(((Math.log(x) - lo) / span) * n + 1e-9))]++; });
    const mid = v.length >> 1;
    return { edges: edges, counts: counts, min: v[0], max: v[v.length - 1], median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2 };
  }

  // -- URL state -----------------------------------------------------------------------------
  const KEYS = ["q", "dis", "src", "cls", "unit", "pmin", "pmax", "aunit", "amin", "amax", "road", "age", "fresh", "cut", "dups", "sort"];
  function toHash(f) {
    const p = [];
    KEYS.forEach(function (k) { if (f[k] !== undefined && f[k] !== "" && f[k] !== false && f[k] !== null) p.push(k + "=" + encodeURIComponent(f[k] === true ? "1" : f[k])); });
    return p.join("&");
  }
  function parseHash(h) {
    const f = {};
    String(h || "").replace(/^#/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      const i = kv.indexOf("="), k = kv.slice(0, i);
      if (KEYS.indexOf(k) < 0) return;               // ignore unknown keys: the hash is user-controlled input
      const v = decodeURIComponent(kv.slice(i + 1));
      f[k] = (k === "fresh" || k === "cut" || k === "dups") ? v === "1" : v;
    });
    return f;
  }

  // -- exports (F18) -------------------------------------------------------------------------
  const CSV_COLS = [["id", "id"], ["title", "t"], ["locality", "loc"], ["palika", "pal"], ["district", "dis"], ["area_sqm", "a"],
    ["npr_per_sqm", "p"], ["price_total_npr", "tot"], ["road_ft", "road"], ["source", "src"], ["url", "url"], ["first_seen", "fs"],
    ["last_seen", "ls"], ["price_confidence", "pc"], ["lat", "lat"], ["lon", "lon"], ["location_precision", "prec"]];
  function csvCell(v) {
    if (v == null) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // neutralise spreadsheet formula injection from scraped text
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(listings) {
    const rows = [CSV_COLS.map(function (c) { return c[0]; }).join(",")];
    listings.forEach(function (l) { rows.push(CSV_COLS.map(function (c) { return csvCell(l[c[1]]); }).join(",")); });
    return rows.join("\n") + "\n";
  }
  function toGeoJSON(listings) {
    return {
      type: "FeatureCollection",
      features: listings.filter(function (l) { return l.lat != null; }).map(function (l) {
        return {
          type: "Feature", geometry: { type: "Point", coordinates: [l.lon, l.lat] },
          properties: { id: l.id, title: l.t, district: l.dis, palika: l.pal, area_sqm: l.a, npr_per_sqm: l.p, url: l.url, location_precision: l.prec }
        };
      })
    };
  }
  function xmlEsc(s) { return String(s == null ? "" : s).replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  function toKML(listings) {
    const pm = listings.filter(function (l) { return l.lat != null; }).map(function (l) {
      return "<Placemark><name>" + xmlEsc(l.t) + "</name><description>" + xmlEsc((l.dis || "") + " | " + fmtMoney(l.tot) + " | " + (l.url || "")) +
        "</description><Point><coordinates>" + l.lon + "," + l.lat + ",0</coordinates></Point></Placemark>";
    });
    return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>' + pm.join("") + "</Document></kml>";
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /** Only http(s) links may be rendered as hrefs: data comes from scraped sources. */
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }

  // -- 'before you pay' list (verify.py builds the items; this only renders them) ----------------------------------------------
  var WHO = { seller: "seller", office: "land office", site: "on site", you: "you" };
  function askHTML(ask, cls) {
    return (ask || []).map(function (a) {
      return '<li><span class="who">' + esc(WHO[a.o] || a.o) + "</span> " + esc(a.a) + ' <span class="' + (cls || "why") + '">Because: ' + esc(a.w) + "</span></li>";
    }).join("");
  }
  return { askHTML, histogram, unitTable, perUnit, toPps, fmtMoney, areaNotation, areaPlain, relTime, whenText, compsPlain, glance, freshness, daysSince, isNewAd, postedSince, isCut, compsLabel, filter, sort, toHash, parseHash, toCSV, toGeoJSON, toKML, esc, safeUrl };
});
