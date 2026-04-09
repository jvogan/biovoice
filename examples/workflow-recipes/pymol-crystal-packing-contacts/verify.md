# Verify Crystal Packing Contacts

## Acceptance Checklist
- [ ] 1HSG is loaded and the inhibitor is visible.
- [ ] Symmetry mates are generated around the ligand.
- [ ] Only the local packing shell is emphasized near the inhibitor.
- [ ] A polished packing-contact PNG export is written.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-crystal-packing-contacts`
- `npm run smoke:pymol`
