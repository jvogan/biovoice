# Natural-Language Structure Control

This guide is for the cases where a scientist speaks in scene semantics instead of object IDs.

## What works well

- Whole-scene requests:
  “Rotate the whole complex 25 degrees around y.”
  “Center the full assembly and keep the map in frame.”
- Relative structure movement:
  “Move the predicted model to the right and keep the scaffold fixed.”
  “Pull partner A away from partner B for an exploded comparison.”
  “Keep the whole complex still and move only the binder.”
- Rosetta-style review:
  “Align the design to the starting scaffold, isolate the remodeled shell, then export the clean comparison.”
  “Show only the changed interface patch and keep the scaffold subdued.”
- AlphaFold review:
  “Color the AlphaFold model by confidence, zoom the low-confidence loop, then compare it to the experimental backbone.”
  “Move the prediction off to the side without changing the camera.”
- Cryo and atomic handoff:
  “Show the density as a cutaway mesh, keep the ligand visible, and save a polished cryo-plus-atomic still.”

## How the runtime resolves those requests

1. `get_target_state` returns `referenceHints` such as `wholeComplex`, `assemblyModel`, `predictedModel`, `experimentalModel`, `scaffoldModel`, `binderModel`, `partnerA`, `partnerB`, `interfacePair`, and `map`.
2. The Realtime agent should reuse those handles through structured selectors like `{ "reference": "predictedModel" }`.
3. When the user wants one structure to move relative to another, the runtime should use `transform` actions rather than camera actions.

## Naming advice for user-provided files

Prefer names like:

- `exp_complex`
- `af_prediction`
- `wt_scaffold`
- `rosetta_design_v2`
- `binder_model`
- `density_map`

Those names make it much easier for the agent to resolve phrases like “the scaffold”, “the prediction”, or “the binder” without falling back to raw commands.

## Best demo pairings

- AlphaFold:
  predicted-versus-experimental overlays, confidence-colored flexible loops, and side-by-side exploded comparison shots.
- Rosetta:
  scaffold-versus-design overlays, changed-shell review, binder-versus-target interface contacts, and before-versus-after exports.
- Cryo:
  map cutaways, orthoplane inspection in ChimeraX, and PyMOL cryo-plus-atomic hero frames.
