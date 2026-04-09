# Cryo-Atomic Handoff Adapter Notes

This recipe targets **pymol**.

## Structured Steps
- **Load the fitted model and local map.**: Open the local cryo-EM model and map, establish the atomic baseline, and store the overview scene.
- **Contour the density and move into the heme neighborhood.**: Build a reusable heme shell, contour the local density, and create a cryo-aware cutaway frame.
- **Store the cutaway and export the polished still.**: Save the heme-centered scene, preserve the cryo-aware preset, and export the final still.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
