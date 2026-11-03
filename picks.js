/* The shortlist page's logic: pure, no DOM, unit-tested under Node (tests/js/picks.test.mjs).
 *
 * The finder (finder.js) answers "which ads pass which criterion". This file turns that into the plain words a person reads first: what was asked for, one sentence
 * saying whether anything fits (and which rule removes the most ads when nothing does), and the few ads worth a phone call, best first. Nothing here is new data and
 * nothing is scored: the order is finder.js's own (tier, then wishes met, then price). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./lib.js"));
  else root.JaggaPicks = factory(root.JaggaLib);
})(typeof self !== "undefined" ? self : this, function (Lib) {
  "use strict";
  const t = Lib.t;

  const num = function (v) { if (v === "" || v == null) return null; const n = +v; return isFinite(n) ? n : null; };
  const nf = function (x) { return Lib.nfmt(Math.round(x)); };
  /** "one ad" / "3 ads": a count with its noun (the catalog has a form for one and for many; Nepali has the same for both). */
  const count = function (n, key) { return t(key + (n === 1 ? ".one" : ".many"), { n: n }); };
  const list = function (xs) { return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + t("picks.or") + xs[xs.length - 1]; };

  /** One criterion in plain words. `o`: {money: n -> 'Rs 35 lakh', district: id -> name, flags: [{k, label}]}. */
  function say(id, r, o) {
    const money = o.money || function (v) { return t("money.plain", { n: nf(v) }); };
    if (id.slice(0, 5) === "flag_") {
      const f = (o.flags || []).filter(function (x) { return "flag_" + x.k === id; })[0];
      return t("picks.say.flag", { w: f ? Lib.flagLabel(f) : id.slice(5) });
    }
    if (id === "where") return t("picks.say.where", { list: list(r.dis.map(function (d) { return (o.district || String)(d); })) });
    if (id === "size") {
      const lo = num(r.min), hi = num(r.max), unit = t("finder.unit." + r.unit);
      return lo != null && hi != null ? t("picks.say.size.between", { lo: lo, hi: hi, unit: unit }) : lo != null ? t("picks.say.size.min", { lo: lo, unit: unit }) : t("picks.say.size.max", { hi: hi, unit: unit });
    }
    if (id === "budget") {
      const tot = num(r.total), p = num(r.pmax), out = [], u = t("finder.unit." + r.punit);
      if (tot != null) out.push(t("picks.say.bud.total", { m: money(tot) }));
      if (p != null) out.push(t(tot != null ? "picks.say.bud.per.next" : "picks.say.bud.per.first", { m: money(p), u: u }));
      return out.join(t("picks.say.bud.or"));
    }
    if (id === "road") return t("picks.say.road", { n: r.min });
    if (id === "hills") {
      const lo = num(r.min), hi = num(r.max);
      return lo != null && hi != null ? t("picks.say.hills.between", { lo: nf(lo), hi: nf(hi) }) : lo != null ? t("picks.say.hills.min", { lo: nf(lo) }) : t("picks.say.hills.max", { hi: nf(hi) });
    }
    if (id === "near") return t("picks.say.near", { list: list(r.places.map(function (p) { return t("picks.say.near.item", { km: p.km, n: p.n }); })) });
    if (id === "city") return t("picks.say.city", { km: r.km });
    if (id === "fresh") return t(+r.days === 1 ? "picks.say.fresh.one" : "picks.say.fresh.many", { n: +r.days });
    if (id === "value") return t("picks.say.value", { pct: r.pct });
    if (id === "trust") return t("picks.say.trust");
    return id;
  }

  /** What was asked for: {musts: [{id, text}], wishes: [{id, text}]}, in the finder's own order. */
  function describe(profile, flags, F, o) {
    const out = { musts: [], wishes: [] };
    F.activeIds(profile, flags).forEach(function (id) {
      const r = profile.rows[id];
      (r.must ? out.musts : out.wishes).push({ id: id, text: say(id, r, Object.assign({ flags: flags }, o || {})) });
    });
    return out;
  }

  /** The rule that removes the most ads, from the funnel: {label, lost, of} or null. The district list is the scope, not a rule to argue with, so it never counts. */
  function biggestDrop(funnel) {
    let best = null;
    for (let i = 1; i < funnel.length; i++) {
      const lost = funnel[i - 1].left - funnel[i].left;
      if (funnel[i].id !== "where" && lost > 0 && (!best || lost > best.lost)) best = { label: funnel[i].label, lost: lost, of: funnel[i - 1].left };
    }
    return best;
  }

  /** Where the ads run out: the first rule that nothing gets through, with how many reached it and how they fell: {label, of, fail, unknown} or null. */
  function runsOutAt(funnel) {
    for (let i = 1; i < funnel.length; i++) {
      if (funnel[i].left === 0 && funnel[i - 1].left > 0) return { label: funnel[i].label, of: funnel[i - 1].left, unknown: funnel[i].unknown, fail: funnel[i - 1].left - funnel[i].unknown };
    }
    return null;
  }

  /** One honest sentence about whether anything fits, with what to do next. `run`: finder.js `run` output. */
  function verdict(run) {
    const c = run.counts, out = runsOutAt(run.funnel), drop = biggestDrop(run.funnel);
    const gain = run.relax.filter(function (x) { return x.gain > 0 && x.id !== "where"; }).sort(function (a, b) { return b.gain - a.gain; })[0];
    const lines = [];
    let head;
    if (c[3] > 0) {
      head = count(c[3], "picks.v.head.match");
      if (c[2] > 0) lines.push(t("picks.v.more", { n: c[2] }));
    } else if (c[2] > 0) {
      head = t("picks.v.head.could");
      lines.push(count(c[2], "picks.v.could"));
    } else if (c[1] > 0) {
      head = t("picks.v.head.miss");
      lines.push(count(c[1], "picks.v.miss"));
    } else {
      head = t("picks.v.head.none");
    }
    if (c[3] === 0 && out) lines.push(t("picks.v.out", { label: out.label, of: count(out.of, "picks.n.ad"), fail: nf(out.fail), unk: out.unknown ? t("picks.v.out.unk", { n: nf(out.unknown) }) : "" }));
    else if (c[3] === 0 && drop) lines.push(t("picks.v.drop", { label: drop.label, lost: nf(drop.lost), of: nf(drop.of) }));
    if (c[3] === 0 && gain) lines.push(count(gain.gain, "picks.v.gain").replace("{label}", gain.label));
    return { head: head, lines: lines, tone: c[3] > 0 ? "good" : c[2] > 0 || c[1] > 0 ? "warn" : "bad" };
  }

  /** The ads worth a look, best first, in sections: matches, then ones that could match, then (only if those are few) near misses.
   *  `F`: finder.js (for byFit). -> [{tier, label, items}] with at most `n` items in all. */
  function sections(run, F, n) {
    const byTier = function (t) { return run.items.filter(function (it) { return it.tier === t; }).sort(F.byFit); };
    const want = [[3, t("picks.sec.3")], [2, t("picks.sec.2")], [1, t("picks.sec.1")]];
    const out = [];
    let left = n || 12;
    want.forEach(function (w) {
      if (left <= 0) return;
      if (w[0] === 1 && out.reduce(function (s, x) { return s + x.items.length; }, 0) >= 3) return;      // near misses only when little else is left
      const all = byTier(w[0]);
      if (!all.length) return;
      const items = all.slice(0, left);
      out.push({ tier: w[0], label: w[1], items: items, total: all.length });
      left -= items.length;
    });
    return out;
  }

  /** Is there anything to show? A finder with no complete criterion has no run. */
  const hasCriteria = function (run) { return !!run && run.active.length > 0; };

  return { say: say, describe: describe, biggestDrop: biggestDrop, runsOutAt: runsOutAt, verdict: verdict, sections: sections, hasCriteria: hasCriteria };
});
