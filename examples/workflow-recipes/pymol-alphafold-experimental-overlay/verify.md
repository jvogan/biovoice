# Verify AlphaFold Experimental Overlay

## Acceptance Checklist
- [ ] The experimental tetramer and AlphaFold alpha-chain model are both loaded in PyMOL.
- [ ] The AlphaFold model is aligned to chain A of the experimental tetramer.
- [ ] An overview scene, a focused overlay scene, and an exploded comparison scene are all stored.
- [ ] A polished overlay export is written successfully.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-alphafold-experimental-overlay`
- `npm run smoke:pymol`
