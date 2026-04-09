# Verify Biological Assembly Tour

## Acceptance Checklist
- [ ] The local cryo-EM hemoglobin model is open.
- [ ] The biological assembly view is generated and stored.
- [ ] A polished hero view is recalled and exported cleanly.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-biological-assembly-tour`
- `npm run smoke:chimerax`
