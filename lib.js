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

  /** "New" means the PORTAL dated the ad within a week. Being first seen by us recently only means we found it recently:
   *  a sweep can discover hundreds of old ads in one day. No posted date => never called new. */
  function isNewAd(l, today) {
    const n = daysSince(l.po, today);
    return n != null && n <= 7;
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
      if (f.ideal && !(l.ia >= 1)) return false;
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
    new: function (a, b) { return (b.fs || "").localeCompare(a.fs || ""); },
    ideal: function (a, b) { return ((b.ia || 0) - (a.ia || 0)) || ((b.iz || 0) - (a.iz || 0)) || nullsLast(a.p, b.p, 1); },
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
  const KEYS = ["q", "dis", "src", "cls", "unit", "pmin", "pmax", "aunit", "amin", "amax", "road", "age", "fresh", "cut", "dups", "ideal", "sort"];
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
      f[k] = (k === "fresh" || k === "cut" || k === "dups" || k === "ideal") ? v === "1" : v;
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

  return { histogram, unitTable, perUnit, toPps, fmtMoney, areaNotation, daysSince, isNewAd, isCut, compsLabel, filter, sort, toHash, parseHash, toCSV, toGeoJSON, toKML, esc, safeUrl };
});
