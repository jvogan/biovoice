# Verify Map and Model Walkthrough

## Acceptance Checklist
- [ ] 1UBQ is loaded.
- [ ] A gaussian map has been generated.
- [ ] A mesh or surface contour is visible near the selected region.
- [ ] Scene transitions between overview and focus views are stored.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-map-and-model-walkthrough`
- `npm run smoke:pymol`
