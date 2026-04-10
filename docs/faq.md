# FAQ and Glossary

## What is BioVoice?

BioVoice is a local research prototype for voice control of PyMOL and ChimeraX. It is built for structural biology workflows such as ligand-pocket walkthroughs, AlphaFold overlays, Rosetta reviews, and cryo-EM map stories.

## Can I use BioVoice without an OpenAI API key?

Yes. Offline rehearsal is a first-class path. You can start the local server, inspect the UI, dry-run workflows, and run direct recipe/API routes without live voice.

Start here:

```bash
npm run agent:start -- pymol --offline --clean-target
```

## Which voice provider does BioVoice support today?

**OpenAI Realtime API only.** That is the only supported and documented live voice provider in this release.

## Does BioVoice support Anthropic live voice, Gemini live voice, or local speech providers?

No. Those are not implemented or supported today. BioVoice does not currently expose a provider-selection interface.

## Does my PDB, CIF, or cryo-EM map leave my machine?

No. Molecular file contents stay local. During live voice sessions, microphone audio, transcripts, and structured tool-call text go to OpenAI.

## Is local `.env` still the normal setup?

Yes. Real credentials belong in your local `.env`. That file stays ignored and local. The tracked [`.env.example`](../.env.example) file is a safe template and should remain tracked.

## Which local paths stay outside the remote/public repo?

These locations are expected to stay local-only:

- `.env`
- `.runtime/`
- `local/`
- `private/`
- `tmp/`
- `output/`

They are kept out of git so you can use the app normally on your own machine without publishing local state.

## Can I use BioVoice on Linux or Windows?

Partially. The local backend and browser UI can run, but macOS is the only platform with built-in autolaunch today. On Linux or Windows, start PyMOL or ChimeraX manually first.

## Do I need both PyMOL and ChimeraX installed?

No. You can use either one. Many workflows have a recommended target, but BioVoice does not require both applications to be present.

## What are the best first workflows to try?

- Ligand pocket story for the fastest polished visual win
- AlphaFold overlay for prediction-versus-experiment demos
- Rosetta compare for scaffold-versus-design storytelling
- ChimeraX map fit for a cryo-EM-oriented walkthrough

See [Getting Started](./getting-started.md) and the tutorial pages in `docs/`.

## How do I test AlphaFold workflows locally?

Use the validated showcase or rehearsal commands:

```bash
npm run showcase:chimerax:overlay
npm run rehearse:workflow -- alphafold_vs_experiment_overlay --target chimerax --capture --model examples/data/local/af-p69905.pdb --experimental examples/data/local/4hhb.pdb
```

## How do I test Rosetta workflows locally?

Use the validated showcase or rehearsal commands:

```bash
npm run showcase:pymol:rosetta
npm run rehearse:workflow -- rosetta_top_design_compare --target pymol --capture --model examples/data/local/rosetta_demo/reference_scaffold.pdb --bundle examples/data/local/rosetta_demo --scorefile examples/data/local/rosetta_demo/score.sc --top-n 2
```

## What should I redact before filing a public issue?

Redact:

- API keys and access tokens
- full browser URLs
- local filesystem paths you do not want public
- transcript text you would not want indexed
- screenshots that reveal sensitive structures, prompts, or machine details

See [SUPPORT.md](../SUPPORT.md) and [SECURITY.md](../SECURITY.md).

## Glossary

### PyMOL

A molecular visualization application widely used for structure inspection, presentation figures, and scripting-heavy workflows.

### ChimeraX

A molecular visualization application with strong support for modern rendering, contact analysis, assemblies, maps, and structural comparison workflows.

### AlphaFold

A protein-structure prediction system. In BioVoice, AlphaFold workflows usually mean confidence review, overlay, interface triage, or cryo handoff.

### Rosetta

A computational modeling suite often used for design, interface optimization, and scaffold-versus-design comparison workflows.

### Cryo-EM

Cryo-electron microscopy. In BioVoice, cryo-EM workflows focus on density maps, fitted atomic models, cutaways, and map-fit presentations.

### OpenAI Realtime API

The live voice backend BioVoice uses today for real-time speech interaction over WebRTC.

### WebRTC

The browser transport used for live audio streaming between the BioVoice UI and OpenAI Realtime.
