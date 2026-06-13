# Selection and Storyboarding Workflow

## Step 1: Create reusable named selections.

**Suggested voice request:** Build named selections for chain A, chain B, catalytic residues, and the ligand shell.

Build named selections for chain A, chain B, catalytic residues, and the ligand shell.

Checkpoints:
- All named selections are created.

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
- `select chain_a, chain A`
- `select chain_b, chain B`
- `select catalytic, resi 25+26+27 and (chain A or chain B)`
- `select ligand_shell, byres (all and ((organic) around 5))`

## Step 2: Step through the selections and store scenes.

**Suggested voice request:** Orient and zoom to each named selection, then store a matching scene for the storyboard.

Orient and zoom to each named selection, then store a matching scene for the storyboard.

Checkpoints:
- Scenes F7-F9 are stored for the storyboard.

Direct command equivalents:
- `show sticks, catalytic or ligand_shell`
- `center chain_a`
- `orient chain_a`
- `turn y, 14`
- `turn x, 8`
- `zoom chain_a, 8`
- `scene F7, store, Chain A introduction`
- `center chain_b`
- `orient chain_b`
- `turn y, 14`
- `turn x, 8`
- `zoom chain_b, 8`
- `scene F8, store, Chain B introduction`
- `center ligand_shell`
- `orient ligand_shell`
- `turn y, 18`
- `turn x, -10`
- `zoom ligand_shell, 5`
- `clip slab, 40`
- `scene F9, store, Ligand shell close-up`

## Step 3: Export the final storyboard close-up.

**Suggested voice request:** Recall the close-up scene and export a final still for reuse.

Recall the close-up scene and export a final still for reuse.

Checkpoints:
- The storyboard close-up export is written.

Direct command equivalents:
- `scene F9, recall`
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
- `png "./output/doc-exports/pymol-selection-and-storyboarding-export-storyboard.png", width=2000, height=1400, dpi=350, ray=1`
