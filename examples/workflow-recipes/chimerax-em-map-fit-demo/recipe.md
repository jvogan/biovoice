# Cryo-EM Map Fit Review Workflow

## Step 1: Open the local cryo-EM model and map.

**Suggested voice request:** Load the fitted hemoglobin model and its cryo-EM map, then switch the map to a clean mesh view.

Load the fitted hemoglobin model and its cryo-EM map, then switch the map to a clean mesh view.

Checkpoints:
- The cryo-EM map is visible as mesh with the model loaded beside it.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/8wj1.cif"`
- `open "./examples/data/local/emd_37575.map"`
- `cartoon #1`
- `color #1 bychain cartoons`
- `volume #2 style mesh level 0.021`

## Step 2: Fit the model into the map and inspect the fit.

**Suggested voice request:** Run fitmap, move through mesh and orthoplane views, and store the fitted presentation framing.

Run fitmap, move through mesh and orthoplane views, and store the fitted presentation framing.

Checkpoints:
- Fit executes cleanly and the map-fit-hero view is stored.

Direct command equivalents:
- `fitmap #1 inMap #2`
- `view #1 orient`
- `turn y 20`
- `turn x 12`
- `zoom 1.25`
- `clip front 14`
- `volume #2 style image orthoplanes xyz`
- `volume #2 style mesh level 0.021`
- `view name map-fit-hero`

## Step 3: Apply a presentation preset and export.

**Suggested voice request:** Enable a publication-friendly preset and save the final map-fit image.

Enable a publication-friendly preset and save the final map-fit image.

Checkpoints:
- A map-fit export exists.

Direct command equivalents:
- `view map-fit-hero 40`
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
