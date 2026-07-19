# Reference sources

Citation sources for authoring `taxonomy` / `treatment` / `resistance` and the prose
panels. **The PDFs themselves are not committed** (copyrighted textbooks / large binaries —
see `.gitignore`); this file records what they are, where they live, and how to cite them.

Content authored from these is verified by hand, in small batches — never bulk-generated.

## Sources

| Key | Title | Pages | Text layer | Role |
|---|---|---|---|---|
| **OXFORD-IDM** | Oxford Handbook of Infectious Diseases and Microbiology | 909 | clean, searchable | Primary — organisms, taxonomy, treatment *mechanism*, resistance mechanisms |
| **NAIRN-3E** | Nairn & Helbert, *Immunology for Medical Students*, 3rd ed. | 305 | clean, searchable | Primary — immune mechanisms (the `resp`/`evade` panels, immune-map linkage) |
| **SRAWA-2567** | Medical Council of Thailand, Announcement 4/2567 — licensing knowledge criteria พ.ศ. 2567 | 106 | **scanned, no text layer** (Thai) | Scope source of truth (which conditions, and tier กลุ่ม 1/2) |
| ~~IMMUNO-MEDSTU~~ | Same book as NAIRN-3E, front-matter only (12 pp) | 12 | clean | Redundant — ignore |

### Current file locations (on this machine)

- OXFORD-IDM  — `C:\Users\ASUS\Documents\infection and defend\Oxford-handbook-of-ID-and-microbiology.pdf`
- NAIRN-3E    — `C:\Users\ASUS\Downloads\dokumen.pub_immunology-for-medical-students-3rd-edition-9780702067976.pdf`
- SRAWA-2567  — `C:\ศรว\ศรว requirement.pdf`

> Paths are absolute and machine-specific. If they move, update them here. Optionally copy
> them into `reference/` locally — that folder is git-ignored so they won't be committed.

## How to read them

- **Textbooks (OXFORD-IDM, NAIRN-3E)**: extract text directly, e.g. PyMuPDF
  `fitz.open(path)[page].get_text()`. No rendering needed. Print with UTF-8
  (`sys.stdout.buffer.write(...encode("utf-8"))`) — the Windows console default (cp1252)
  chokes on β, γ, etc.
- **SRAWA-2567 (scanned)**: render a page to PNG and read it visually —
  `fitz.open(path)[page].get_pixmap(dpi=150).save("out.png")` then open the PNG. A low-DPI
  contact sheet locates sections fast.

## Citation convention

When a batch is delivered, each authored field is cited as `KEY p.N` (e.g. `OXFORD-IDM p.401`,
`NAIRN-3E p.55`) so verification is a lookup, not a memory test. **Proposed schema addition**
(pending approval): an optional `sources: []` array per organism record to store these durably.

## SRAWA-2567 page map (scope)

The ศรว criteria are **indexed by clinical condition/disease with a tier (กลุ่มที่ 1 / กลุ่มที่ 2)**,
*not* by a flat list of named organisms. The prototype's 89 organisms are a mapping the
project author made *from* these conditions *to* their causative organisms — so scope-checking
is condition-based judgement, not an automatable organism-name diff.

| Pages | Section |
|---|---|
| p1 | Cover — Announcement 4/2567, dated 15 Jan 2567 |
| p2–6 | Preamble + contents/structure |
| p7–16 | ส่วนที่ 1 — Basic Medical Science Knowledge (incl. microbiology & immunology topic lists) |
| p17–48 | ส่วนที่ 2 — clinical conditions by organ system, tier tables (กลุ่มที่ 1/2) |
| p57–73 | ส่วนที่ 2 (cont.) — conditions by ICD chapter; **Infectious & parasitic diseases: p61** |
| p74–88 | ส่วนที่ 3–5 — clinical competencies, procedures (หัตถการ), professional/ethics, research |
| p89–106 | Appendices — condition / drug / laboratory lists (per-system; infectious list ~p94, p97) |

**The primary infectious-disease scope table is p61** (with related pathogens scattered under
respiratory, nervous, genitourinary, etc.). Extracting it is the natural way to wire the
validator's scope seam (`scripts/validate.mjs`, currently `TODO`).
