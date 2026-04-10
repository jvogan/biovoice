# First Live Session

This walkthrough is the safest first mic-enabled BioVoice session. It uses a validated local ligand-pocket demo, keeps the target simple, and favors push-to-talk over open-mic automation.

## What This Walkthrough Demonstrates

- Starting BioVoice with a real local target
- Connecting a live OpenAI Realtime session
- Speaking a few reliable first commands
- Recovering gracefully if the room, mic, or target state is noisy

## Recommended Target

**PyMOL** is the recommended first live target because the ligand pocket story is fast, visually obvious, and easy to narrate.

If you prefer ChimeraX first, use the same checklist with the ligand interaction explainer in [Ligand Pocket Tutorial](./tutorial-ligand-pocket.md).

## Prerequisites

- `npm install`
- `npm run prepare:data`
- `npm run generate:examples`
- Local `.env` with `OPENAI_API_KEY`
- Microphone permission available in your browser

## Exact Command To Run

```bash
npm run quickstart:pymol
```

This launches PyMOL, starts the local BioVoice backend, and opens the browser console on the default local port.

## What You Should Expect To See

- PyMOL opens to a clean presentation baseline
- The browser console loads with PyMOL selected
- After you click **Connect Voice Session**, the `Data`, `Controller`, and `Event Stream` indicators turn green
- The workflow rail is available if you want to stage a guided recipe before freestyle voice

## First Commands To Say

Start in **Push-to-Talk** mode. Use short, concrete commands first.

- "Open local structure 1HSG."
- "Show the protein as cartoon and the inhibitor as sticks."
- "Zoom the active site and center on the ligand."

If those work cleanly, continue with:

- "Measure the nearest catalytic contacts."
- "Make the pocket surface transparent."
- "Save a hero image."

## How To Run The Same Workflow Without Voice

```bash
npm run rehearse:workflow -- pymol-binding-pocket-story --target pymol --capture
```

That is the best fallback if you want to validate the exact same ligand-pocket story without touching the microphone.

## Common Failure Points

- **No microphone prompt appears**: check browser permissions and reload the page
- **`Data`, `Controller`, or `Event Stream` never turns green**: disconnect, reconnect, and confirm your API key is present in local `.env`
- **Ambient room noise triggers turns**: stay in push-to-talk and do not switch to always-on yet
- **PyMOL looks stale or cluttered**: use `Reset Target` before reconnecting voice
- **You want a safer first run**: go back to [Getting Started](./getting-started.md) and use the offline path first

## Where To Go Next

- [Ligand Pocket Tutorial](./tutorial-ligand-pocket.md) for a fuller version of this story
- [AlphaFold Tutorial](./tutorial-alphafold.md) for prediction-versus-experiment overlays
- [Rosetta Tutorial](./tutorial-rosetta.md) for design-review demos
- [Operator Quick Reference](../examples/start-here/README.md) for compact session reminders

## Generated Reference Pages

- [PyMOL binding pocket story reference](../examples/workflow-recipes/pymol-binding-pocket-story/README.md)
- [PyMOL binding pocket prompts](../examples/workflow-recipes/pymol-binding-pocket-story/prompts.md)
