# Cryo-EM Tutorial

This tutorial is the best newcomer path when the story is about density, model fit, and a map-oriented explanation rather than a pure structure-only scene.

## What This Walkthrough Demonstrates

- Opening a validated local cryo-EM map and its fitted model
- Reviewing a global mesh-based fit before moving into sectional inspection
- Using orthoplanes briefly as a real cryo check, not as the final presentation mode
- Moving into a local heme-centered density cutaway and returning to a polished mesh hero

## Recommended Target

**ChimeraX** is the recommended first cryo-EM target because the current map-fit workflow has the strongest mesh, orthoplane, and fit-quality presentation.

PyMOL remains a good alternative when you want a more tightly staged atomic handoff.

## Prerequisites

- `npm install`
- `npm run prepare:data`
- `npm run generate:examples`
- Optional for live voice: local `.env` with `OPENAI_API_KEY`

## Exact Command To Run

```bash
npm run showcase:chimerax:map
```

## What You Should Expect To See

- The local `EMD-37575` map opens in ChimeraX as a clean mesh around the fitted hemoglobin model
- The walkthrough holds a whole-assembly "model inside density" frame before fitting
- The fit is executed and revisited from multiple angles so it feels like a real validation task
- Orthoplane inspection appears briefly, then exits back to mesh
- The scene tightens into a heme-centered local density cutaway and ends on a polished mesh-plus-model hero

## First Commands To Say

- "Open the cryo map and the fitted model."
- "Keep the density as mesh and show the whole fitted assembly first."
- "Run fitmap and rotate slowly around the fit."
- "Clip into the heme neighborhood and keep the model visible inside the density."

Useful follow-ups:

- "Show orthoplanes through the density briefly, then return to mesh."
- "Compare the wide fit against the local cutaway."
- "Save a polished map-fit export once the mesh hero looks balanced."

## How To Run The Same Workflow Without Voice

```bash
npm run rehearse:workflow -- alphafold_to_cryo_handoff --target chimerax --capture --model examples/data/local/af-p69905.pdb --experimental examples/data/local/8wj1.cif --pae examples/data/local/af-p69905-pae.json --map examples/data/local/emd_37575.map
```

## PyMOL Alternative

```bash
npm run showcase:pymol:cryo
```

## Common Failure Points

- **The map takes a moment to load**: wait for the workflow to complete before restyling manually
- **The orthoplane beat looks noisy**: that is expected for the inspection phase; the workflow returns to mesh before the final hero frame
- **The local close-up feels too tight**: recall the saved global fitted view first, then move back into the heme cutaway
- **You expected a synthetic map demo**: this tutorial uses the real local cryo-EM map path
- **You want more prediction context first**: start with [AlphaFold Tutorial](./tutorial-alphafold.md), then come back here
- **The target feels heavy for a first session**: use the ligand pocket tutorial first, then return to cryo-EM

## Where To Go Next

- [AlphaFold Tutorial](./tutorial-alphafold.md) for the prediction side of the handoff
- [Architecture and Provider Support](./architecture.md) for the local-control path and why ChimeraX is the stronger map-first target
- [Scientific Workflows Catalog](../examples/scientific-workflows/README.md) for alternate map-oriented entries

## Generated Reference Pages

- [Scientific workflow catalog](../examples/scientific-workflows/README.md)
- [ChimeraX cryo-EM map fit reference](../examples/workflow-recipes/chimerax-em-map-fit-demo/README.md)
- [PyMOL cryo atomic handoff reference](../examples/workflow-recipes/pymol-cryo-atomic-handoff/README.md)
