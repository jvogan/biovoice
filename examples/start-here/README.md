# Operator Quick Reference

If you are brand new to BioVoice, start with [`docs/getting-started.md`](../../docs/getting-started.md).

This page is the compact reference for operators who already know the basics and want the shortest path back to a working demo.

## Blessed Paths
Human-first:
- `npm run quickstart:pymol`
- `npm run quickstart:chimerax`
Agent-first:
- `npm run agent:start -- pymol`
- `npm run agent:start -- chimerax`
- `npm run agent:start -- pymol --workflow alphafold_confidence_review --uniprot P12345`
- `npm run agent:start -- chimerax --workflow alphafold_vs_experiment_overlay --uniprot P69905 --experimental-pdb-id 4HHB --structure-format pdb`
- `npm run agent:start -- pymol --workflow alphafold_to_cryo_handoff --uniprot P69905 --experimental-pdb-id 4HHB --emdb-id EMD-1234`
- `npm run agent:start -- chimerax --workflow rosetta_top_design_compare --bundle ./design-bundle --scorefile ./score.sc --top-n 5`

## Minimum Setup
1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` if you plan to use live voice.
3. Pull local demo assets with `npm run prepare:data`.

## Rehearse Without Voice
1. Start with `npm run quickstart:pymol` or `npm run quickstart:chimerax`.
2. Open `Settings` → `Workflows`. Scientific cards provide `Dry run` and `Run`; recipe cards provide `Run`.
3. For a fully non-mutating check, run `npm run rehearse:workflow -- <workflowId|recipeId> --target <pymol|chimerax> --dry-run`.
4. Add `--capture` to a terminal rehearsal when you also want a local viewport image.

## First Live Voice Test
1. Confirm `OPENAI_API_KEY` is set in `.env`.
2. Start with `npm run quickstart:pymol` or `npm run quickstart:chimerax`. Do not use audience mode for the first live test.
3. In the app, stay in `Push To Talk`.
4. Use the first line from the recipe `Voice Pack` before freestyle speech.
5. For AlphaFold, Rosetta, or variant-review tasks, choose a scientific workflow card first so the right workflow and inputs are already pinned.
6. Switch to `Always On` only after one clean turn in a quiet room.

## Cost And Silence
- Realtime billing is per response and input-transcription turn, not for simply keeping the connection open.
- Idle silence by itself is not billed.
- Open-mic or VAD can still create billable turns if ambient speech is committed and a response is triggered.
- Leave idle auto-sleep on for normal use.

## First Recipes To Try
- **Binding Pocket Story**: Open 1HSG and make it presentation-ready.
- **Two-Structure Comparison**: Compare open and closed adenylate kinase by voice.
- **Map and Model Walkthrough**: Generate a synthetic map from 1UBQ and contour it.
- **Surface and Presentation View**: Turn 4HHB into a clean surface presentation view.

## Scientific Workflow Cards
- Open `Settings` → `Workflows` in the full console to start from the scientific task instead of the target app.
- For AlphaFold confidence or overlay stories, pin `--uniprot`, `--model`, and optionally `--pae`.
- For Rosetta review stories, pin `--bundle`, `--scorefile`, and optionally `--top-n`.
- For variant environment reviews, pin `--model` or `--uniprot` plus one or more `--mutation` values such as `A:H58Y`.
- The same flags work with the agent path: `npm run agent:start -- <pymol|chimerax> --workflow <workflowId> ...`.

## Bring Your Own Files
- AlphaFold: local `.pdb` or `.cif`, optional PAE JSON, optional experimental structure, optional map.
- Rosetta: bundle directory, candidate models, `score.sc`, and an optional reference scaffold.
- Variant review: a local model or UniProt accession, explicit mutation sites, and optional comparison structure or ligand code.

## Demo Controls
- `Space`: push to talk
- `Cancel Turn`: clears the current audio buffer
- `Pause Mic (keep session)`: stop accepting new audio without ending the session
- `Disconnect (end session)`: close the live Realtime session completely
- `Mute Voice Output`: keep visual execution but silence spoken confirmations
- `Audience Clean Mode`: focus the screen on the signal well and timeline
