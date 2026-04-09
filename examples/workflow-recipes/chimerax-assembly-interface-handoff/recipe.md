# Assembly-To-Interface Handoff Workflow

## Step 1: Open the assembly and save the overview camera.

**Suggested voice request:** Load 8WJ1, expand the biological assembly, and save a clean overview view before focusing on the interface.

Load 8WJ1, expand the biological assembly, and save a clean overview view before focusing on the interface.

Checkpoints:
- The assembly is visible and color-coded by chain.
- assembly-global is stored as a named view.

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
- `view name assembly-global`

## Step 2: Focus the A/B interface and compute its contact network.

**Suggested voice request:** Return to one focused interface, compute contacts and hydrogen bonds across chains A and B, and save the interface hero view.

Return to one focused interface, compute contacts and hydrogen bonds across chains A and B, and save the interface hero view.

Checkpoints:
- Only chains A and B are emphasized.
- Contacts or hydrogen bonds across the interface are visible.
- interface-hero is stored as a named view.

Direct command equivalents:
- `tile off`
- `hide /C,D`
- `color /A royalblue`
- `color /B goldenrod`
- `contacts /A restrict /B distanceOnly 4 reveal true showDist true`
- `hbonds /A restrict /B reveal true showDist true`
- `surface (/A & /B :< 4) | (/B & /A :< 4)`
- `transparency (/A & /B :< 4) | (/B & /A :< 4) 55 target s`
- `view /A,B orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name interface-hero`

## Step 3: Recall the interface hero view and export it cleanly.

**Suggested voice request:** Return to the saved interface view, apply the polished comparison preset, and export the final interface still.

Return to the saved interface view, apply the polished comparison preset, and export the final interface still.

Checkpoints:
- The interface-hero view is recalled.
- A high-resolution interface export is written.

Direct command equivalents:
- `view interface-hero 35`
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
- `save "./output/doc-exports/chimerax-assembly-interface-handoff-recall-and-export-interface.png" width 2400 height 1600`
