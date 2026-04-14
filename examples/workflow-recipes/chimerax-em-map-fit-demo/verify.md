# Verify Cryo-EM Map Fit Review

## Acceptance Checklist
- [ ] The local model and map are both open in ChimeraX.
- [ ] A global mesh overview is stored.
- [ ] Map fit executes and the fitted overview is stored.
- [ ] Orthoplane inspection appears briefly and exits cleanly.
- [ ] A local heme-focused mesh hero is exported.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-em-map-fit-demo`
- `npm run smoke:chimerax`
