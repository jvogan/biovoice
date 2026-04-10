# Surface and Presentation View Workflow

## Step 1: Load hemoglobin and apply distinct chain colors.

**Suggested voice request:** Open the structure, show cartoons, and color each chain cleanly.

Open the structure, show cartoons, and color each chain cleanly.

Checkpoints:
- Hemoglobin is visible as cartoon with heme groups shown.

Direct command equivalents:
- `reinitialize`
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
- `delete 4hhb`
- `load "./examples/data/local/4hhb.pdb", 4hhb`
- `hide everything, all`
- `show cartoon, 4hhb`
- `show sticks, heme`
- `util.cbc polymer.protein`
- `util.cnc heme`

## Step 2: Add the surface and place chain labels.

**Suggested voice request:** Wrap a transparent surface over the tetramer and label each chain center.

Wrap a transparent surface over the tetramer and label each chain center.

Checkpoints:
- Surface and labels are visible on a white background.

Direct command equivalents:
- `show surface, polymer.protein`
- `color gray70, polymer.protein`
- `set surface_transparency, 0.55, polymer.protein`
- `label chain A and resi 20 and name CA, "Chain A"`
- `label chain B and resi 20 and name CA, "Chain B"`
- `label chain C and resi 20 and name CA, "Chain C"`
- `label chain D and resi 20 and name CA, "Chain D"`

## Step 3: Frame the hero shot and store the scene.

**Suggested voice request:** Orient the tetramer and store the hero scene before exporting.

Orient the tetramer and store the hero scene before exporting.

Checkpoints:
- Scene F6 is stored for the final hemoglobin presentation view.

Direct command equivalents:
- `center 4hhb`
- `orient 4hhb`
- `turn y, 14`
- `turn x, 8`
- `zoom 4hhb, 8`
- `scene F6, store, Hemoglobin presentation view`

## Step 4: Export the final hemoglobin presentation PNG.

**Suggested voice request:** Recall the stored hero scene and write the final high-resolution PNG after the framing settles.

Recall the stored hero scene and write the final high-resolution PNG after the framing settles.

Checkpoints:
- Scene F6 is stored and a figure export exists.

Direct command equivalents:
- `scene F6, recall`
- `png "./output/doc-exports/pymol-surface-and-presentation-export-hero-shot.png", width=2200, height=1600, dpi=350, ray=0`
