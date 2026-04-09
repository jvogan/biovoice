# AlphaFold Experimental Overlay Workflow

## Step 1: Load the tetramer and the AlphaFold chain, then establish the overview.

**Suggested voice request:** Start from a clean PyMOL workspace, load 4HHB plus the AlphaFold alpha chain, and store an assembly-first overview before the overlay.

Start from a clean PyMOL workspace, load 4HHB plus the AlphaFold alpha chain, and store an assembly-first overview before the overlay.

Checkpoints:
- The experimental tetramer is visible with chain A emphasized.
- The AlphaFold chain is loaded and visible as a separate overlay object.
- Scene F15 stores the clean assembly overview.

Direct command equivalents:
- `delete all`
- `scene *, clear`
- `bg_color gray99`
- `set ray_opaque_background, off`
- `set orthoscopic, on`
- `set depth_cue, 0`
- `set ray_shadows, 0`
- `set antialias, 2`
- `set antialias_shader, 2`
- `set specular, 0.15`
- `set specular_intensity, 0.2`
- `set spec_direct, 0`
- `set ambient, 0.22`
- `set direct, 0.48`
- `set two_sided_lighting, 1`
- `set cartoon_fancy_helices, 1`
- `set cartoon_flat_sheets, 1`
- `set cartoon_smooth_loops, 1`
- `set stick_radius, 0.16`
- `set surface_quality, 2`
- `set valence, 0`
- `set label_color, gray20`
- `set label_size, 18`
- `set label_outline_color, gray98`
- `set dash_color, gray45`
- `set dash_radius, 0.05`
- `set dash_gap, 0.18`
- `delete hb_exp`
- `load "./examples/data/local/4hhb.pdb", hb_exp`
- `delete hb_af_alpha`
- `load "./examples/data/local/af-p69905.pdb", hb_af_alpha`
- `hide everything, all`
- `show cartoon, hb_exp and polymer.protein`
- `show sticks, hb_exp and organic`
- `show cartoon, hb_af_alpha and polymer.protein`
- `color gray85, hb_exp and polymer.protein`
- `color deepteal, hb_exp and chain A and polymer.protein`
- `color tv_orange, hb_exp and organic`
- `color hotpink, hb_af_alpha and polymer.protein`
- `set cartoon_transparency, 0.55, hb_exp and polymer.protein and not chain A`
- `bg_color gray99`
- `set ray_opaque_background, off`
- `set orthoscopic, on`
- `set depth_cue, 0`
- `set ray_shadows, 0`
- `set antialias, 2`
- `set antialias_shader, 2`
- `set specular, 0.15`
- `set specular_intensity, 0.2`
- `set spec_direct, 0`
- `set ambient, 0.22`
- `set direct, 0.48`
- `set two_sided_lighting, 1`
- `set cartoon_fancy_helices, 1`
- `set cartoon_flat_sheets, 1`
- `set cartoon_smooth_loops, 1`
- `set stick_radius, 0.16`
- `set surface_quality, 2`
- `set valence, 0`
- `set label_color, gray20`
- `set label_size, 18`
- `set label_outline_color, gray98`
- `set dash_color, gray45`
- `set dash_radius, 0.05`
- `set dash_gap, 0.18`
- `set cartoon_transparency, 0.04`
- `set stick_radius, 0.13`
- `set label_size, 16`
- `set dash_radius, 0.04`
- `center hb_exp and polymer.protein`
- `orient hb_exp and polymer.protein`
- `turn y, 14`
- `turn x, 8`
- `zoom hb_exp and polymer.protein, 11`
- `scene F15, store, Experimental tetramer overview`

## Step 2: Align the prediction to chain A and focus the heme-adjacent comparison patch.

**Suggested voice request:** Align the AlphaFold chain to experimental chain A, spotlight the heme neighborhood, and store a crisp comparison scene with labels.

Align the AlphaFold chain to experimental chain A, spotlight the heme neighborhood, and store a crisp comparison scene with labels.

Checkpoints:
- The AlphaFold model is aligned to chain A.
- The heme-adjacent comparison patch is visible as sticks.
- Scene F16 stores the chain-level overlay.

Direct command equivalents:
- `cealign hb_af_alpha and polymer.protein, hb_exp and chain A and polymer.protein`
- `select compare_patch, byres (hb_exp and chain A within 6 of organic)`
- `show sticks, compare_patch`
- `label hb_exp and chain A and resi 58 and name CA, "His58"`
- `label hb_exp and chain A and resi 87 and name CA, "His87"`
- `center compare_patch or hb_af_alpha or hb_exp and chain A`
- `orient compare_patch or hb_af_alpha or hb_exp and chain A`
- `turn y, 12`
- `turn x, 6`
- `zoom compare_patch or hb_af_alpha or hb_exp and chain A, 8`
- `scene F16, store, AlphaFold overlay around chain A`

## Step 3: Pull the prediction aside for an exploded comparison shot.

**Suggested voice request:** Translate and rotate the AlphaFold model away from the tetramer so the scientist can explain the prediction separately before returning to the overlay.

Translate and rotate the AlphaFold model away from the tetramer so the scientist can explain the prediction separately before returning to the overlay.

Checkpoints:
- The AlphaFold model is offset from the tetramer for a readable side-by-side comparison.
- Scene F17 stores the exploded comparison view.

Direct command equivalents:
- `translate [18,0,0], all, -1, 1`
- `rotate y, 24, all, -1, 1`
- `center hb_exp and chain A or hb_af_alpha or organic`
- `orient hb_exp and chain A or hb_af_alpha or organic`
- `turn y, 12`
- `turn x, 6`
- `zoom hb_exp and chain A or hb_af_alpha or organic, 11`
- `scene F17, store, Exploded prediction-versus-experiment comparison`

## Step 4: Recall the comparison scene and export the final figure.

**Suggested voice request:** Return to the exploded comparison, strengthen the editorial comparison preset, and export a high-resolution figure for the demo.

Return to the exploded comparison, strengthen the editorial comparison preset, and export a high-resolution figure for the demo.

Checkpoints:
- The stored exploded comparison scene is recalled cleanly.
- A high-resolution predicted-versus-experimental PNG export exists.

Direct command equivalents:
- `scene F17, recall`
- `bg_color gray99`
- `set ray_opaque_background, off`
- `set orthoscopic, on`
- `set depth_cue, 0`
- `set ray_shadows, 0`
- `set antialias, 2`
- `set antialias_shader, 2`
- `set specular, 0.15`
- `set specular_intensity, 0.2`
- `set spec_direct, 0`
- `set ambient, 0.22`
- `set direct, 0.48`
- `set two_sided_lighting, 1`
- `set cartoon_fancy_helices, 1`
- `set cartoon_flat_sheets, 1`
- `set cartoon_smooth_loops, 1`
- `set stick_radius, 0.16`
- `set surface_quality, 2`
- `set valence, 0`
- `set label_color, gray20`
- `set label_size, 18`
- `set label_outline_color, gray98`
- `set dash_color, gray45`
- `set dash_radius, 0.05`
- `set dash_gap, 0.18`
- `set cartoon_transparency, 0.04`
- `set stick_radius, 0.13`
- `set label_size, 16`
- `set dash_radius, 0.04`
- `set cartoon_transparency, 0.08`
- `set stick_radius, 0.15`
- `set dash_gap, 0.2`
- `png "./output/doc-exports/pymol-alphafold-experimental-overlay-export-overlay-figure.png", width=2600, height=1700, dpi=350, ray=1`
