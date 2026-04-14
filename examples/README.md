# BioVoice Examples Library

This directory is the generated reference library for the PyMOL and ChimeraX BioVoice console.

If you are new to the project, start with the hand-authored guides first:

- [`docs/getting-started.md`](../docs/getting-started.md)
- [`docs/first-live-session.md`](../docs/first-live-session.md)
- [`docs/tutorial-alphafold.md`](../docs/tutorial-alphafold.md)
- [`docs/tutorial-rosetta.md`](../docs/tutorial-rosetta.md)

## Structure
- `start-here/`: concise operator quick reference
- `scientific-workflows/`: task-first AlphaFold and Rosetta launch catalog
- `workflow-recipes/`: full demo workflows for both apps
- `prompt-library/`: curated utterance packs and follow-up prompts
- `tool-playbooks/`: what the structured tool surface can do
- `troubleshooting/`: speech, ambiguity, and export recovery
- `gallery/`: demo ideas and operator-facing hero shots

## Workflow Recipes
- `pymol-binding-pocket-story` | **Binding Pocket Story** | Load a ligand-bound structure, style the protein and ligand, measure the pocket, and save a polished active-site view.
- `pymol-two-structure-comparison` | **Two-Structure Comparison** | Load open and closed adenylate kinase conformations, align them, isolate the mobile lid, and store paired scenes.
- `pymol-map-and-model-walkthrough` | **Map and Model Walkthrough** | Generate a synthetic density map around a structure, contour it as mesh or surface, and walk between full-model and pocket views.
- `pymol-surface-and-presentation` | **Surface and Presentation View** | Build a presentation-ready surface rendering with stylized colors, labels, and an export shot.
- `pymol-selection-and-storyboarding` | **Selection and Storyboarding** | Create named selections for chains, residue spans, and ligand neighborhoods, then step through them as a storyboard.
- `pymol-alphafold-confidence-sweep` | **AlphaFold Confidence Sweep** | Open a local AlphaFold model in PyMOL, color it by confidence, isolate uncertain regions, and export a polished confidence-focused still.
- `pymol-alphafold-experimental-overlay` | **AlphaFold Experimental Overlay** | Overlay an AlphaFold hemoglobin alpha chain onto the experimental 4HHB tetramer in PyMOL, preserve the assembly context, and export a polished chain-level comparison near the heme pocket.
- `pymol-crystal-packing-contacts` | **Crystal Packing Contacts** | Expand crystallographic symmetry around a ligand-bound structure, isolate the packing shell near the inhibitor, and export a polished packing-contact still.
- `pymol-cryo-atomic-handoff` | **Cryo-Atomic Handoff** | Load a local cryo-EM hemoglobin model and map in PyMOL, show the fitted atomic model against the density, focus a heme neighborhood, and export a polished cutaway still.
- `chimerax-ligand-interaction-explainer` | **Ligand Interaction Explainer** | Load a ligand-bound structure in ChimeraX, build a transparent pocket surface, and compute hydrogen bonds and clashes around the ligand.
- `chimerax-homolog-alignment-showcase` | **Homolog Alignment Showcase** | Open open and closed adenylate kinase conformers in ChimeraX, align them with matchmaker, tile and compare views, and store a presentation export.
- `chimerax-alphafold-confidence-review` | **AlphaFold Confidence Review** | Open an AlphaFold model, color by confidence, isolate flexible loops, and export a confidence-focused figure.
- `chimerax-alphafold-experimental-overlay` | **AlphaFold Experimental Overlay** | Open the experimental 4HHB tetramer and an AlphaFold hemoglobin alpha chain in ChimeraX, preserve a full-assembly view, then move into a chain-level overlay near the heme site and export the comparison.
- `chimerax-biological-assembly-tour` | **Biological Assembly Tour** | Open a local cryo-EM hemoglobin model, expand the biological assembly, store named views for the overview and hero frame, and export the final assembly still.
- `chimerax-assembly-interface-handoff` | **Assembly-To-Interface Handoff** | Start from a biological assembly overview, transition into a chain-level interface analysis, and finish on a polished interface hero view with saved named cameras.
- `chimerax-hemoglobin-structural-handoff` | **Hemoglobin Structural Handoff** | Tell a paper-like hemoglobin story in ChimeraX: start from the experimental 8WJ1 tetramer, align an AlphaFold alpha chain to chain A, move into the heme neighborhood, then hand off into the EMD-37575 cryo map and end on a fitted local hero.
- `chimerax-em-map-fit-demo` | **Cryo-EM Map Fit Review** | Open a real local cryo-EM hemoglobin map with its fitted model, review the global fit, inspect orthoplanes briefly, move into a heme-centered local cutaway, and export a polished mesh-based hero still.
- `chimerax-groel-cavity-tour` | **GroEL Cavity Tour** | Open the GroEL chaperonin in ChimeraX, color its domain architecture, move into a cavity cutaway, and export a polished large-assembly still.
- `chimerax-interface-contacts-analysis` | **Interface or Contacts Analysis** | Open a multichain complex, isolate an interface, compute contacts and hydrogen bonds, and export the interface view.
## Guided Tutorials
- `pymol-rosetta-style-design-review` | **Rosetta-Style Design Review** | Review a scaffold-versus-design comparison in PyMOL with semantic handles, changed-shell emphasis, and an exploded side-by-side export.
- `chimerax-rosetta-style-design-review` | **Rosetta-Style Design Review** | Review a scaffold-versus-design comparison in ChimeraX with semantic handles, remodeled-shell emphasis, exploded transforms, and a polished export.

Every workflow recipe directory ships with:
- `README.md`
- `prompts.md`
- `recipe.md`
- `verify.md`
- `adapters/<tool>.md`
- `assets/data-manifest.json`
- `assets/transcript.md`
- `assets/captures.md`
