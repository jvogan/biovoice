# Verify Hemoglobin Structural Handoff

## Acceptance Checklist
- [ ] The experimental tetramer and AlphaFold alpha chain are both open in ChimeraX.
- [ ] The AlphaFold chain is aligned to experimental chain A.
- [ ] The local heme-adjacent comparison is stored as a named view.
- [ ] The cryo map opens, the fitted overview is stored, and orthoplane inspection exits cleanly.
- [ ] A polished local cryo hero is exported from the final handoff.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-hemoglobin-structural-handoff`
- `npm run smoke:chimerax`
