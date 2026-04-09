# Troubleshooting

## Speech And Recognition
- If the model mishears a PDB ID, spell it out and say each character individually.
- Stay in push-to-talk mode until the room is quiet enough for open-mic use.

## Target Process Issues
- If PyMOL is not responding, restart it with `pymol -R` or use `npm run smoke:pymol`.
- If ChimeraX is not responding, restart the REST server with `remotecontrol rest start port 60958 json true log false` or use `npm run smoke:chimerax`.

## Recovery
- Use the built-in recipe steps to recover a complex demo without restyling the scene manually.
- Use `Reset Target` when you want a clean presentation baseline without restarting the app.
- Use `Cancel Turn` if a spoken instruction starts to drift before the tool call executes.
