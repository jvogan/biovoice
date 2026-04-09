# Verify Selection and Storyboarding

## Acceptance Checklist
- [ ] Named selections exist for chains, catalytic residues, and ligand shell.
- [ ] Each storyboard stop is visible and stored as a scene.
- [ ] The final storyboard close-up can be recalled and exported cleanly.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-selection-and-storyboarding`
- `npm run smoke:pymol`
