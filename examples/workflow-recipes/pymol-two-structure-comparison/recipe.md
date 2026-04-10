# Two-Structure Comparison Workflow

## Step 1: Load both conformations and establish distinct colors.

**Suggested voice request:** Bring both structures into PyMOL and color them for quick comparison.

Bring both structures into PyMOL and color them for quick comparison.

Checkpoints:
- Both models are visible as cartoons with distinct colors.

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
- `delete 1ake`
- `load "./examples/data/local/1ake.pdb", 1ake`
- `delete 4ake`
- `load "./examples/data/local/4ake.pdb", 4ake`
- `hide everything, all`
- `show cartoon, 1ake or 4ake`
- `color deepteal, 1ake`
- `color tv_orange, 4ake`

## Step 2: Align the pair and isolate the moving lid.

**Suggested voice request:** Superpose the two models and spotlight the lid region that moves during closure.

Superpose the two models and spotlight the lid region that moves during closure.

Checkpoints:
- The models are aligned.
- Residues 118-160 are highlighted as sticks.

Direct command equivalents:
- `super 4ake and name CA, 1ake and name CA`
- `select lid_region, resi 118-160 and (1ake or 4ake)`
- `show sticks, lid_region`
- `center lid_region`
- `orient lid_region`
- `turn y, 12`
- `turn x, 6`
- `zoom lid_region, 8`

## Step 3: Store the overview and close-up scenes.

**Suggested voice request:** Save both the global alignment and the lid close-up as named scenes.

Save both the global alignment and the lid close-up as named scenes.

Checkpoints:
- Two named scenes are stored for the comparison.

Direct command equivalents:
- `scene F2, store, Global aligned overview`
- `scene F3, store, Lid close-up`
