# Hemoglobin Structural Handoff Adapter Notes

This recipe targets **chimerax**.

## Structured Steps
- **Open the tetramer and prediction, then save the whole-assembly overview.**: Start from a clean ChimeraX workspace, open the experimental 8WJ1 tetramer plus the AlphaFold chain, and save a polished full-assembly view before alignment.
- **Align the AlphaFold chain to chain A and store the local overlay.**: Align the AlphaFold alpha chain to experimental chain A, then move into a heme-adjacent comparison that reads like a real figure panel.
- **Tighten into the heme neighborhood for the local structural read.**: Stay on the aligned comparison, quiet the rest of the assembly, and settle on a local heme-centered frame before the map handoff.
- **Hide the prediction, hand off into the cryo map, and inspect orthoplanes briefly.**: Return to the whole fitted assembly, hide the AlphaFold model, bring in the local cryo map, run fitmap, and use orthoplanes only as a short validation beat.
- **Return to a fitted local heme-centered hero and export.**: Recall the fitted overview, move into a local heme-centered cutaway with the map still legible, then apply the map preset and export the final figure.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
