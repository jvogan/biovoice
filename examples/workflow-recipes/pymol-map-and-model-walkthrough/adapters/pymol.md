# Map and Model Walkthrough Adapter Notes

This recipe targets **pymol**.

## Structured Steps
- **Load ubiquitin and generate a synthetic map.**: Open 1UBQ, create a gaussian map, and contour it as a mesh.
- **Focus the Lys48 region and clip through the map.**: Create a neighborhood selection, orient the camera, and clip into the contour.
- **Store overview and site scenes for playback.**: Create an overview scene and a focused scene, then export the focus image.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
