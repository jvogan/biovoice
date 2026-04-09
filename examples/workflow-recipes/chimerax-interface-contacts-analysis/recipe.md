# Interface or Contacts Analysis Workflow

## Step 1: Open hemoglobin and isolate chains A and B.

**Suggested voice request:** Load the tetramer and narrow the view to the A/B interface.

Load the tetramer and narrow the view to the A/B interface.

Checkpoints:
- Only chains A and B remain emphasized.

Direct command equivalents:
- `close all`
- `open "./examples/data/local/4hhb.pdb"`
- `hide /C,D`
- `color /A royalblue`
- `color /B goldenrod`
- `view /A,B orient`

## Step 2: Compute interface contacts and hydrogen bonds.

**Suggested voice request:** Run contact and hydrogen bond analysis across the chain interface.

Run contact and hydrogen bond analysis across the chain interface.

Checkpoints:
- Interface pseudobonds and surface are visible.

Direct command equivalents:
- `contacts /A restrict /B distanceOnly 4 reveal true showDist true`
- `hbonds /A restrict /B reveal true showDist true`
- `surface (/A & /B :< 4) | (/B & /A :< 4)`
- `transparency (/A & /B :< 4) | (/B & /A :< 4) 60 target s`

## Step 3: Apply the clean preset and export the interface.

**Suggested voice request:** Use a silhouette presentation preset and save the interface shot.

Use a silhouette presentation preset and save the interface shot.

Checkpoints:
- Interface export is saved.

Direct command equivalents:
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
- `save "./output/doc-exports/chimerax-interface-contacts-analysis-export-interface.png" width 2200 height 1500`
