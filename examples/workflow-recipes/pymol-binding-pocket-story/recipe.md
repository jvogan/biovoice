# Binding Pocket Story Workflow

## Step 1: Load the structure and establish the visual baseline.

**Suggested voice request:** Bring 1HSG into PyMOL, switch to cartoon plus sticks, and apply clear colors.

Bring 1HSG into PyMOL, switch to cartoon plus sticks, and apply clear colors.

Checkpoints:
- The structure is visible in PyMOL.
- Protein is cartoon and organic ligand is in sticks.

Direct command equivalents:
- `reinitialize`
- `scene *, clear`
- `bg_color gray99`
- `set auto_zoom, 0`
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
- `delete 1hsg`
- `load "./examples/data/local/1hsg.pdb", 1hsg`
- `hide everything, all`
- `show cartoon, polymer.protein`
- `show sticks, organic`
- `util.cbc polymer.protein`
- `util.cnc organic`

## Step 2: Focus the active site and call out the catalytic residues.

**Suggested voice request:** Select the ligand neighborhood, zoom the pocket, and label the catalytic aspartates.

Select the ligand neighborhood, zoom the pocket, and label the catalytic aspartates.

Checkpoints:
- Pocket residues are selected and displayed.
- Active-site labels are visible near the catalytic aspartates.

Direct command equivalents:
- `select pocket, byres (all and ((organic) around 5))`
- `show sticks, pocket`
- `label chain A and resi 25 and name CA, "Asp25A"`
- `label chain B and resi 25 and name CA, "Asp25B"`
- `center pocket or organic`
- `orient pocket or organic`
- `turn y, 18`
- `turn x, -10`
- `zoom pocket or organic, 6`
- `clip slab, 40`

## Step 3: Measure the pocket and add a transparent surface.

**Suggested voice request:** Add key measurements, lay a transparent surface over the pocket, and store a scene.

Add key measurements, lay a transparent surface over the pocket, and store a scene.

Checkpoints:
- Distance objects are visible.
- A semi-transparent surface encloses the pocket.
- A scene and PNG export have been created.

Direct command equivalents:
- `distance cat_contact_a, chain A and resi 25 and name OD1, organic, 3.5, 2`
- `distance cat_contact_b, chain B and resi 25 and name OD1, organic, 3.5, 2`
- `show surface, pocket`
- `set surface_color, marine, pocket`
- `set transparency, 0.45, pocket`
- `bg_color gray99`
- `set auto_zoom, 0`
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
- `set stick_radius, 0.2`
- `set dash_radius, 0.06`
- `set dash_gap, 0.16`
- `set transparency, 0.5`
- `set label_size, 20`
- `set transparency, 0.42`
- `set mesh_width, 0.35`
- `set label_outline_color, gray98`
- `scene F1, store, Pocket story hero shot`
- `png "./output/doc-exports/pymol-binding-pocket-story-measure-and-surface.png", width=2200, height=1500, dpi=350, ray=1`
