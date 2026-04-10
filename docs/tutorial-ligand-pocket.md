# Ligand Pocket Tutorial

This is the best polished first-scene tutorial in the repo. It produces an immediately readable active-site story and teaches the BioVoice interaction style without requiring large assemblies or heavy scientific context.

## What This Walkthrough Demonstrates

- Opening a ligand-bound structure from the local demo set
- Styling the protein and ligand for an audience-friendly explanation
- Measuring local contacts and building a transparent pocket surface
- Exporting a clean hero shot

## Recommended Target

**PyMOL** is the recommended first pocket target because its ligand-pocket storytelling, scene framing, and export flow are especially polished in the current recipes.

ChimeraX is an excellent second pass when you want hydrogen bonds and clashes emphasized more heavily.

## Prerequisites

- `npm install`
- `npm run prepare:data`
- `npm run generate:examples`
- Optional for live voice: local `.env` with `OPENAI_API_KEY`

## Exact Command To Run

```bash
npm run showcase:pymol:pocket
```

## What You Should Expect To See

- The local `1HSG` structure opens
- The inhibitor is visible in the active site
- The protein settles into a clean cartoon presentation
- Catalytic contacts and a transparent pocket surface are added
- A polished export is available at the end of the walkthrough

## First Commands To Say

- "Open local structure 1HSG."
- "Show the protein as cartoon and the inhibitor as sticks."
- "Zoom the active site and center on the ligand."

Useful follow-ups:

- "Measure the nearest catalytic contacts."
- "Make the pocket surface transparent."
- "Store this as the pocket hero scene."
- "Export the current pocket shot as a PNG."

## How To Run The Same Workflow Without Voice

```bash
npm run rehearse:workflow -- pymol-binding-pocket-story --target pymol --capture
```

## ChimeraX Alternative

```bash
npm run showcase:chimerax:pocket
```

## Common Failure Points

- **No local structure loads**: rerun `npm run prepare:data`
- **The view feels cluttered**: clear residue labels and tighten the slab before exporting
- **You want interaction annotations more than presentation styling**: switch to the ChimeraX pocket path
- **You are testing without voice**: use the rehearsal command above instead of forcing live voice

## Where To Go Next

- [First Live Session](./first-live-session.md) if this was still offline
- [AlphaFold Tutorial](./tutorial-alphafold.md) for comparison workflows
- [Cryo-EM Tutorial](./tutorial-cryo-em.md) for map and model walkthroughs

## Generated Reference Pages

- [PyMOL binding pocket story reference](../examples/workflow-recipes/pymol-binding-pocket-story/README.md)
- [ChimeraX ligand interaction explainer reference](../examples/workflow-recipes/chimerax-ligand-interaction-explainer/README.md)
