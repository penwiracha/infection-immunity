/* ============================================================
   immune-map.js — knowledge layer for the keystone diagram.
   A short role for each of the 29 addressable components (c_*) and each of
   the 24 flow arrows (f_*). The immune-map view reads this so every box and
   every arrow is clickable for its own detail. Component ids match the SVG
   and enums.cIds; flow ids match enums.flowIds.
   ============================================================ */
;(function (root) {
  const C = (name, zone, detail) => ({ name, zone, detail });
  const F = (from, to, label, detail) => ({ from, to, label, detail });

  const IMMUNE_MAP = {
    components: {
      c_barrier: C("Epithelium & mucus", "Entry & barrier",
        "The first line of defence: intact epithelium, mucus, cilia, gastric acid, urine flow and skin fatty acids exclude microbes before any immune response is needed. Breaching it (burns, catheters, cystic fibrosis) is the commonest immunodeficiency in hospital."),
      c_flora: C("Commensal flora", "Entry & barrier",
        "The normal microbiota occupies niches, competes for nutrients and secretes inhibitory substances — 'colonisation resistance'. Its loss (e.g. after antibiotics) lets pathogens such as C. difficile and Candida take hold."),
      c_amp: C("Antimicrobial peptides", "Entry & barrier",
        "Defensins, cathelicidins and lysozyme secreted by epithelia and phagocytes directly damage microbial membranes. Their epithelial production is induced by the TH17/IL-17 axis."),
      c_prr: C("PRRs — TLR, NLR, MBL", "Innate recognition",
        "Pattern-recognition receptors detect conserved microbial PAMPs (LPS, flagellin, viral nucleic acid). They trigger inflammation, type I interferon and complement — the innate alarm that fires within minutes and long before antibody."),
      c_ifn1: C("Type I interferon", "Innate recognition",
        "IFN-α/β, made by infected cells and plasmacytoid dendritic cells, induces an antiviral state in neighbouring cells (blocking translation, degrading viral RNA) and activates NK cells. Many viruses (influenza NS1, HCV NS3/4A) block it."),
      c_c3: C("Complement C3", "Innate recognition",
        "The amplification hub. Activated within minutes by the classical (antibody/C1), lectin (MBL) and alternative pathways, all converging on C3 to make opsonins, anaphylatoxins and the membrane-attack complex — before any antibody exists."),
      c_c3b: C("C3b", "Innate recognition",
        "The dominant opsonin: covalently coats microbial surfaces and is recognised by complement receptors (CR1/CR3) on phagocytes, tagging the organism for ingestion. Capsules (pneumococcus) block its deposition."),
      c_c5a: C("C3a / C5a", "Innate recognition",
        "Anaphylatoxins released on complement activation. They raise vascular permeability, and C5a is a potent neutrophil chemoattractant — the signal that draws phagocytes to the site (cleaved by S. pyogenes C5a peptidase)."),
      c_phago: C("Phagocytosis", "Innate effectors",
        "Neutrophils and macrophages engulf opsonised organisms via complement receptors (CR1/CR3) and Fcγ receptors, drawing them into a phagosome. Requires the organism to be both coated and small enough to swallow."),
      c_mac: C("MAC C5–9", "Innate effectors",
        "The membrane-attack complex (C5b–C9) punches a lytic pore in the target membrane. In humans it matters almost solely against Neisseria — everything else is cleared by phagocytes (hence recurrent meningococcaemia in C5–9 deficiency)."),
      c_burst: C("Phagolysosome & oxidative burst", "Innate effectors",
        "The phagosome fuses with lysosomes and NADPH oxidase generates the respiratory burst (superoxide, H₂O₂), delivering reactive oxygen, proteases, defensins and low pH to kill the ingested microbe. Absent in chronic granulomatous disease."),
      c_nk: C("NK cells", "Innate effectors",
        "Natural killer cells kill host cells that have lost MHC I ('missing self') — the backup against viruses that downregulate MHC I to hide from CTLs. They also mediate antibody-dependent cytotoxicity (ADCC) and secrete IFN-γ."),
      c_inflam: C("Inflammation — IL-1, IL-6, TNF", "Innate effectors",
        "The cytokines of activated macrophages: fever, acute-phase proteins, endothelial activation and neutrophil recruitment. TNF sustains granulomas — which is why anti-TNF therapy reactivates TB."),
      c_dc: C("Dendritic cell", "Antigen presentation",
        "The bridge from innate to adaptive immunity: takes up antigen at the periphery, matures on PRR signals, migrates to lymph nodes and presents peptide on MHC to prime naïve T cells."),
      c_mhc1: C("MHC I", "Antigen presentation",
        "Displays peptides from the cytosol (e.g. viral proteins) to CD8 T cells; expressed on all nucleated cells — the 'inside report' that flags infected cells for CTL killing. Downregulated by HIV Nef and CMV."),
      c_mhc2: C("MHC II", "Antigen presentation",
        "Displays peptides from the vesicular/endosomal pathway (phagocytosed material) to CD4 T cells; restricted to professional antigen-presenting cells."),
      c_tap: C("TAP & proteasome", "Antigen presentation",
        "The proteasome degrades cytosolic proteins into peptides that TAP transports into the ER for loading onto MHC I — the supply line for CD8 surveillance. Blocked by HSV ICP47, blinding CTLs to infected cells."),
      c_cd4: C("CD4 T cell", "T-helper polarisation",
        "The help hub: recognises MHC II–peptide and, depending on the cytokine milieu, becomes TH1/TH2/TH17/Tfh — subsets that direct every downstream arm. Its destruction by HIV collapses cellular and humoral immunity at once."),
      c_th1: C("TH1 — IFN-γ", "T-helper polarisation",
        "IL-12-driven, T-bet⁺ CD4 subset secreting IFN-γ to activate macrophages and support CTLs — the arm against vesicular/intracellular pathogens (TB, Leishmania, Salmonella)."),
      c_th2: C("TH2 — IL-4/5/13", "T-helper polarisation",
        "IL-4/5/13-secreting, GATA3⁺ subset driving IgE, mast cells and eosinophils — the anti-helminth 'weep-and-sweep' arm (and the arm behind allergy)."),
      c_th17: C("TH17 — IL-17", "T-helper polarisation",
        "IL-23-driven, RORγt⁺ subset secreting IL-17 to recruit neutrophils and induce epithelial antimicrobial peptides — surface defence against extracellular bacteria and fungi (the textbook Candida arm)."),
      c_tfh: C("Tfh / germinal centre", "T-helper polarisation",
        "Follicular helper T cells license germinal-centre B cells for class switching and affinity maturation — turning IgM into high-affinity IgG/IgA and generating memory. T-independent antigens (plain polysaccharide) bypass this, giving no memory."),
      c_ctl: C("CD8 CTL", "Effector arms & memory",
        "Cytotoxic T lymphocytes recognise MHC I–peptide and kill infected cells via perforin/granzyme and Fas — the effector against cytosolic viruses and intracellular pathogens. The only way to clear an infected cell is to kill it."),
      c_macact: C("Activated macrophage", "Effector arms & memory",
        "A macrophage switched on by TH1 IFN-γ: enhanced phagolysosomal killing, nitric oxide and granuloma formation — the effector that contains vesicular pathogens like TB (which survives by blocking this very step)."),
      c_ige: C("IgE · mast · eosinophil", "Effector arms & memory",
        "The type-2 effector: IgE arms mast cells and eosinophils; on antigen contact they release mediators driving mucus, smooth-muscle contraction and worm expulsion."),
      c_neut: C("Neutrophils", "Effector arms & memory",
        "The dominant phagocyte of acute extracellular infection: rapid recruitment, phagocytosis, oxidative burst, NETs and antimicrobial peptides — summoned by C5a and the TH17/IL-17 axis."),
      c_bcell: C("B cell / plasma cell", "Effector arms & memory",
        "Recognises antigen via surface immunoglobulin; with Tfh help, differentiates into plasma cells secreting antibody (IgM→IgG/IgA/IgE) and into memory B cells."),
      c_ab: C("Antibody", "Effector arms & memory",
        "Secreted immunoglobulin that neutralises toxins and viruses, opsonises for phagocytosis, activates complement and arms NK/mast cells — the decisive adaptive effector against extracellular organisms."),
      c_mem: C("Memory", "Effector arms & memory",
        "Long-lived memory B and T cells and long-lived plasma cells that respond faster and stronger on re-exposure — the basis of durable immunity and of vaccination.")
    },

    flows: {
      f_barrier_prr: F("c_barrier", "c_prr", "breach → detection", "Whatever gets past the barrier is met by pattern-recognition receptors on sentinel cells — the handover from physical to innate immunity."),
      f_prr_c3: F("c_prr", "c_c3", "recognition → complement", "PRR engagement (especially mannan-binding lectin) activates the complement cascade at C3."),
      f_c3_c3b: F("c_c3", "c_c3b", "C3 → opsonin", "Cleavage of C3 deposits C3b, the surface-coating opsonin."),
      f_c3_c5: F("c_c3", "c_c5a", "C3 → anaphylatoxin", "The same C3 activation liberates the anaphylatoxins C3a and C5a."),
      f_c3b_phag: F("c_c3b", "c_phago", "opsonin → ingestion", "C3b-coated organisms are bound by complement receptors (CR1/CR3) and phagocytosed."),
      f_c5_mac: F("c_c5a", "c_mac", "C5 → lysis", "C5 cleavage also nucleates assembly of the membrane-attack complex (C5b–C9)."),
      f_phag_burst: F("c_phago", "c_burst", "ingest → kill", "Once ingested, the phagosome fuses with lysosomes and mounts the oxidative burst to destroy the microbe."),
      f_prr_dc: F("c_prr", "c_dc", "sense → present", "PRR-activated dendritic cells mature, take up antigen and migrate to prime T cells — the innate-to-adaptive bridge."),
      f_dc_mhc2: F("c_dc", "c_mhc2", "vesicular → MHC II", "Dendritic cells load peptides from the phagocytic/vesicular pathway onto MHC II for CD4 cells."),
      f_dc_mhc1: F("c_dc", "c_mhc1", "cytosolic → MHC I", "Dendritic cells display cytosolic (e.g. viral) peptides on MHC I — by direct presentation or cross-presentation — for CD8 cells."),
      f_mhc2_cd4: F("c_mhc2", "c_cd4", "MHC II → CD4", "MHC II–peptide plus co-stimulation primes naïve CD4 helper T cells."),
      f_mhc1_cd8: F("c_mhc1", "c_ctl", "MHC I → CD8", "MHC I–peptide primes CD8 cells and marks infected cells as targets for cytotoxic killing."),
      f_cd4_th1: F("c_cd4", "c_th1", "IL-12 → TH1", "IL-12 (from dendritic cells/macrophages) drives CD4 differentiation to TH1."),
      f_cd4_th2: F("c_cd4", "c_th2", "IL-4 → TH2", "An IL-4-rich milieu drives CD4 differentiation to TH2 (the anti-helminth/allergy arm)."),
      f_cd4_th17: F("c_cd4", "c_th17", "IL-23 → TH17", "IL-23 with TGF-β/IL-6 drives CD4 differentiation to TH17 for surface defence."),
      f_cd4_tfh: F("c_cd4", "c_tfh", "→ B-cell help", "CD4 cells become follicular helper (Tfh) cells to support the germinal-centre reaction."),
      f_th1_mac: F("c_th1", "c_macact", "IFN-γ → activation", "TH1-derived IFN-γ activates macrophages to kill the pathogens they harbour (TB, Leishmania)."),
      f_th1_ctl: F("c_th1", "c_ctl", "help → CTL", "TH1 help (IL-2, IFN-γ, licensing of dendritic cells) supports full CD8 cytotoxic responses."),
      f_th2_ige: F("c_th2", "c_ige", "IL-4/5/13 → type 2", "TH2 cytokines drive IgE class switching and arm mast cells and eosinophils."),
      f_th17_neut: F("c_th17", "c_neut", "IL-17 → neutrophils", "TH17-derived IL-17 recruits neutrophils and boosts epithelial antimicrobial peptides."),
      f_tfh_b: F("c_tfh", "c_bcell", "help → B cell", "Tfh cells license germinal-centre B cells for class switching and affinity maturation."),
      f_b_ab: F("c_bcell", "c_ab", "plasma → antibody", "Activated B cells become plasma cells secreting antibody."),
      f_ab_c3: F("c_ab", "c_c3", "antibody → complement", "Antibody (IgM/IgG) feeds back to activate the classical complement pathway (C1→C3) — adaptive immunity amplifying innate."),
      f_ab_phag: F("c_ab", "c_phago", "antibody → phagocytosis", "Antibody opsonises organisms for Fcγ-receptor-mediated phagocytosis — closing the loop back to ingestion.")
    }
  };

  root.IMMUNE_MAP = IMMUNE_MAP;
  if (typeof module !== "undefined" && module.exports) module.exports = IMMUNE_MAP;
})(typeof globalThis !== "undefined" ? globalThis : this);
