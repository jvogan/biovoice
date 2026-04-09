# AlphaFold Experimental Overlay Adapter Notes

This recipe targets **pymol**.

## Structured Steps
- **Load the tetramer and the AlphaFold chain, then establish the overview.**: Start from a clean PyMOL workspace, load 4HHB plus the AlphaFold alpha chain, and store an assembly-first overview before the overlay.
- **Align the prediction to chain A and focus the heme-adjacent comparison patch.**: Align the AlphaFold chain to experimental chain A, spotlight the heme neighborhood, and store a crisp comparison scene with labels.
- **Pull the prediction aside for an exploded comparison shot.**: Translate and rotate the AlphaFold model away from the tetramer so the scientist can explain the prediction separately before returning to the overlay.
- **Recall the comparison scene and export the final figure.**: Return to the exploded comparison, strengthen the editorial comparison preset, and export a high-resolution figure for the demo.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
