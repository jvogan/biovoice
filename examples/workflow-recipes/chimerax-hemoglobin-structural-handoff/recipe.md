# Hemoglobin Structural Handoff Workflow

## Step 1: Open the tetramer and prediction, then save the whole-assembly overview.

**Suggested voice request:** Start from a clean ChimeraX workspace, open the experimental 8WJ1 tetramer plus the AlphaFold chain, and save a polished full-assembly view before alignment.

Start from a clean ChimeraX workspace, open the experimental 8WJ1 tetramer plus the AlphaFold chain, and save a polished full-assembly view before alignment.

Checkpoints:
- The 8WJ1 tetramer is visible with hemes shown as sticks.
- The AlphaFold chain is open as a second model.
- handoff-overview is stored as a named view.

Direct command equivalents:
- `close all`
- `view delete all`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `open "./examples/data/local/8wj1.cif"`
- `open "./examples/data/local/af-p69905.pdb"`
- `cartoon #1`
- `style #1 & ligand stick`
- `cartoon #2`
- `color #1 bychain cartoons`
- `color #1 & ligand byelement atoms`
- `color #2 hotpink`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `graphics silhouettes true color #282828 width 2`
- `cartoon style width 1.72 thick 0.34`
- `lighting full`
- `view #1 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `view name handoff-overview`

## Step 2: Align the AlphaFold chain to chain A and store the local overlay.

**Suggested voice request:** Align the AlphaFold alpha chain to experimental chain A, then move into a heme-adjacent comparison that reads like a real figure panel.

Align the AlphaFold alpha chain to experimental chain A, then move into a heme-adjacent comparison that reads like a real figure panel.

Checkpoints:
- The AlphaFold chain is aligned to chain A.
- The local heme-adjacent overlay is framed cleanly.
- handoff-alpha-overlay is stored as a named view.

Direct command equivalents:
- `matchmaker #2 to #1/A`
- `style #1/A:58,87 | #2:58,87 | #1/A & ligand stick`
- `view #1/A | #2 | #1/A & ligand orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name handoff-alpha-overlay`

## Step 3: Tighten into the heme neighborhood for the local structural read.

**Suggested voice request:** Stay on the aligned comparison, quiet the rest of the assembly, and settle on a local heme-centered frame before the map handoff.

Stay on the aligned comparison, quiet the rest of the assembly, and settle on a local heme-centered frame before the map handoff.

Checkpoints:
- The local comparison is tighter and less cluttered than the full overlay.
- handoff-heme-close-up is stored as a named view.

Direct command equivalents:
- `view handoff-alpha-overlay`
- `hide #1/B`
- `view #1/A | #2 | #1/A & ligand orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `turn y 8`
- `turn x -3`
- `view name handoff-heme-close-up`

## Step 4: Hide the prediction, hand off into the cryo map, and inspect orthoplanes briefly.

**Suggested voice request:** Return to the whole fitted assembly, hide the AlphaFold model, bring in the local cryo map, run fitmap, and use orthoplanes only as a short validation beat.

Return to the whole fitted assembly, hide the AlphaFold model, bring in the local cryo map, run fitmap, and use orthoplanes only as a short validation beat.

Checkpoints:
- The cryo map is open around the experimental model.
- The fitted overview is stored before orthoplanes begin.
- The orthoplane beat appears briefly and exits back to mesh cleanly.

Direct command equivalents:
- `view handoff-overview`
- `show #1`
- `close #2`
- `open "./examples/data/local/emd_37575.map"`
- `volume #2 style mesh level 2.1`
- `color #2 #8A9098`
- `fitmap #1 inMap #2`
- `view #1 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `view name handoff-map-fit-overview`
- `volume #2 style image orthoplanes xyz`
- `clip front 12`
- `turn y 10`
- `volume #2 style mesh level 2.1`
- `color #2 #8A9098`
- `view name handoff-map-post-orthoplane`

## Step 5: Return to a fitted local heme-centered hero and export.

**Suggested voice request:** Recall the fitted overview, move into a local heme-centered cutaway with the map still legible, then apply the map preset and export the final figure.

Recall the fitted overview, move into a local heme-centered cutaway with the map still legible, then apply the map preset and export the final figure.

Checkpoints:
- The local cryo handoff lands on the heme-centered cutaway rather than the orthoplane view.
- A polished final export exists.

Direct command equivalents:
- `view handoff-map-fit-overview`
- `hide #1/B`
- `style #1/A:58,87 | #1/A & ligand stick`
- `clip off`
- `view #1/A | #1/A & ligand orient`
- `turn y 18`
- `turn x 10`
- `view name handoff-final-local-hero`
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
- `save "./output/doc-exports/chimerax-hemoglobin-structural-handoff-final-fitted-local-hero.png" width 2400 height 1600`
