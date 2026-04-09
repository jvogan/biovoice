# Verify Homolog Alignment Showcase

## Acceptance Checklist
- [ ] Both models are loaded.
- [ ] Matchmaker alignment succeeds.
- [ ] Views move between tiled and aligned states.
- [ ] An export is saved.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-homolog-alignment-showcase`
- `npm run smoke:chimerax`
