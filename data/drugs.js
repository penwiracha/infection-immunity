/* ============================================================
   drugs.js — antimicrobial review tree.
   Structure: family (antibacterial / antiviral / antifungal / antiparasitic)
   → class → subgroup (generation) → drug leaf { drug, mechanism, use }.
   Grounded in the Oxford Handbook of ID & Microbiology antimicrobial chapters
   (p.3–126) + standard pharmacology. Mechanistic, not a prescribing guide.
   ============================================================ */
;(function (root) {
  const D = (drug, mechanism, use) => ({ drug, mechanism, use });

  const DRUGS = {
    source: "Oxford Handbook of ID & Microbiology, antimicrobial chapters (p.3–126)",
    families: [

      /* ================= ANTIBACTERIAL ================= */
      { label: "Antibacterial", children: [
        { label: "β-lactams (inhibit cell-wall transpeptidases / PBPs)", children: [
          { label: "Penicillins", children: [
            { label: "Natural penicillins", children: [
              D("Benzylpenicillin (pen G)", "β-lactam; binds PBPs, blocking peptidoglycan cross-linking. β-lactamase-labile.", "IV; streptococci, meningococcus, syphilis, Clostridium, Listeria (with an aminoglycoside)."),
              D("Phenoxymethylpenicillin (pen V)", "As pen G, acid-stable for oral use.", "Oral; strep throat, rheumatic-fever and post-splenectomy prophylaxis.") ] },
            { label: "Anti-staphylococcal (β-lactamase-stable)", children: [
              D("Flucloxacillin", "Isoxazolyl side chain resists staphylococcal β-lactamase.", "MSSA — skin/soft tissue, bone/joint, endocarditis. Useless against MRSA.") ] },
            { label: "Aminopenicillins", children: [
              D("Amoxicillin / ampicillin", "Extended Gram-negative cover; still β-lactamase-labile.", "Listeria, enterococci, Strep, susceptible coliforms; ampicillin for meningitis Listeria cover.") ] },
            { label: "Antipseudomonal penicillins", children: [
              D("Piperacillin (with tazobactam)", "Broad, anti-pseudomonal; tazobactam neutralises many β-lactamases.", "Hospital Gram-negative sepsis, Pseudomonas, mixed/neutropenic infection.") ] },
            { label: "+ β-lactamase inhibitor", children: [
              D("Co-amoxiclav", "Clavulanate inhibits β-lactamase, restoring amoxicillin.", "β-lactamase-producing H. influenzae, animal/human bites, mixed infection.") ] } ] },
          { label: "Cephalosporins", children: [
            { label: "1st generation", children: [ D("Cefalexin / cefazolin", "β-lactam; more β-lactamase-stable than penicillins; best vs Gram-positives.", "Skin/soft tissue, UTI; cefazolin for surgical prophylaxis.") ] },
            { label: "2nd generation", children: [ D("Cefuroxime", "Broader Gram-negative cover than 1st gen.", "Respiratory and urinary infection.") ] },
            { label: "3rd generation", children: [
              D("Ceftriaxone / cefotaxime", "Strong Gram-negative cover, good CSF penetration.", "Meningitis (pneumococcus, meningococcus, Hib), gonorrhoea, typhoid, severe sepsis."),
              D("Ceftazidime", "3rd-gen with anti-pseudomonal activity.", "Pseudomonas, melioidosis (intensive phase).") ] },
            { label: "4th generation", children: [ D("Cefepime", "Broad Gram-positive + Gram-negative incl. Pseudomonas; stable to some AmpC.", "Neutropenic sepsis, hospital Gram-negative infection.") ] },
            { label: "5th generation", children: [ D("Ceftaroline", "Binds PBP2a — the only β-lactam with MRSA activity.", "MRSA skin/soft tissue and pneumonia.") ] } ] },
          { label: "Carbapenems", children: [ D("Meropenem / imipenem / ertapenem", "Very broad β-lactam, stable to most β-lactamases incl. ESBL/AmpC.", "Severe/ESBL Gram-negative sepsis; last-line before carbapenemases. Ertapenem spares Pseudomonas.") ] },
          { label: "Monobactams", children: [ D("Aztreonam", "β-lactam active only against aerobic Gram-negatives; safe in penicillin allergy.", "Gram-negative infection incl. Pseudomonas when β-lactam-allergic.") ] } ] },
        { label: "Glycopeptides (block D-Ala-D-Ala cell-wall precursor)", children: [
          D("Vancomycin", "Binds D-Ala-D-Ala, blocking transglycosylation/transpeptidation. IV for systemic, oral (non-absorbed) for C. difficile.", "MRSA, ampicillin-resistant enterococci, β-lactam allergy; oral for severe CDI."),
          D("Teicoplanin", "As vancomycin, once-daily, less nephrotoxic.", "Gram-positive infection, OPAT.") ] },
        { label: "Aminoglycosides (30S — irreversible, bactericidal)", children: [
          D("Gentamicin", "Binds 30S, causing misreading; synergistic with cell-wall agents. Needs level monitoring; oxygen-dependent uptake (inactive in anaerobes).", "Gram-negative sepsis; synergy in endocarditis/Listeria."),
          D("Amikacin", "Aminoglycoside stable to many modifying enzymes.", "Gentamicin-resistant Gram-negatives; part of MDR-TB regimens."),
          D("Streptomycin", "First aminoglycoside.", "Plague, tularaemia, second-line TB.") ] },
        { label: "Macrolides (50S)", children: [
          D("Erythromycin", "Binds 50S, blocking protein synthesis (bacteriostatic).", "Penicillin-allergy strep, pertussis, Campylobacter."),
          D("Clarithromycin / azithromycin", "Better tolerated/longer half-life; azithromycin concentrates intracellularly.", "Atypical pneumonia (Legionella, Mycoplasma, Chlamydia), H. pylori regimens, chlamydia, MAC.") ] },
        { label: "Tetracyclines (30S)", children: [
          D("Doxycycline", "Binds 30S, blocking tRNA (bacteriostatic); cell-penetrating.", "Rickettsia/scrub typhus, Brucella, Leptospira, chlamydia, atypical pneumonia, anti-Wolbachia filariasis, malaria adjunct.") ] },
        { label: "Lincosamides (50S)", children: [
          D("Clindamycin", "Binds 50S; also suppresses exotoxin synthesis.", "Anaerobes, toxin-mediated disease (necrotising fasciitis, gas gangrene, TSS) added for its anti-toxin effect.") ] },
        { label: "Oxazolidinones (50S initiation)", children: [
          D("Linezolid", "Blocks 50S ribosome assembly; full oral bioavailability.", "MRSA, VRE, resistant Gram-positives. Marrow suppression / neuropathy on prolonged use.") ] },
        { label: "Fluoroquinolones (DNA gyrase / topoisomerase IV)", children: [
          D("Ciprofloxacin", "Inhibits DNA gyrase — bactericidal; strong Gram-negative incl. Pseudomonas.", "Complicated UTI, Gram-negative sepsis, meningococcal prophylaxis."),
          D("Levofloxacin / moxifloxacin", "'Respiratory' fluoroquinolones with added Gram-positive/atypical cover.", "Respiratory infection, Legionnaires', 2nd-line TB.") ] },
        { label: "Other agents", children: [
          D("Metronidazole (nitroimidazole)", "Reduced to DNA-damaging radicals in anaerobes/protozoa.", "Anaerobic infection, C. difficile (mild), amoebiasis, giardiasis, trichomoniasis."),
          D("Co-trimoxazole (trimethoprim + sulfamethoxazole)", "Sequential folate-synthesis blockade (DHFR + DHPS).", "UTI, PCP (treatment & prophylaxis), toxoplasmosis, Nocardia, melioidosis eradication."),
          D("Rifampicin (rifamycin)", "Inhibits bacterial RNA polymerase; potent, resistance if used alone.", "TB/leprosy (in combination), meningococcal prophylaxis, adjunct in prosthetic/biofilm infection."),
          D("Nitrofurantoin", "Reduced to reactive intermediates damaging bacterial macromolecules; concentrates in urine.", "Uncomplicated lower UTI (not pyelonephritis)."),
          D("Daptomycin (lipopeptide)", "Inserts into and depolarises the Gram-positive membrane (inactivated by lung surfactant).", "MRSA bacteraemia/endocarditis; NOT for pneumonia."),
          D("Colistin (polymyxin)", "Disrupts the Gram-negative outer membrane; nephro/neurotoxic — a last resort.", "Carbapenem-resistant Gram-negatives.") ] },
        { label: "Anti-mycobacterials (first-line TB)", children: [
          D("Isoniazid", "Blocks mycolic-acid synthesis (InhA, after KatG activation).", "TB — bactericidal; also latent-TB monotherapy."),
          D("Rifampicin", "Inhibits RNA polymerase (rpoB).", "TB/leprosy backbone."),
          D("Pyrazinamide", "Disrupts membrane energetics in the acidic phagosome.", "TB intensive phase — sterilises intracellular bacilli."),
          D("Ethambutol", "Inhibits arabinogalactan cell-wall synthesis.", "TB — added to prevent resistance; watch for optic neuritis.") ] } ] },

      /* ================= ANTIVIRAL ================= */
      { label: "Antiviral", children: [
        { label: "Anti-herpesvirus (inhibit viral DNA polymerase)", children: [
          D("Aciclovir / valaciclovir", "Nucleoside analogue phosphorylated only by viral thymidine kinase → DNA-polymerase inhibition + chain termination (selective for infected cells).", "HSV, VZV; valaciclovir is the better-absorbed oral prodrug."),
          D("Ganciclovir / valganciclovir", "Guanosine analogue activated by CMV UL97 kinase; marrow-toxic.", "Sight-/life-threatening CMV in the immunocompromised."),
          D("Foscarnet", "Pyrophosphate analogue directly inhibiting the polymerase — no activation needed.", "Aciclovir-resistant HSV/VZV, ganciclovir-resistant CMV. Nephrotoxic.") ] },
        { label: "Anti-influenza", children: [
          D("Oseltamivir / zanamivir (NA inhibitors)", "Sialic-acid analogues inhibiting neuraminidase, so virions can't be released.", "Influenza A & B, early (<48h) — treatment and prophylaxis."),
          D("Amantadine (M2 blocker)", "Blocks the M2 ion channel (uncoating); influenza A only.", "No longer recommended — near-universal resistance.") ] },
        { label: "Anti-hepatitis", children: [
          D("Tenofovir / entecavir (HBV)", "Nucleos(t)ide analogues inhibiting HBV reverse transcriptase; high barrier to resistance.", "Chronic hepatitis B — suppress (cccDNA persists, so long-term)."),
          D("Pegylated interferon-α", "Immunomodulatory; finite course aiming at HBeAg seroconversion.", "Selected chronic HBV/HCV."),
          D("HCV direct-acting antivirals (DAAs)", "Combination blocking NS3/4A protease ('-previr'), NS5A ('-asvir') and NS5B polymerase ('-buvir', e.g. sofosbuvir).", "Curative (SVR >90%) in hepatitis C.") ] },
        { label: "Antiretrovirals (HIV)", children: [
          { label: "NRTIs (reverse transcriptase — chain terminators)", children: [ D("Tenofovir, emtricitabine, abacavir, zidovudine", "Nucleos(t)ide analogues incorporated by RT, terminating the DNA chain. Backbone of ART.", "HIV (always in combination); tenofovir/emtricitabine also PrEP.") ] },
          { label: "NNRTIs (RT — allosteric)", children: [ D("Efavirenz, nevirapine, rilpivirine", "Bind RT at a separate site; one mutation often cross-resists the class.", "HIV combination therapy.") ] },
          { label: "Integrase inhibitors (INSTIs)", children: [ D("Dolutegravir, raltegravir", "Block integrase strand transfer, preventing proviral integration; high barrier (dolutegravir).", "First-line HIV anchor drug.") ] },
          { label: "Protease inhibitors (PIs)", children: [ D("Darunavir, atazanavir, lopinavir/ritonavir", "Block HIV protease → immature non-infectious virions; ritonavir 'boosts' levels.", "HIV, often 2nd-line/boosted.") ] },
          { label: "Entry inhibitors", children: [ D("Maraviroc / enfuvirtide", "Maraviroc blocks the CCR5 co-receptor; enfuvirtide blocks gp41 fusion.", "Salvage/specific HIV regimens.") ] } ] } ] },

      /* ================= ANTIFUNGAL ================= */
      { label: "Antifungal", children: [
        { label: "Polyenes (bind ergosterol → membrane pores)", children: [
          D("Amphotericin B (liposomal)", "Binds ergosterol, leaking cell contents — broad and fungicidal; lipid forms less nephrotoxic.", "Severe/invasive mycoses: cryptococcal & candidal, mucormycosis, endemic dimorphics, visceral leishmaniasis."),
          D("Nystatin", "Polyene, too toxic for systemic use.", "Topical mucosal candidiasis.") ] },
        { label: "Azoles (inhibit 14-α-demethylase → block ergosterol synthesis)", children: [
          { label: "Imidazoles (mostly topical)", children: [ D("Clotrimazole, ketoconazole, miconazole", "Azole; ketoconazole limited by hepatotoxicity.", "Topical dermatophytes, candidiasis; Malassezia.") ] },
          { label: "Triazoles (systemic)", children: [
            D("Fluconazole", "Water-soluble, good CSF penetration; yeasts (not moulds).", "Candida, cryptococcal maintenance, coccidioidal meningitis."),
            D("Itraconazole", "Broader; active against dimorphics and Aspergillus.", "Endemic dimorphic mycoses, sporotrichosis, ABPA."),
            D("Voriconazole", "Fungicidal against Aspergillus; broad.", "First-line invasive aspergillosis; Fusarium/Scedosporium."),
            D("Posaconazole / isavuconazole", "Extended-spectrum — the only azoles with Mucorales activity.", "Mucormycosis (salvage/step-down), prophylaxis in neutropenia.") ] } ] },
        { label: "Echinocandins (inhibit β-1,3-glucan synthase → cell wall)", children: [
          D("Caspofungin / anidulafungin / micafungin", "Block cell-wall glucan synthesis; fungicidal vs Candida, fungistatic vs Aspergillus. No CNS/urine penetration.", "Invasive candidiasis (first-line), Aspergillus salvage. Inactive vs Cryptococcus and Mucorales.") ] },
        { label: "Antimetabolite", children: [
          D("Flucytosine", "Converted to 5-fluorouracil, disrupting fungal nucleic-acid synthesis; used in combination (resistance if alone).", "With amphotericin for cryptococcal meningitis and severe candidiasis.") ] },
        { label: "Allylamines / others", children: [
          D("Terbinafine (allylamine)", "Inhibits squalene epoxidase, blocking ergosterol synthesis; concentrates in keratin.", "Dermatophyte nail and skin infection."),
          D("Griseofulvin", "Disrupts fungal microtubules; deposits in keratin.", "Tinea capitis, dermatophytosis (esp. children).") ] } ] },

      /* ================= ANTIPARASITIC ================= */
      { label: "Antiparasitic", children: [
        { label: "Antimalarials", children: [
          { label: "Artemisinins", children: [ D("Artesunate / artemether (in ACT)", "Heme-iron-activated free radicals kill blood-stage parasites and gametocytes; always combined with a partner drug.", "IV artesunate for severe malaria; ACT for uncomplicated falciparum.") ] },
          { label: "Quinolines", children: [
            D("Chloroquine", "Blocks haem detoxification in the food vacuole. Widely resisted (pfcrt) in falciparum.", "Non-falciparum malaria; still used where susceptible."),
            D("Quinine / mefloquine", "Blood-schizonticides.", "Quinine for severe malaria where artesunate unavailable; mefloquine prophylaxis."),
            D("Primaquine / tafenoquine", "8-aminoquinoline killing liver hypnozoites and gametocytes.", "Radical cure of P. vivax/ovale relapse. Check G6PD first (haemolysis).") ] },
          { label: "Antifolates / other", children: [ D("Atovaquone-proguanil; sulfadoxine-pyrimethamine", "Block mitochondrial electron transport / folate synthesis.", "Prophylaxis and treatment of falciparum malaria.") ] } ] },
        { label: "Antiprotozoals", children: [
          D("Metronidazole / tinidazole", "Nitroimidazole reduced to DNA-damaging radicals.", "Amoebiasis, giardiasis, trichomoniasis (+ luminal agent for amoebic cysts)."),
          D("Pyrimethamine + sulfadiazine", "Sequential folate blockade (+ folinic acid to protect host).", "Toxoplasmic encephalitis and ocular toxoplasmosis."),
          D("Antileishmanials", "Liposomal amphotericin (membrane sterols); sodium stibogluconate (energy metabolism); miltefosine (oral, membranes); paromomycin.", "Visceral (kala-azar) and cutaneous leishmaniasis — regimen by region."),
          D("Pentamidine", "Interferes with parasite DNA/folate.", "PCP (2nd-line/nebulised), African trypanosomiasis, leishmaniasis.") ] },
        { label: "Anthelmintics", children: [
          D("Albendazole / mebendazole (benzimidazoles)", "Bind β-tubulin, blocking microtubules and glucose uptake.", "Intestinal nematodes (Ascaris, hookworm, Trichuris, Enterobius), neurocysticercosis (albendazole + steroids)."),
          D("Ivermectin", "Opens glutamate-gated chloride channels → parasite paralysis.", "Strongyloides, onchocerciasis, filariasis (MDA), scabies, lice."),
          D("Praziquantel", "Raises tegumental calcium permeability → paralysis and tegument damage.", "Schistosomiasis, liver/lung flukes, tapeworm infection (not Fasciola)."),
          D("Diethylcarbamazine (DEC)", "Microfilaricidal (± macrofilaricidal).", "Lymphatic filariasis, loiasis."),
          D("Niclosamide", "Inhibits the tapeworm's mitochondrial phosphorylation; not absorbed (luminal).", "Intestinal tapeworm (adult worm only)."),
          D("Doxycycline (anti-Wolbachia)", "Kills the essential Wolbachia endosymbiont → adult worms sterilised/die.", "Lymphatic filariasis, onchocerciasis (macrofilaricidal).") ] },
        { label: "Ectoparasiticides", children: [
          D("Permethrin / malathion", "Neurotoxic to arthropods (Na-channel / cholinesterase).", "Scabies (topical permethrin first-line) and lice — pyrethroid resistance rising."),
          D("Dimeticone", "Physically coats and suffocates lice — resistance-proof.", "Head lice."),
          D("Ivermectin (oral/topical)", "Glutamate-gated chloride channels.", "Crusted scabies, outbreaks, resistant lice.") ] } ] }
    ]
  };

  root.DRUGS = DRUGS;
  if (typeof module !== "undefined" && module.exports) module.exports = DRUGS;
})(typeof globalThis !== "undefined" ? globalThis : this);
