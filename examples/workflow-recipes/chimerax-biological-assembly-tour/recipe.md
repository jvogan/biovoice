# Biological Assembly Tour Workflow

## Step 1: Open the model and expand the biological assembly.

**Suggested voice request:** Load the local 8WJ1 cryo-EM model, color it by chain, expand the assembly, and store the overview.

Load the local 8WJ1 cryo-EM model, color it by chain, expand the assembly, and store the overview.

Checkpoints:
- The model is visible with by-chain colors.
- assembly-overview is stored as a named view.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/8wj1.cif"`
- `cartoon #1`
- `color #1 bychain cartoons`
- `sym #1 assembly 1 copies true`
- `view #1 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `view name assembly-overview`

## Step 2: Tile briefly and settle into the hero framing.

**Suggested voice request:** Use tile mode to inspect the assembly layout, then collapse back to a single presentation camera and store the hero view.

Use tile mode to inspect the assembly layout, then collapse back to a single presentation camera and store the hero view.

Checkpoints:
- Tile mode toggles cleanly.
- assembly-hero is stored as a named view.

Direct command equivalents:
- `tile`
- `tile off`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `graphics silhouettes true color #303030 width 1.4`
- `view #1 orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name assembly-hero`

## Step 3: Recall the hero framing and export the still.

**Suggested voice request:** Recall the polished hero view, strengthen the presentation preset, and export the final assembly still.

Recall the polished hero view, strengthen the presentation preset, and export the final assembly still.

Checkpoints:
- The assembly-hero view is recalled.
- A high-resolution assembly export exists.

Direct command equivalents:
- `view assembly-hero 40`
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
- `save "./output/doc-exports/chimerax-biological-assembly-tour-export-assembly-still.png" width 2400 height 1600`
