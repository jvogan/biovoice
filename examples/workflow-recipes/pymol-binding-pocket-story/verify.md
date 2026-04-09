# Verify Binding Pocket Story

## Acceptance Checklist
- [ ] 1HSG is loaded into PyMOL.
- [ ] Protein is cartoon, inhibitor is sticks, and chains are colored distinctly.
- [ ] Catalytic contacts are labeled and a transparent pocket surface is visible.
- [ ] A hero PNG export is written successfully.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe pymol-binding-pocket-story`
- `npm run smoke:pymol`
