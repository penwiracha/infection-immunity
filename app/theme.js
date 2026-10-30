/* ============================================================
   theme.js — dark / light mode for every page (the apps, the maps,
   the home page and the offline bundle).
   Load it in <head>, before the page paints. It sets
     <html data-theme="dark|light" data-theme-choice="dark|light|system">
   and each page's CSS restyles itself under html[data-theme="light"].
   The choice is kept in localStorage ("ii.theme") so the static map pages
   follow it too; signed-in users also save it to their profile (Settings),
   which the apps copy back into localStorage on sign-in.
   Default: dark (the original look). "system" follows the device setting.
   ============================================================ */
;(function (root) {
  "use strict";
  var KEY = "ii.theme", CHOICES = ["dark", "light", "system"];
  var doc = root.document;
  function valid(t) { return CHOICES.indexOf(t) >= 0 ? t : "dark"; }
  function read() { try { return valid(root.localStorage.getItem(KEY) || "dark"); } catch (e) { return "dark"; } }
  function mq() { try { return root.matchMedia("(prefers-color-scheme: light)"); } catch (e) { return null; } }
  function resolve(t) { t = valid(t); if (t !== "system") return t; var m = mq(); return m && m.matches ? "light" : "dark"; }
  function apply(t) {
    t = valid(t);
    var r = resolve(t), d = doc.documentElement;
    d.setAttribute("data-theme", r);
    d.setAttribute("data-theme-choice", t);
    d.style.colorScheme = r;
    // the offline bundle shows each view in a frame: pass the choice down
    var frames = doc.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i++) { try { frames[i].contentWindow.postMessage({ iiTheme: t }, "*"); } catch (e) { /* ignore */ } }
    try { root.dispatchEvent(new Event("ii-theme-applied")); } catch (e) { /* old browser */ }
    return r;
  }
  function set(t) {
    t = valid(t);
    try { root.localStorage.setItem(KEY, t); } catch (e) { /* private window: this page only */ }
    apply(t);
    return t;
  }
  apply(read());
  var m = mq();
  if (m) { var onChange = function () { if (read() === "system") apply("system"); };
           if (m.addEventListener) m.addEventListener("change", onChange); else if (m.addListener) m.addListener(onChange); }
  root.addEventListener("storage", function (e) { if (e.key === KEY) apply(read()); });
  root.addEventListener("message", function (e) {
    var d = e && e.data;
    if (d && typeof d === "object" && typeof d.iiTheme === "string" && CHOICES.indexOf(d.iiTheme) >= 0) apply(d.iiTheme);
  });
  root.Theme = { get: read, set: set, apply: apply, resolve: function () { return resolve(read()); }, CHOICES: CHOICES.slice() };
})(typeof window !== "undefined" ? window : this);
