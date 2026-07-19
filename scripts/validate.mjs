/* ============================================================
   validate.mjs — integrity gate. Exits non-zero on any failure.
   Loads the global-script data files in a shared context and checks:
     · broken c_* / flow references (engages, breaks, flows)
     · missing required fields
     · duplicate organism names or ids
     · fail values outside the canonical set
     · orphaned failure-mode categories (defined but unused)
     · cascade break-points referencing unknown organisms/host-defects/steps
     · scope cross-check against prototypes/ocr.txt (seam — skipped if absent)
   Run:  node scripts/validate.mjs
   ============================================================ */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const P = (...a) => join(ROOT, ...a);

/* ---- load the data files into one shared sandbox ---- */
const ctx = {};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of [
  "data/enums.js", "data/organisms.js", "data/host-defects.js",
  "data/cascades/extracellular.js",
  "data/cascades/vesicular.js", "data/cascades/cytosolic.js", "data/cascades/surface.js",
  "data/taxonomy.js"
]) {
  if (!existsSync(P(f))) continue; // seams may not exist yet
  vm.runInContext(readFileSync(P(f), "utf8"), ctx, { filename: f });
}
const { ENUMS, ORGANISMS, HOST_DEFECTS, CASCADES, TAXONOMY } = ctx;

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ---- preconditions ---- */
if (!ENUMS) err("ENUMS not loaded");
if (!Array.isArray(ORGANISMS)) err("ORGANISMS not loaded");
if (!Array.isArray(HOST_DEFECTS)) err("HOST_DEFECTS not loaded");

if (errors.length) { report(); process.exit(1); }

const cId = new Set(ENUMS.cIds);
const fId = new Set(ENUMS.flowIds);
const failSet = new Set(ENUMS.failureModes);
const nicheSet = new Set(ENUMS.niches.map((n) => n.id));
const sysSet = new Set(ENUMS.systems);
const kingdomSet = new Set(ENUMS.kingdoms);

/* ---- component/flow reference checker ---- */
function checkRefs(rec, label) {
  for (const c of rec.engages || []) if (!cId.has(c)) err(`${label}: engages → unknown component "${c}"`);
  for (const c of rec.breaks || []) if (!cId.has(c)) err(`${label}: breaks → unknown component "${c}"`);
  for (const f of rec.flows || []) if (!fId.has(f)) err(`${label}: flows → unknown flow "${f}"`);
}

/* ---- organisms ---- */
const ids = new Map();
const names = new Map();
const usedFails = new Set();

let refCount = 0;
for (const o of ORGANISMS) {
  const label = `organism "${o && o.name || o && o.id || "?"}"`;

  // id / name uniqueness and kingdom apply to every entry, reference or not
  if (o.id) {
    if (ids.has(o.id)) err(`duplicate id "${o.id}" (${ids.get(o.id)} / ${o.name})`);
    ids.set(o.id, o.name);
  } else err(`${label}: missing required field "id"`);
  if (o.name) {
    if (names.has(o.name)) err(`duplicate name "${o.name}"`);
    names.set(o.name, o.id);
  } else err(`${label}: missing required field "name"`);
  if (!o.kingdom) err(`${label}: missing required field "kingdom"`);
  else if (!kingdomSet.has(o.kingdom)) err(`${label}: unknown kingdom "${o.kingdom}"`);
  checkRefs(o, label);

  // reference entries appear in the taxonomy browse only — the ศรว-specific
  // fields (niche/tier/sys/fail/sub/panels) are optional, but validated if present.
  if (o.reference) {
    refCount++;
    if (o.panels) for (const p of ["resp", "evade", "dis"])
      if (!o.panels[p]) err(`${label}: panel "${p}" present but empty`);
    if (o.fail) { if (!failSet.has(o.fail)) err(`${label}: fail "${o.fail}" not in canonical set`); else usedFails.add(o.fail); }
    if (o.tier !== undefined && ![1, 2].includes(o.tier)) err(`${label}: tier, if present, must be 1 or 2`);
    for (const n of o.niche || []) if (!nicheSet.has(n)) err(`${label}: unknown niche "${n}"`);
    for (const s of o.sys || []) if (!sysSet.has(s)) err(`${label}: unknown system "${s}"`);
    continue;
  }

  const req = ["niche", "tier", "sys", "fail", "sub", "panels"];
  for (const k of req) if (o[k] === undefined || o[k] === null) err(`${label}: missing required field "${k}"`);
  if (o.panels) for (const p of ["resp", "evade", "dis"])
    if (!o.panels[p]) err(`${label}: missing panel "${p}"`);
  if (o.fail) { if (!failSet.has(o.fail)) err(`${label}: fail "${o.fail}" not in canonical set`); else usedFails.add(o.fail); }
  if (![1, 2].includes(o.tier)) err(`${label}: tier must be 1 or 2 (got ${o.tier})`);
  for (const n of o.niche || []) if (!nicheSet.has(n)) err(`${label}: unknown niche "${n}"`);
  for (const s of o.sys || []) if (!sysSet.has(s)) err(`${label}: unknown system "${s}"`);
}

/* orphaned failure-mode categories */
for (const f of ENUMS.failureModes) if (!usedFails.has(f)) err(`orphaned failure-mode category: "${f}" (defined, no organisms)`);

/* ---- host defects ---- */
const hostIds = new Map();
for (const h of HOST_DEFECTS) {
  const label = `host-defect "${h && h.name || "?"}"`;
  for (const k of ["id", "name", "panels"]) if (!h[k]) err(`${label}: missing required field "${k}"`);
  if (h.panels && !h.panels.mechanism) err(`${label}: missing panel "mechanism"`);
  if (h.id) { if (hostIds.has(h.id)) err(`duplicate host-defect id "${h.id}"`); hostIds.set(h.id, h.name); }
  checkRefs(h, label);
}

/* ---- cascades ---- */
const orgIds = new Set(ORGANISMS.map((o) => o.id));
const hIds = new Set(HOST_DEFECTS.map((h) => h.id));
for (const [branch, c] of Object.entries(CASCADES || {})) {
  const stepKeys = new Set((c.steps || []).map((s) => s.k));
  for (const s of c.steps || [])
    for (const comp of s.components || []) if (!cId.has(comp)) err(`cascade ${branch} step ${s.k}: unknown component "${comp}"`);
  for (const b of c.breaks || []) {
    const bl = `cascade ${branch} break "${b.label}"`;
    if (!stepKeys.has(b.step)) err(`${bl}: unknown step "${b.step}"`);
    if (b.refKind === "organism") { if (!orgIds.has(b.ref)) err(`${bl}: unknown organism ref "${b.ref}"`); }
    else if (b.refKind === "host") { if (!hIds.has(b.ref)) err(`${bl}: unknown host-defect ref "${b.ref}"`); }
    else err(`${bl}: invalid refKind "${b.refKind}"`);
  }
}

/* ---- taxonomy trees: every kingdom organism is exactly one leaf ---- */
function collectLeaves(node, acc, dupSink, label) {
  if (!node || typeof node !== "object") return;
  if (node.organism) {
    if (acc.has(node.organism)) dupSink.push(`${label}: organism "${node.organism}" appears more than once in the tree`);
    acc.add(node.organism);
  }
  for (const c of node.children || []) collectLeaves(c, acc, dupSink, label);
}
for (const [kingdom, entry] of Object.entries(TAXONOMY || {})) {
  if (!entry || entry.pending) continue; // seams not yet populated
  const label = `taxonomy ${kingdom}`;
  const leaves = new Set();
  collectLeaves(entry.tree, leaves, errors, label);
  // every leaf must be a real organism of this kingdom
  for (const id of leaves) {
    const o = ORGANISMS.find((x) => x.id === id);
    if (!o) err(`${label}: leaf "${id}" is not a known organism`);
    else if (o.kingdom !== kingdom) err(`${label}: leaf "${id}" is kingdom "${o.kingdom}", not ${kingdom}`);
  }
  // every organism of this kingdom must appear as a leaf
  for (const o of ORGANISMS.filter((x) => x.kingdom === kingdom))
    if (!leaves.has(o.id)) err(`${label}: organism "${o.id}" is not placed anywhere in the tree`);
}

/* ---- scope seam: cross-check against the ศรว. list when supplied ---- */
if (existsSync(P("prototypes", "ocr.txt"))) {
  // TODO: parse ocr.txt and diff required organisms against ORGANISMS names.
  warn("prototypes/ocr.txt present — scope cross-check not yet implemented (seam).");
} else {
  warn("prototypes/ocr.txt absent — scope completeness against ศรว. 2567 not checked.");
}

report();
process.exit(errors.length ? 1 : 0);

function report() {
  if (warnings.length) { console.log("\n⚠  warnings:"); for (const w of warnings) console.log("   - " + w); }
  if (errors.length) {
    console.log(`\n✗ validation FAILED — ${errors.length} error(s):`);
    for (const e of errors) console.log("   - " + e);
  } else {
    const full = ORGANISMS.length - refCount;
    console.log(`\n✓ validation passed — ${full} organisms${refCount ? ` (+${refCount} reference)` : ""}, ${HOST_DEFECTS.length} host defects, ${Object.keys(CASCADES || {}).length} cascade(s).`);
  }
}
