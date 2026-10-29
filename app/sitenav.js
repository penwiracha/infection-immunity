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
  body.has-siteside{padding-left:236px}
  .siteside{position:fixed;left:0;top:0;bottom:0;width:236px;z-index:40;display:flex;flex-direction:column;
    background:#0c0d11;border-right:1px solid #262a33;padding:18px 12px 14px;overflow-y:auto;
    font:14.5px/1.4 "Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,"Noto Sans Thai",sans-serif}
  .siteside .sbrand{display:block;color:#eceef2;font-weight:700;font-size:16px;text-decoration:none;padding:4px 10px 2px}
  .siteside .spill{align-self:flex-start;display:inline-block;margin:6px 10px 0;border:1px solid #33384a;border-radius:999px;padding:1px 9px;font-size:11.5px;color:#c9cdd6}
  .siteside .sgroup{margin-top:18px}
  .siteside .shead{font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8f97a6;padding:0 10px 6px}
  .siteside a.sitem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:#c9cdd6;text-decoration:none;margin:1px 0}
  .siteside a.sitem:hover{background:#1d212a;color:#eceef2}
  .siteside a.sitem[aria-current="page"]{background:rgba(122,108,240,.16);color:#eceef2;font-weight:600;box-shadow:inset 3px 0 0 #9d8cf7}
  .siteside a.sitem .sdot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--c,#4a5163)}
  .siteside .sbadge{margin-left:auto;background:#9d8cf7;color:#15122a;font-size:11.5px;font-weight:700;border-radius:999px;padding:0 7px;min-width:20px;text-align:center}
  .siteside .sfoot{margin-top:auto;padding-top:14px;border-top:1px solid #262a33}
  .siteside .sfoot:empty{display:none}
  .siteside .stop{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .siteside .sclose{background:transparent;border:1px solid transparent;color:#8f97a6;border-radius:8px;width:32px;height:32px;
    font-size:18px;line-height:1;cursor:pointer;flex:none}
  .siteside .sclose:hover{border-color:#33384a;color:#eceef2;background:#1d212a}
  .sitebar{display:none;align-items:center;gap:12px;position:sticky;top:0;z-index:35;background:#0f1014;
    border-bottom:1px solid #262a33;padding:10px 16px;font:15px/1.4 "Segoe UI",-apple-system,Roboto,sans-serif}
  .sitebar button{background:transparent;color:#eceef2;border:1px solid #33384a;border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer}
  .sitebar button:hover{background:#1d212a}
  .sitebar b{color:#eceef2}
  .siteshade{display:none}
  /* closed sidebar on a wide screen: the same sections as tabs along the top */
  .sitebar .stabs{display:none;align-self:stretch;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
  .sitebar .stabs::-webkit-scrollbar{display:none}
  .sitebar a.stab,.sitebar .smaps>summary{display:flex;align-items:center;gap:7px;padding:0 12px;color:#8f97a6;text-decoration:none;
    border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer;list-style:none}
  .sitebar .smaps>summary::-webkit-details-marker{display:none}
  .sitebar a.stab:hover,.sitebar .smaps>summary:hover{color:#eceef2}
  .sitebar a.stab[aria-current="page"],.sitebar .smaps.cur>summary{color:#eceef2;border-bottom-color:#9d8cf7;font-weight:600}
  .sitebar .stab .sbadge{background:#9d8cf7;color:#15122a;font-size:11.5px;font-weight:700;border-radius:999px;padding:0 7px}
  .sitebar .smaps{position:relative;display:flex}
  .sitebar .smapsbox{position:fixed;top:54px;min-width:190px;background:#15171d;border:1px solid #33384a;border-radius:10px;padding:6px;z-index:45;
    box-shadow:0 12px 30px rgba(0,0,0,.45)}
  .sitebar .smapsbox a{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;color:#c9cdd6;text-decoration:none}
  .sitebar .smapsbox a:hover,.sitebar .smapsbox a[aria-current="page"]{background:#1d212a;color:#eceef2}
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
  const MAPS = [["niche-map", "Niche map", "niche-map.html", "#e0603f"], ["immune-map", "Immune map", "immune-map.html", "#7a6cf0"],
                ["cascade", "Where it breaks", "cascade.html?b=extracellular", "#e0603f"], ["taxonomy", "Taxonomy", "taxonomy.html", "#57b86b"],
                ["drugs", "Antimicrobials", "drugs.html", "#e0a83f"]];

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
    const top = mk("div", "stop"); top.appendChild(brand); top.appendChild(close);
    aside.appendChild(top);
    if (staff) aside.appendChild(mk("span", "spill", "Instructor"));
    const nav = mk("nav"); nav.setAttribute("aria-label", "Sections");
    nav.appendChild(group(null, staff ? STAFF : STUDENT));
    nav.appendChild(group("Maps", MAPS));
    nav.appendChild(group("Account", [["settings", "Settings", staff ? "instructor.html#settings" : "app.html#settings"]]
      .concat(staff ? [["student-view", "Student view", "app.html?preview=1"]] : [])));
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
    (staff ? STAFF : STUDENT).forEach((r) => strip.appendChild(tab(r[0], r[1], r[2])));
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
