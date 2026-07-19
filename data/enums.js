/* ============================================================
   enums.js — the canonical vocabularies.
   Every dataset is validated against these closed lists.
   Loaded first: assigns window.ENUMS (browser) / globalThis.ENUMS (Node).
   ============================================================ */
;(function (root) {

  const ENUMS = {

    /* Kingdoms — the top level of the taxonomy-browse seam. */
    kingdoms: ["bacteria", "virus", "fungus", "parasite"],

    /* Niches — where the pathogen lives, which decides the effector arm.
       name + effector prose migrated verbatim from the niche-map prototype. */
    niches: [
      { id: "extra", name: "EXTRACELLULAR — interstitium, blood, mucosal lumen",
        col: "var(--extra)",
        eff: "Type 3 · Complement + neutrophils + TH17/IL-17 · IgM/IgG/IgA opsonisation. Antibody is the decisive arm." },
      { id: "vesic", name: "INTRACELLULAR — vesicular (phagosome)",
        col: "var(--vesic)",
        eff: "Type 1 · MHC II → CD4 TH1 → IFN-γ → macrophage activation. Antibody cannot reach the organism." },
      { id: "cyto", name: "INTRACELLULAR — cytosolic",
        col: "var(--cyto)",
        eff: "Type 1 · Type I IFN + NK early; MHC I → CD8 CTL kills the infected cell. Killing the host cell is the only option." },
      { id: "surf", name: "SURFACE / MULTICELLULAR — too large to phagocytose",
        col: "var(--surf)",
        eff: "Type 2 · TH2 → IL-4/IL-5/IL-13 · IgE + mast cells + eosinophils · mucus, contraction, expulsion." }
    ],

    /* Failure-mode categories — the closed set an organism's `fail` must match.
       The validator flags any organism whose fail is not here, and any entry
       here with zero organisms (orphan). */
    failureModes: [
      "Capsule / anti-phagocytic",
      "Molecular mimicry",
      "Direct immune subversion",
      "Toxin-mediated",
      "Size / inaccessible niche",
      "Intracellular survival",
      "Weak / short-lived immunity",
      "Antigenic variation",
      "Latency / sanctuary site",
      "Immunopathology (response causes disease)",
      "Immature / absent host immunity",
      "Host defect / opportunist"
    ],

    /* Body systems used by the `sys[]` tags. */
    systems: [
      "Resp", "CNS", "ENT", "Skin", "MSK", "CVS", "GI", "GU", "Rheum",
      "Neuro", "STI", "Eye", "Liver", "Onc", "Systemic", "Neonatal",
      "Haem", "Lymph"
    ],

    /* The 29 addressable immune-map components. engages[]/breaks[] must
       reference IDs from this list. Order follows the SVG top-to-bottom. */
    cIds: [
      "c_barrier", "c_flora", "c_amp",
      "c_prr", "c_ifn1", "c_c3", "c_c3b", "c_c5a",
      "c_phago", "c_mac", "c_burst", "c_nk", "c_inflam",
      "c_dc", "c_mhc1", "c_mhc2", "c_tap",
      "c_cd4", "c_th1", "c_th2", "c_th17", "c_tfh",
      "c_ctl", "c_macact", "c_ige", "c_neut",
      "c_bcell", "c_ab", "c_mem"
    ],

    /* The immune-map flow-path IDs. flows[] must reference IDs from this list. */
    flowIds: [
      "f_barrier_prr", "f_prr_c3", "f_c3_c3b", "f_c3_c5", "f_c3b_phag",
      "f_c5_mac", "f_phag_burst", "f_prr_dc", "f_dc_mhc2", "f_dc_mhc1",
      "f_mhc2_cd4", "f_mhc1_cd8", "f_cd4_th1", "f_cd4_th2", "f_cd4_th17",
      "f_cd4_tfh", "f_th1_mac", "f_th1_ctl", "f_th2_ige", "f_th17_neut",
      "f_tfh_b", "f_b_ab", "f_ab_c3", "f_ab_phag"
    ]
  };

  root.ENUMS = ENUMS;
  if (typeof module !== "undefined" && module.exports) module.exports = ENUMS;

})(typeof globalThis !== "undefined" ? globalThis : this);
