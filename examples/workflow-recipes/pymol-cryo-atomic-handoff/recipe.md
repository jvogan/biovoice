# Cryo-Atomic Handoff Workflow

## Step 1: Load the fitted model and local map.

**Suggested voice request:** Open the local cryo-EM model and map, establish the atomic baseline, and store the overview scene.

Open the local cryo-EM model and map, establish the atomic baseline, and store the overview scene.

Checkpoints:
- The cryo-EM model and map are both loaded.
- The fitted atomic model is visible with cofactors emphasized.
- A clean overview scene is stored.

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
- `delete hb_cryo`
- `load "./examples/data/local/8wj1.cif", hb_cryo`
- `delete emd_37575`
- `load "./examples/data/local/emd_37575.map", emd_37575`
- `hide everything, all`
- `show cartoon, hb_cryo and polymer.protein`
- `show sticks, hb_cryo and organic`
- `util.cbc hb_cryo and polymer.protein`
- `util.cnc hb_cryo and organic`
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
- `set mesh_width, 0.46`
- `set surface_transparency, 0.24`
- `set dash_color, teal`
- `set dash_radius, 0.06`
- `center hb_cryo and polymer.protein`
- `orient hb_cryo and polymer.protein`
- `turn y, 14`
- `turn x, 8`
- `zoom hb_cryo and polymer.protein, 11`
- `scene F13, store, Cryo overview`

## Step 2: Contour the density and move into the heme neighborhood.

**Suggested voice request:** Build a reusable heme shell, contour the local density, and create a cryo-aware cutaway frame.

Build a reusable heme shell, contour the local density, and create a cryo-aware cutaway frame.

Checkpoints:
- A heme neighborhood selection exists.
- Local density is contoured around the heme shell.
- The framing now reads as a cryo-plus-atomic cutaway.

Direct command equivalents:
- `select heme_shell, byres (hb_cryo and (organic) around 5)`
- `show sticks, heme_shell or hb_cryo and organic`
- `isomesh emd_37575_mesh, emd_37575, 1.4, heme_shell or hb_cryo and organic, 6`
- `color cyan, emd_37575_mesh`
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
- `set mesh_width, 0.46`
- `set surface_transparency, 0.24`
- `set dash_color, teal`
- `set dash_radius, 0.06`
- `center heme_shell or hb_cryo and organic`
- `orient heme_shell or hb_cryo and organic`
- `turn y, 20`
- `turn x, 12`
- `zoom heme_shell or hb_cryo and organic, 7`
- `clip slab, 14`
- `clip slab, 14`

## Step 3: Store the cutaway and export the polished still.

**Suggested voice request:** Save the heme-centered scene, preserve the cryo-aware preset, and export the final still.

Save the heme-centered scene, preserve the cryo-aware preset, and export the final still.

Checkpoints:
- The heme cutaway scene is stored.
- A polished cryo-plus-atomic PNG export is written.

Direct command equivalents:
- `scene F14, store, Cryo heme cutaway`
- `png "./output/doc-exports/pymol-cryo-atomic-handoff-store-and-export-cryo-cutaway.png", width=2600, height=1700, dpi=350, ray=1`
