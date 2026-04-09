# Verify AlphaFold Confidence Review

## Acceptance Checklist
- [ ] AlphaFold model opens successfully.
- [ ] Confidence coloring is applied.
- [ ] Flexible loops are isolated and framed.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-alphafold-confidence-review`
- `npm run smoke:chimerax`
