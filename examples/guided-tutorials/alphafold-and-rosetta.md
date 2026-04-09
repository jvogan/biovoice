# AlphaFold and Rosetta Demo Ideas

This stack already supports strong **AlphaFold** and **Rosetta-style** demos even without a bespoke AlphaFold or Rosetta runtime integration.

The core rule is simple:

- Use **Realtime voice** to direct the workflow live.
- Use the structured desktop actions to inspect, compare, measure, and export.
- Treat AlphaFold or Rosetta outputs as structural inputs, not a separate UI layer.

## Strong AlphaFold demos

### 1. Confidence triage

Best in:

- `PyMOL` for confidence-colored putty plus clean loop close-ups
- `ChimeraX` for confidence coloring, named views, and interface/contact overlays

Use when:

- you want to explain which regions are trustworthy
- you want a clean before-and-after between overview and flexible loop
- you want an export-ready still for slides or a paper talk

Built-in starting points:

- `pymol-alphafold-confidence-sweep`
- `chimerax-alphafold-confidence-review`

### 2. AlphaFold vs experiment overlay

Best in:

- `PyMOL` for tight structural overlays and curated publication stills
- `ChimeraX` for global view + close-up handoff with named cameras

Use when:

- you want to compare a prediction against an experimental structure
- you want to highlight flexible loops, termini, or domain shifts
- you want to separate confident backbone agreement from uncertain local detail

Minimal workflow:

1. Load the AlphaFold model and the experimental structure.
2. Align them with `super`, `cealign`, `matchmaker`, or `align`.
3. Color the prediction by confidence.
4. Save one global overlay view and one flexible-region close-up.
5. Export both.

Built-in starting points:

- `pymol-alphafold-experimental-overlay`
- `chimerax-alphafold-experimental-overlay`

### 3. AlphaFold multimer interface review

Best in:

- `ChimeraX`

Use when:

- you want to inspect an AlphaFold multimer interface
- you want hydrogen bonds, contacts, clashes, or a clean interface cutaway
- you want a demo that feels closer to real structural biology triage

Good voice asks:

- “Open the AlphaFold multimer, isolate the A/B interface, compute contacts, and save a clean hero view.”
- “Color by confidence, then highlight only the uncertain interface shell.”

### 4. AlphaFold to cryo handoff

Best in:

- `ChimeraX` first
- `PyMOL` as a lighter presentation follow-up

Use when:

- you want to compare a predicted model against a cryo map
- you want to show map fit quality, then move into a local loop or cofactor neighborhood

The existing cryo and map-fit workflows are a good base for this.

## Strong Rosetta-style demos

The useful Rosetta story here is usually **review**, not Rosetta execution itself.

This stack is good for:

- designed model vs starting scaffold comparison
- redesigned shell or hotspot inspection
- interface packing review
- ligand redesign or binding-pocket comparison
- confidence or geometry cleanup before sharing a figure

### 1. Designed vs starting scaffold

Best in:

- `PyMOL`

Use when:

- you want to compare a Rosetta output against the starting backbone
- you want aligned global and local scenes
- you want to isolate just the changed shell or redesigned region

Good voice asks:

- “Align the designed model to the starting scaffold and show only residues within five angstroms of the redesigned shell.”
- “Store a global overlay and then a close-up around the changed pocket.”

### 2. Interface design review

Best in:

- `ChimeraX`

Use when:

- you want contacts, clashes, hydrogen bonds, and an interface surface
- you want a strong before/after export for protein-protein design work

Good voice asks:

- “Open the designed complex, isolate the interface, compute clashes and hbonds, and save the cleanest interface view.”
- “Keep the scaffold subdued and highlight only the redesigned interface patch.”

### 3. Ligand-design review

Best in:

- `PyMOL` for pocket storytelling
- `ChimeraX` for contact cleanup and interaction overlays

Use when:

- you want to compare a redesigned binding site against the original
- you want pocket stills that read well on camera

Good voice asks:

- “Keep the ligand bright, quiet the scaffold, and show only the redesigned shell in sticks.”
- “Measure the new catalytic geometry and save a publication-style pocket frame.”

## Natural-language naming that makes voice control work better

The voice layer now classifies loaded structures into semantic handles such as:

- `whole complex`
- `full assembly`
- `experimental model`
- `predicted model`
- `reference model`
- `scaffold`
- `binder`
- `receptor`
- `map`
- `ligand context`

It can infer many of these from the loaded scene, but descriptive object or model names make the resolution much more reliable for real user data.

Recommended naming patterns when you load your own structures:

- `exp_complex`, `experimental_tetramer`, `reference_pdb`
- `af_prediction`, `alphafold_chainA`, `predicted_model`
- `wt_scaffold`, `native_scaffold`, `starting_backbone`
- `rosetta_design_v1`, `design_variant_03`
- `binder_model`, `minibinder_v2`, `fab_partner`
- `emd_map`, `cryo_map`, `density_map`

That lets you say things like:

- “Hide the binder and center on the scaffold.”
- “Pull the predicted model fifteen angstroms to the right for a side-by-side overlay.”
- “Rotate the binder around its own center without moving the receptor.”
- “Show only the ligand context around the experimental model.”
- “Align the predicted model to chain A of the experimental model.”

## Real voice workflows for complex movement and comparison

These are the kinds of natural-language requests the current tool layer is meant to support directly:

### PyMOL

- “Move the whole complex a little left and rotate the prediction away from the scaffold.”
- “Pull the AlphaFold model out of the tetramer so I can explain it separately, then zoom back to the heme site.”
- “Hide the binder, focus the scaffold, then bring the binder back and show only interface residues within five angstroms.”
- “Rotate the designed partner around its own center and export a clean side-by-side comparison.”

### ChimeraX

- “Turn only the binder around its own center and keep the receptor fixed.”
- “Move the predicted chain to the right, save that exploded view, then recall the interface close-up.”
- “Keep the whole assembly visible, but isolate the A/B interface and calculate contacts before exporting.”
- “Show the cryo map, then move the atomic model into a cutaway-friendly frame without losing the named overview.”

## Practical setup for user data

If you already have AlphaFold or Rosetta outputs, the lowest-friction path is:

1. Put the model files somewhere local.
2. Launch the target app and the voice console.
3. Load the files by path with the local target actions or adapt one of the built-in recipes.
4. Rehearse with the non-voice flow first.
5. Run the live voice take once the framing and selections are stable.

Useful commands from this repo:

```bash
npm run launch:pymol
npm run launch:chimerax
npm run showcase:pymol:overlay
npm run showcase:chimerax:overlay
npm run agent:start -- pymol --offline --clean-target --recipe pymol-alphafold-experimental-overlay
npm run agent:start -- chimerax --offline --clean-target --recipe chimerax-alphafold-experimental-overlay
npm run rehearse:workflow -- pymol-cryo-atomic-handoff --target pymol --capture
npm run rehearse:workflow -- chimerax-groel-cavity-tour --target chimerax --capture
```

## Recommendation

For polished demos:

- Use **AlphaFold** when you want confidence, flexibility, prediction-vs-experiment, or multimer triage.
- Use **Rosetta-style review** when you want design deltas, interface packing, ligand redesign, or scaffold comparison.
- Use **ChimeraX** for map/interface/contact-heavy stories.
- Use **PyMOL** for pocket storytelling, editorial stills, and clean scene choreography.
