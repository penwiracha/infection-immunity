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
