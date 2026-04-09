# AlphaFold Experimental Overlay

Overlay an AlphaFold hemoglobin alpha chain onto the experimental 4HHB tetramer in PyMOL, preserve the assembly context, and export a polished chain-level comparison near the heme pocket.

- App: `pymol`
- Difficulty: `deep-dive`
- Estimated time: `8 minutes`
- Voice mode: `push_to_talk`
- Last verified: `2026-04-04`

## Sample Data
- **Human deoxy hemoglobin tetramer**: ./examples/data/local/4hhb.pdb
- **AlphaFold hemoglobin alpha chain**: ./examples/data/local/af-p69905.pdb

## What Success Looks Like
- The experimental tetramer and AlphaFold alpha-chain model are both loaded in PyMOL.
- The AlphaFold model is aligned to chain A of the experimental tetramer.
- An overview scene, a focused overlay scene, and an exploded comparison scene are all stored.
- A polished overlay export is written successfully.
