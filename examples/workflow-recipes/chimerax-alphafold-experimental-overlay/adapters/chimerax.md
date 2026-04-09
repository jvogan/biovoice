# AlphaFold Experimental Overlay Adapter Notes

This recipe targets **chimerax**.

## Structured Steps
- **Open the tetramer and prediction, then save the overview.**: Start from a clean ChimeraX workspace, open the experimental tetramer plus the AlphaFold chain, and save a polished full-assembly view before alignment.
- **Align to chain A and store the focused overlay.**: Align the AlphaFold model to experimental chain A, emphasize the heme-adjacent patch, and save a dedicated overlay view for recall.
- **Move the prediction aside for an exploded comparison.**: Translate and rotate the AlphaFold model away from the tetramer so the comparison can be narrated without visual overlap.
- **Recall the overlay and export the final comparison.**: Return to the exploded comparison, apply the polished comparison preset, and export a high-resolution still for the demo.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
