# AlphaFold Experimental Overlay Prompts

## Starter Prompts
- Compare an AlphaFold hemoglobin alpha chain against the experimental 4HHB tetramer in PyMOL.
- Save one overview of the full tetramer, one aligned overlay around chain A, and one exploded comparison where the prediction is pulled aside cleanly.
- Highlight the heme-adjacent patch so the predicted-versus-experimental handoff feels deliberate.

## Reusable Spoken Utterances
- Open 4HHB and the local AlphaFold alpha-chain model.
- Keep the tetramer readable but emphasize chain A for the overlay.
- Align the AlphaFold model to experimental chain A with cealign.
- Show the heme as sticks and tighten the camera around the comparison patch.
- Label the distal and proximal histidines before the final export.
- Save one scene for the tetramer overview and one for the chain A overlay.
- Pull the AlphaFold model away from the tetramer for a readable side-by-side comparison and save that scene too.
- Make the non-focused chains quieter so the AlphaFold overlay reads clearly.
- Use the comparison preset before the final export.
- Tell me the alignment RMSD once the overlay is locked in.
- Export the final predicted-versus-experimental figure.
- Use the assembly preset for large oligomers so the silhouettes stay crisp and the frame does not get muddy.
- If the prediction and scaffold overlap too much, move the predicted model aside for a cleaner side-by-side comparison.
- Keep the whole complex fixed and slide only the predicted partner to the right.
- Rotate just the comparison partner around its own center instead of moving the camera.
- When the user says whole complex, scaffold, binder, or experimental model, inspect state first and use the semantic handle instead of guessing.
- For an AlphaFold handoff, compare the confidence-colored loop against the experimental backbone before exporting.
- Overlay the AlphaFold subunit on the experimental assembly, save the global context, and then push into the local comparison patch.
- For a prediction-versus-experiment story, keep the experimental assembly quiet and let the overlay read crisply against one highlighted chain.
- Apply the light presentation preset before the next hero shot.
- Use a pocket hero frame and keep the ligand emphasized.
- Measure the angle across the catalytic triad and leave the label visible.
- Measure the key dihedral and keep it on screen for the explanation.
- Color only the ligand neighborhood and keep the scaffold neutral.
- Store this polished view so we can jump back to it later.
- Ray trace a higher-resolution export once the framing looks right.
- Switch to a comparison-style framing that feels more editorial.
- Clear the residue labels if they start to clutter the view.
- Generate symmetry mates around the ligand and keep only the close contacts visible.
- Clip the slab tighter around the active site and keep the mesh readable.
- Capture the current viewport so you can check whether the labels and pocket are clean.
- Color the model by confidence or B-factor and switch to putty for uncertain loops.
- Isolate the chain interface, keep the buried residues visible, and save the cleanest view.
- After the first export, inspect the view again and tighten the framing before the final still.
- Tell me the shortest measurement that is currently visible before you move on.
- Generate symmetry mates around the ligand and isolate only the packing shell that matters.
- Tell me whether the current scene contains maps, measurement objects, or just molecular models before you change it.
- Focus the quaternary interface, quiet the rest of the model, and leave me with a publication-style still.
- If the shot feels busy, clear the labels, tighten the slab, and re-export a cleaner version.
- Walk from the global assembly into a domain-level or cavity-level close-up, then save both scenes for the demo.
