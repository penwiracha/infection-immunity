/* ============================================================
   bundle.mjs — build ONE self-contained, offline HTML file.
   Inlines every data file into every view (fully isolated frames — no
   external files, no server, no internet), wraps them in a small nav shell,
   and writes dist/infection-immunity.html.  Run:  node scripts/bundle.mjs
   Share that single file — it opens by double-click.
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => join(ROOT, ...a);

/* ---- all data, in load order, as one blob (escaped so </script> is safe) ---- */
const DATA_FILES = [
  "data/enums.js", "data/organisms.js", "data/host-defects.js", "data/immune-map.js",
  "data/cascades/extracellular.js", "data/cascades/vesicular.js",
  "data/cascades/cytosolic.js", "data/cascades/surface.js",
  "data/taxonomy.js", "data/drugs.js"
];
const escClose = (s) => s.replace(/<\/script/gi, "<\\/script");
const DATA_JS = "<script>\n" + DATA_FILES.map((f) => escClose(readFileSync(P(f), "utf8"))).join("\n") + "\n</script>";

/* ---- process one view into a fully self-contained document string ---- */
function processView(file) {
  let html = readFileSync(P("views", file), "utf8");
  // 1. replace the external data <script src> block with the inlined data
  const hadData = /<script src="\.\.\/data\//.test(html);
  html = html.replace(/[ \t]*<script src="\.\.\/data\/[^"]+"><\/script>\n?/g, "");
  if (hadData) html = html.replace("<script>", DATA_JS + "\n<script>"); // before the view's main script
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
<style>
 :root{--bg:#0e1014;--bar:#141821;--line:#272c36;--ink:#e8eaee;--dim:#8d96a6;--acc:#7a6cf0}
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
 nav button:hover{color:var(--ink);background:#1c212b}
 nav button.on{color:#0e1014;background:var(--acc);font-weight:600}
 nav .tail{margin-left:auto;color:var(--dim);font-size:11.5px}
 #view{flex:1;width:100%;border:0;background:var(--bg)}
</style></head>
<body>
<div id="shell">
  <nav>
    <div class="brand">Infection &amp; Immunity <span>· revision</span></div>
    ${NAV.map(([k, l]) => `<button data-v="${k}">${l}</button>`).join("")}
    <div class="tail">single-file · works offline</div>
  </nav>
  <iframe id="view" title="view"></iframe>
</div>
<script id="views" type="application/json">${JSON.stringify(VIEWS_B64)}</script>
<script>
 const VIEWS=JSON.parse(document.getElementById('views').textContent);
 const frame=document.getElementById('view');
 const dec=(b64)=>new TextDecoder().decode(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));
 function show(key,b){
   if(!VIEWS[key])key='home';
   document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.v===(key==='home'?'home':key)));
   let src=dec(VIEWS[key]);
   if(key==='cascade'&&b) src=src.replace('<body>',"<body><script>window.__b="+JSON.stringify(b)+"<\\/script>");
   frame.srcdoc=src;
 }
 document.querySelectorAll('nav button').forEach(btn=>btn.onclick=()=>show(btn.dataset.v));
 window.addEventListener('message',e=>{const d=e.data;if(d&&d.go)show(d.go,d.b);});
 show('home');
</script>
</body></html>`;

mkdirSync(P("dist"), { recursive: true });
const OUT = P("dist", "infection-immunity.html");
writeFileSync(OUT, SHELL);
const kb = (Buffer.byteLength(SHELL) / 1024).toFixed(0);
console.log(`built dist/infection-immunity.html  (${kb} KB, ${Object.keys(VIEWS).length} views, fully offline)`);
