/* The personal finder: pure logic, no DOM, unit-tested under Node (tests/js/finder.test.mjs).
 *
 * A PROFILE is whatever one visitor wants: any districts, any size and budget, any minimum road, any elevation band, any number of places to be
 * near (a palika, a landmark, a point on the map), distance to a city, how recently posted, price against comparables, and any of the 'the ad
 * says' wishes. It lives in the visitor's browser (and in a link only if they copy it); nothing personal is ever in the published data.
 *
 * Every criterion is judged PASS, FAIL or UNKNOWN with its evidence beside it; there is no score. A criterion is a MUST or a nice-to-have.
 * Tiers: 3 match (every must passes), 2 possible (no must fails, some are unknown), 1 near miss (exactly one must fails), 0 none.
 * `run` also returns the FUNNEL (how many ads survive each must in turn) and, for each must, how many more ads would match if it were relaxed:
 * an empty result then explains itself and shows the way out. Unknown is common (most ads do not say) and is reported, never filled in. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./lib.js"));
  else root.JaggaFinder = factory(root.JaggaLib);
})(typeof self !== "undefined" ? self : this, function (Lib) {
  "use strict";
  const t = Lib.t;                                               // every sentence below is a catalog key (src/jagga/i18n): the wording follows the visitor's language

  // id, group, label, params with defaults, default 'must'. Order is the funnel order.
  const ROWS = [
    { id: "where", gk: "plot", must: true, def: { dis: [] } },
    { id: "size", gk: "plot", must: true, def: { min: "", max: "", unit: "ropani" } },
    { id: "budget", gk: "plot", must: true, def: { total: "", pmax: "", punit: "aana" } },
    { id: "road", gk: "plot", must: true, def: { min: "" } },
    { id: "hills", gk: "plot", must: true, def: { min: "", max: "" } },
    { id: "near", gk: "around", must: true, def: { places: [] } },
    { id: "city", gk: "around", must: false, def: { km: "" } },
    { id: "fresh", gk: "trust", must: false, def: { days: "" } },
    { id: "value", gk: "trust", must: false, def: { pct: 50 } },
    { id: "trust", gk: "trust", must: false, def: {} }
  ].map(function (row) {         // `label` and `group` are read when needed, so they follow the language chosen at start-up
    return Object.defineProperties(row, { label: { get: function () { return t("finder.row." + row.id); }, enumerable: true }, group: { get: function () { return t("finder.group." + row.gk); }, enumerable: true } });
  });
  const TIER = Object.defineProperties(["", "", "", ""], { 1: { get: function () { return t("finder.tier.1"); }, enumerable: true }, 2: { get: function () { return t("finder.tier.2"); }, enumerable: true }, 3: { get: function () { return t("finder.tier.3"); }, enumerable: true } });
  const funit = function (u) { return t("finder.unit." + u); };
  const TOL_KM = { exact: 0.2, locality: 1.5, palika: 8 };       // how far a position can be off, by how precisely the ad is located
  const MAX_PLACES = 6;

  const num = function (v) { if (v === "" || v == null) return null; const n = +v; return isFinite(n) ? n : null; };
  const rowDef = function (id) { return ROWS.filter(function (r) { return r.id === id; })[0]; };
  const isFlag = function (id) { return id.slice(0, 5) === "flag_"; };

  function defaultProfile() {
    const rows = {};
    ROWS.forEach(function (r) { rows[r.id] = Object.assign({ on: false, must: r.must }, JSON.parse(JSON.stringify(r.def))); });
    return { v: 1, name: "", rows: rows };
  }
  /** Rows exist for every ROWS id plus a `flag_<key>` row per wish the data offers. */
  function ensureRows(profile, flags) {
    const d = defaultProfile();
    Object.keys(d.rows).forEach(function (k) { if (!profile.rows[k]) profile.rows[k] = d.rows[k]; });
    (flags || []).forEach(function (f) { if (!profile.rows["flag_" + f.k]) profile.rows["flag_" + f.k] = { on: false, must: false }; });
    return profile;
  }
  /** A row only counts once its parameters are filled in (an unticked or half-filled row is not a criterion). */
  function complete(id, r) {
    if (!r || !r.on) return false;
    if (isFlag(id) || id === "trust") return true;
    if (id === "where") return r.dis.length > 0;
    if (id === "size") return num(r.min) != null || num(r.max) != null;
    if (id === "budget") return num(r.total) != null || num(r.pmax) != null;
    if (id === "road") return num(r.min) != null;
    if (id === "hills") return num(r.min) != null || num(r.max) != null;
    if (id === "near") return r.places.length > 0;
    if (id === "city") return num(r.km) != null;
    if (id === "fresh") return num(r.days) != null;
    if (id === "value") return num(r.pct) != null;
    return false;
  }
  function activeIds(profile, flags) {
    const ids = ROWS.map(function (r) { return r.id; }).concat((flags || []).map(function (f) { return "flag_" + f.k; }));
    return ids.filter(function (id) { return complete(id, profile.rows[id]); });
  }

  function hav(a, b, c, d) {
    const p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  }
  const nf = function (x) { return Lib.nfmt(Math.round(x)); };
  function daysSince(dateStr, today) {
    if (!dateStr) return null;
    const d = Date.parse(dateStr + "T00:00:00Z");
    return isNaN(d) ? null : Math.max(0, Math.floor(((today || new Date()).getTime() - d) / 86400000));
  }
  const res = function (s, e) { return { s: s, e: e }; };
  /** A wish's words in the chosen language (the data carries the English label of each: used when there is no entry for it). */
  const flagLabel = Lib.flagLabel;

  /** One criterion for one listing -> {s: pass|fail|unknown, e: evidence}. `ctx`: {table: sqm per unit, flags: [{k,label}], today}. */
  function judge(id, r, l, ctx) {
    const T = ctx.table;
    if (isFlag(id)) {
      const i = (ctx.flags || []).map(function (f) { return f.k; }).indexOf(id.slice(5));
      const f = ctx.flags[i];
      return (l.tf || 0) & (1 << i) ? res("pass", t("finder.e.flag.yes", { label: flagLabel(f) })) : res("unknown", t("finder.e.flag.no"));
    }
    if (id === "where") return r.dis.indexOf(l.dk) >= 0 ? res("pass", l.dis || "") : res("fail", t("finder.e.where.fail", { d: l.dis || t("finder.e.another") }));
    if (id === "size") {
      if (l.a == null) return res("unknown", l.ms ? (l.ms === "plots of different sizes" ? t("finder.e.size.ms.diff") : t("finder.e.size.ms.several", { ms: Lib.msText(l.ms) })) : t("finder.e.size.unread"));
      const v = l.a / T[r.unit], lo = num(r.min), hi = num(r.max), shown = t("finder.shown", { n: Math.round(v * 10) / 10, unit: funit(r.unit) });
      if (lo != null && v < lo) return res("fail", t("finder.e.size.min", { shown: shown, lo: lo }));
      if (hi != null && v > hi) return res("fail", t("finder.e.size.max", { shown: shown, hi: hi }));
      return res("pass", shown);
    }
    if (id === "budget") {
      const tmax = num(r.total), pmax = num(r.pmax), out = [];
      let fail = false, unk = false;
      if (tmax != null) {
        if (l.tot == null) { unk = true; out.push(l.ms ? t("finder.e.bud.tot.ms") : t("finder.e.bud.tot.none")); }
        else if (l.tot > tmax) { fail = true; out.push(t("finder.e.bud.tot.over", { a: nf(l.tot), b: nf(tmax) })); } else out.push(t("finder.e.bud.tot.ok", { a: nf(l.tot) }));
      }
      if (pmax != null) {
        if (l.p == null) { unk = true; out.push(t("finder.e.bud.p.none")); }
        else { const p = l.p * T[r.punit]; if (p > pmax) { fail = true; out.push(t("finder.e.bud.p.over", { a: nf(p), u: funit(r.punit), b: nf(pmax) })); } else out.push(t("finder.e.bud.p.ok", { a: nf(p), u: funit(r.punit) })); }
      }
      return res(fail ? "fail" : unk ? "unknown" : "pass", out.join("; "));
    }
    if (id === "road") {
      if (l.road == null) return res("unknown", t("finder.e.road.none"));
      return l.road >= +r.min ? res("pass", t("card.road", { n: l.road })) : res("fail", t("finder.e.road.fail", { n: l.road, m: r.min }));
    }
    if (id === "hills") {
      const lo = num(r.min), hi = num(r.max), band = (lo != null ? Lib.digits(lo) : "") + (hi != null ? t("finder.band.to", { hi: hi }) : "+");
      const okAt = function (v) { return (lo == null || v >= lo) && (hi == null || v <= hi); };
      if (l.el != null) return okAt(l.el) ? res("pass", t("finder.e.hills.at", { n: nf(l.el) })) : res("fail", t("finder.e.hills.atfail", { n: nf(l.el), band: band }));
      if (l.er) {
        const a = okAt(l.er[0]), b = okAt(l.er[1]), span = { a: nf(l.er[0]), b: nf(l.er[1]) };
        if (a && b) return res("pass", t("finder.e.hills.palika.ok", span));
        if (!a && !b && ((lo != null && l.er[1] < lo) || (hi != null && l.er[0] > hi))) return res("fail", t("finder.e.hills.palika.fail", { a: span.a, b: span.b, band: band }));
        return res("unknown", t("finder.e.hills.palika.unk", span));
      }
      return res("unknown", t("finder.e.hills.none"));
    }
    if (id === "near") {
      if (l.lat == null) return res("unknown", t("finder.e.near.nopos"));
      const tol = TOL_KM[l.prec] != null ? TOL_KM[l.prec] : TOL_KM.palika;
      let best = null;
      r.places.forEach(function (p) { const d = hav(l.lat, l.lon, p.lat, p.lon), ok = d - p.km; if (best == null || ok < best.ok) best = { d: d, ok: ok, p: p }; });
      const where = t("finder.e.near.where", { d: nf(best.d), name: best.p.n, rough: l.prec === "palika" ? t("finder.e.near.rough") : "" });
      if (best.ok <= -tol) return res("pass", t("finder.e.near.within", { where: where, km: best.p.km }));
      if (best.ok > tol) return res("fail", t("finder.e.near.within", { where: where, km: best.p.km }));
      return res("unknown", t("finder.e.near.unk", { where: where, km: best.p.km }));
    }
    if (id === "city") {
      if (l.ck == null) return res("unknown", t("finder.e.city.nopos"));
      return l.ck <= +r.km ? res("pass", t("finder.e.city.ok", { n: nf(l.ck) })) : res("fail", t("finder.e.city.fail", { n: nf(l.ck), km: r.km }));
    }
    if (id === "fresh") {
      if (l.po && (l.pk === "updated" || l.pk === "relisted")) return res("unknown", t("finder.e.fresh.kind", { kind: t("finder.kind." + l.pk) }));
      const n = daysSince(l.po, ctx.today);
      if (n == null) return res("unknown", t("finder.e.fresh.nodate"));
      return n <= +r.days ? res("pass", t("finder.e.fresh.ok", { n: n })) : res("fail", t("finder.e.fresh.fail", { n: n, d: r.days }));
    }
    if (id === "value") {
      if (!l.c) return res("unknown", t("finder.e.value.none"));
      if (l.c.rel === "weak") return res("unknown", t("finder.e.value.weak", { p: l.c.p, n: l.c.n }));
      return l.c.p <= +r.pct ? res("pass", t("finder.e.value.ok", { p: l.c.p, n: l.c.n })) : res("fail", t("finder.e.value.fail", { p: l.c.p, n: l.c.n, pct: r.pct }));
    }
    if (id === "trust") return l.pc === "high" ? res("pass", t("finder.e.trust.high")) : l.pc === "low" ? res("fail", t("finder.e.trust.low")) : res("unknown", t("finder.e.trust.other", { pc: l.pc ? (t("finder.pc." + l.pc) !== "finder.pc." + l.pc ? t("finder.pc." + l.pc) : l.pc) : t("finder.pc.none") }));
    return res("unknown", "");
  }

  /** The criteria that apply to one listing under a profile: [{id, label, must, s, e}]. */
  function evaluate(l, profile, ctx) {
    return activeIds(profile, ctx.flags).map(function (id) {
      const r = profile.rows[id], j = judge(id, r, l, ctx);
      const label = isFlag(id) ? t("finder.flag.row", { w: flagLabel(ctx.flags[ctx.flags.map(function (f) { return f.k; }).indexOf(id.slice(5))]) }) : rowDef(id).label;
      return { id: id, label: label, must: !!r.must, s: j.s, e: j.e };
    });
  }
  function tierOf(results) {
    const musts = results.filter(function (x) { return x.must; });
    const fails = musts.filter(function (x) { return x.s === "fail"; }).length;
    if (fails === 0 && musts.every(function (x) { return x.s === "pass"; })) return 3;
    return fails === 0 ? 2 : fails === 1 ? 1 : 0;
  }

  /** Everything the panel needs: per-listing results, tier counts, the funnel, and what relaxing each must would add. */
  function run(listings, profile, ctx) {
    const pool = listings.filter(function (l) { return !l.dup || ctx.includeDups; });
    const ids = activeIds(profile, ctx.flags);
    const items = pool.map(function (l) {
      const results = evaluate(l, profile, ctx), wishes = results.filter(function (x) { return !x.must; });
      return { l: l, results: results, tier: tierOf(results), wishes: wishes.filter(function (x) { return x.s === "pass"; }).length, wishTotal: wishes.length };
    });
    const counts = [0, 0, 0, 0];
    items.forEach(function (it) { counts[it.tier]++; });
    const mustIds = ids.filter(function (id) { return profile.rows[id].must; });
    const status = function (it, id) { return (it.results.filter(function (x) { return x.id === id; })[0] || {}).s; };
    const funnel = [{ id: "all", label: t("finder.funnel.all"), left: items.length, unknown: 0 }];
    let alive = items;
    mustIds.forEach(function (id) {
      const passing = alive.filter(function (it) { return status(it, id) === "pass"; });
      funnel.push({ id: id, label: (items[0] ? items[0].results.filter(function (x) { return x.id === id; })[0] : rowDef(id) || {}).label || id,
                    left: passing.length, unknown: alive.filter(function (it) { return status(it, id) === "unknown"; }).length });
      alive = passing;
    });
    const relax = mustIds.map(function (id) {
      const gain = items.filter(function (it) { return it.tier < 3 && status(it, id) !== "pass" && mustIds.every(function (k) { return k === id || status(it, k) === "pass"; }); }).length;
      return { id: id, label: (items[0] ? items[0].results.filter(function (x) { return x.id === id; })[0] : {}).label || id, gain: gain };
    });
    return { items: items, counts: counts, funnel: funnel, relax: relax, musts: mustIds, active: ids };
  }

  /** Best fit first: tier, then wishes met, then the cheaper per-m2 price. No composite score: just an order of three plain facts. */
  function byFit(a, b) {
    return (b.tier - a.tier) || (b.wishes - a.wishes) || (a.l.p == null ? 1 : b.l.p == null ? -1 : a.l.p - b.l.p);
  }

  // -- presets: generic starting points (nobody's personal profile) ----------------------------------------------------------------------
  const preset = function (id, rows) { return { id: id, get label() { return t("finder.preset." + id + ".label"); }, get blurb() { return t("finder.preset." + id + ".blurb"); }, rows: rows }; };
  const PRESETS = [
    preset("hill", { size: { on: true, must: true, min: 1, max: "", unit: "ropani" }, road: { on: true, must: true, min: 10 }, hills: { on: true, must: true, min: 700, max: "" },
                     flag_view: { on: true, must: false }, flag_farm: { on: true, must: false }, flag_water: { on: true, must: false } }),
    preset("house", { size: { on: true, must: true, min: 3, max: 10, unit: "aana" }, road: { on: true, must: true, min: 13 }, city: { on: true, must: true, km: 15 },
                      flag_flat: { on: true, must: false }, flag_paved: { on: true, must: false } }),
    preset("value", { value: { on: true, must: true, pct: 25 }, trust: { on: true, must: true }, fresh: { on: true, must: false, days: 180 } })
  ];
  function applyPreset(id, flags) {
    const p = ensureRows(defaultProfile(), flags), pre = PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!pre) return p;
    p.name = pre.label;
    Object.keys(pre.rows).forEach(function (k) { if (p.rows[k]) Object.assign(p.rows[k], pre.rows[k]); });
    return p;
  }

  // -- sharing: the profile in a link, decoded as untrusted input ------------------------------------------------------------------------
  function b64enc(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64dec(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); }
  function encode(profile) {
    const rows = {};
    Object.keys(profile.rows).forEach(function (k) { if (profile.rows[k].on) rows[k] = profile.rows[k]; });
    return b64enc(JSON.stringify({ v: 1, n: profile.name || "", r: rows }));
  }
  const clean = function (v, max) { return String(v == null ? "" : v).slice(0, max || 60); };
  /** A profile from a link or from storage; anything malformed becomes the default for that field. */
  function decode(str, flags) {
    const p = ensureRows(defaultProfile(), flags);
    let j;
    try { j = JSON.parse(b64dec(String(str))); } catch (e) { return p; }
    if (!j || typeof j !== "object" || typeof j.r !== "object" || j.r === null) return p;
    p.name = clean(j.n, 60);
    Object.keys(j.r).forEach(function (k) {
      const src = j.r[k];
      if (!p.rows[k] || !src || typeof src !== "object") return;
      const dst = p.rows[k];
      dst.on = true; dst.must = !!src.must;
      Object.keys(dst).forEach(function (f) {
        if (f === "on" || f === "must" || src[f] === undefined) return;
        if (f === "dis") dst.dis = Array.isArray(src.dis) ? src.dis.slice(0, 80).map(function (x) { return clean(x, 40); }) : [];
        else if (f === "places") dst.places = (Array.isArray(src.places) ? src.places : []).slice(0, MAX_PLACES).filter(function (q) { return q && isFinite(+q.lat) && isFinite(+q.lon) && +q.km > 0; })
          .map(function (q) { return { n: clean(q.n, 40) || "a place", lat: +q.lat, lon: +q.lon, km: Math.min(500, +q.km) }; });
        else if (f === "unit" || f === "punit") dst[f] = /^(aana|ropani|kattha|dhur|bigha|sqft|sqm|paisa|daam)$/.test(src[f]) ? src[f] : dst[f];
        else dst[f] = src[f] === "" ? "" : isFinite(+src[f]) ? +src[f] : dst[f];
      });
    });
    return p;
  }

  return { ROWS: ROWS, PRESETS: PRESETS, TIER: TIER, flagLabel: flagLabel, funit: funit, MAX_PLACES: MAX_PLACES, defaultProfile, ensureRows, complete, activeIds, judge, evaluate, tierOf, run, byFit, applyPreset, encode, decode, hav };
});
