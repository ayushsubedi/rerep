/* Nepali (ne) interface strings, keyed by the English text. Covers the interface chrome only: the long X-Ray sentences are generated
 * server-side in English and are deliberately not translated. Machine-assisted wording: corrections from a Nepali reader welcome.
 * Digits stay ASCII. A missing key falls back to English, and tests/test_i18n.py fails if the UI uses a string that is not here. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JaggaI18n = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const NE = {
    "Skip to results": "नतिजामा जानुहोस्",
    "chabahil, dahachowk, 10 aana…": "चाबहिल, दहचोक, 10 आना…",
    "Compare": "तुलना", "⇄ Compare": "⇄ तुलना", "★ Watchlist": "★ मनपर्ने सूची", "Watchlist": "मनपर्ने सूची", "Coverage": "समेटिएको क्षेत्र", "About": "बारेमा",
    "All districts": "सबै जिल्ला", "per aana": "प्रति आना", "per ropani": "प्रति रोपनी", "per kattha": "प्रति कठ्ठा", "per dhur": "प्रति धुर",
    "per bigha": "प्रति बिघा", "per sq ft": "प्रति वर्ग फिट", "per m²": "प्रति वर्ग मिटर",
    "Price": "मूल्य", "min Rs": "न्यूनतम रु.", "max Rs": "अधिकतम रु.", "Area": "क्षेत्रफल", "min": "न्यूनतम", "max": "अधिकतम",
    "aana": "आना", "ropani": "रोपनी", "kattha": "कठ्ठा", "dhur": "धुर", "bigha": "बिघा", "m²": "वर्ग मि.", "sq ft": "वर्ग फिट",
    "Road ≥": "बाटो ≥", "ft": "फिट", "All sources": "सबै स्रोत", "Posted": "प्रकाशित", "any time": "जुनसुकै बेला",
    "last 7 days": "पछिल्लो 7 दिन", "last 30 days": "पछिल्लो 30 दिन", "last 3 months": "पछिल्लो 3 महिना", "last 6 months": "पछिल्लो 6 महिना",
    "Price cut": "मूल्य घटेको", "Price cut (none seen yet)": "मूल्य घटेको (अहिलेसम्म देखिएन)", "Show duplicates": "दोहोरिएका देखाउनुहोस्",
    "Saved searches…": "सुरक्षित खोजीहरू…", "Save search": "खोजी सुरक्षित गर्नुहोस्", "Reset": "रिसेट",
    "Sort": "क्रम", "Price: low to high": "मूल्य: कम देखि बढी", "Price: high to low": "मूल्य: बढी देखि कम", "Cheapest vs comps": "तुलनामा सबैभन्दा सस्तो",
    "Total price": "कुल मूल्य", "Largest area": "सबैभन्दा ठूलो क्षेत्रफल", "Newest": "नयाँ",
    "Search map area": "नक्सा क्षेत्रमा खोज्नुहोस्", "Export": "निर्यात", "Listings": "सूची", "Infrastructure": "पूर्वाधार", "Districts & coverage": "जिल्ला र कभरेज",
    "cheap vs comps": "तुलनामा सस्तो", "mid": "मध्यम", "dear": "महँगो", "no comps": "तुलना छैन", "List": "सूची", "Map": "नक्सा",
    "listing": "विज्ञापन", "listings": "विज्ञापन",
    "new": "नयाँ", "price cut ": "मूल्य घटेको", "weak comps": "कमजोर तुलना", "price uncertain": "मूल्य अनिश्चित", "read as total": "कुल मूल्य मानिएको",
    "dear vs comps": "तुलनामा महँगो", "mid vs comps": "तुलनामा मध्यम", "weak": "कमजोर", "pct": "प्रतिशतक",
    "Price n/a": "मूल्य उपलब्ध छैन", "area n/a": "क्षेत्रफल उपलब्ध छैन", "total": "कुल", "ft road": "फिट बाटो", "seen": "देखिएको", "today": "आज",
    "Show more": "थप देखाउनुहोस्", "left": "बाँकी", "posted": "पोस्ट", "old": "पुरानो", "No listings match.": "कुनै विज्ञापन मेल खाएन।",
    "Loading details…": "विवरण लोड हुँदैछ…", "place": "स्थान", "area": "क्षेत्रफल", "first seen": "पहिलो पटक देखिएको", "last seen": "पछिल्लो पटक देखिएको",
    "ad dated": "विज्ञापन मिति", "facing": "मोहोडा", "per": "प्रति", "sq ft ": "वर्ग फिट",
    "X-Ray · each factor cited, none estimated": "एक्स-रे · हरेक कारक स्रोतसहित, अनुमान गरिएको छैन", "Price history (NPR/m²)": "मूल्य इतिहास (रु./वर्ग मि.)",
    "View original ad ↗": "मूल विज्ञापन हेर्नुहोस् ↗", "☆ Watch": "☆ मनपर्ने", "★ Watching": "★ मनपर्नेमा", "Show on map": "नक्सामा देखाउनुहोस्", "Previous listing (K)": "अघिल्लो विज्ञापन (K)", "Next listing (J)": "अर्को विज्ञापन (J)", "Copy link": "लिङ्क कपी", "Link copied.": "लिङ्क कपी भयो।",
    "Your notes (stored only in this browser)": "तपाईंका टिपोट (यही ब्राउजरमा मात्र सुरक्षित)", "missing": "छैन", "source ↗": "स्रोत ↗",
    "coverage": "समेटिएको क्षेत्र", "about": "बारेमा", "watchlist": "मनपर्ने सूची", "compare": "तुलना", "save search": "खोजी सुरक्षित",
    "Print shortlist": "छोटो सूची प्रिन्ट", "Export JSON": "JSON निर्यात", "Import JSON": "JSON आयात", "Save": "सुरक्षित गर्नुहोस्", "Delete": "मेट्नुहोस्",
    "Name this search (the current filters)": "यो खोजीलाई नाम दिनुहोस् (हालका फिल्टर)", "Your saved searches": "तपाईंका सुरक्षित खोजीहरू",
    "note": "टिपोट", "Language": "भाषा", "Menu": "मेनु"
  };
  const ATTRS = ["placeholder", "aria-label", "title"];
  const orig = new WeakMap();            // node -> original English (text node: string; element: {attr: string})
  let lang = "en", obs = null;

  function tr(s) { return lang === "ne" && Object.prototype.hasOwnProperty.call(NE, s) ? NE[s] : s; }

  // orig remembers {en, shown}: if the node no longer shows what we put there, the app rewrote it and the record is stale.
  function textNode(n) {
    const raw = n.nodeValue, key = raw.trim();
    if (!key) return;
    let rec = orig.get(n);
    if (rec && rec.shown !== key) rec = null;
    const en = rec ? rec.en : key;
    if (!rec && !Object.prototype.hasOwnProperty.call(NE, en)) return;
    const out = tr(en);
    orig.set(n, { en: en, shown: out });
    if (out !== key) n.nodeValue = raw.replace(key, out);
  }
  function attrs(el) {
    ATTRS.forEach(function (a) {
      const v = el.getAttribute(a);
      if (v == null) return;
      const m = orig.get(el) || {};
      let rec = m[a];
      if (rec && rec.shown !== v) rec = null;
      const en = rec ? rec.en : v;
      if (!rec && !Object.prototype.hasOwnProperty.call(NE, en)) return;
      const out = tr(en);
      m[a] = { en: en, shown: out }; orig.set(el, m);
      if (out !== v) el.setAttribute(a, out);
    });
  }
  function walk(root) {
    const w = document.createTreeWalker(root, 5 /* elements + text */);
    let n = root.nodeType === 1 ? root : w.nextNode();
    for (; n; n = w.nextNode()) {
      if (n.nodeType === 3) { if (n.parentNode && !/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) textNode(n); }
      else attrs(n);
      if (n === root && root.nodeType === 1) { /* continue into children */ }
    }
  }
  function apply() {
    if (obs) obs.disconnect();
    walk(document.body);
    document.documentElement.lang = lang;
    if (obs) obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function setLang(l) {
    lang = l === "ne" ? "ne" : "en";
    try { localStorage.setItem("jagga.lang", lang); } catch (e) { /* private mode */ }
    apply();
    const b = document.getElementById("btnLang");
    if (b) { b.setAttribute("aria-pressed", String(lang === "ne")); b.firstElementChild.textContent = lang === "ne" ? "EN" : "नेपाली"; }
  }
  function init() {
    let l = "en";
    try { l = localStorage.getItem("jagga.lang") || (/[?&#]lang=ne\b/.test(location.href) ? "ne" : "en"); } catch (e) { /* ignore */ }
    obs = new MutationObserver(function () { apply(); });
    setLang(l);
    const b = document.getElementById("btnLang");
    if (b) b.addEventListener("click", function () { setLang(lang === "ne" ? "en" : "ne"); });
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  }
  return { NE: NE, tr: tr, setLang: setLang };
});
