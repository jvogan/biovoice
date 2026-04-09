# AlphaFold Confidence Sweep Adapter Notes

This recipe targets **pymol**.

## Structured Steps
- **Load the AlphaFold model and establish the confidence overview.**: Open the local AlphaFold structure, switch to a confidence-aware putty representation, and store an overview scene.
- **Isolate and frame the uncertain regions.**: Create a reusable selection for low-confidence residues, emphasize them, and store a close-up scene.
- **Recall the close-up and export the final confidence still.**: Return to the flexible-region close-up, polish the presentation preset, and export the final figure.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
