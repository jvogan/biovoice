# Homolog Alignment Showcase Workflow

## Step 1: Open the conformers and apply distinct coloring.

**Suggested voice request:** Bring in both structures and make them visually distinct.

Bring in both structures and make them visually distinct.

Checkpoints:
- Both structures are present with distinct colors.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/1ake.pdb"`
- `open "./examples/data/local/4ake.pdb"`
- `color #1 deepskyblue`
- `color #2 gold`

## Step 2: Run matchmaker and focus the moving region.

**Suggested voice request:** Superpose the models and focus the mobile lid region for comparison.

Superpose the models and focus the mobile lid region for comparison.

Checkpoints:
- Alignment and moving-region focus are complete.

Direct command equivalents:
- `matchmaker #2 to #1`
- `select #1,2:118-160`
- `style sel stick`
- `view sel orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`

## Step 3: Jump between tile and aligned views, then export.

**Suggested voice request:** Show the presentation preset, create a tiled comparison, then export the aligned view.

Show the presentation preset, create a tiled comparison, then export the aligned view.

Checkpoints:
- Tile view occurs and the final aligned export is saved.

Direct command equivalents:
- `tile`
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
- `tile off`
- `view #1 orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `save "./output/doc-exports/chimerax-homolog-alignment-showcase-tile-and-export.png" width 2200 height 1500`
