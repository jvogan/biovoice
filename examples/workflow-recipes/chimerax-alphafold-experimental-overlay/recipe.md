# AlphaFold Experimental Overlay Workflow

## Step 1: Open the tetramer and prediction, then save the overview.

**Suggested voice request:** Start from a clean ChimeraX workspace, open the experimental tetramer plus the AlphaFold chain, and save a polished full-assembly view before alignment.

Start from a clean ChimeraX workspace, open the experimental tetramer plus the AlphaFold chain, and save a polished full-assembly view before alignment.

Checkpoints:
- The tetramer is visible with chain colors and hemes shown as sticks.
- The AlphaFold chain is open as a second model.
- tetramer-overview is stored as a named view.

Direct command equivalents:
- `close all`
- `view delete all`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `open "./examples/data/local/4hhb.pdb"`
- `open "./examples/data/local/af-p69905.pdb"`
- `cartoon #1`
- `style #1 & ligand stick`
- `cartoon #2`
- `color #1 bychain cartoons`
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
- `view name tetramer-overview`

## Step 2: Align to chain A and store the focused overlay.

**Suggested voice request:** Align the AlphaFold model to experimental chain A, emphasize the heme-adjacent patch, and save a dedicated overlay view for recall.

Align the AlphaFold model to experimental chain A, emphasize the heme-adjacent patch, and save a dedicated overlay view for recall.

Checkpoints:
- The AlphaFold chain is aligned to chain A.
- The heme-adjacent overlay patch is emphasized.
- alpha-overlay is stored as a named view.

Direct command equivalents:
- `matchmaker #2 to #1/A`
- `style #1/A:58,87 | #2:58,87 | #1 & ligand stick`
- `label #1/A:58@CA text "Exp His58"`
- `label #1/A:87@CA text "Exp His87"`
- `view #1/A | #2 | #1 & ligand orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name alpha-overlay`

## Step 3: Move the prediction aside for an exploded comparison.

**Suggested voice request:** Translate and rotate the AlphaFold model away from the tetramer so the comparison can be narrated without visual overlap.

Translate and rotate the AlphaFold model away from the tetramer so the comparison can be narrated without visual overlap.

Checkpoints:
- The AlphaFold chain is offset from the tetramer for an exploded comparison.
- alpha-exploded is stored as a named view.

Direct command equivalents:
- `move x 18 models #2`
- `turn y 24 center #2 models #2`
- `view #1/A | #2 | #1 & ligand orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name alpha-exploded`

## Step 4: Recall the overlay and export the final comparison.

**Suggested voice request:** Return to the exploded comparison, apply the polished comparison preset, and export a high-resolution still for the demo.

Return to the exploded comparison, apply the polished comparison preset, and export a high-resolution still for the demo.

Checkpoints:
- The alpha-exploded view is recalled cleanly.
- A high-resolution predicted-versus-experimental export exists.

Direct command equivalents:
- `view alpha-exploded 35`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `graphics silhouettes true color #282828 width 2`
- `cartoon style width 1.72 thick 0.34`
- `lighting full`
- `graphics silhouettes true color #222222 width 2.1`
- `lighting full`
- `save "./output/doc-exports/chimerax-alphafold-experimental-overlay-recall-and-export-overlay.png" width 2600 height 1700`
