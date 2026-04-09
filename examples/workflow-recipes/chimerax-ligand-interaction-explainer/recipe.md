# Ligand Interaction Explainer Workflow

## Step 1: Open the structure and style the protein and ligand.

**Suggested voice request:** Load 1HSG, apply chain coloring, and switch the ligand to a more legible representation.

Load 1HSG, apply chain coloring, and switch the ligand to a more legible representation.

Checkpoints:
- Protein is ribbon, ligand is sticks, and colors are applied.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/1hsg.pdb"`
- `color #1 bychain cartoons`
- `cartoon protein`
- `style ligand stick`
- `view ligand orient`

## Step 2: Build the pocket surface and compute interactions.

**Suggested voice request:** Create a transparent pocket surface and overlay hydrogen bonds and clashes around the ligand.

Create a transparent pocket surface and overlay hydrogen bonds and clashes around the ligand.

Checkpoints:
- Pocket surface is visible and interaction overlays are present.

Direct command equivalents:
- `surface protein & ligand :< 6`
- `transparency protein & ligand :< 6 55 target s`
- `hbonds ligand restrict "protein & ligand :< 6" reveal true showDist true`
- `clashes ligand restrict "protein & ligand :< 6" distanceOnly 2.2 reveal true showDist true`

## Step 3: Finish the pocket shot and export it.

**Suggested voice request:** Set the camera, apply a presentation preset, and save a PNG.

Set the camera, apply a presentation preset, and save a PNG.

Checkpoints:
- A publication-style export is saved.

Direct command equivalents:
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `view ligand orient`
- `turn y 18`
- `turn x -10`
- `zoom 1.35`
- `clip front 10`
- `save "./output/doc-exports/chimerax-ligand-interaction-explainer-export-pocket-view.png" width 2200 height 1500`
