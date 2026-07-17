# Rosetta-Style Design Review Workflow

## Step 1: Open the scaffold and design candidate with semantic roles.

**Suggested voice request:** Start from a clean ChimeraX workspace, open the scaffold plus design surrogate, and establish a restrained overview view.

Start from a clean ChimeraX workspace, open the scaffold plus design surrogate, and establish a restrained overview view.

Checkpoints:
- The scaffold and design are visible with distinct colors.
- design-overview is stored as a named view.

Direct command equivalents:
- `close all`
- `view delete all`
- `preset publication 1`
- `graphics bgColor #FBFBF7`
- `graphics silhouettes true color #3A3A3A width 1.6`
- `graphics quality 2.2`
- `cartoon style width 1.5 thick 0.3`
- `lighting soft`
- `open "./examples/data/local/4ake.pdb"`
- `open "./examples/data/local/1ake.pdb"`
- `cartoon #1`
- `cartoon #2`
- `color #1 slate`
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
- `graphics silhouettes true color #222222 width 2.1`
- `lighting full`
- `view #1 | #2 orient`
- `turn y 14`
- `turn x 8`
- `zoom 1.15`
- `view name design-overview`

## Step 2: Align the design to the scaffold and isolate the remodeled shell.

**Suggested voice request:** Overlay the design onto the scaffold, emphasize the remodeled shell, and save the focused comparison view.

Overlay the design onto the scaffold, emphasize the remodeled shell, and save the focused comparison view.

Checkpoints:
- The design is aligned onto the scaffold.
- Residues 118-160 are emphasized on both models.
- design-shell is stored as a named view.

Direct command equivalents:
- `matchmaker #2 to #1`
- `style #2:118-160 stick`
- `style #1:118-160 stick`
- `color #2:118-160 hotpink`
- `color #1:118-160 deepskyblue`
- `distance #1/A:136@CA #2/A:136@CA`
- `view #1:118-160 | #2:118-160 orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name design-shell`

## Step 3: Move only the design candidate for the exploded comparison and export it.

**Suggested voice request:** Translate and rotate the design candidate away from the scaffold, keep the scaffold anchored, and export the final design-review still.

Translate and rotate the design candidate away from the scaffold, keep the scaffold anchored, and export the final design-review still.

Checkpoints:
- Only the design candidate is moved for the exploded comparison.
- design-exploded is stored as a named view.
- A high-resolution design-review PNG export exists.

Direct command equivalents:
- `move x 22 models #2`
- `turn y 22 center #2 models #2`
- `view #1 | #2 orient`
- `turn y 10`
- `turn x 5`
- `zoom 1.2`
- `view name design-exploded`
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
- `save "./output/doc-exports/chimerax-rosetta-style-design-review-explode-and-export-design.png" width 2600 height 1700`
