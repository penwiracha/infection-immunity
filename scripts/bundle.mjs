/* ============================================================
   bundle.mjs — build ONE self-contained, offline HTML file.
   Inlines every data file into every view (fully isolated frames — no
   external files, no server, no internet), wraps them in a small nav shell,
   and writes dist/infection-immunity.html.  Run:  node scripts/bundle.mjs
   Share that single file — it opens by double-click.
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => join(ROOT, ...a);

/* ---- inline every image in images/ as a base64 data-URI ----
   Keyed by filename stem: "<id>-lifecycle" for diagrams, "<id>" for micrographs.
   The views read this map (window.__IMG__, on the frame or its parent shell)
   before probing the images/ folder, so the single file shows pictures offline. */
// sniff the true image type from magic bytes — micrographs are all saved with a
// .jpg name even when the bytes are PNG, so the declared data-URI MIME must follow
// the content, not the extension.
const sniffMime = (b) =>
  b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
  : b[0] === 0x89 && b[1] === 0x50 ? "image/png"
  : b[0] === 0x47 && b[1] === 0x49 ? "image/gif"
  : null;
const IMG_MAP = {};
for (const f of readdirSync(P("images"))) {
  const m = f.match(/^(.+)\.(gif|jpe?g|png)$/i);
  if (!m) continue; // skip README, .gitignore, credits
  const buf = readFileSync(P("images", f));
  const mime = sniffMime(buf);
  if (!mime) continue; // not a real image
  IMG_MAP[m[1]] = `data:${mime};base64,${buf.toString("base64")}`;
}

/* ---- all data, in load order, as one blob (escaped so </script> is safe) ---- */
const DATA_FILES = [
  "data/enums.js", "data/organisms.js", "data/host-defects.js", "data/immune-map.js",
  "data/cascades/extracellular.js", "data/cascades/vesicular.js",
  "data/cascades/cytosolic.js", "data/cascades/surface.js",
  "data/taxonomy.js", "data/drugs.js", "data/image-credits.js"
];
const escClose = (s) => s.replace(/<\/script/gi, "<\\/script");
const DATA_JS = "<script>\n" + DATA_FILES.map((f) => escClose(readFileSync(P(f), "utf8"))).join("\n") + "\n</script>";
/* dark / light mode: app/theme.js inlined into every view and the shell */
const THEME_JS = "<script>\n" + escClose(readFileSync(P("app/theme.js"), "utf8")) + "\n</script>";
/* English / ไทย: the Thai dictionary and app/i18n.js, inlined the same way */
const I18N_JS = "<script>\n" + escClose(readFileSync(P("app/i18n-th.js"), "utf8")) + "\n</script>\n<script>\n" + escClose(readFileSync(P("app/i18n.js"), "utf8")) + "\n</script>";

/* ---- process one view into a fully self-contained document string ---- */
function processView(file) {
  let html = readFileSync(P("views", file), "utf8");
  // the side navigation links into the online app; the offline file has its own top bar
  html = html.replace(/<!-- online-only -->[\s\S]*?<!-- \/online-only -->\n?/g, "");
  // 1. replace the external data <script src> block with the inlined data
  const hadData = /<script src="\.\.\/data\//.test(html);
  html = html.replace(/[ \t]*<script src="\.\.\/data\/[^"]+"><\/script>\n?/g, "");
  if (hadData) html = html.replace("<script>", DATA_JS + "\n<script>"); // before the view's main script
  html = html.replace('<script src="../app/theme.js"></script>', () => THEME_JS);
  html = html.replace('<script src="../app/i18n-th.js"></script>\n<script src="../app/i18n.js"></script>', () => I18N_JS);
  // 2. home links → ask the shell to navigate
  html = html.replaceAll('href="../index.html"', `href="#" onclick="parent.postMessage({go:'home'},'*');return false"`);
  // 3. cascade branch links → shell reloads the cascade frame with that branch
  html = html.replace("a.href='?b='+b.id;", "a.href='#';a.onclick=function(ev){ev.preventDefault();parent.postMessage({go:'cascade',b:b.id},'*')};");
  html = html.replace("const branchId=params.get('b')||'extracellular';", "const branchId=(window.__b)||params.get('b')||'extracellular';");
  return html;
}

/* ---- process index.html into the "home" view ---- */
function processHome() {
  let html = readFileSync(P("index.html"), "utf8");
  // signed-in pages (Learn, Instructor) need the network and Supabase: not part of the offline file
  html = html.replace(/<!-- online-only -->[\s\S]*?<!-- \/online-only -->/g, "");
  html = html.replace('<script src="app/theme.js"></script>', () => THEME_JS);
  html = html.replace('<script src="app/i18n-th.js"></script>\n<script src="app/i18n.js"></script>', () => I18N_JS);
  // the home page's own language button would only reload its frame; the shell has one for the whole file
  html = html.replace(/<script>\/\* English \/ ไทย switch \*\/[^\n]*<\/script>\n?/, "");
  const map = {
    'views/niche-map.html': 'niche', 'views/immune-map.html': 'immune',
    'views/cascade.html?b=extracellular': 'cascade', 'views/taxonomy.html': 'taxonomy',
    'views/drugs.html': 'drugs'
  };
  for (const [href, key] of Object.entries(map))
    html = html.replaceAll(`href="${href}"`, `href="#" onclick="parent.postMessage({go:'${key}'},'*');return false"`);
  return html;
}

const VIEWS = {
  home: processHome(),
  niche: processView("niche-map.html"),
  immune: processView("immune-map.html"),
  cascade: processView("cascade.html"),
  taxonomy: processView("taxonomy.html"),
  drugs: processView("drugs.html")
};
// base64 (UTF-8) so backticks / </script> / Unicode inside each view can't break the shell
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const VIEWS_B64 = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, b64(v)]));

const NAV = [
  ["home", "Home"], ["niche", "Niche map"], ["immune", "Immune map"],
  ["cascade", "Cascade"], ["taxonomy", "Taxonomy"], ["drugs", "Antimicrobials"]
];

const SHELL = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Infection &amp; Immunity — revision tool</title>
${THEME_JS}
${I18N_JS}
<style>
 :root{--bg:#0e1014;--bar:#141821;--line:#272c36;--ink:#e8eaee;--dim:#8d96a6;--acc:#7a6cf0;--hov:#1c212b;--on:#0e1014}
 html[data-theme="light"]{--bg:#f6f7f9;--bar:#ffffff;--line:#dde1e7;--ink:#16181d;--dim:#5f6878;--acc:#6a58e0;--hov:#eef0f4;--on:#ffffff}
 *{box-sizing:border-box}
 html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
   font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
 #shell{display:flex;flex-direction:column;height:100%}
 nav{display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:9px 16px;background:var(--bar);
   border-bottom:1px solid var(--line)}
 nav .brand{font-weight:700;font-size:13px;margin-right:12px;letter-spacing:.2px}
 nav .brand span{color:var(--dim);font-weight:400}
 nav button{font:inherit;font-size:12.5px;color:var(--dim);background:transparent;border:1px solid transparent;
   border-radius:8px;padding:6px 12px;cursor:pointer}
 nav button:hover{color:var(--ink);background:var(--hov)}
 nav button.on{color:var(--on);background:var(--acc);font-weight:600}
 nav button.theme{font-size:14px;padding:4px 10px;border-color:var(--line)}
 nav button.langbtn{display:inline-flex;align-items:center;gap:6px;margin-left:6px}
 nav .tail{margin-left:auto;color:var(--dim);font-size:11.5px}
 #view{flex:1;width:100%;border:0;background:var(--bg)}
</style></head>
<body>
<div id="shell">
  <nav>
    <div class="brand">Infection &amp; Immunity <span>· revision</span></div>
    ${NAV.map(([k, l]) => `<button data-v="${k}">${l}</button>`).join("")}
    <div class="tail">single-file · works offline</div>
    <button class="theme" id="theme" type="button"></button>
    <span id="langslot"></span>
  </nav>
  <iframe id="view" title="view"></iframe>
</div>
<script id="imgs" type="application/json">${JSON.stringify(IMG_MAP)}</script>
<script>window.__IMG__=JSON.parse(document.getElementById('imgs').textContent);</script>
<script id="views" type="application/json">${JSON.stringify(VIEWS_B64)}</script>
<script>
 const VIEWS=JSON.parse(document.getElementById('views').textContent);
 const frame=document.getElementById('view');
 const dec=(b64)=>new TextDecoder().decode(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));
 function show(key,b){
   if(!VIEWS[key])key='home';
   document.querySelectorAll('nav button[data-v]').forEach(x=>x.classList.toggle('on',x.dataset.v===(key==='home'?'home':key)));
   let src=dec(VIEWS[key]);
   if(key==='cascade'&&b) src=src.replace('<body>',"<body><script>window.__b="+JSON.stringify(b)+"<\\/script>");
   frame.srcdoc=src;
 }
 document.querySelectorAll('nav button[data-v]').forEach(btn=>btn.onclick=()=>show(btn.dataset.v));
 window.addEventListener('message',e=>{const d=e.data;if(d&&d.go)show(d.go,d.b);});
 // dark / light: the shell's button sets it; each view frame picks it up when it loads
 const tbtn=document.getElementById('theme');
 const paint=()=>{const l=Theme.resolve()==='light';tbtn.textContent=l?'Dark mode':'Light mode';tbtn.title=l?'Switch to dark mode':'Switch to light mode';};
 tbtn.onclick=()=>{Theme.set(Theme.resolve()==='light'?'dark':'light');paint();};
 frame.addEventListener('load',()=>Theme.apply(Theme.get()));
 // English / ไทย: saved for the whole file; the shell and the open view reload in the new language
 if (window.I18N) document.getElementById('langslot').appendChild(I18N.globeButton({ className: 'theme', text: true }));
 paint();
 show('home');
</script>
</body></html>`;

mkdirSync(P("dist"), { recursive: true });
const OUT = P("dist", "infection-immunity.html");
writeFileSync(OUT, SHELL);
const kb = (Buffer.byteLength(SHELL) / 1024).toFixed(0);
const imgCount = Object.keys(IMG_MAP).length;
console.log(`built dist/infection-immunity.html  (${kb} KB, ${Object.keys(VIEWS).length} views, ${imgCount} images inlined, fully offline)`);
