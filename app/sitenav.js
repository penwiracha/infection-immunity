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
  body.sidecollapsed.has-siteside{padding-left:0}
  body.sidecollapsed .siteside{display:none}
  body.sidecollapsed .sitebar{display:flex}
  body.nonav .siteside, body.nonav .sitebar{display:none !important}
  body.nonav.has-siteside{padding-left:0}
  .siteside a:focus-visible,.siteside button:focus-visible,.sitebar button:focus-visible{outline:2px solid #7a6cf0;outline-offset:1px}
  @media (max-width:900px){
    body.has-siteside{padding-left:0}
    .siteside{transform:translateX(-100%);transition:transform .18s ease;box-shadow:0 0 40px rgba(0,0,0,.5)}
    body.sidecollapsed .siteside{display:flex}
    body.sideopen .siteside{transform:none}
    .sitebar{display:flex}
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

  let aside = null, items = {}, foot = null;
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
    menu.setAttribute("aria-label", "Show the menu");
    menu.addEventListener("click", () => setOpen(true));
    bar.appendChild(menu); bar.appendChild(mk("b", null, "Infection & Immunity"));
    const shade = document.querySelector(".siteshade") || mk("div", "siteshade");
    shade.onclick = () => setOpen(false);
    document.body.prepend(shade); document.body.prepend(bar); document.body.prepend(aside);
    document.body.classList.add("has-siteside");
    try { document.body.classList.toggle("sidecollapsed", localStorage.getItem("ii.side") === "closed"); } catch (e) { /* ignore */ }
    if (!keyBound) {
      keyBound = true;
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("sideopen")) setOpen(false); });
    }
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
  }
  function setActive(id) {
    for (const [k, a] of Object.entries(items)) {
      if (k === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
  }
  function setBadge(id, n) {
    const a = items[id]; if (!a) return;
    let b = a.querySelector(".sbadge");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = mk("span", "sbadge"); a.appendChild(b); }
    b.textContent = String(n);
    b.setAttribute("aria-label", n + " waiting");
  }
  function hide(on) { document.body.classList.toggle("nonav", !!on); }

  root.SiteNav = { mount, setActive, setBadge, hide, setOpen, get foot() { return foot; } };
})(typeof globalThis !== "undefined" ? globalThis : this);
