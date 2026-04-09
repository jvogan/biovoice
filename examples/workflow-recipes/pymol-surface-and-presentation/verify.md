# Verify Surface and Presentation View

## Acceptance Checklist
- [ ] 4HHB is loaded with chain-aware colors.
- [ ] Surface and cartoon are both visible.
- [ ] Chain labels and background settings are applied.
- [ ] Presentation export is saved.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-surface-and-presentation`
- `npm run smoke:pymol`
