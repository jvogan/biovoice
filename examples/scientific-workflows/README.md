# Scientific Workflows

This catalog is the task-first launch layer for AlphaFold and Rosetta work.

If you want a guided newcomer walkthrough first, start with:

- [`docs/tutorial-alphafold.md`](../../docs/tutorial-alphafold.md)
- [`docs/tutorial-rosetta.md`](../../docs/tutorial-rosetta.md)
- [`docs/tutorial-cryo-em.md`](../../docs/tutorial-cryo-em.md)

Use it from the UI `Scientific Launch` rail, or pass the workflow explicitly to the agent start path.

## Common Launch Pattern
- `npm run agent:start -- <pymol|chimerax> --workflow <workflowId> [scientific inputs]`
- Examples: `--uniprot`, `--model`, `--experimental`, `--pae`, `--map`, `--bundle`, `--scorefile`, `--top-n`
- Keep `Push To Talk` as the default until the first clean live turn is complete.

## Validated Local Showcases

These are the strongest local-data rehearsals to run before a live demo or voice session:

- `npm run showcase:pymol:pocket`
- `npm run showcase:pymol:overlay`
- `npm run showcase:pymol:cryo`
- `npm run showcase:pymol:rosetta`
- `npm run showcase:chimerax:pocket`
- `npm run showcase:chimerax:overlay`
- `npm run showcase:chimerax:map`
- `npm run showcase:chimerax:rosetta`

Run `npm run verify:showcases` to rehearse the pocket, AlphaFold, cryo, and Rosetta showcase matrix on both targets.

## AlphaFold Confidence Review

Start from a confidence-colored prediction, isolate uncertain loops, and keep the scene ready for a fast PTT demo.

- Default target: `chimerax`
- Intent: `confidence review`
- Voice starter: Open the local AlphaFold model and color it by confidence.

### Input Hints
- `uniprot`
- `model`
- `pae`

### Ranked Candidate Recipes
- **chimerax**: `chimerax-alphafold-confidence-review` (100) - Best named-view confidence review and loop isolation.
- **pymol**: `pymol-alphafold-confidence-sweep` (98) - Best putty-style confidence sweep and export.

### Launch Example
- `npm run agent:start -- chimerax --workflow alphafold_confidence_review --uniprot P12345 --model ./model.pdb`

### Operator Notes
- Use this when you want the first story beat to be confidence and flexibility.
- Best for a clean overview, a loop close-up, and a high-confidence export.
## AlphaFold vs Experiment Overlay

Overlay a prediction against an experimental structure, preserve assembly context, and move into a focused comparison patch.

- Default target: `chimerax`
- Intent: `prediction versus experiment`
- Voice starter: Open the experimental tetramer and the AlphaFold chain model.

### Input Hints
- `uniprot`
- `model`
- `experimental`

### Ranked Candidate Recipes
- **chimerax**: `chimerax-alphafold-experimental-overlay` (100) - Best overlay handoff with named views.
- **pymol**: `pymol-alphafold-experimental-overlay` (99) - Best chain-level overlay and polished export.

### Launch Example
- `npm run agent:start -- chimerax --workflow alphafold_vs_experiment_overlay --uniprot P12345 --model ./model.pdb`

### Operator Notes
- Use this when the demo needs a direct structural comparison, not just a confidence story.
- The best shots are an assembly overview, an aligned overlay, and a side-by-side comparison.
## AlphaFold Multimer Interface Review

Inspect a multimer interface, surface the contact shell, and keep the comparison anchored while the interface is explained.

- Default target: `chimerax`
- Intent: `interface triage`
- Voice starter: Open the AlphaFold multimer and isolate the interface shell.

### Input Hints
- `uniprot`
- `model`
- `pae`

### Ranked Candidate Recipes
- **chimerax**: `chimerax-interface-contacts-analysis` (100) - Best interface contact, clash, and hbond review.
- **chimerax**: `chimerax-alphafold-confidence-review` (82) - Good fallback for confidence-colored triage.
- **pymol**: `pymol-crystal-packing-contacts` (72) - Useful if the comparison needs a PyMOL-style pocket or packing shell.

### Launch Example
- `npm run agent:start -- chimerax --workflow alphafold_multimer_interface_review --uniprot P12345 --model ./model.pdb`

### Operator Notes
- Use this when the story is about contacts, clashes, or an interface shell inside a prediction.
- The model should stay readable while only the interface becomes the focus.
## AlphaFold PAE-Guided Triage

Use optional PAE input to prioritize uncertain regions and turn them into a short, presentation-ready triage story.

- Default target: `chimerax`
- Intent: `PAE triage`
- Voice starter: Show me the uncertain AlphaFold regions first.

### Input Hints
- `uniprot`
- `model`
- `pae`

### Ranked Candidate Recipes
- **chimerax**: `chimerax-alphafold-confidence-review` (100) - Best confidence triage and named-view summary.
- **pymol**: `pymol-alphafold-confidence-sweep` (96) - Best putty-based uncertain-region sweep.

### Launch Example
- `npm run agent:start -- chimerax --workflow alphafold_pae_guided_triage --uniprot P12345 --model ./model.pdb`

### Operator Notes
- Use this when you want the workflow to surface uncertainty before moving into the overlay.
- The UI should summarize low-confidence regions and keep the rest of the assembly quiet.
## AlphaFold to Cryo Handoff

Move from prediction or confidence review into a cryo-plus-atomic presentation without losing the scene context.

- Default target: `pymol`
- Intent: `cryo handoff`
- Voice starter: Show the cryo map and keep the atomic model visible for the handoff.

### Input Hints
- `experimental`
- `map`
- `pae`

### Ranked Candidate Recipes
- **pymol**: `pymol-cryo-atomic-handoff` (100) - Best cryo-plus-atomic hero story in PyMOL.
- **chimerax**: `chimerax-em-map-fit-demo` (96) - Best map-fit and cutaway handoff in ChimeraX.

### Launch Example
- `npm run agent:start -- pymol --workflow alphafold_to_cryo_handoff --uniprot P12345 --model ./model.pdb`

### Operator Notes
- Use this when the model needs to read against a density map or an assembly cutaway.
- Best for a dense but visually polished before/after handoff.
## Rosetta Scaffold / Design Review

Compare a scaffold against a design candidate, keep the scaffold anchored, and explode the design cleanly for the before/after shot.

- Default target: `pymol`
- Intent: `design review`
- Voice starter: Open the scaffold and design candidate and keep the scaffold quiet.

### Input Hints
- `model`
- `bundle`

### Ranked Candidate Recipes
- **pymol**: `pymol-rosetta-style-design-review` (100) - Best exploded scaffold-versus-design comparison in PyMOL.
- **chimerax**: `chimerax-rosetta-style-design-review` (98) - Best semantic-handle design review in ChimeraX.

### Launch Example
- `npm run agent:start -- pymol --workflow rosetta_scaffold_design_review --bundle ./bundle --scorefile ./score.sc --top-n 5`

### Operator Notes
- Use this for scaffold-versus-design storytelling with strong semantic handles.
- Best when the key question is what changed in the remodeled shell.
## Rosetta Interface Packing Review

Focus on interface contacts, packing, clashes, and residue neighborhoods before the final export.

- Default target: `chimerax`
- Intent: `interface packing`
- Voice starter: Show the interface contacts and clashes around the design patch.

### Input Hints
- `bundle`
- `scorefile`
- `topN`

### Ranked Candidate Recipes
- **chimerax**: `chimerax-interface-contacts-analysis` (100) - Best contacts, clashes, and hbond interface analysis.
- **pymol**: `pymol-crystal-packing-contacts` (92) - Best packing-shell and contact storytelling in PyMOL.
- **chimerax**: `chimerax-rosetta-style-design-review` (86) - Best if you want the interface review folded into the scaffold/design story.

### Launch Example
- `npm run agent:start -- chimerax --workflow rosetta_interface_packing_review --bundle ./bundle --scorefile ./score.sc --top-n 5`

### Operator Notes
- Use this when the science story is about interaction quality, not just a static overlay.
- Best for packed interfaces, contacts, and clash cleanup.
## Rosetta Ligand Redesign Review

Tell a ligand-pocket redesign story with the pocket bright, the scaffold subdued, and the remodeled shell clearly visible.

- Default target: `pymol`
- Intent: `ligand redesign`
- Voice starter: Keep the ligand bright and show only the redesigned shell.

### Input Hints
- `model`
- `bundle`
- `scorefile`

### Ranked Candidate Recipes
- **pymol**: `pymol-binding-pocket-story` (100) - Best pocket storytelling and ligand emphasis.
- **pymol**: `pymol-rosetta-style-design-review` (90) - Best if the redesign is part of a broader scaffold overlay.
- **chimerax**: `chimerax-interface-contacts-analysis` (75) - Good contact cleanup when the ligand pocket is part of a larger interface.

### Launch Example
- `npm run agent:start -- pymol --workflow rosetta_ligand_redesign_review --bundle ./bundle --scorefile ./score.sc --top-n 5`

### Operator Notes
- Use this when the design is centered on a binding site or catalytic pocket.
- Best for a pocket hero shot, interaction shell, and polished export.
## Rosetta Top-Design Compare

Rank the top designs, load the winners, and move between the overview and the best-scoring comparison shot.

- Default target: `pymol`
- Intent: `top design compare`
- Voice starter: Rank the top designs and open the best-scoring candidates.

### Input Hints
- `bundle`
- `scorefile`
- `topN`

### Ranked Candidate Recipes
- **pymol**: `pymol-rosetta-style-design-review` (100) - Best design-versus-scaffold compare in PyMOL.
- **chimerax**: `chimerax-rosetta-style-design-review` (98) - Best if you want named views and interface handoff in ChimeraX.
- **pymol**: `pymol-two-structure-comparison` (84) - Useful fallback for a plain structural compare when design metadata is limited.

### Launch Example
- `npm run agent:start -- pymol --workflow rosetta_top_design_compare --bundle ./bundle --scorefile ./score.sc --top-n 5`

### Operator Notes
- Use this when the input bundle already contains multiple candidates and the best one is not obvious.
- Best for scorefile-driven review and side-by-side design comparison.
