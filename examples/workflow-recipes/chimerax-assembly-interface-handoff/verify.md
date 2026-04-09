# Verify Assembly-To-Interface Handoff

## Acceptance Checklist
- [ ] The biological assembly overview is saved as a named view.
- [ ] The A/B interface is isolated with contacts or hydrogen bonds visible.
- [ ] A focused interface hero view is saved and exported.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-assembly-interface-handoff`
- `npm run smoke:chimerax`
