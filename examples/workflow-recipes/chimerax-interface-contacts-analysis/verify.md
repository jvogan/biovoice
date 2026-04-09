# Verify Interface or Contacts Analysis

## Acceptance Checklist
- [ ] 4HHB is loaded and the A/B interface is isolated.
- [ ] Contacts or hydrogen bonds are visible.
- [ ] Interface surface and export are complete.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-interface-contacts-analysis`
- `npm run smoke:chimerax`
