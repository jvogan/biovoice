# Verify GroEL Cavity Tour

## Acceptance Checklist
- [ ] The GroEL assembly is open and colored cleanly.
- [ ] A named overview view is stored for the full ring.
- [ ] A cavity-focused hero view is stored and exported cleanly.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-groel-cavity-tour`
- `npm run smoke:chimerax`
