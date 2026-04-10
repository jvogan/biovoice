# Rosetta Tutorial

This tutorial is the best starting point if you want BioVoice to tell a design-review story instead of a generic structural walkthrough.

## What This Walkthrough Demonstrates

- Loading a validated local Rosetta-style design bundle
- Ranking and opening the strongest candidates
- Comparing scaffold and design in a presentation-friendly way

## Recommended Target

**PyMOL** is the recommended first Rosetta target because the scaffold-versus-design comparison and exploded review are especially strong there.

Use ChimeraX when the story is more about interface contacts than the before-versus-after visual.

## Prerequisites

- `npm install`
- `npm run prepare:data`
- `npm run generate:examples`
- Local `.env` with `OPENAI_API_KEY` for live voice

## Exact Command To Run

```bash
npm run showcase:pymol:rosetta
```

## What You Should Expect To See

- The reference scaffold loads from the local Rosetta demo bundle
- The top design candidates are ranked from `score.sc`
- The design and scaffold are arranged into a readable comparison
- The remodeled shell becomes the visual focus for a polished export

## First Commands To Say

- "Rank the top designs and open the best-scoring candidates."
- "Keep the scaffold quiet and show the remodeled shell."
- "Pull the design away for a clean before-and-after view."

Useful follow-ups:

- "Highlight the changed shell only."
- "Keep the whole scaffold visible but emphasize the design patch."
- "Save the final comparison as a PNG."

## How To Run The Same Workflow Without Voice

```bash
npm run rehearse:workflow -- rosetta_top_design_compare --target pymol --capture --model examples/data/local/rosetta_demo/reference_scaffold.pdb --bundle examples/data/local/rosetta_demo --scorefile examples/data/local/rosetta_demo/score.sc --top-n 2
```

## ChimeraX Alternative

```bash
npm run showcase:chimerax:rosetta
```

## Common Failure Points

- **The bundle or scorefile path is wrong**: confirm the local demo files exist under `examples/data/local/rosetta_demo/`
- **You expected a ligand-centric story**: use [Ligand Pocket Tutorial](./tutorial-ligand-pocket.md) instead
- **The comparison looks cluttered**: keep the scaffold anchored and simplify labels before exporting
- **You actually want interface packing and contacts**: start the ChimeraX Rosetta path instead of the PyMOL compare

## Where To Go Next

- [Ligand Pocket Tutorial](./tutorial-ligand-pocket.md) for binding-site storytelling
- [Scientific Workflows Catalog](../examples/scientific-workflows/README.md) for alternate Rosetta task entries
- [Architecture and Provider Support](./architecture.md) for the tool/runtime model

## Generated Reference Pages

- [Scientific workflow catalog](../examples/scientific-workflows/README.md)
- [PyMOL Rosetta-style design review reference](../examples/workflow-recipes/pymol-rosetta-style-design-review/README.md)
- [ChimeraX Rosetta-style design review reference](../examples/workflow-recipes/chimerax-rosetta-style-design-review/README.md)
