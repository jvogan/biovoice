# Map and Model Walkthrough Workflow

## Step 1: Load ubiquitin and generate a synthetic map.

**Suggested voice request:** Open 1UBQ, create a gaussian map, and contour it as a mesh.

Open 1UBQ, create a gaussian map, and contour it as a mesh.

Checkpoints:
- The structure is loaded and a density mesh is visible.

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
- `delete 1ubq`
- `load "./examples/data/local/1ubq.pdb", 1ubq`
- `hide everything, all`
- `show cartoon, 1ubq`
- `map_new ubq_map, gaussian, 1, 1ubq, 5`
- `isomesh ubq_map_mesh, ubq_map, 1, 1ubq, 5`

## Step 2: Focus the Lys48 region and clip through the map.

**Suggested voice request:** Create a neighborhood selection, orient the camera, and clip into the contour.

Create a neighborhood selection, orient the camera, and clip into the contour.

Checkpoints:
- The Lys48 neighborhood is highlighted and the contour is clipped.

Direct command equivalents:
- `select lys48_shell, byres (resi 48 and (1ubq and resi 48) around 6)`
- `show sticks, lys48_shell`
- `center lys48_shell`
- `orient lys48_shell`
- `turn y, 20`
- `turn x, 12`
- `zoom lys48_shell, 6`
- `clip slab, 14`

## Step 3: Store overview and site scenes for playback.

**Suggested voice request:** Create an overview scene and a focused scene, then export the focus image.

Create an overview scene and a focused scene, then export the focus image.

Checkpoints:
- Both scenes exist and a focus PNG is saved.

Direct command equivalents:
- `scene F4, store, Overview with synthetic map`
- `scene F5, store, Lys48 map close-up`
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
- `set mesh_width, 0.4`
- `set surface_quality, 2`
- `set two_sided_lighting, 1`
- `png "./output/doc-exports/pymol-map-and-model-walkthrough-store-overview-and-site.png", width=2000, height=1400, dpi=350, ray=1`
