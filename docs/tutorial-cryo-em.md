# Cryo-EM Tutorial

This tutorial is the best newcomer path when the story is about density, model fit, and a map-oriented explanation rather than a pure structure-only scene.

## What This Walkthrough Demonstrates

- Opening a validated local cryo-EM map and fitted model
- Moving from overview to map-focused close-up
- Inspecting a density-and-model scene with a polished export at the end

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

- The local `EMD-37575` map opens
- The fitted hemoglobin model opens into the same scene
- The walkthrough shifts between overview, mesh, and density-focused close-ups
- The workflow reports fit-oriented metrics and ends with an exportable presentation frame

## First Commands To Say

- "Open the cryo map and the fitted model."
- "Show the density as mesh."
- "Clip into the heme pocket and keep the model visible."

Useful follow-ups:

- "Show orthoplanes through the density."
- "Quiet the rest of the assembly and keep the local fit visible."
- "Save a polished map-fit export."

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
- **You expected a synthetic map demo**: this tutorial uses the real local cryo-EM map path
- **You want more prediction context first**: start with [AlphaFold Tutorial](./tutorial-alphafold.md), then come back here
- **The target feels heavy for a first session**: use the ligand pocket tutorial first, then return to cryo-EM

## Where To Go Next

- [AlphaFold Tutorial](./tutorial-alphafold.md) for the prediction side of the handoff
- [Architecture and Provider Support](./architecture.md) for the local/control path
- [Scientific Workflows Catalog](../examples/scientific-workflows/README.md) for alternate map-oriented entries

## Generated Reference Pages

- [Scientific workflow catalog](../examples/scientific-workflows/README.md)
- [ChimeraX cryo-EM map fit reference](../examples/workflow-recipes/chimerax-em-map-fit-demo/README.md)
- [PyMOL cryo atomic handoff reference](../examples/workflow-recipes/pymol-cryo-atomic-handoff/README.md)
