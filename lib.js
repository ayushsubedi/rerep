/* Pure logic for the Jaggasignal site: units, Nepali money, filtering, sorting, exports.
 * No DOM access here, so it is unit-tested under Node (tests/js/lib.test.mjs).
 * Unit constants come from data.js (generated from units.py): one source of truth. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JaggaLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SQFT = 0.09290304;

  // -- language ---------------------------------------------------------------------------------------------------------------
  // Every sentence the app writes is a key in a catalog (src/jagga/i18n/{en,ne}.json): the page gets them from messages.js (built from those files), Node loads the files themselves,
  // so the tests run against what ships. A key missing in Nepali falls back to English, and a key missing everywhere shows the key: never a blank.
  var CAT = null, LANG = "en", DEVA = false;
  const DEV_DIGITS = "०१२३४५६७८९";
  function catalogs() {
    if (CAT) return CAT;
    if (typeof module === "object" && module.exports && typeof require === "function") CAT = { en: require("../i18n/en.json"), ne: require("../i18n/ne.json") };
    else if (typeof self !== "undefined" && self.JAGGA_MSG) CAT = self.JAGGA_MSG;
    else CAT = { en: {}, ne: {} };
    return CAT;
  }
  /** lang: "en" | "ne"; digits: "deva" shows ०-९ (Nepali mode only), anything else Western 0-9. An unknown language is English. */
  function setLang(lang, digits) { LANG = catalogs()[lang] ? lang : "en"; DEVA = LANG === "ne" && digits === "deva"; }
  function getLang() { return LANG; }
  /** Digits as the visitor chose. Only text the app wrote goes through here: a seller's own words keep their own digits. */
  function digits(s) { return DEVA ? String(s).replace(/[0-9]/g, function (d) { return DEV_DIGITS.charAt(+d); }) : String(s); }
  /** A number with thousands separators, in the chosen digits. */
  function nfmt(n) { return digits(Number(n).toLocaleString("en-US")); }
  /** Typed numbers: Devanagari digits from a Nepali keyboard become ASCII before anything parses them. */
  function toAscii(s) { return String(s == null ? "" : s).replace(/[०-९]/g, function (d) { return DEV_DIGITS.indexOf(d); }); }
  /** The sentence for `key` with {name} filled from `p`. A number parameter is shown in the chosen digits; a string parameter is inserted as given (format it first with nfmt/digits if it is a number). */
  function t(key, p) {
    var c = catalogs(), tpl = c[LANG] && c[LANG][key];
    if (tpl == null) tpl = c.en && c.en[key];
    if (tpl == null) return key;
    return digitsOutside(tpl).replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? param(p[k]) : m; });
  }
  /** The template's own digits in the chosen style, but never inside a {placeholder} (a name like {p25} must still be found afterwards). */
  function digitsOutside(tpl) { return DEVA ? tpl.replace(/\{\w+\}|[0-9]/g, function (m) { return m.length > 1 ? m : DEV_DIGITS.charAt(+m); }) : tpl; }
  /** A parameter as text: a number is shown in the chosen digits, a plain string as given; the server's two wire forms are {d: "75,160"} (a number it already formatted: digits only) and
   *  {k, p} (a sentence of its own, rendered the same way, so sentences nest), and {j: [...], s: ", "} (parts joined by a separator). */
  function param(v) {
    if (typeof v === "number") return digits(v);
    if (v && typeof v === "object") return v.d != null ? digits(v.d) : v.k ? t(v.k, v.p) : v.j ? v.j.map(param).join(v.s != null ? v.s : ", ") : String(v);
    return String(v);
  }
  /** An X-Ray factor's name in the chosen language (the data carries the English name: the key JS and the server look it up by). */
  function factor(name) { var k = "factor." + String(name).replace(/[^a-z0-9]+/g, "_"); return t(k) !== k ? t(k) : name; }
  /** The size range an ad gives ('4 to 6 aana', 'from 3 aana', 'flexible sizes') in the chosen language; anything else as written. English is what the data says. */
  function msText(ms) {
    if (LANG === "en" || !ms) return ms == null ? "" : String(ms);
    var m, num = function (x) { return { d: x }; }, unit = function (u) { var k = "finder.unit." + u; return t(k) !== k ? t(k) : u; };
    if (ms === "flexible sizes") return t("ms.flex");
    if (ms === "plots of different sizes") return t("area.diff");
    if ((m = /^from ([\d.,]+) (\w+)$/.exec(ms))) return t("ms.from", { n: num(m[1]), unit: unit(m[2]) });
    if ((m = /^([\d.,]+) to ([\d.,]+) (\w+)$/.exec(ms))) return t("ms.range", { a: num(m[1]), b: num(m[2]), unit: unit(m[3]) });
    return String(ms);
  }
  /** Text the server wrote: a plain string (free text from the ad, shown as it is) or a sentence in the wire form {k, p}. */
  function msg(v) { return v && typeof v === "object" && v.k ? t(v.k, v.p) : v == null ? "" : String(v); }

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
    if (a >= 1e7) return t("money.crore", { n: +trim2(n / 1e7) });
    if (a >= 1e5) return t("money.lakh", { n: +trim2(n / 1e5) });
    return t("money.plain", { n: nfmt(Math.round(n)) });      // below a lakh people say "Rs 45,000", not "45 thousand"
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
    return parts.map(function (n, i) { return n ? digits(n) + " " + t("unit." + names[i]) : ""; }).filter(Boolean).join(" ");
  }

  /** Sellers often type titles in capitals ('LAND ON SALE AT CHAPAGAUN'): shown in plain title case. Mixed-case titles are left as written. */
  function niceTitle(t) {
    const s = String(t || ""), letters = s.replace(/[^A-Za-z]/g, "");
    if (letters.length < 8 || letters.replace(/[^A-Z]/g, "").length / letters.length < 0.65) return s;
    const small = { at: 1, in: 1, on: 1, of: 1, for: 1, and: 1, the: 1, to: 1, with: 1, near: 1 };
    return s.toLowerCase().replace(/[a-z][a-z']*/g, function (w, i) { return i > 0 && small[w] ? w : w.charAt(0).toUpperCase() + w.slice(1); });
  }

  /** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago", "2.8 years ago". */
  function relTime(days) {
    if (days == null) return "";
    if (days === 0) return t("time.today");
    if (days === 1) return t("time.yesterday");
    if (days < 14) return t("time.days", { n: days });
    if (days < 60) return t("time.weeks", { n: Math.floor(days / 7) });
    if (days < 365) return t("time.months", { n: Math.floor(days / 30) });
    return t("time.years", { n: Math.round(days / 36.5) / 10 });
  }

  /** When the PORTAL says the ad was put up, in words: 'posted 6 days ago', 'updated 3 months ago', 're-listed ...', or that no date is stated. */
  function whenText(l, today) {
    if (!l.po) return t("when.none");
    return t("when." + (l.pk === "updated" || l.pk === "relisted" || l.pk === "posted" ? l.pk : "dated"), { ago: relTime(daysSince(l.po, today)) });
  }

  /** How old the data is, from when each crawled portal last answered (meta.refresh: [{source, last_ok: "YYYY-MM-DD HH:MM", UTC}]).
   *  -> {text, stale, detail}: 'Data refreshed 5 hours ago'; stale (over 3 days) says what that means. null when nothing was ever crawled. */
  function freshness(refresh, now) {
    const at = (now instanceof Date ? now : new Date()).getTime();
    const rows = (refresh || []).filter(function (r) { return r.last_ok; }).map(function (r) {
      return { source: r.source, hours: Math.max(0, (at - Date.parse(r.last_ok.replace(" ", "T") + ":00Z")) / 36e5) };
    });
    if (!rows.length) return null;
    const say = function (h) { return h < 1 ? t("fresh.lt1h") : h < 24 ? t(Math.floor(h) === 1 ? "fresh.h1" : "fresh.hn", { n: Math.floor(h) }) : relTime(Math.floor(h / 24)); };
    const newest = Math.min.apply(null, rows.map(function (r) { return r.hours; }));
    const old = rows.filter(function (r) { return r.hours > 72; });
    const detail = rows.map(function (r) { return t("fresh.detail", { source: r.source, say: say(r.hours) }); }).join(", ");
    if (newest > 72) return { stale: true, text: t("fresh.stale", { say: say(newest) }), detail: detail };
    if (old.length) return { stale: true, text: t("fresh.partial", { say: say(newest), list: old.map(function (r) { return t("fresh.src", { source: r.source, say: say(r.hours) }); }).join(", ") }), detail: detail };
    return { stale: false, text: t("fresh.ok", { say: say(newest) }), detail: detail };
  }

  /** The About page's accuracy numbers, from meta.accuracy (counts of values that were read from the ad's own words by an AI reader and did or did not match).
   *  -> {rows: [{source, n, cells: [{text: "28/29", miss}]}], line} for the order area, price per m2, total, district; null when nothing was measured. */
  function accuracyView(acc) {
    if (!acc || !acc.sources || !acc.sources.length || !(acc.checked > 0)) return null;
    const cell = function (a) { return { text: a[0] + "/" + a[1], miss: a[0] < a[1] }; };
    return {
      rows: acc.sources.map(function (s) { return { source: s.source, n: s.n, cells: [cell(s.area), cell(s.price), cell(s.total), cell(s.district)] }; }),
      line: t("acc.line", { right: nfmt(acc.right), checked: nfmt(acc.checked), pct: digits((100 * acc.right / acc.checked).toFixed(1)) }),
    };
  }

  /** The price guide as display rows. g: window.JAGGA_GUIDE; o: {size: "all"|"small", sort: "n"|"high"|"low"|"name", q, unit, T}.
   *  Values arrive as NPR per m2 and are shown per the chosen unit. A place with fewer than g.min_asks asks gets its count and a grey 'too few', no range. */
  function guideRows(g, o) {
    const per = function (v) { return fmtMoney(perUnit(v, o.unit, o.T)); };
    const q = (o.q || "").trim().toLowerCase();
    const cell = function (st) {
      if (!st) return null;
      const thin = st.n < g.min_asks;
      return { n: st.n, thin: thin, med: st.med, text: per(st.med), range: thin ? "" : t("guide.range", { a: per(st.p25), b: per(st.p75) }) };
    };
    const rows = g.rows.map(function (r) {
      const gv = r.govt;
      return {
        id: r.id, name: r.name, level: r.level, district: r.district,
        label: r.level === "district" ? t("guide.district", { name: r.name }) : r.name + (r.kind ? " (" + (t("kind." + String(r.kind).replace(/-/g, "_")) !== "kind." + String(r.kind).replace(/-/g, "_") ? t("kind." + String(r.kind).replace(/-/g, "_")) : String(r.kind).replace(/_/g, " ")) + ")" : "") + (r.district ? ", " + r.district : ""),
        recent: cell(r.stats.recent[o.size]), any: cell(r.stats.any[o.size]),
        govt: gv ? { text: gv.hi > gv.lo ? t("guide.range", { a: per(gv.lo), b: per(gv.hi) }) : per(gv.lo), fy: gv.fy, n: gv.n, source: gv.source, url: gv.url } : null
      };
    }).filter(function (r) { return r.recent || r.any || r.govt; })
      .filter(function (r) { return !q || (r.label + " " + (r.district || "")).toLowerCase().includes(q); });
    const key = { n: function (a, b) { return ((b.recent && b.recent.n) || 0) - ((a.recent && a.recent.n) || 0) || ((b.any && b.any.n) || 0) - ((a.any && a.any.n) || 0); },
      high: function (a, b) { return nullsLast(a.recent && a.recent.med, b.recent && b.recent.med, -1); },
      low: function (a, b) { return nullsLast(a.recent && a.recent.med, b.recent && b.recent.med, 1); },
      name: function (a, b) { return a.label.localeCompare(b.label); } }[o.sort] || null;
    return key ? rows.sort(key) : rows;
  }

  /** A price against its comparables, in plain words for a card. c: {p: percentile (low = cheap), n, rel}. */
  function compsPlain(c) {
    if (!c) return null;
    return t(c.p < 25 ? "comps.cheap" : c.p > 75 ? "comps.dear" : "comps.mid");
  }

  var FLAG_KEYS = ["view", "farm", "water", "stay", "paved", "flat", "quiet"];
  /** A wish's long words in the chosen language. English is what the data says (the server owns it); another language uses the catalog, and the data's own label when the catalog has no entry. */
  function flagLabel(f) { if (LANG === "en") return f.label; var k = "flag.label." + f.k; return t(k) !== k ? t(k) : f.label; }

  /** "At a glance": 4-8 plain sentences built ONLY from what is already known about the ad (nothing is estimated here).
   *  o: {today, unit (price unit key), T (unit table), units (area units), flags: meta.flags}. */
  /** An ad for a RANGE of sizes, or plots of different sizes (`ms`, a neutral fact from the build): no single area and no total are right for it, so they are set aside once, at load, and every
   *  screen then shows what is true: the size is unknown. A rate the seller stated is kept; a price per unit that was only worked out from a total and an area is dropped. */
  function multiSize(l) {
    if (!l.ms || l.msDone) return l;
    l.msDone = true; l.msA = l.a; l.msTot = l.tot; l.a = null; l.tot = null;
    if (l.pb !== "per_unit" && l.pb !== "text_rate") l.p = null;
    return l;
  }
  function glance(l, o) {
    const out = [], T = o.T, per = function (u) { return fmtMoney(perUnit(l.p, u, T)); };
    if (l.ms) out.push(l.ms === "plots of different sizes" ? t("glance.ms.diff") : t("glance.ms.several", { ms: msText(l.ms) }));
    if (l.p != null) out.push(l.tot ? t("glance.ask.tot", { price: per(o.unit), unit: t("unit." + o.unit), tot: fmtMoney(l.tot) }) : t("glance.ask", { price: per(o.unit), unit: t("unit." + o.unit) }));
    else if (l.tot) out.push(t("glance.tot.noarea", { tot: fmtMoney(l.tot) }));
    else if (l.ms && l.msTot) out.push(t("glance.ms.tot", { tot: fmtMoney(l.msTot) }));
    if (l.p != null) {
      if (l.c && l.c.rel !== "weak") out.push(t("glance.comps", { pct: 100 - l.c.p, n: l.c.n }));
      else if (l.c) out.push(t("glance.comps.weak"));
      else out.push(t("glance.comps.none"));
    }
    out.push(l.road ? t("glance.road", { n: l.road }) : t("glance.road.none"));
    if (!l.po) out.push(t("glance.date.none"));
    else out.push(t("glance.date", { when: whenText(l, o.today), a: l.pk === "updated" || l.pk === "relisted" ? t("glance.date.a") : "", b: daysSince(l.po, o.today) > 180 ? t("glance.date.b") : "" }));
    out.push(t(l.prec === "exact" || l.prec === "locality" || l.prec === "palika" ? "glance.pin." + l.prec : "glance.pin.none"));
    if (l.el != null) out.push(t("glance.el", { n: nfmt(l.el) }));
    else if (l.er) out.push(t("glance.er", { lo: nfmt(l.er[0]), hi: nfmt(l.er[1]) }));
    const names = (o.flags || []).map(function (f, i) { return (l.tf || 0) >> i & 1 ? (FLAG_KEYS.indexOf(f.k) >= 0 ? t("flag." + f.k) : f.label) : null; }).filter(Boolean);
    if (names.length) out.push(t("glance.flags", { list: names.join(", ") }));
    if (l.tw) out.push(t("glance.twin", { n: l.tw + 1 }));
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
    return t("comps.label", { side: t(c.p < 25 ? "comps.label.cheap" : c.p > 75 ? "comps.label.dear" : "comps.label.mid"), p: c.p, n: c.n, weak: c.rel === "weak" ? t("comps.label.weak") : "" });
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
      if (amin != null || amax != null) {
        if (l.a == null) { if (!l.ms) return false; }                                // several sizes: a plot in the wanted range cannot be ruled out
        else if ((amin != null && l.a < amin) || (amax != null && l.a > amax)) return false;
      }
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
    ["last_seen", "ls"], ["sizes_range", "ms"], ["price_confidence", "pc"], ["lat", "lat"], ["lon", "lon"], ["location_precision", "prec"]];
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
  var XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;       // not allowed in XML 1.0: one stray control character in a scraped title would make Earth refuse the whole file
  function xmlEsc(s) { return String(s == null ? "" : s).replace(XML_BAD, "").replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]; }); }

  // -- Google Earth ----------------------------------------------------------------------------------------------------------
  /** A usable point: both numbers, on the globe. The data holds 8 to 15 decimals; 5 (about a metre) is all anyone can use. */
  function hasPoint(l) { return !!l && typeof l.lat === "number" && typeof l.lon === "number" && isFinite(l.lat) && isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180; }
  /** Camera distance in metres. The vaguer the pin, the wider the view, so a municipality centre never looks like 'the plot is here'. */
  var EARTH_RANGE = { exact: 1500, locality: 5000, palika: 15000 };
  /** Google documents no link format for opening Earth at a point. This is the one its own share links use (@lat,lon, ground height a, camera distance d, field of view y,
   *  heading h, tilt t, roll r). It can change without notice: the KML file is the dependable route. */
  function earthUrl(l) {
    if (!hasPoint(l)) return null;
    var ground = typeof l.el === "number" && isFinite(l.el) ? Math.round(l.el) : 0;
    return "https://earth.google.com/web/@" + (+l.lat.toFixed(5)) + "," + (+l.lon.toFixed(5)) + "," + ground + "a," + (EARTH_RANGE[l.prec] || EARTH_RANGE.palika) + "d,35y,0h,0t,0r";
  }
  /** What the pin means. A pin is evidence, not truth: even an 'exact' one is the portal's or the seller's claim. */
  function earthNote(l) {
    return l.prec === "exact" || l.prec === "locality" || l.prec === "palika" ? t("earth.note." + l.prec) : "";
  }
  /** 'lat, lon' as Earth's and Google Maps' search boxes take it. */
  function coordsText(l) { return hasPoint(l) ? (+l.lat.toFixed(5)) + ", " + (+l.lon.toFixed(5)) : ""; }

  var KML_PIN = { exact: "red-circle", locality: "ylw-circle", palika: "wht-circle" };      // Google's own paddle icons: red = from the ad, yellow = area, white = municipality centre
  /** One placemark. o.describe(l) -> plain lines (the app passes what the screen shows); o.lookAt adds a camera, for a file of a single plot. */
  function kmlPlacemark(l, o) {
    var lines = (o.describe ? o.describe(l) : [l.dis, l.tot ? fmtMoney(l.tot) : ""]).filter(Boolean), note = earthNote(l), url = safeUrl(l.url);
    var html = "<p><b>" + esc(niceTitle(l.t)) + "</b></p>" + lines.map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("") +
      (note ? "<p><i>" + esc(note) + "</i></p>" : "") + (url !== "#" ? '<p><a href="' + esc(url) + '">' + esc(t("earth.kml.ad")) + "</a></p>" : "");
    var lon = +l.lon.toFixed(6), lat = +l.lat.toFixed(6), pin = KML_PIN[l.prec] ? l.prec : "palika";
    return "<Placemark><name>" + xmlEsc(niceTitle(l.t)) + "</name><description><![CDATA[" + html.replace(XML_BAD, "").replace(/\]\]>/g, "]]]]><![CDATA[>") + "]]></description>" +
      (o.lookAt ? "<LookAt><longitude>" + lon + "</longitude><latitude>" + lat + "</latitude><altitude>0</altitude><heading>0</heading><tilt>0</tilt><range>" +
        (EARTH_RANGE[l.prec] || EARTH_RANGE.palika) + "</range><altitudeMode>relativeToGround</altitudeMode></LookAt>" : "") +
      "<styleUrl>#" + pin + "</styleUrl><ExtendedData><Data name=\"precision\"><value>" + xmlEsc(l.prec || "none") + "</value></Data></ExtendedData>" +
      "<Point><coordinates>" + lon + "," + lat + ",0</coordinates></Point></Placemark>";
  }
  /** Google Earth file. Listings without a point are left out. o: {name, describe, lookAt}. */
  function toKML(listings, o) {
    o = o || {};
    var styles = Object.keys(KML_PIN).map(function (k) {
      return '<Style id="' + k + '"><IconStyle><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/' + KML_PIN[k] + ".png</href></Icon></IconStyle></Style>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xmlEsc(o.name || t("earth.doc.default")) + "</name>" + styles +
      listings.filter(hasPoint).map(function (l) { return kmlPlacemark(l, o); }).join("") + "</Document></kml>";
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /** Only http(s) links may be rendered as hrefs: data comes from scraped sources. */
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }

  // -- 'before you pay' list (verify.py builds the items; this only renders them) ----------------------------------------------
  var WHO = { seller: "who.seller", office: "who.office", site: "who.site", you: "who.you" };
  function askHTML(ask, cls) {
    return (ask || []).map(function (a) {
      return '<li><span class="who">' + esc(WHO[a.o] ? t(WHO[a.o]) : a.o) + "</span> " + esc(msg(a.a)) + ' <span class="' + (cls || "why") + '">' + esc(t("ask.because")) + " " + esc(msg(a.w)) + "</span></li>";
    }).join("");
  }
  // -- the visitor's own work (saved plots, notes, saved searches, finder criteria): a backup file, parsed as untrusted input ------------------
  var HEXID = /^[0-9a-f]{6,32}$/, B64URL = /^[A-Za-z0-9_-]{0,6000}$/;
  var cut = function (v, n) { return String(v == null ? "" : v).slice(0, n); };
  /** A small record of a plot, kept when it is saved, so it can still be shown (with its note) after the portal takes the ad down and it leaves the data. */
  function snapOf(l) {
    return { t: cut(l.t, 160), loc: cut(l.loc || l.pal, 80), dis: cut(l.dis, 40), tot: l.tot != null && isFinite(+l.tot) ? +l.tot : null, url: /^https?:\/\//i.test(l.url || "") ? cut(l.url, 500) : "", po: /^\d{4}-\d{2}-\d{2}$/.test(l.po || "") ? l.po : "" };
  }
  function makeBackup(s, now) {
    return { app: "jaggasignal", v: 2, saved_at: now.toISOString(), watch: s.watch || {}, notes: s.notes || {}, snaps: s.snaps || {}, searches: s.searches || {}, profile: s.profile || "" };
  }
  /** -> {ok: true, watch, notes, snaps, searches, profile, dropped} or {ok: false, error}. Reads the old export too ({watch, notes}). Anything malformed is dropped and counted, never stored. */
  function parseBackup(text) {
    var j, out = { ok: true, watch: {}, notes: {}, snaps: {}, searches: {}, profile: "", dropped: 0 };
    try { j = JSON.parse(text); } catch (e) { return { ok: false, error: t("backup.err.json") }; }
    if (!j || typeof j !== "object" || Array.isArray(j) || !(j.watch || j.notes || j.searches || j.profile)) return { ok: false, error: t("backup.err.app") };
    var each = function (o, max, fn) {
      if (!o || typeof o !== "object" || Array.isArray(o)) return;
      Object.keys(o).slice(0, max).forEach(function (k) { if (!fn(k, o[k])) out.dropped++; });
    };
    each(j.watch, 500, function (id, v) { if (!HEXID.test(id)) return false; out.watch[id] = /^[A-Za-z ]{1,20}$/.test(String(v)) ? String(v) : "watching"; return true; });
    each(j.notes, 500, function (id, v) { if (!HEXID.test(id) || typeof v !== "string") return false; if (v) out.notes[id] = v.slice(0, 4000); return true; });
    each(j.snaps, 500, function (id, v) {
      if (!HEXID.test(id) || !v || typeof v !== "object") return false;
      out.snaps[id] = snapOf(v); return true;
    });
    each(j.searches, 100, function (name, v) { if (!name || name.length > 60 || typeof v !== "string" || v.length > 2000) return false; out.searches[name] = v; return true; });
    if (typeof j.profile === "string" && j.profile) { if (B64URL.test(j.profile)) out.profile = j.profile; else out.dropped++; }
    return out;
  }

  return { t, msg, factor, msText, setLang, getLang, flagLabel, digits, nfmt, toAscii, catalogs, askHTML, histogram, unitTable, perUnit, toPps, fmtMoney, areaNotation, areaPlain, niceTitle, relTime, whenText, compsPlain, glance, freshness, accuracyView, guideRows, daysSince, isNewAd, postedSince, isCut, compsLabel, filter, sort, toHash, parseHash, toCSV, toGeoJSON, toKML, hasPoint, earthUrl, earthNote, coordsText, esc, safeUrl, snapOf, makeBackup, parseBackup, multiSize };
});
