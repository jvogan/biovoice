# Rosetta-Style Design Review Workflow

## Step 1: Load the scaffold and design candidate with semantic roles.

**Suggested voice request:** Start from a clean workspace, load the scaffold plus design surrogate, and establish a restrained overview view.

Start from a clean workspace, load the scaffold plus design surrogate, and establish a restrained overview view.

Checkpoints:
- The scaffold and design are visible with distinct colors.
- Scene F18 stores the global design-review overview.

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
- `delete wt_scaffold`
- `load "./examples/data/local/4ake.pdb", wt_scaffold`
- `delete rosetta_design_v2`
- `load "./examples/data/local/1ake.pdb", rosetta_design_v2`
- `hide everything, all`
- `show cartoon, wt_scaffold and polymer.protein`
- `show cartoon, rosetta_design_v2 and polymer.protein`
- `color gray80, wt_scaffold and polymer.protein`
- `color raspberry, rosetta_design_v2 and polymer.protein`
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
- `set cartoon_transparency, 0.04`
- `set stick_radius, 0.13`
- `set label_size, 16`
- `set dash_radius, 0.04`
- `set cartoon_transparency, 0.08`
- `set stick_radius, 0.15`
- `set dash_gap, 0.2`
- `center wt_scaffold or rosetta_design_v2`
- `orient wt_scaffold or rosetta_design_v2`
- `turn y, 14`
- `turn x, 8`
- `zoom wt_scaffold or rosetta_design_v2, 10`
- `scene F18, store, Scaffold versus design overview`

## Step 2: Align the design to the scaffold and isolate the remodeled shell.

**Suggested voice request:** Overlay the design onto the scaffold, then emphasize the moving shell so the scientist can narrate the changed region directly.

Overlay the design onto the scaffold, then emphasize the moving shell so the scientist can narrate the changed region directly.

Checkpoints:
- The design is aligned onto the scaffold.
- Residues 118-160 are emphasized on both models.
- Scene F19 stores the remodeled-shell close-up.

Direct command equivalents:
- `cealign rosetta_design_v2 and polymer.protein, wt_scaffold and polymer.protein`
- `show sticks, rosetta_design_v2 and resi 118-160`
- `show sticks, wt_scaffold and resi 118-160`
- `color hotpink, rosetta_design_v2 and resi 118-160`
- `color deepteal, wt_scaffold and resi 118-160`
- `distance shell_anchor, wt_scaffold and resi 136 and name CA, rosetta_design_v2 and resi 136 and name CA`
- `center wt_scaffold and resi 118-160 or rosetta_design_v2 and resi 118-160`
- `orient wt_scaffold and resi 118-160 or rosetta_design_v2 and resi 118-160`
- `turn y, 12`
- `turn x, 6`
- `zoom wt_scaffold and resi 118-160 or rosetta_design_v2 and resi 118-160, 8`
- `scene F19, store, Remodeled shell close-up`

## Step 3: Move only the design candidate for the exploded comparison and export it.

**Suggested voice request:** Translate and rotate the design candidate away from the scaffold, keep the scaffold anchored, and export the final design-review figure.

Translate and rotate the design candidate away from the scaffold, keep the scaffold anchored, and export the final design-review figure.

Checkpoints:
- Only the design candidate is moved for the exploded comparison.
- Scene F20 stores the exploded comparison.
- A high-resolution design-review PNG export exists.

Direct command equivalents:
- `translate [22,0,0], object=rosetta_design_v2, camera=1`
- `rotate y, 22, object=rosetta_design_v2, camera=1`
- `center wt_scaffold or rosetta_design_v2`
- `orient wt_scaffold or rosetta_design_v2`
- `turn y, 12`
- `turn x, 6`
- `zoom wt_scaffold or rosetta_design_v2, 12`
- `scene F20, store, Exploded scaffold versus design comparison`
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
- `set cartoon_transparency, 0.04`
- `set stick_radius, 0.13`
- `set label_size, 16`
- `set dash_radius, 0.04`
- `set cartoon_transparency, 0.08`
- `set stick_radius, 0.15`
- `set dash_gap, 0.2`
- `png "./output/doc-exports/pymol-rosetta-style-design-review-explode-and-export-design.png", width=2600, height=1700, dpi=350, ray=1`
