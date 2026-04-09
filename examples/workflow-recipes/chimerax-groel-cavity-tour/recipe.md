# GroEL Cavity Tour Workflow

## Step 1: Open GroEL and establish the overview.

**Suggested voice request:** Load the local assembly, color by chain, apply the large-assembly preset, and save a global overview view.

Load the local assembly, color by chain, apply the large-assembly preset, and save a global overview view.

Checkpoints:
- GroEL is visible as a clean large assembly.
- The groel-overview named view exists.

Direct command equivalents:
- `view delete all`
- `close all`
- `open "./examples/data/local/1grl.pdb"`
- `color #1 bychain cartoons`
- `cartoon #1`
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
- `view name groel-overview`

## Step 2: Color the domain architecture and reveal the cavity.

**Suggested voice request:** Color the GroEL apical, intermediate, and equatorial domains, clip into the cavity, and save the hero view.

Color the GroEL apical, intermediate, and equatorial domains, clip into the cavity, and save the hero view.

Checkpoints:
- The three GroEL domains are colored distinctly.
- The cavity cutaway is visible and stored as groel-cavity.

Direct command equivalents:
- `color :191-376 #E07A5F`
- `color :134-190,377-408 #95A78D`
- `color :1-133,409-523 #59728A`
- `view #1 orient`
- `clip front 18`
- `turn y 22`
- `turn x 8`
- `view name groel-cavity`

## Step 3: Inspect the layout and export the cavity hero shot.

**Suggested voice request:** Briefly tile the view, return to the cavity hero framing, and export the final still.

Briefly tile the view, return to the cavity hero framing, and export the final still.

Checkpoints:
- The cavity hero view is recalled cleanly.
- A polished GroEL still is exported.

Direct command equivalents:
- `tile`
- `tile off`
- `view groel-cavity 35`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `graphics silhouettes true color #282828 width 2`
- `cartoon style width 1.72 thick 0.34`
- `lighting full`
- `save "./output/doc-exports/chimerax-groel-cavity-tour-tile-recall-and-export.png" width 2600 height 1700`
