# Verify Cryo-Atomic Handoff

## Acceptance Checklist
- [ ] The local model and cryo-EM map are loaded into PyMOL.
- [ ] The atomic model and a contoured density view are visible together.
- [ ] A heme-centered cutaway scene is stored and exported cleanly.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-cryo-atomic-handoff`
- `npm run smoke:pymol`
