# Verify AlphaFold Experimental Overlay

## Acceptance Checklist
- [ ] The experimental tetramer and AlphaFold chain are both open in ChimeraX.
- [ ] The AlphaFold chain is aligned to experimental chain A.
- [ ] Named views exist for the assembly overview, the overlay focus, and the exploded comparison.
- [ ] A polished overlay export is written successfully.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-alphafold-experimental-overlay`
- `npm run smoke:chimerax`
