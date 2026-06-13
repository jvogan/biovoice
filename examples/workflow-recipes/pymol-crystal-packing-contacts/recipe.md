# Crystal Packing Contacts Workflow

## Step 1: Load the ligand-bound complex and establish the base styling.

**Suggested voice request:** Bring 1HSG into PyMOL, show the protein and ligand cleanly, and apply the light editorial preset.

Bring 1HSG into PyMOL, show the protein and ligand cleanly, and apply the light editorial preset.

Checkpoints:
- Protein is cartoon and the inhibitor is visible as sticks.
- The light presentation preset is active.

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
- `delete mate_*`
- `delete packing_shell`
- `delete 1hsg`
- `delete 1hsg`
- `load "./examples/data/local/1hsg.pdb", 1hsg`
- `hide everything, all`
- `show cartoon, polymer.protein`
- `show sticks, organic`
- `util.cbc polymer.protein`
- `util.cnc organic`
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

## Step 2: Generate symmetry mates and isolate the packing shell.

**Suggested voice request:** Expand symmetry around the inhibitor, then keep only the local shell that explains the packing contact story.

Expand symmetry around the inhibitor, then keep only the local shell that explains the packing contact story.

Checkpoints:
- Symmetry mates are visible around the inhibitor.
- The local packing shell is selected and emphasized.

Direct command equivalents:
- `symexp mate_, 1hsg, organic, 8`
- `show lines, mate_*`
- `color gray70, mate_*`
- `select packing_shell, byres (mate_* within 4 of organic)`
- `show sticks, packing_shell`
- `color wheat, packing_shell`

## Step 3: Polish the packing-contact shot and export it.

**Suggested voice request:** Frame the ligand and packing shell tightly, save a scene, and export a publication-style still.

Frame the ligand and packing shell tightly, save a scene, and export a publication-style still.

Checkpoints:
- A tight crystal-packing scene is stored.
- A polished PNG export is created.

Direct command equivalents:
- `center packing_shell or organic`
- `orient packing_shell or organic`
- `turn y, 18`
- `turn x, -10`
- `zoom packing_shell or organic, 7`
- `clip slab, 40`
- `clip slab, 12`
- `scene F12, store, Crystal packing contact hero`
- `png "./output/doc-exports/pymol-crystal-packing-contacts-frame-and-export-packing.png", width=2200, height=1500, dpi=350, ray=1`
