# AlphaFold Confidence Review Workflow

## Step 1: Open the AlphaFold model and color it by confidence.

**Suggested voice request:** Load the local AlphaFold model and apply B-factor confidence coloring.

Load the local AlphaFold model and apply B-factor confidence coloring.

Checkpoints:
- Model is open and confidence colors are visible.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/af-q9h255.pdb"`
- `color bfactor #1 palette alphafold`
- `cartoon #1`

## Step 2: Find and focus the flexible region.

**Suggested voice request:** Select a low-confidence loop, frame it, and compare cartoon and surface.

Select a low-confidence loop, frame it, and compare cartoon and surface.

Checkpoints:
- Flexible loop region is selected and emphasized.

Direct command equivalents:
- `select #1:180-225`
- `style sel stick`
- `surface sel`
- `transparency sel 60 target s`
- `view sel orient`
- `turn y 18`
- `turn x -10`
- `zoom 1.35`
- `clip front 10`

## Step 3: Apply a clean preset and export the result.

**Suggested voice request:** Use a soft-light preset and save the final confidence review figure.

Use a soft-light preset and save the final confidence review figure.

Checkpoints:
- A final confidence review image is saved.

Direct command equivalents:
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `lighting soft`
- `graphics silhouettes true color #333333 width 1.5`
- `save "./output/doc-exports/chimerax-alphafold-confidence-review-export-confidence-shot.png" width 2200 height 1500`
