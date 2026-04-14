# Cryo-EM Map Fit Review Workflow

## Step 1: Open the fitted model and establish the global mesh overview.

**Suggested voice request:** Load the fitted hemoglobin model and its cryo-EM map, start in mesh view, and save a whole-assembly overview before any analytic inspection.

Load the fitted hemoglobin model and its cryo-EM map, start in mesh view, and save a whole-assembly overview before any analytic inspection.

Checkpoints:
- The cryo-EM map is visible as mesh around the model.
- The map-global-overview named view is stored.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/8wj1.cif"`
- `open "./examples/data/local/emd_37575.map"`
- `cartoon #1`
- `style #1 & ligand stick`
- `color #1 bychain cartoons`
- `color #1 & ligand byelement atoms`
- `volume #2 style mesh level 2.1`
- `color #2 #8A9098`
- `view #1 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `view name map-global-overview`

## Step 2: Fit the model into the map and validate the global fit.

**Suggested voice request:** Run fitmap, keep the mesh view active, and rotate through the fitted assembly so the density alignment reads like a real validation pass.

Run fitmap, keep the mesh view active, and rotate through the fitted assembly so the density alignment reads like a real validation pass.

Checkpoints:
- Fit executes cleanly against the map.
- The map-fit-overview named view is stored.

Direct command equivalents:
- `view map-global-overview`
- `fitmap #1 inMap #2`
- `view #1 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `turn y 18`
- `turn x 7`
- `view name map-fit-overview`

## Step 3: Inspect the fitted density with orthoplanes, then exit cleanly.

**Suggested voice request:** Briefly switch into sectional orthoplane view to inspect the density internals, then return to the cleaner mesh presentation before moving local.

Briefly switch into sectional orthoplane view to inspect the density internals, then return to the cleaner mesh presentation before moving local.

Checkpoints:
- Orthoplane inspection is visible.
- The map returns to mesh view and stores map-post-orthoplane.

Direct command equivalents:
- `view map-fit-overview`
- `volume #2 style image orthoplanes xyz`
- `clip front 12`
- `turn y 10`
- `volume #2 style mesh level 2.1`
- `color #2 #8A9098`
- `view name map-post-orthoplane`

## Step 4: Move into a local heme-centered fit review.

**Suggested voice request:** Return to the fitted overview, then tighten into a heme-centered density cutaway so the map feels locally informative instead of globally noisy.

Return to the fitted overview, then tighten into a heme-centered density cutaway so the map feels locally informative instead of globally noisy.

Checkpoints:
- The local heme neighborhood is emphasized without losing the density context.
- The map-local-fit named view is stored.

Direct command equivalents:
- `view map-fit-overview`
- `style #1/A:58,87 | #1 & ligand stick`
- `view #1/A | #1 & ligand orient`
- `turn y 20`
- `turn x 12`
- `zoom 1.25`
- `clip front 14`
- `turn y 8`
- `turn x -4`
- `view name map-local-fit`

## Step 5: Return to the polished mesh hero and export.

**Suggested voice request:** Recall the strongest fitted mesh overview, apply the map presentation preset, and save a final still that reads cleanly even when paused.

Recall the strongest fitted mesh overview, apply the map presentation preset, and save a final still that reads cleanly even when paused.

Checkpoints:
- The fitted mesh hero is recalled.
- A high-resolution cryo map-fit export is written.

Direct command equivalents:
- `view map-fit-overview`
- `clip off`
- `view #1 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `volume #2 style mesh level 2.25`
- `color #2 #737A82`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `graphics silhouettes true color #5A5A5A width 1.35`
- `graphics quality 2.4`
- `lighting simple`
- `graphics silhouettes true color #5A5A5A width 1.4`
- `lighting simple`
- `save "./output/doc-exports/chimerax-em-map-fit-demo-presentation-export.png" width 2400 height 1600`
