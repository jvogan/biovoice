# Verify Cryo-EM Map Fit Review

## Acceptance Checklist
- [ ] The local model and map are both open in ChimeraX.
- [ ] Map fit is executed.
- [ ] Map styles switch between mesh and orthoplanes.
- [ ] Export is saved.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-em-map-fit-demo`
- `npm run smoke:chimerax`
