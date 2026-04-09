# Tool Playbooks

## PyMOL
- `reset_workspace`, `load`, `select`, `show`, `hide`, `color`, `camera`, `measure`, `distance`, `label`, `align`, `surface`, `map`, `scene`, `object`, `preset`, `setting`, `export`, `raw_command`
- Best for pocket walkthroughs, named scenes, camera hero frames, synthetic gaussian maps, and ray-traced exports.

## ChimeraX
- `reset_workspace`, `open`, `close`, `visibility`, `select`, `style`, `color`, `camera`, `measure`, `distance`, `label`, `contacts`, `align`, `fit`, `layout`, `volume`, `preset`, `graphics`, `cartoon`, `view`, `lighting`, `export`, `raw_command`
- Best for contact analysis, named-view demos, matchmaker alignments, map fitting, tiled comparisons, AlphaFold review, and polished publication exports.

## Guardrails
- Ask for clarification when chain IDs, residue ranges, filenames, or export paths are ambiguous.
- Prefer structured tools over raw commands.
- Confirm destructive actions or overwrites before executing them.
- Default to the repo-wide demo aesthetic unless the operator explicitly wants a different look.
