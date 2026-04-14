# Cryo-EM Map Fit Review Adapter Notes

This recipe targets **chimerax**.

## Structured Steps
- **Open the fitted model and establish the global mesh overview.**: Load the fitted hemoglobin model and its cryo-EM map, start in mesh view, and save a whole-assembly overview before any analytic inspection.
- **Fit the model into the map and validate the global fit.**: Run fitmap, keep the mesh view active, and rotate through the fitted assembly so the density alignment reads like a real validation pass.
- **Inspect the fitted density with orthoplanes, then exit cleanly.**: Briefly switch into sectional orthoplane view to inspect the density internals, then return to the cleaner mesh presentation before moving local.
- **Move into a local heme-centered fit review.**: Return to the fitted overview, then tighten into a heme-centered density cutaway so the map feels locally informative instead of globally noisy.
- **Return to the polished mesh hero and export.**: Recall the strongest fitted mesh overview, apply the map presentation preset, and save a final still that reads cleanly even when paused.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
