# Hemoglobin Structural Handoff

Tell a paper-like hemoglobin story in ChimeraX: start from the experimental 8WJ1 tetramer, align an AlphaFold alpha chain to chain A, move into the heme neighborhood, then hand off into the EMD-37575 cryo map and end on a fitted local hero.

- App: `chimerax`
- Difficulty: `deep-dive`
- Estimated time: `10 minutes`
- Voice mode: `push_to_talk`
- Last verified: `2026-04-04`

## Sample Data
- **Human oxy hemoglobin cryo-EM model**: ./examples/data/local/8wj1.cif
- **AlphaFold hemoglobin alpha chain**: ./examples/data/local/af-p69905.pdb
- **Human oxy hemoglobin cryo-EM map**: ./examples/data/local/emd_37575.map

## What Success Looks Like
- The experimental tetramer and AlphaFold alpha chain are both open in ChimeraX.
- The AlphaFold chain is aligned to experimental chain A.
- The local heme-adjacent comparison is stored as a named view.
- The cryo map opens, the fitted overview is stored, and orthoplane inspection exits cleanly.
- A polished local cryo hero is exported from the final handoff.
