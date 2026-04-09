# Verify Rosetta-Style Design Review

## Acceptance Checklist
- [ ] The scaffold and design surrogate are both loaded with semantic roles.
- [ ] The design is aligned onto the scaffold and the remodeled shell is emphasized.
- [ ] An exploded comparison scene moves only the design candidate, not the whole camera.
- [ ] A polished PNG export is written successfully.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-rosetta-style-design-review`
- `npm run smoke:pymol`
