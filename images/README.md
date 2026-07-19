# Microscopy images

Drop real light-microscopy images here and they appear automatically in the
**Taxonomy** view's microscopy slot — no code or data editing needed.

## Naming
Name each file after the organism's record **id**, e.g. `staphylococcus-aureus.jpg`.
The full list — what image each organism needs and its exact filename — is in
`images-needed.csv` at the repo root. `.jpg`, `.jpeg` and `.png` all work.

## Fallback
When no image exists yet, the view keeps the generated Gram-stain **schematic**.
So images can be added gradually — each one replaces its schematic the moment
it's in this folder.

## Single-file bundle
`dist/infection-immunity.html` embeds data, not these image files. A later build
step can inline them as data-URIs; for now the bundle shows the schematics.

## Life-cycle diagrams
Name a life-cycle image `<id>-lifecycle.<ext>` (e.g. `plasmodium-falciparum-lifecycle.gif`)
and it appears inside the **Life cycle** block of the detail popup, above the text.
`.gif`, `.jpg`, `.jpeg` and `.png` are auto-loaded, in that order. Same fallback rule:
no file → text only.

All 22 parasite life-cycle diagrams are already present, fetched from **CDC DPDx**
(public domain). Full per-organism source URLs and the suggested citation are in
[`lifecycle-credits.md`](lifecycle-credits.md). These are tracked in git (unlike
user-supplied micrographs) because they're public-domain and needed to rebuild the
offline bundle.
