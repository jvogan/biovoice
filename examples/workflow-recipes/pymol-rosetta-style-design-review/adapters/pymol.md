# Rosetta-Style Design Review Adapter Notes

This recipe targets **pymol**.

## Structured Steps
- **Load the scaffold and design candidate with semantic roles.**: Start from a clean workspace, load the scaffold plus design surrogate, and establish a restrained overview view.
- **Align the design to the scaffold and isolate the remodeled shell.**: Overlay the design onto the scaffold, then emphasize the moving shell so the scientist can narrate the changed region directly.
- **Move only the design candidate for the exploded comparison and export it.**: Translate and rotate the design candidate away from the scaffold, keep the scaffold anchored, and export the final design-review figure.

## Notes
- The voice console compiles these recipe steps into structured tool calls.
- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.
