/* The shortlist page's logic: pure, no DOM, unit-tested under Node (tests/js/picks.test.mjs).
 *
 * The finder (finder.js) answers "which ads pass which criterion". This file turns that into the plain words a person reads first: what was asked for, one sentence
 * saying whether anything fits (and which rule removes the most ads when nothing does), and the few ads worth a phone call, best first. Nothing here is new data and
 * nothing is scored: the order is finder.js's own (tier, then wishes met, then price). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JaggaPicks = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const num = function (v) { if (v === "" || v == null) return null; const n = +v; return isFinite(n) ? n : null; };
  const nf = function (x) { return Math.round(x).toLocaleString("en-US"); };
  const plural = function (n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); };
  const list = function (xs) { return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " or " + xs[xs.length - 1]; };

  /** One criterion in plain words. `o`: {money: n -> 'Rs 35 lakh', district: id -> name, flags: [{k, label}]}. */
  function say(id, r, o) {
    const money = o.money || function (v) { return "Rs " + nf(v); };
    if (id.slice(0, 5) === "flag_") {
      const f = (o.flags || []).filter(function (x) { return "flag_" + x.k === id; })[0];
      return "The ad mentions " + (f ? f.label : id.slice(5));
    }
    if (id === "where") return "In " + list(r.dis.map(function (d) { return (o.district || String)(d); }));
    if (id === "size") {
      const lo = num(r.min), hi = num(r.max);
      return lo != null && hi != null ? "Between " + lo + " and " + hi + " " + r.unit : lo != null ? "At least " + lo + " " + r.unit : "At most " + hi + " " + r.unit;
    }
    if (id === "budget") {
      const t = num(r.total), p = num(r.pmax), out = [];
      if (t != null) out.push("Up to " + money(t) + " in total");
      if (p != null) out.push((t != null ? "up to " : "Up to ") + money(p) + " per " + r.punit);
      return out.join(", or ");
    }
    if (id === "road") return "A road at least " + r.min + " ft wide";
    if (id === "hills") {
      const lo = num(r.min), hi = num(r.max);
      return lo != null && hi != null ? "On ground between " + nf(lo) + " and " + nf(hi) + " m above sea level" : lo != null ? "On ground at least " + nf(lo) + " m above sea level" : "On ground at most " + nf(hi) + " m above sea level";
    }
    if (id === "near") return "Within " + list(r.places.map(function (p) { return p.km + " km of " + p.n; }));
    if (id === "city") return "Within " + r.km + " km of a city";
    if (id === "fresh") return "Posted in the last " + plural(+r.days, "day");
    if (id === "value") return "Priced among the cheapest " + r.pct + "% for its area";
    if (id === "trust") return "A price reading we can trust";
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
      head = plural(c[3], "ad meets", "ads meet") + " every must-have.";
      if (c[2] > 0) lines.push(plural(c[2], "more could", "more could") + ": nothing fails, but the ad does not say something the rule needs.");
    } else if (c[2] > 0) {
      head = "No ad is proven to meet every must-have.";
      lines.push(plural(c[2], "ad could", "ads could") + ": nothing fails, but each leaves out a fact (the road, the height, the date). A phone call settles it.");
    } else if (c[1] > 0) {
      head = "No ad meets every must-have.";
      lines.push(plural(c[1], "ad misses", "ads miss") + " by exactly one rule.");
    } else {
      head = "Nothing is close to what you asked for.";
    }
    if (c[3] === 0 && out) lines.push("The ads run out at “" + out.label + "”: of the " + plural(out.of, "ad") + " that reach it, " + nf(out.fail) + " fail" + (out.unknown ? " and " + nf(out.unknown) + " do not say" : "") + ".");
    else if (c[3] === 0 && drop) lines.push("The rule that removes the most ads is “" + drop.label + "”: " + nf(drop.lost) + " of " + nf(drop.of) + " fall out there.");
    if (c[3] === 0 && gain) lines.push("If “" + gain.label + "” were only nice to have, " + plural(gain.gain, "more ad would", "more ads would") + " match.");
    return { head: head, lines: lines, tone: c[3] > 0 ? "good" : c[2] > 0 || c[1] > 0 ? "warn" : "bad" };
  }

  /** The ads worth a look, best first, in sections: matches, then ones that could match, then (only if those are few) near misses.
   *  `F`: finder.js (for byFit). -> [{tier, label, items}] with at most `n` items in all. */
  function sections(run, F, n) {
    const byTier = function (t) { return run.items.filter(function (it) { return it.tier === t; }).sort(F.byFit); };
    const want = [[3, "Match every must-have"], [2, "Could match: a fact is missing"], [1, "Near misses: one rule fails"]];
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
