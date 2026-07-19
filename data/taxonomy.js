/* ============================================================
   taxonomy.js — identification / classification trees per kingdom.
   Roadmap entry: pick kingdom → tree → organism → niche + immune map.

   These are phenotypic IDENTIFICATION keys (which is exactly what this
   project's `taxonomy` fields capture — Gram, catalase, coagulase, etc.),
   not phylogeny. The bacteria tree follows the Oxford Handbook of Infectious
   Diseases and Microbiology, Figs 7.1–7.4 (identification of GPC / GPR / GNC /
   GNR), plus a branch for organisms outside those culture-based keys
   (acid-fast, spirochaetes, obligate intracellular), staining p.223.

   Node shape:
     { label, test?, note?, organism?, children?[] }
   Leaves carry `organism` = an id from organisms.js. Internal nodes carry
   `test` (the discriminator applied to reach the children). The validator
   asserts every organism of the kingdom is exactly one leaf, and every leaf
   points at a real organism of that kingdom.
   ============================================================ */
;(function (root) {

  const bacteriaTree = {
    label: "Bacteria",
    test: "Gram stain / acid-fast / special culture",
    children: [
      /* ---- Fig 7.1 — Gram-positive cocci ---- */
      { label: "Gram-positive cocci", test: "arrangement, then catalase",
        children: [
          { label: "Clusters — Staphylococci (catalase-positive)", test: "coagulase",
            children: [
              { label: "Coagulase-positive", organism: "staphylococcus-aureus" }
            ] },
          { label: "Chains — Streptococci (catalase-negative)", test: "haemolysis on blood agar",
            children: [
              { label: "α-haemolytic", test: "optochin",
                children: [
                  { label: "Optochin-sensitive", organism: "streptococcus-pneumoniae" }
                ] },
              { label: "β-haemolytic", test: "Lancefield group",
                children: [
                  { label: "Group A (bacitracin-sensitive)", organism: "streptococcus-pyogenes" },
                  { label: "Group B", organism: "group-b-streptococcus" }
                ] }
            ] }
        ] },

      /* ---- Fig 7.2 — Gram-positive rods ---- */
      { label: "Gram-positive rods", test: "growth requirement, catalase, spores",
        children: [
          { label: "Aerobic, catalase-positive, non-branching",
            children: [
              { label: "Corynebacterium (non-spore, club-shaped)", organism: "corynebacterium-diphtheriae" },
              { label: "Bacillus (aerobic spore-former)", organism: "bacillus-anthracis" },
              { label: "Listeria (motile, non-spore)", organism: "listeria-monocytogenes" }
            ] },
          { label: "Anaerobic, spore-forming — Clostridia",
            children: [
              { organism: "clostridium-tetani" },
              { organism: "clostridium-botulinum" },
              { organism: "clostridium-perfringens" },
              { organism: "clostridioides-difficile" }
            ] }
        ] },

      /* ---- Fig 7.3 — Gram-negative cocci ---- */
      { label: "Gram-negative cocci (diplococci)", test: "oxidase, then sugar fermentation",
        children: [
          { label: "Oxidase-positive — Neisseria",
            children: [
              { label: "Glucose + maltose", organism: "neisseria-meningitidis" },
              { label: "Glucose only", organism: "neisseria-gonorrhoeae" }
            ] }
        ] },

      /* ---- Fig 7.4 — Gram-negative rods ---- */
      { label: "Gram-negative rods", test: "growth requirement",
        children: [
          { label: "Fastidious",
            children: [
              { label: "Haemophilus (requires X and/or V factor)",
                children: [
                  { organism: "haemophilus-influenzae-b" },
                  { organism: "haemophilus-ducreyi" }
                ] },
              { organism: "brucella-species" },
              { organism: "bordetella-pertussis" },
              { label: "Campylobacter (microaerophilic, curved)", organism: "campylobacter-jejuni" },
              { label: "Helicobacter (microaerophilic, curved, urease-positive)", organism: "helicobacter-pylori" },
              { organism: "legionella-pneumophila" }
            ] },
          { label: "Aerobic, lactose-fermenting (Enterobacterales)",
            children: [
              { organism: "escherichia-coli" }
            ] },
          { label: "Aerobic, non-lactose-fermenting", test: "oxidase",
            children: [
              { label: "Oxidase-positive",
                children: [
                  { label: "Oxidative / non-fermenter",
                    children: [
                      { organism: "pseudomonas-aeruginosa" },
                      { organism: "burkholderia-pseudomallei" }
                    ] },
                  { label: "Fermentative (curved)", organism: "vibrio-cholerae" }
                ] },
              { label: "Oxidase-negative (Enterobacterales)",
                children: [
                  { organism: "salmonella" },
                  { organism: "salmonella-typhi" },
                  { organism: "shigella-eiec" },
                  { organism: "yersinia-pestis" }
                ] }
            ] }
        ] },

      /* ---- Outside the culture-based keys ---- */
      { label: "Acid-fast bacilli", note: "do not Gram-stain; ZN / auramine (p.223)",
        children: [
          { organism: "mycobacterium-tuberculosis" },
          { organism: "mycobacterium-leprae" }
        ] },
      { label: "Spirochaetes", note: "dark-field / serology; not seen on Gram stain",
        children: [
          { organism: "treponema-pallidum" },
          { organism: "leptospira-interrogans" }
        ] },
      { label: "Obligate intracellular", note: "not culturable on standard media",
        children: [
          { organism: "chlamydia-trachomatis" },
          { organism: "rickettsia-orientia-tsutsugamushi" }
        ] },
      { label: "Gram-variable / other",
        children: [
          { label: "Gardnerella (Gram-variable coccobacillus)", organism: "gardnerella-bv-flora" }
        ] }
    ]
  };

  /* ============================================================
     VIRUSES — Oxford Handbook Table 8.1 (Summary of viruses), p.370–4.
     Structure: nucleic acid (DNA / RNA) → family → virus leaf.
     ============================================================ */
  const virusTree = {
    label: "Viruses",
    test: "nucleic acid, then family",
    children: [
      { label: "DNA viruses",
        children: [
          { label: "Herpesviridae", test: "enveloped, dsDNA; latency",
            children: [
              { organism: "herpes-simplex-virus" },
              { organism: "varicella-zoster-virus" },
              { organism: "cytomegalovirus" },
              { organism: "epstein-barr-virus" },
              { organism: "human-herpesvirus-6" }
            ] },
          { label: "Hepadnaviridae", children: [ { organism: "hepatitis-b-virus" } ] },
          { label: "Papillomaviridae", children: [ { organism: "human-papillomavirus" } ] },
          { label: "Parvoviridae", children: [ { organism: "parvovirus-b19" } ] }
        ] },
      { label: "RNA viruses",
        children: [
          { label: "Orthomyxoviridae", test: "enveloped, segmented −ssRNA",
            children: [ { organism: "influenza-a" } ] },
          { label: "Paramyxoviridae", test: "enveloped, non-segmented −ssRNA",
            children: [
              { organism: "measles-virus" },
              { organism: "mumps-virus" },
              { organism: "respiratory-syncytial-virus" },
              { label: "Henipavirus", organism: "nipah-virus" }
            ] },
          { label: "Coronaviridae", children: [ { organism: "sars-cov-2" } ] },
          { label: "Picornaviridae", test: "naked +ssRNA",
            children: [
              { organism: "poliovirus" },
              { organism: "enteroviruses" },
              { organism: "hepatitis-a-virus" }
            ] },
          { label: "Flaviviridae", test: "enveloped +ssRNA; arboviruses",
            children: [
              { organism: "dengue-virus" },
              { organism: "zika-virus" },
              { organism: "hepatitis-c-virus" }
            ] },
          { label: "Togaviridae",
            children: [
              { organism: "rubella-virus" },
              { label: "Alphavirus", organism: "chikungunya-virus" }
            ] },
          { label: "Retroviridae", test: "enveloped +ssRNA; reverse transcriptase",
            children: [ { organism: "hiv-1" } ] },
          { label: "Rhabdoviridae", children: [ { organism: "rabies-virus" } ] },
          { label: "Hepeviridae", children: [ { organism: "hepatitis-e-virus" } ] }
        ] }
    ]
  };

  /* ============================================================
     FUNGI — Oxford Handbook Table 9.1 (Overview of fungi), p.470–1.
     Structure: growth form (yeast / dimorphic / mould) → species leaf.
     Some leaves are `reference:true` browse entries (classification only).
     ============================================================ */
  const fungusTree = {
    label: "Fungi",
    test: "growth form (yeast / dimorphic / mould)",
    children: [
      { label: "Yeasts", test: "phylum",
        children: [
          { label: "Ascomycota",
            children: [
              { organism: "candida-albicans" },
              { label: "Pneumocystis (atypical)", organism: "pneumocystis-jirovecii" }
            ] },
          { label: "Basidiomycota",
            children: [
              { organism: "cryptococcus-neoformans" },
              { organism: "trichosporon" },
              { organism: "rhodotorula" },
              { organism: "malassezia-furfur" }
            ] }
        ] },
      { label: "Dimorphic fungi", test: "yeast at 37°C / mould at 25°C",
        children: [
          { organism: "histoplasma-capsulatum" },
          { organism: "blastomyces-dermatitidis" },
          { organism: "coccidioides-immitis" },
          { organism: "paracoccidioides-brasiliensis" },
          { organism: "sporothrix-schenckii" },
          { label: "Talaromyces (Penicillium) marneffei", organism: "talaromyces-marneffei" }
        ] },
      { label: "Moulds", test: "hyphal septation",
        children: [
          { label: "Septate hyphae",
            children: [
              { organism: "aspergillus-fumigatus" },
              { organism: "dermatophytes" },
              { organism: "fusarium" },
              { organism: "scedosporium" },
              { organism: "mycetoma-agents" }
            ] },
          { label: "Aseptate (broad) hyphae — Zygomycota (Mucorales)",
            children: [
              { organism: "mucorales" }
            ] }
        ] }
    ]
  };

  /* ============================================================
     PARASITES — protozoa / helminth / ectoparasite, with subclass.
     ============================================================ */
  const parasiteTree = {
    label: "Parasites",
    test: "protozoa / helminth / ectoparasite",
    children: [
      { label: "Protozoa", test: "locomotion / phylum",
        children: [
          { label: "Amoebae",
            children: [
              { organism: "entamoeba-histolytica" },
              { organism: "free-living-amoebae" }
            ] },
          { label: "Flagellates",
            children: [
              { organism: "giardia-lamblia" },
              { organism: "trichomonas-vaginalis" },
              { organism: "leishmania-species" }
            ] },
          { label: "Apicomplexa (sporozoa)",
            children: [
              { organism: "plasmodium-falciparum" },
              { organism: "toxoplasma-gondii" }
            ] }
        ] },
      { label: "Helminths", test: "phylum",
        children: [
          { label: "Nematodes (roundworms)",
            children: [
              { organism: "ascaris-lumbricoides" },
              { organism: "hookworm" },
              { organism: "strongyloides-stercoralis" },
              { organism: "enterobius-vermicularis" },
              { organism: "trichuris-trichiura" },
              { organism: "trichinella-spiralis" },
              { organism: "gnathostoma-spinigerum" },
              { organism: "angiostrongylus-cantonensis" },
              { organism: "wuchereria-bancrofti" },
              { organism: "cutaneous-larva-migrans" }
            ] },
          { label: "Cestodes (tapeworms)",
            children: [
              { organism: "taenia-solium-cysticercosis" }
            ] },
          { label: "Trematodes (flukes)",
            children: [
              { organism: "opisthorchis-viverrini" },
              { organism: "schistosoma-species" }
            ] }
        ] },
      { label: "Ectoparasites (arthropods)",
        children: [
          { organism: "sarcoptes-scabiei" },
          { organism: "pediculus-phthirus" }
        ] }
    ]
  };

  const TAXONOMY = {
    bacteria: { pending: false, source: "Oxford Handbook of ID & Microbiology, Figs 7.1–7.4 + p.223", tree: bacteriaTree },
    virus:    { pending: false, source: "Oxford Handbook of ID & Microbiology, Table 8.1 (p.370–4)", tree: virusTree },
    fungus:   { pending: false, source: "Oxford Handbook of ID & Microbiology, Table 9.1 (p.470–1)", tree: fungusTree },
    parasite: { pending: false, source: "Classified by protozoa / helminth (nematode/cestode/trematode) / ectoparasite", tree: parasiteTree }
  };

  root.TAXONOMY = TAXONOMY;
  if (typeof module !== "undefined" && module.exports) module.exports = TAXONOMY;

})(typeof globalThis !== "undefined" ? globalThis : this);
