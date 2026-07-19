/* ============================================================
   migrate.mjs — one-time, re-runnable migration.

   Reads the three prototypes in ../prototypes VERBATIM, extracts their
   data literals, and emits the restructured data files:
     data/organisms.js       (89 organism records)
     data/host-defects.js    (13 immunodeficiency records)
     data/cascades/extracellular.js

   No prose is retyped: strings are lifted exactly as authored. The only
   authored-here content is structural — id slugs, kingdom tags, and the
   name→id resolution tables below. Run:  node scripts/migrate.mjs
   ============================================================ */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const P = (...a) => join(ROOT, ...a);

/* ---- extract a balanced [...] / {...} literal following a declaration ---- */
function balancedFrom(src, openIdx) {
  let depth = 0, inStr = null, esc = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i + 2); if (i < 0) i = src.length; continue; }
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  throw new Error("unbalanced literal");
}
function literalAfter(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`decl not found: ${decl}`);
  let i = at + decl.length;
  while (src[i] !== "[" && src[i] !== "{") i++;
  return balancedFrom(src, i);
}
const evalLiteral = (txt) => new Function(`return (${txt});`)();

/* ---- load prototype literals ---- */
const nicheHtml = readFileSync(P("prototypes", "infection-and-defence-map.html"), "utf8");
const cascadeHtml = readFileSync(P("prototypes", "cascade-extracellular.html"), "utf8");
const mapHtml = readFileSync(P("prototypes", "immune-map.html"), "utf8");

const ORGS = evalLiteral(literalAfter(nicheHtml, "const ORGS ="));
const STEPS = evalLiteral(literalAfter(cascadeHtml, "const STEPS ="));
const L = evalLiteral(literalAfter(cascadeHtml, "const L ="));
const MAP = evalLiteral(literalAfter(mapHtml, "const MAP ="));

/* ---- id slug (strip parenthetical, non-alnum → hyphen) ---- */
function slug(name) {
  return name
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ---- kingdom: authored per organism name (the one inferred classification) ---- */
const KINGDOM = {
  "Streptococcus pneumoniae": "bacteria", "Streptococcus pyogenes (GAS)": "bacteria",
  "Staphylococcus aureus": "bacteria", "Neisseria meningitidis": "bacteria",
  "Haemophilus influenzae b": "bacteria", "Corynebacterium diphtheriae": "bacteria",
  "Bordetella pertussis": "bacteria", "Clostridium tetani": "bacteria",
  "Clostridium botulinum": "bacteria", "Clostridium perfringens": "bacteria",
  "Vibrio cholerae": "bacteria", "Shigella / EIEC": "bacteria",
  "Salmonella (non-typhoidal)": "bacteria", "Salmonella Typhi": "bacteria",
  "Campylobacter jejuni": "bacteria", "Escherichia coli (UPEC/ETEC)": "bacteria",
  "Pseudomonas aeruginosa": "bacteria", "Burkholderia pseudomallei": "bacteria",
  "Leptospira interrogans": "bacteria", "Treponema pallidum": "bacteria",
  "Neisseria gonorrhoeae": "bacteria", "Chlamydia trachomatis": "bacteria",
  "Haemophilus ducreyi": "bacteria", "Gardnerella / BV flora": "bacteria",
  "Mycobacterium tuberculosis": "bacteria", "Mycobacterium leprae": "bacteria",
  "Legionella pneumophila": "bacteria", "Brucella species": "bacteria",
  "Listeria monocytogenes": "bacteria", "Rickettsia / Orientia tsutsugamushi": "bacteria",
  "Bacillus anthracis": "bacteria", "Yersinia pestis": "bacteria",
  "Group B Streptococcus": "bacteria", "Helicobacter pylori": "bacteria",
  "Clostridioides difficile": "bacteria",
  "Influenza A": "virus", "SARS-CoV-2": "virus", "Respiratory syncytial virus": "virus",
  "Measles virus": "virus", "Rubella virus": "virus", "Varicella zoster virus": "virus",
  "Herpes simplex virus": "virus", "Cytomegalovirus": "virus", "Epstein–Barr virus": "virus",
  "Hepatitis A virus": "virus", "Hepatitis B virus": "virus", "Hepatitis C virus": "virus",
  "Hepatitis E virus": "virus", "HIV-1": "virus", "Dengue virus": "virus",
  "Chikungunya virus": "virus", "Zika virus": "virus", "Rabies virus": "virus",
  "Poliovirus": "virus", "Mumps virus": "virus", "Enteroviruses (EV71, Coxsackie)": "virus",
  "Parvovirus B19": "virus", "Human herpesvirus 6": "virus", "Human papillomavirus": "virus",
  "Nipah virus": "virus",
  "Candida albicans": "fungus", "Cryptococcus neoformans": "fungus",
  "Talaromyces (Penicillium) marneffei": "fungus", "Aspergillus fumigatus": "fungus",
  "Mucorales (mucormycosis)": "fungus", "Pneumocystis jirovecii": "fungus",
  "Dermatophytes (Trichophyton etc.)": "fungus",
  "Plasmodium falciparum": "parasite", "Entamoeba histolytica": "parasite",
  "Giardia lamblia": "parasite", "Toxoplasma gondii": "parasite",
  "Trichomonas vaginalis": "parasite", "Leishmania species": "parasite",
  "Free-living amoebae (Naegleria, Acanthamoeba)": "parasite",
  "Ascaris lumbricoides": "parasite", "Hookworm (Necator, Ancylostoma)": "parasite",
  "Strongyloides stercoralis": "parasite", "Enterobius vermicularis": "parasite",
  "Trichuris trichiura": "parasite", "Taenia solium / cysticercosis": "parasite",
  "Opisthorchis viverrini": "parasite", "Schistosoma species": "parasite",
  "Trichinella spiralis": "parasite", "Gnathostoma spinigerum": "parasite",
  "Angiostrongylus cantonensis": "parasite", "Wuchereria bancrofti (filariasis)": "parasite",
  "Sarcoptes scabiei": "parasite", "Pediculus / Phthirus (lice)": "parasite",
  "Cutaneous larva migrans (Ancylostoma braziliense)": "parasite"
};

/* ---- MAP key → organism id (the 6 authored organisms). cgd/c59 are host defects. ---- */
const MAP_ORG = {
  spneumo: "streptococcus-pneumoniae",
  tb: "mycobacterium-tuberculosis",
  hiv: "hiv-1",
  hsv: "herpes-simplex-virus",
  schisto: "schistosoma-species",
  candida: "candida-albicans"
};

/* ============================================================
   ORGANISMS
   ============================================================ */
const seenIds = new Map();
const organisms = ORGS.map((o) => {
  const id = slug(o.n);
  if (seenIds.has(id)) throw new Error(`duplicate id ${id} from "${o.n}" and "${seenIds.get(id)}"`);
  seenIds.set(id, o.n);
  const kingdom = KINGDOM[o.n];
  if (!kingdom) throw new Error(`no kingdom mapped for "${o.n}"`);
  return {
    id, name: o.n, kingdom,
    niche: o.niche, tier: o.tier, sys: o.sys,
    fail: o.fail, sub: o.sub,
    panels: { resp: o.resp, evade: o.evade, dis: o.dis },
    engages: [], breaks: [], flows: [],
    taxonomy: {}, treatment: [], resistance: []
  };
});
const byId = new Map(organisms.map((o) => [o.id, o]));

/* attach immune-map linkage to the 6 authored organisms */
for (const [key, id] of Object.entries(MAP_ORG)) {
  const m = MAP[key], org = byId.get(id);
  if (!m) throw new Error(`MAP missing key ${key}`);
  if (!org) throw new Error(`organism id ${id} not found for MAP key ${key}`);
  org.engages = m.engages || [];
  org.breaks = m.breaks || [];
  org.flows = m.flows || [];
  org.mapNote = m.why; // map-specific framing, additive to the 3 panels
}

/* ============================================================
   HOST DEFECTS — the host-side break-points from the cascade,
   plus immune-map linkage for the two that have it (cgd, c59).
   defectStep is where the cascade prototype placed them.
   ============================================================ */
// L index of each host defect  →  { id, and optional MAP key for linkage }
const HOST = {
  "Barrier loss: burns, catheters, lines": { id: "barrier-loss" },
  "Cystic fibrosis / bronchiectasis": { id: "cystic-fibrosis" },
  "MBL deficiency": { id: "mbl-deficiency" },
  "Asplenia / hyposplenism": { id: "asplenia" },
  "X-linked agammaglobulinaemia": { id: "xla" },
  "Selective IgA deficiency": { id: "iga-deficiency" },
  "Leukocyte adhesion deficiency": { id: "lad" },
  "Neutropenia": { id: "neutropenia" },
  "Chronic granulomatous disease": { id: "cgd", map: "cgd" },
  "Chediak-Higashi syndrome": { id: "chediak-higashi" },
  "Terminal complement deficiency (C5&ndash;C9)": { id: "terminal-complement-deficiency", map: "c59" },
  "Common variable immunodeficiency": { id: "cvid" },
  "Advanced HIV (loss of CD4 help)": { id: "advanced-hiv" }
};

// host-flagged in the cascade but genuinely an organism (framed as a host gap)
const HOST_FLAGGED_ORGANISMS = new Set(["Group B Streptococcus"]);

const hostDefects = [];
const hostIdByName = new Map();
for (const l of L) {
  if (!l.host) continue;
  if (HOST_FLAGGED_ORGANISMS.has(l.n)) continue;
  const meta = HOST[l.n];
  if (!meta) throw new Error(`unmapped host defect "${l.n}"`);
  hostIdByName.set(l.n, meta.id);
  const rec = {
    id: meta.id, name: l.n, kind: "host",
    defectStep: l.s, how: l.how,
    panels: { mechanism: l.m, dis: l.o },
    engages: [], breaks: [], flows: []
  };
  if (meta.map) {
    const m = MAP[meta.map];
    rec.engages = m.engages || [];
    rec.breaks = m.breaks || [];
    rec.flows = m.flows || [];
    rec.mapNote = m.why;
  }
  hostDefects.push(rec);
}

/* ============================================================
   EXTRACELLULAR CASCADE
   steps: scaffold + component mapping (authored below, structural)
   breaks: ref (organism|host id) + step + verbatim how/mech
   ============================================================ */
// which immune-map components each step corresponds to (structural mapping)
const STEP_COMPONENTS = {
  S1: ["c_barrier", "c_flora", "c_amp"],
  S2: ["c_prr", "c_c3"],
  S3: ["c_c3b", "c_ab"],
  S4: ["c_c5a", "c_th17", "c_neut"],
  S5: ["c_phago"],
  S6: ["c_burst"],
  S7: ["c_mac"],
  S8: ["c_tfh", "c_bcell", "c_mem"]
};

// name (L.n) → { ref, refKind, side } for every break-point
const CASCADE_REF = {
  // S1
  "Gardnerella / BV flora": { ref: "gardnerella-bv-flora", refKind: "organism", side: "pathogen" },
  "Clostridioides difficile": { ref: "clostridioides-difficile", refKind: "organism", side: "pathogen" },
  "Vibrio cholerae": { ref: "vibrio-cholerae", refKind: "organism", side: "pathogen" },
  "Escherichia coli (UPEC)": { ref: "escherichia-coli", refKind: "organism", side: "pathogen" },
  "Helicobacter pylori": { ref: "helicobacter-pylori", refKind: "organism", side: "pathogen" },
  "Mucorales": { ref: "mucorales", refKind: "organism", side: "pathogen" },
  "Candida albicans": { ref: "candida-albicans", refKind: "organism", side: "pathogen" },
  "Free-living amoebae": { ref: "free-living-amoebae", refKind: "organism", side: "pathogen" },
  "Barrier loss: burns, catheters, lines": { ref: "barrier-loss", refKind: "host", side: "host" },
  "Cystic fibrosis / bronchiectasis": { ref: "cystic-fibrosis", refKind: "host", side: "host" },
  // S2
  "Yersinia pestis": { ref: "yersinia-pestis", refKind: "organism", side: "pathogen" },
  "Brucella species": { ref: "brucella-species", refKind: "organism", side: "pathogen" },
  "MBL deficiency": { ref: "mbl-deficiency", refKind: "host", side: "host" },
  // S3
  "Streptococcus pneumoniae": { ref: "streptococcus-pneumoniae", refKind: "organism", side: "pathogen" },
  "Neisseria meningitidis": { ref: "neisseria-meningitidis", refKind: "organism", side: "pathogen" },
  "Haemophilus influenzae b": { ref: "haemophilus-influenzae-b", refKind: "organism", side: "pathogen" },
  "Staphylococcus aureus": { ref: "staphylococcus-aureus", refKind: "organism", side: "pathogen" },
  "Streptococcus pyogenes": { ref: "streptococcus-pyogenes", refKind: "organism", side: "pathogen" },
  "Bacillus anthracis": { ref: "bacillus-anthracis", refKind: "organism", side: "pathogen" },
  "Cryptococcus neoformans": { ref: "cryptococcus-neoformans", refKind: "organism", side: "pathogen" },
  "Treponema pallidum": { ref: "treponema-pallidum", refKind: "organism", side: "pathogen" },
  "Group B Streptococcus": { ref: "group-b-streptococcus", refKind: "organism", side: "host" },
  "Asplenia / hyposplenism": { ref: "asplenia", refKind: "host", side: "host" },
  "X-linked agammaglobulinaemia": { ref: "xla", refKind: "host", side: "host" },
  "Selective IgA deficiency": { ref: "iga-deficiency", refKind: "host", side: "host" },
  // S4
  "Streptococcus pyogenes (C5a peptidase)": { ref: "streptococcus-pyogenes", refKind: "organism", side: "pathogen" },
  "Bordetella pertussis": { ref: "bordetella-pertussis", refKind: "organism", side: "pathogen" },
  "Clostridium perfringens": { ref: "clostridium-perfringens", refKind: "organism", side: "pathogen" },
  "Leukocyte adhesion deficiency": { ref: "lad", refKind: "host", side: "host" },
  // S5
  "Pseudomonas aeruginosa": { ref: "pseudomonas-aeruginosa", refKind: "organism", side: "pathogen" },
  "Entamoeba histolytica": { ref: "entamoeba-histolytica", refKind: "organism", side: "pathogen" },
  "Neutropenia": { ref: "neutropenia", refKind: "host", side: "host" },
  // S6
  "Staphylococcus aureus (burst evasion)": { ref: "staphylococcus-aureus", refKind: "organism", side: "pathogen" },
  "Haemophilus ducreyi": { ref: "haemophilus-ducreyi", refKind: "organism", side: "pathogen" },
  "Chronic granulomatous disease": { ref: "cgd", refKind: "host", side: "host" },
  "Chediak-Higashi syndrome": { ref: "chediak-higashi", refKind: "host", side: "host" },
  // S7
  "Neisseria gonorrhoeae": { ref: "neisseria-gonorrhoeae", refKind: "organism", side: "pathogen" },
  "Terminal complement deficiency (C5&ndash;C9)": { ref: "terminal-complement-deficiency", refKind: "host", side: "host" },
  // S8
  "Neisseria gonorrhoeae (no memory)": { ref: "neisseria-gonorrhoeae", refKind: "organism", side: "pathogen" },
  "Streptococcus pneumoniae (T-independent)": { ref: "streptococcus-pneumoniae", refKind: "organism", side: "pathogen" },
  "Bordetella pertussis (waning)": { ref: "bordetella-pertussis", refKind: "organism", side: "pathogen" },
  "Clostridium tetani": { ref: "clostridium-tetani", refKind: "organism", side: "pathogen" },
  "Corynebacterium diphtheriae": { ref: "corynebacterium-diphtheriae", refKind: "organism", side: "pathogen" },
  "Common variable immunodeficiency": { ref: "cvid", refKind: "host", side: "host" },
  "Advanced HIV (loss of CD4 help)": { ref: "advanced-hiv", refKind: "host", side: "host" }
};

const cascadeSteps = STEPS.map((s) => ({
  k: s.k, t: s.t, d: s.d, components: STEP_COMPONENTS[s.k] || []
}));
const cascadeBreaks = L.map((l) => {
  const r = CASCADE_REF[l.n];
  if (!r) throw new Error(`unresolved cascade break-point "${l.n}"`);
  return {
    step: l.s, ref: r.ref, refKind: r.refKind, side: r.side,
    tier: l.tier || 0, label: l.n, how: l.how, mech: l.m
  };
});
const cascade = { id: "extracellular", branch: "extra", steps: cascadeSteps, breaks: cascadeBreaks };

/* ============================================================
   SERIALISE — global-script style, loadable in browser and Node
   ============================================================ */
function emit(varName, value, assign) {
  const body = JSON.stringify(value, null, 2);
  return `/* GENERATED by scripts/migrate.mjs — do not hand-edit the migrated prose.
   Structural fields (taxonomy/treatment/resistance/engages/breaks/flows) are
   yours to fill; re-running migrate will preserve them only if you move them
   into the mapping tables. Prose panels are verbatim from the prototypes. */
;(function (root) {
  const ${varName} = ${body};
  ${assign}
  if (typeof module !== "undefined" && module.exports) module.exports = ${varName};
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
}

writeFileSync(P("data", "organisms.js"),
  emit("ORGANISMS", organisms, "root.ORGANISMS = ORGANISMS;"));
writeFileSync(P("data", "host-defects.js"),
  emit("HOST_DEFECTS", hostDefects, "root.HOST_DEFECTS = HOST_DEFECTS;"));
writeFileSync(P("data", "cascades", "extracellular.js"),
  emit("CASCADE_EXTRA", cascade,
    "root.CASCADES = root.CASCADES || {}; root.CASCADES.extracellular = CASCADE_EXTRA;"));

console.log(`organisms:     ${organisms.length}`);
console.log(`host defects:  ${hostDefects.length}`);
console.log(`cascade steps: ${cascadeSteps.length}  breaks: ${cascadeBreaks.length}`);
console.log("migration complete.");
