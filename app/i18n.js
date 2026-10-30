/* ============================================================
   i18n.js — English / ไทย for the website's own words (menus, buttons,
   headings, messages). Course content — lectures, questions, organism
   prose, students' own cards, names — always stays as written.

   How it works: the pages are written in English. When Thai is chosen,
   every text node and the placeholder / title / aria-label / data-tip
   attributes are looked up in the dictionary (app/i18n-th.js, loaded
   first) and swapped, including text added later (a MutationObserver).
     - Exact entries:   "Practice": "ฝึกทำ"
     - Pattern entries: "{n} cards due today": "ถึงกำหนดทบทวน {n} ใบ"
       ({name} matches any text; a captured word that is itself in the
       dictionary is translated too).
   Anything inside translate="no" (or class "notranslate") is skipped —
   that is how content is protected. Missing entries simply stay English.

   The choice lives in localStorage ("ii.lang") so the maps and home page
   follow it; signed-in users also save it to their profile (Settings).
   Changing it reloads the page.
   ============================================================ */
;(function (root) {
  "use strict";
  var KEY = "ii.lang", LANGS = ["en", "th"];
  var doc = root.document;
  function read() { try { var v = root.localStorage.getItem(KEY); return LANGS.indexOf(v) >= 0 ? v : "en"; } catch (e) { return "en"; } }
  var lang = read();

  var DICT = root.I18N_TH || {};
  var exact = new Map(), patterns = [];
  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
  Object.keys(DICT).forEach(function (k) {
    if (/\{\w+\}/.test(k)) {
      var names = [];
      var re = "^" + esc(k).replace(/\\\{(\w+)\\\}/g, function (_, n) { names.push(n); return "([\\s\\S]+?)"; }) + "$";
      patterns.push({ re: new RegExp(re), names: names, out: DICT[k] });
    } else exact.set(k, DICT[k]);
  });

  function tr(s) {
    if (lang !== "th" || s == null) return s;
    var str = String(s), m = str.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2];
    if (!core) return str;
    var hit = exact.get(core);
    if (hit == null) {
      for (var i = 0; i < patterns.length && hit == null; i++) {
        var p = patterns[i], r = p.re.exec(core);
        if (!r) continue;
        var vars = {};
        p.names.forEach(function (n, j) { var v = r[j + 1]; vars[n] = exact.has(v) ? exact.get(v) : v; });
        hit = p.out.replace(/\{(\w+)\}/g, function (_, n) { return vars[n] != null ? vars[n] : "{" + n + "}"; });
      }
    }
    return hit == null ? str : m[1] + hit + m[3];
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "data-tip", "alt"];
  function protectedEl(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP_TAGS[n.tagName] || n.getAttribute("translate") === "no" || (n.classList && n.classList.contains("notranslate"))) return true;
    }
    return false;
  }
  function doText(t) {
    if (!t.parentElement || protectedEl(t.parentElement)) return;
    var v = tr(t.nodeValue);
    if (v !== t.nodeValue) t.nodeValue = v;
  }
  function doAttrs(el) {
    if (protectedEl(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a), w = tr(v);
      if (w !== v) el.setAttribute(a, w);
    }
  }
  function walk(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) { doText(rootNode); return; }
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
    if (rootNode.nodeType === 1) { if (protectedEl(rootNode)) return; doAttrs(rootNode); }
    var w = doc.createTreeWalker(rootNode, 1 | 4, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return SKIP_TAGS[n.tagName] || n.getAttribute("translate") === "no" || n.classList.contains("notranslate") ? 2 : 1;
        return 1;
      }
    });
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) { var v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } else doAttrs(n); }
  }

  // A page can opt out (the instructor dashboard is English only for now): <html data-i18n="off">
  var off = function () { return doc.documentElement.getAttribute("data-i18n") === "off"; };
  function start() {
    if (lang !== "th" || off()) return;
    doc.documentElement.lang = "th";
    var title = tr(doc.title); if (title !== doc.title) doc.title = title;
    walk(doc.body || doc.documentElement);
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === "childList") r.addedNodes.forEach(walk);
        else if (r.type === "characterData") doText(r.target);
        else if (r.type === "attributes") doAttrs(r.target);
      }
    }).observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (lang === "th" && !off()) {
    doc.documentElement.lang = "th";
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
  }

  // Switch language. A signed-in app sets I18N.beforeChange to save the choice to the profile
  // first (given up to 3 seconds); then the page reloads in the new language.
  function set(l) {
    l = LANGS.indexOf(l) >= 0 ? l : "en";
    try { root.localStorage.setItem(KEY, l); } catch (e) { /* private window */ }
    if (l === lang) return Promise.resolve(l);
    var save = typeof api.beforeChange === "function"
      ? Promise.race([Promise.resolve().then(function () { return api.beforeChange(l); }).catch(function () {}),
                      new Promise(function (r) { setTimeout(r, 3000); })])
      : Promise.resolve();
    return save.then(function () { root.location.reload(); return l; });
  }
  root.addEventListener("message", function (e) {
    var d = e && e.data;
    if (d && typeof d === "object" && LANGS.indexOf(d.iiLang) >= 0 && d.iiLang !== lang) set(d.iiLang);
  });
  root.addEventListener("storage", function (e) { if (e.key === KEY && read() !== lang) root.location.reload(); });

  // A globe button that switches English <-> ไทย. opts.text: also show the other language's name.
  function globeButton(opts) {
    opts = opts || {};
    var NS = "http://www.w3.org/2000/svg", b = doc.createElement("button");
    b.type = "button"; b.className = (opts.className || "") + " langbtn";
    var svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "display:block;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round";
    [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M3 12h18" }], ["path", { d: "M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z" }]]
      .forEach(function (x) { var n = doc.createElementNS(NS, x[0]); for (var k in x[1]) n.setAttribute(k, x[1][k]); svg.appendChild(n); });
    b.appendChild(svg);
    var other = lang === "th" ? "English" : "ภาษาไทย";
    if (opts.text) { var sp = doc.createElement("span"); sp.textContent = other; sp.setAttribute("translate", "no"); b.appendChild(sp); }
    b.setAttribute("translate", "no");          // the label is always the other language's own name
    b.title = lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย";
    b.setAttribute("aria-label", b.title);
    b.setAttribute("lang", lang === "th" ? "en" : "th");
    b.addEventListener("click", function () { b.disabled = true; set(lang === "th" ? "en" : "th"); });
    return b;
  }

  var api = { get lang() { return lang; }, get available() { return !off(); }, set: set, t: tr, LANGS: LANGS.slice(), beforeChange: null, globeButton: globeButton,
              locale: function () { return lang === "th" ? "th-TH" : undefined; } };
  root.I18N = api;
})(typeof window !== "undefined" ? window : this);
