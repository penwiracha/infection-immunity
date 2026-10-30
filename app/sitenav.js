/* ============================================================
   sitenav.js — the side navigation used on every online page:
   the student app, the instructor dashboard and the five maps.
   SiteNav.mount({ active, role })   role: "student" | "staff"
   On the map pages the role is remembered from the last app visit
   (localStorage "ii.role"), so instructors see their own sections.
   Self-contained (injects its own CSS) so the static map pages can use it.
   ============================================================ */
;(function (root) {
  "use strict";
  const CSS = `
  :root{--sn-bg:#0c0d11;--sn-line:#262a33;--sn-ink:#eceef2;--sn-ink2:#c9cdd6;--sn-dim:#8f97a6;--sn-hover:#1d212a;--sn-line2:#33384a;
    --sn-acc:#9d8cf7;--sn-acc-ink:#15122a;--sn-bar:#0f1014;--sn-pop:#15171d;--sn-shadow:rgba(0,0,0,.45);--sn-cur:rgba(122,108,240,.16)}
  html[data-theme="light"]{--sn-bg:#ffffff;--sn-line:#dde1e7;--sn-ink:#16181d;--sn-ink2:#3a4150;--sn-dim:#5f6878;--sn-hover:#eef0f4;--sn-line2:#c9ced8;
    --sn-acc:#6a58e0;--sn-acc-ink:#ffffff;--sn-bar:#f6f7f9;--sn-pop:#ffffff;--sn-shadow:rgba(20,24,33,.14);--sn-cur:rgba(106,88,224,.10)}
  body.has-siteside{padding-left:236px}
  .siteside{position:fixed;left:0;top:0;bottom:0;width:236px;z-index:40;display:flex;flex-direction:column;
    background:var(--sn-bg);border-right:1px solid var(--sn-line);padding:18px 12px 14px;overflow-y:auto;
    font:14.5px/1.4 "Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,"Noto Sans Thai",sans-serif}
  .siteside .sbrand{display:block;color:var(--sn-ink);font-weight:700;font-size:16px;text-decoration:none;padding:4px 10px 2px}
  .siteside .spill{align-self:flex-start;display:inline-block;margin:6px 10px 0;border:1px solid var(--sn-line2);border-radius:999px;padding:1px 9px;font-size:11.5px;color:var(--sn-ink2)}
  .siteside .sgroup{margin-top:18px}
  .siteside .shead{font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--sn-dim);padding:0 10px 6px}
  .siteside a.sitem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:var(--sn-ink2);text-decoration:none;margin:1px 0}
  .siteside a.sitem:hover{background:var(--sn-hover);color:var(--sn-ink)}
  .siteside a.sitem[aria-current="page"]{background:var(--sn-cur);color:var(--sn-ink);font-weight:600;box-shadow:inset 3px 0 0 var(--sn-acc)}
  .siteside a.sitem .sdot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--c,#4a5163)}
  .siteside .sbadge{margin-left:auto;background:var(--sn-acc);color:var(--sn-acc-ink);font-size:11.5px;font-weight:700;border-radius:999px;padding:0 7px;min-width:20px;text-align:center}
  .siteside .sfoot{margin-top:auto;padding-top:14px;border-top:1px solid var(--sn-line)}
  .siteside .sfoot:empty{display:none}
  .siteside .stop{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .siteside .sclose{background:transparent;border:1px solid transparent;color:var(--sn-dim);border-radius:8px;width:32px;height:32px;
    font-size:18px;line-height:1;cursor:pointer;flex:none}
  .siteside .stheme{margin-left:auto;font-size:15px}
  .siteside .slang{display:inline-flex;align-items:center;justify-content:center}
  .siteside .sclose:hover{border-color:var(--sn-line2);color:var(--sn-ink);background:var(--sn-hover)}
  .sitebar{display:none;align-items:center;gap:12px;position:sticky;top:0;z-index:35;background:var(--sn-bar);
    border-bottom:1px solid var(--sn-line);padding:10px 16px;font:15px/1.4 "Segoe UI",-apple-system,Roboto,sans-serif}
  .sitebar button{background:transparent;color:var(--sn-ink);border:1px solid var(--sn-line2);border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer}
  .sitebar button:hover{background:var(--sn-hover)}
  .sitebar b{color:var(--sn-ink)}
  .siteshade{display:none}
  /* closed sidebar on a wide screen: the same sections as tabs along the top */
  .sitebar .stabs{display:none;align-self:stretch;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
  .sitebar .stabs::-webkit-scrollbar{display:none}
  .sitebar a.stab,.sitebar .smaps>summary{display:flex;align-items:center;gap:7px;padding:0 12px;color:var(--sn-dim);text-decoration:none;
    border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer;list-style:none}
  .sitebar .smaps>summary::-webkit-details-marker{display:none}
  .sitebar a.stab:hover,.sitebar .smaps>summary:hover{color:var(--sn-ink)}
  .sitebar a.stab[aria-current="page"],.sitebar .smaps.cur>summary{color:var(--sn-ink);border-bottom-color:var(--sn-acc);font-weight:600}
  .sitebar .stab .sbadge{background:var(--sn-acc);color:var(--sn-acc-ink);font-size:11.5px;font-weight:700;border-radius:999px;padding:0 7px}
  .sitebar .smaps{position:relative;display:flex}
  .sitebar .smapsbox{position:fixed;top:54px;min-width:190px;background:var(--sn-pop);border:1px solid var(--sn-line2);border-radius:10px;padding:6px;z-index:45;
    box-shadow:0 12px 30px var(--sn-shadow)}
  .sitebar .smapsbox a{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;color:var(--sn-ink2);text-decoration:none}
  .sitebar .smapsbox a:hover,.sitebar .smapsbox a[aria-current="page"]{background:var(--sn-hover);color:var(--sn-ink)}
  .sitebar .smapsbox .sdot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--c,#4a5163)}
  .sitebar .sacct{margin-left:auto;flex:none;display:flex;align-items:center;gap:12px}
  .sitebar .sacct:empty{display:none}
  .sitebar .sacct .userbtn{width:auto;padding:4px;border:none}
  .sitebar .sacct .userbtn>span:not(.avatar){display:none}
  body.sidecollapsed.has-siteside{padding-left:0}
  body.sidecollapsed .siteside{display:none}
  body.sidecollapsed .sitebar{display:flex;padding-top:0;padding-bottom:0;height:54px}
  body.sidecollapsed .sitebar .stabs{display:flex}
  body.sidecollapsed > .menu{position:fixed;top:58px;right:16px;left:auto;bottom:auto}
  body.nonav .siteside, body.nonav .sitebar{display:none !important}
  body.nonav.has-siteside{padding-left:0}
  .siteside a:focus-visible,.siteside button:focus-visible,.sitebar button:focus-visible{outline:2px solid #7a6cf0;outline-offset:1px}
  @media (max-width:900px){
    body.has-siteside{padding-left:0}
    .siteside{transform:translateX(-100%);transition:transform .18s ease;box-shadow:0 0 40px rgba(0,0,0,.5)}
    body.sidecollapsed .siteside{display:flex}
    body.sideopen .siteside{transform:none}
    .sitebar{display:flex}
    body.sidecollapsed .sitebar{height:auto;padding:10px 16px}
    body.sidecollapsed .sitebar .stabs{display:none}
    body.sideopen .siteshade{display:block;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:39}
  }
  @media print{.siteside,.sitebar{display:none}body.has-siteside{padding-left:0}}`;

  const STUDENT = [["home", "Home", "app.html#home"], ["learn", "Learn", "app.html#learn"], ["explore", "Explore", "app.html#explore"],
                   ["practice", "Practice", "app.html#practice"], ["progress", "Progress", "app.html#progress"]];
  const STAFF = [["overview", "Overview", "instructor.html#overview"], ["lectures", "Lectures", "instructor.html#lectures"],
                 ["questions", "Questions", "instructor.html#questions"], ["students", "Students", "instructor.html#students"],
                 ["items", "Items", "instructor.html#items"], ["exams", "Exams", "instructor.html#exams"], ["export", "Export", "instructor.html#export"]];
  // Each map has its own marker. Only the niche map uses the four niche colours (it is the map OF the niches);
  // "Where it breaks" uses the break colour (pink), never a niche colour, so the two cannot be confused.
  const NICHE_DOT = "conic-gradient(#e0603f 0 25%, #e0a83f 0 50%, #4fa3e3 0 75%, #57b86b 0)";
  const MAPS = [["niche-map", "Niche map", "niche-map.html", NICHE_DOT], ["immune-map", "Immune map", "immune-map.html", "#9d8cf7"],
                ["cascade", "Where it breaks", "cascade.html?b=extracellular", "#ec5fa5"], ["taxonomy", "Taxonomy", "taxonomy.html", "#2fb7b0"],
                ["drugs", "Antimicrobials", "drugs.html", "#94a3b8"]];

  let aside = null, items = {}, tabs = {}, foot = null, acct = null, mapsTab = null;
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function link(id, label, href, color) {
    const a = mk("a", "sitem");
    a.href = href;
    if (color) { const d = mk("span", "sdot"); d.style.setProperty("--c", color); a.appendChild(d); }
    a.appendChild(mk("span", null, label));
    a.addEventListener("click", () => document.body.classList.remove("sideopen"));
    items[id] = a;
    return a;
  }
  function group(title, rows) {
    const g = mk("div", "sgroup");
    if (title) g.appendChild(mk("div", "shead", title));
    rows.forEach((r) => g.appendChild(link(...r)));
    return g;
  }

  function mount(opts) {
    opts = opts || {};
    let role = opts.role;
    if (!role) { try { role = localStorage.getItem("ii.role") || "student"; } catch (e) { role = "student"; } }
    else if (opts.remember !== false) { try { localStorage.setItem("ii.role", role); } catch (e) { /* ignore */ } }
    const staff = role === "staff";
    if (!document.getElementById("sitenav-css")) { const st = mk("style"); st.id = "sitenav-css"; st.textContent = CSS; document.head.appendChild(st); }
    if (aside) aside.remove();
    items = {};
    aside = mk("aside", "siteside");
    aside.setAttribute("aria-label", "Site");
    const brand = mk("a", "sbrand", "Infection & Immunity");
    brand.href = staff ? "instructor.html#overview" : "app.html#home";
    const close = mk("button", "sclose", "«");
    close.type = "button";
    close.title = "Hide the menu";
    close.setAttribute("aria-label", "Hide the menu");
    close.addEventListener("click", () => setOpen(false));
    const top = mk("div", "stop"); top.appendChild(brand);
    // Dark / light switch. The apps listen for "ii-theme" and save the choice to the profile.
    if (root.Theme) {
      const tb = mk("button", "sclose stheme");
      tb.type = "button";
      // drawn icons (no emoji): a moon in light mode, a sun in dark mode
      const icon = (light) => {
        const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("aria-hidden", "true");
        svg.style.cssText = "display:block;margin:auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round";
        const add = (tag, a) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); svg.appendChild(n); };
        if (light) add("path", { d: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" });
        else { add("circle", { cx: 12, cy: 12, r: 4 });
               [[12, 2, 12, 4], [12, 20, 12, 22], [2, 12, 4, 12], [20, 12, 22, 12], [4.9, 4.9, 6.3, 6.3], [17.7, 17.7, 19.1, 19.1], [4.9, 19.1, 6.3, 17.7], [17.7, 6.3, 19.1, 4.9]]
                 .forEach(([x1, y1, x2, y2]) => add("line", { x1, y1, x2, y2 })); }
        return svg;
      };
      const paint = () => { const light = root.Theme.resolve() === "light";
        tb.textContent = ""; tb.appendChild(icon(light));
        tb.title = light ? "Switch to dark mode" : "Switch to light mode";
        tb.setAttribute("aria-label", tb.title); };
      tb.addEventListener("click", () => {
        const t = root.Theme.set(root.Theme.resolve() === "light" ? "dark" : "light");
        paint();
        root.dispatchEvent(new CustomEvent("ii-theme", { detail: t }));
      });
      root.addEventListener("ii-theme-applied", paint);
      paint();
      top.appendChild(tb);
    }
    // English / ไทย
    if (root.I18N && root.I18N.globeButton && root.I18N.available) top.appendChild(root.I18N.globeButton({ className: "sclose slang" }));
    top.appendChild(close);
    aside.appendChild(top);
    if (staff) aside.appendChild(mk("span", "spill", "Instructor"));
    const nav = mk("nav"); nav.setAttribute("aria-label", "Sections");
    const staffRows = STAFF;
    nav.appendChild(group(null, staff ? staffRows : STUDENT));
    nav.appendChild(group("Maps", MAPS));
    nav.appendChild(group("Account", [["settings", "Settings", staff ? "instructor.html#settings" : "app.html#settings"]]
      .concat(staff ? [["student-view", "Student view", "app.html?preview=1"]] : [])
      .concat(opts.preview ? [["instructor-view", "Back to instructor view", "instructor.html#overview"]] : [])));
    aside.appendChild(nav);
    foot = mk("div", "sfoot");
    aside.appendChild(foot);

    const bar = document.querySelector(".sitebar") || mk("div", "sitebar");
    bar.textContent = "";
    const menu = mk("button", null, "☰ Menu");
    menu.type = "button";
    menu.title = "Show the side menu";
    menu.setAttribute("aria-label", "Show the menu");
    menu.addEventListener("click", () => setOpen(true));
    bar.appendChild(menu); bar.appendChild(mk("b", null, "Infection & Immunity"));
    // Top tabs, shown instead of the sidebar when it is closed on a wide screen
    tabs = {};
    const strip = mk("nav", "stabs"); strip.setAttribute("aria-label", "Sections (top)");
    const tab = (id, label, href) => { const a = mk("a", "stab"); a.href = href; a.appendChild(mk("span", null, label)); tabs[id] = a; return a; };
    (staff ? staffRows : STUDENT).forEach((r) => strip.appendChild(tab(r[0], r[1], r[2])));
    mapsTab = mk("details", "smaps");
    mapsTab.appendChild(mk("summary", null, "Maps ▾"));
    const box = mk("div", "smapsbox");
    MAPS.forEach((r) => {
      const a = mk("a"); a.href = r[2];
      const d = mk("span", "sdot"); d.style.setProperty("--c", r[3]); a.appendChild(d); a.appendChild(mk("span", null, r[1]));
      tabs[r[0]] = a; box.appendChild(a);
    });
    mapsTab.appendChild(box);
    mapsTab.addEventListener("toggle", () => { if (mapsTab.open) box.style.left = mapsTab.getBoundingClientRect().left + "px"; });
    strip.appendChild(mapsTab);
    strip.appendChild(tab("settings", "Settings", staff ? "instructor.html#settings" : "app.html#settings"));
    if (staff) strip.appendChild(tab("student-view", "Student view", "app.html?preview=1"));
    if (opts.preview) strip.appendChild(tab("instructor-view", "Instructor view", "instructor.html#overview"));
    bar.appendChild(strip);
    acct = mk("div", "sacct"); bar.appendChild(acct);
    const shade = document.querySelector(".siteshade") || mk("div", "siteshade");
    shade.onclick = () => setOpen(false);
    document.body.prepend(shade); document.body.prepend(bar); document.body.prepend(aside);
    document.body.classList.add("has-siteside");
    try { document.body.classList.toggle("sidecollapsed", localStorage.getItem("ii.side") === "closed"); } catch (e) { /* ignore */ }
    if (!keyBound) {
      keyBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.body.classList.contains("sideopen")) setOpen(false);
        if (e.key === "Escape" && mapsTab) mapsTab.open = false;
      });
      document.addEventListener("click", (e) => { if (mapsTab && mapsTab.open && !mapsTab.contains(e.target)) mapsTab.open = false; });
      window.addEventListener("resize", placeFoot);
    }
    placeFoot();
    setActive(opts.active);
    return { foot };
  }
  let keyBound = false;
  const narrow = () => window.matchMedia("(max-width: 900px)").matches;
  /* Open or close the side navigation. Phones: a slide-over. Larger screens: it hides and
     the choice is remembered on this browser. */
  function setOpen(open) {
    if (narrow()) { document.body.classList.toggle("sideopen", open); return; }
    document.body.classList.toggle("sidecollapsed", !open);
    try { localStorage.setItem("ii.side", open ? "open" : "closed"); } catch (e) { /* ignore */ }
    placeFoot();
  }
  // The account button sits at the bottom of the sidebar, or at the right of the top tabs when the sidebar is closed.
  function placeFoot() {
    if (!foot || !acct || !aside) return;
    const top = document.body.classList.contains("sidecollapsed") && !narrow();
    const from = top ? foot : acct, to = top ? acct : foot;
    while (from.firstChild) to.appendChild(from.firstChild);
  }
  function setActive(id) {
    for (const set of [items, tabs]) {
      for (const [k, a] of Object.entries(set)) {
        if (k === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      }
    }
    if (mapsTab) mapsTab.classList.toggle("cur", MAPS.some((r) => r[0] === id));
  }
  function setBadge(id, n) {
    for (const a of [items[id], tabs[id]]) {
      if (!a) continue;
      let b = a.querySelector(".sbadge");
      if (!n) { if (b) b.remove(); continue; }
      if (!b) { b = mk("span", "sbadge"); a.appendChild(b); }
      b.textContent = String(n);
      b.setAttribute("aria-label", n + " waiting");
    }
  }
  function hide(on) { document.body.classList.toggle("nonav", !!on); }

  root.SiteNav = { mount, setActive, setBadge, hide, setOpen, get foot() { return document.body.classList.contains("sidecollapsed") && !narrow() ? acct : foot; } };
})(typeof globalThis !== "undefined" ? globalThis : this);
