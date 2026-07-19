# Infection &amp; Immunity — revision tool

A revision tool for Infection &amp; Immunity, mapped to the Thai medical licensing
requirements (ศรว. 2567). Four linked views read from **one dataset**: no organism
content is duplicated across views.

## Open it

Zero build. Open `index.html` in a browser (double-click works — data files load as
plain `<script>` globals, no dev server required). From there:

### Share it as one offline file

```
node scripts/bundle.mjs      # → dist/infection-immunity.html
```

Produces a **single self-contained HTML file** (~2 MB) with every view and all data
inlined in isolated frames. It opens by double-click, works with **no internet and no
other files** — hand it to a student, email it, put it on a USB stick. (To host it online
instead, push the repo to GitHub and enable GitHub Pages.)

| View | File | Reads |
|---|---|---|
| Niche map | `views/niche-map.html` | organisms |
| Immune map (keystone) | `views/immune-map.html` | organisms + host defects |
| Cascade | `views/cascade.html?b=extracellular` | cascade + organisms + host defects |
| Taxonomy browse *(seam)* | `views/taxonomy.html` | organisms + taxonomy |

## Data layer — the single source of truth

Everything lives in `data/`, each file assigning a global (browser) that Node can also load:

- **`organisms.js`** — 89 organism records. One record per organism. This is the source of truth.
- **`host-defects.js`** — 13 immunodeficiencies (CGD, C5–9, neutropenia, XLA, …). The
  host-side break-points; not organisms, so kept separate.
- **`cascades/extracellular.js`** — the 8-step spine + 45 break-point references.
- **`cascades/{vesicular,cytosolic,surface}.js`** — seams (empty, `pending:true`).
- **`taxonomy.js`** — classification-tree seam (empty).
- **`enums.js`** — canonical vocabularies (niches, failure modes, systems, kingdoms,
  the 29 `c_*` component IDs, the 24 `f_*` flow IDs). The validator checks everything against these.

### Organism record shape

```js
{
  id: "streptococcus-pneumoniae",   // stable slug
  name: "Streptococcus pneumoniae",
  kingdom: "bacteria",              // bacteria | virus | fungus | parasite
  niche: ["extra"],                 // extra | vesic | cyto | surf
  tier: 1,                          // ศรว. group 1 | 2
  sys: ["Resp","CNS","ENT"],
  fail: "Capsule / anti-phagocytic",// must be in enums.failureModes
  sub: "capsule",
  panels: { resp, evade, dis },     // the 3 prose panels (verbatim from the prototype)

  engages: ["c_prr", …],            // immune-map components used   (authored for ~6 so far)
  breaks:  ["c_c3b", …],            // immune-map components broken
  flows:   ["f_prr_c3", …],         // immune-map flow paths lit
  mapNote: "…",                     // optional map-specific framing

  taxonomy: {},                     // EMPTY — fill incrementally
  treatment: [],                    // EMPTY — mechanism-level only
  resistance: []                    // EMPTY — mechanism only
}
```

`taxonomy` / `treatment` / `resistance` are intentionally empty and filled by hand, in
small batches. See **Filling content** below.

## Validate

```
node scripts/validate.mjs
```

Exits non-zero and lists every problem. It fails loudly on:

- broken `c_*` / `f_*` references in any `engages` / `breaks` / `flows`
- missing required fields (including the three panels)
- duplicate organism `id` or `name`
- a `fail` value outside `enums.failureModes`
- **orphaned** failure-mode categories (defined but used by no organism)
- cascade break-points referencing an unknown organism / host defect / step

The **scope** check against the ศรว. list is a seam: drop the OCR of the requirement
list at `prototypes/ocr.txt` and implement the diff in `validate.mjs` (marked `TODO`).

## Regenerate (provenance)

The data files were produced from the three original prototypes (kept in `prototypes/`)
by `scripts/migrate.mjs`, which lifts all prose **verbatim** — nothing was retyped. The
only content authored in the migration is structural: id slugs, `kingdom` tags, and the
name→id resolution tables. Re-run with:

```
node scripts/migrate.mjs   # overwrites data/organisms.js, host-defects.js, cascades/extracellular.js
```

> ⚠ Re-running migrate **overwrites** those three files. Once you start hand-filling
> `taxonomy`/`treatment`/`resistance` or authoring `engages`/`breaks`, either stop
> re-running migrate, or move that content into the migration's mapping tables first.

## Filling content — the ground rules

- **Never bulk-generate medical content.** Organism records are added and verified in
  small batches. Structural scaffolding is automated; clinical accuracy is checked by hand.
- **Treatment stays mechanistic** — drug class + why it works. Never empirical regimens;
  local guidelines govern those.
- **Resistance is mechanism** (e.g. PBP2a, ESBL, efflux), not local prevalence.
- One inferred classification to sanity-check: the `kingdom` tag on each organism was
  assigned during migration. Everything else is verbatim from your prototypes.

## Roadmap (seams already in place)

- Three more cascades — vesicular (~15), cytosolic (~32), surface (~19) — following
  `cascades/extracellular.js` exactly.
- Taxonomy browse: populate the trees in `data/taxonomy.js`.
- Only ~6 of 89 organisms (+2 host defects) have `engages`/`breaks` authored so far.
