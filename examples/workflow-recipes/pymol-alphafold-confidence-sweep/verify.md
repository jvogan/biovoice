# Verify AlphaFold Confidence Sweep

## Acceptance Checklist
- [ ] The AlphaFold model is visible in PyMOL with confidence coloring.
- [ ] Low-confidence regions are isolated and emphasized in a close-up view.
- [ ] Overview and detail scenes are stored, and a final export is written.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-alphafold-confidence-sweep`
- `npm run smoke:pymol`
