# Verify Ligand Interaction Explainer

## Acceptance Checklist
- [ ] 1HSG is open in ChimeraX.
- [ ] Ligand and pocket surface are visible.
- [ ] Hydrogen bonds and clash/contact analysis are displayed.

## Failure Cases To Watch
- Chain or residue identifiers are misheard and the wrong region is selected.
- Export paths collide with existing files without confirmation.
- The target process is disconnected or the remote-control port is unavailable.

## Suggested Commands
- `npm run verify:examples -- --recipe chimerax-ligand-interaction-explainer`
- `npm run smoke:chimerax`
