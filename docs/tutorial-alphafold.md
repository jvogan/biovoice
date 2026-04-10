# AlphaFold Tutorial

This tutorial is the best newcomer entry point if you want to see BioVoice handle prediction-versus-experiment work rather than a generic scene demo.

## What This Walkthrough Demonstrates

- Opening a validated local AlphaFold model and experimental comparison target
- Moving from global assembly context into a local overlay story
- Running the same workflow with voice or without voice

## Recommended Target

**ChimeraX** is the recommended first AlphaFold target because the current overlay path has strong named views, readable assembly context, and a polished comparison handoff.

PyMOL remains a strong alternative and is linked below.

## Prerequisites

- `npm install`
- `npm run prepare:data`
- `npm run generate:examples`
- Local `.env` with `OPENAI_API_KEY` for live voice

## Exact Command To Run

```bash
npm run showcase:chimerax:overlay
```

This launches the validated local AlphaFold-versus-experiment overlay showcase using demo data already bundled in `examples/data/local/`.

## What You Should Expect To See

- The experimental 4HHB tetramer opens in ChimeraX
- The AlphaFold hemoglobin alpha-chain model opens and aligns into the same scene
- The walkthrough moves from full-assembly context into a local comparison patch
- A polished export is available at the end of the recipe

## First Commands To Say

- "Open the experimental tetramer and the AlphaFold chain model."
- "Color by confidence."
- "Compare the prediction to the experimental backbone near the heme."

Good follow-ups:

- "Keep the whole complex visible but emphasize the comparison chain."
- "Pull the prediction slightly to the right for a cleaner side-by-side."
- "Save a polished export."

## How To Run The Same Workflow Without Voice

```bash
npm run rehearse:workflow -- alphafold_vs_experiment_overlay --target chimerax --capture --model examples/data/local/af-p69905.pdb --experimental examples/data/local/4hhb.pdb
```

## PyMOL Alternative

```bash
npm run showcase:pymol:overlay
```

## Common Failure Points

- **You forgot the demo data step**: rerun `npm run prepare:data`
- **You expected another voice provider**: AlphaFold live voice still runs through OpenAI Realtime only
- **The overlay looks too busy**: use the saved workflow views and keep the non-focused chains subdued
- **You want confidence-first rather than overlay-first**: use the scientific workflow catalog and start with the confidence review instead

## Where To Go Next

- [Cryo-EM Tutorial](./tutorial-cryo-em.md) for a map-oriented handoff
- [Architecture and Provider Support](./architecture.md) for the local/tool-execution model
- [Scientific Workflows Catalog](../examples/scientific-workflows/README.md) for more AlphaFold entry points

## Generated Reference Pages

- [Scientific workflow catalog](../examples/scientific-workflows/README.md)
- [ChimeraX AlphaFold experimental overlay reference](../examples/workflow-recipes/chimerax-alphafold-experimental-overlay/README.md)
- [PyMOL AlphaFold experimental overlay reference](../examples/workflow-recipes/pymol-alphafold-experimental-overlay/README.md)
