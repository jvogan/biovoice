# AlphaFold Confidence Sweep Workflow

## Step 1: Load the AlphaFold model and establish the confidence overview.

**Suggested voice request:** Open the local AlphaFold structure, switch to a confidence-aware putty representation, and store an overview scene.

Open the local AlphaFold structure, switch to a confidence-aware putty representation, and store an overview scene.

Checkpoints:
- The AlphaFold model is visible in cartoon putty mode.
- Scene F10 stores the confidence-colored overview.

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
- `delete af_q9h255`
- `load "./examples/data/local/af-q9h255.pdb", af_q9h255`
- `hide everything, all`
- `show cartoon, af_q9h255`
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
- `cartoon putty, polymer.protein`
- `spectrum b, red_yellow_green_cyan_blue, polymer.protein`
- `center af_q9h255`
- `orient af_q9h255`
- `turn y, 14`
- `turn x, 8`
- `zoom af_q9h255, 10`
- `scene F10, store, AlphaFold confidence overview`

## Step 2: Isolate and frame the uncertain regions.

**Suggested voice request:** Create a reusable selection for low-confidence residues, emphasize them, and store a close-up scene.

Create a reusable selection for low-confidence residues, emphasize them, and store a close-up scene.

Checkpoints:
- Low-confidence residues are selected and emphasized as sticks.
- Scene F11 stores the flexible-region close-up.

Direct command equivalents:
- `select low_confidence, af_q9h255 and polymer.protein and b < 70`
- `show sticks, low_confidence`
- `color tv_orange, low_confidence`
- `hide labels, low_confidence and name CA`
- `center low_confidence`
- `orient low_confidence`
- `turn y, 12`
- `turn x, 6`
- `zoom low_confidence, 8`
- `scene F11, store, Low-confidence region close-up`

## Step 3: Recall the close-up and export the final confidence still.

**Suggested voice request:** Return to the flexible-region close-up, polish the presentation preset, and export the final figure.

Return to the flexible-region close-up, polish the presentation preset, and export the final figure.

Checkpoints:
- The close-up scene is recalled cleanly.
- A confidence-focused PNG export exists.

Direct command equivalents:
- `scene F11, recall`
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
- `png "./output/doc-exports/pymol-alphafold-confidence-sweep-export-confidence-shot.png", width=2200, height=1500, dpi=350, ray=1`
