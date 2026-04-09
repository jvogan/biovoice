# Crystal Packing Contacts Adapter Notes

This recipe targets **pymol**.

## Structured Steps
- **Load the ligand-bound complex and establish the base styling.**: Bring 1HSG into PyMOL, show the protein and ligand cleanly, and apply the light editorial preset.
- **Generate symmetry mates and isolate the packing shell.**: Expand symmetry around the inhibitor, then keep only the local shell that explains the packing contact story.
- **Polish the packing-contact shot and export it.**: Frame the ligand and packing shell tightly, save a scene, and export a publication-style still.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
