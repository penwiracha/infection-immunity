/* ============================================================
   taxonomy.js — SEAM for the taxonomy-browse entry.
   Roadmap: pick kingdom → classification tree → organism → niche + immune map.

   The tree is intentionally empty. Each organism already carries `kingdom`
   (populated) and `taxonomy` (empty, filled incrementally in organisms.js).
   When ready, describe the classification tree per kingdom here, e.g.:

     bacteria: {
       "Gram-positive cocci": {
         "Catalase-positive": ["staphylococcus-aureus"],
         "Catalase-negative": ["streptococcus-pneumoniae", "streptococcus-pyogenes"]
       },
       ...
     }

   Leaves are organism ids from organisms.js. The taxonomy view walks this
   tree; the validator can later assert every leaf id exists and every
   organism appears somewhere (another clean seam).
   ============================================================ */
;(function (root) {
  const TAXONOMY = {
    pending: true,
    bacteria: {},
    virus: {},
    fungus: {},
    parasite: {}
  };
  root.TAXONOMY = TAXONOMY;
  if (typeof module !== "undefined" && module.exports) module.exports = TAXONOMY;
})(typeof globalThis !== "undefined" ? globalThis : this);
