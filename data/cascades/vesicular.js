/* SEAM — vesicular cascade (~15 organisms). Follows cascades/extracellular.js exactly.
   Populate steps[] (scaffold + component mapping) and breaks[] (ref + step + how/mech).
   pending:true tells the view to render a "not yet authored" placeholder. */
;(function (root) {
  const CASCADE = {
    id: "vesicular", branch: "vesic", pending: true,
    steps: [],
    breaks: []
  };
  root.CASCADES = root.CASCADES || {};
  root.CASCADES.vesicular = CASCADE;
  if (typeof module !== "undefined" && module.exports) module.exports = CASCADE;
})(typeof globalThis !== "undefined" ? globalThis : this);
