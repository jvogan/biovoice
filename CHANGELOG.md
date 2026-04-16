# Changelog

All notable changes to BioVoice will be documented in this file.

This project is currently published as a **research prototype**, so release notes emphasize public usability, verified workflows, privacy boundaries, and contributor-facing changes.

## [0.1.0] - 2026-04-15

First public release.

### Added

- **Dual-audience positioning** in the README and package metadata: scientist-first voice control for PyMOL and ChimeraX, and a working reference for OpenAI Realtime API tool calling for developers and AI engineers
- **[docs/realtime-tool-calling.md](docs/realtime-tool-calling.md)** — developer-audience deep dive on the 7 Realtime function tools, the polymorphic selector schema, `get_target_state` grounding, scientific workflow compilation, dry-run mode, and session guardrails
- Hand-authored onboarding docs: [Getting Started](docs/getting-started.md), [First Live Session](docs/first-live-session.md), [AlphaFold Tutorial](docs/tutorial-alphafold.md), [Rosetta Tutorial](docs/tutorial-rosetta.md), [Ligand Pocket Tutorial](docs/tutorial-ligand-pocket.md), [Cryo-EM Tutorial](docs/tutorial-cryo-em.md), [Architecture](docs/architecture.md), [FAQ](docs/faq.md), and [Public Release Checklist](docs/public-release.md)
- Support and contributor docs: [SUPPORT.md](SUPPORT.md), [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [CITATION.cff](CITATION.cff)
- **Scientific workflow catalog**: 9 task-level AlphaFold and Rosetta workflows exposed behind `run_scientific_workflow` and compiled into per-target action streams
- **Seven registered Realtime function tools**: `run_pymol_actions`, `run_chimerax_actions`, `get_target_state`, `run_scientific_workflow`, `run_recipe_step`, `export_artifact`, `capture_view`
- Offline rehearsal mode, `--dryRun` tool argument on action tools, and a `raw_command` gate that hides raw commands from the model unless `ENABLE_EXPERT_RAW_COMMANDS=true`
- Conservative Realtime session guardrails: idle disconnect, session duration cap, response/transcription caps, billable-token cap with pre-disconnect warning, and concurrent-session cap
- Release-readiness scanner covering tracked secrets, personal filesystem paths, local-only artifact paths, and broken relative Markdown links

### Improved

- README expanded with "Why BioVoice Matters" for dual-audience landing and "How Tool Calling Works" with a real tool-schema excerpt
- Expanded npm keywords and GitHub topic guidance covering structural biology, voice UX, and LLM tool-calling clusters
- Generated examples now point newcomers back to the hand-authored docs flow
- `AGENTS.md` title aligned with the BioVoice brand
- Public release checklist now explicitly lists `npm run generate:examples` and a broader GitHub topic set

### Verified

- `npm run typecheck`
- `npm run check`
- `npm run release:check`
- `npm run verify:examples`
- `npm run verify:showcases`

### Notes

- Live voice support today uses **OpenAI Realtime only**. Anthropic live voice, Gemini live voice, and a local/offline speech stack are **not** implemented
- Local `.env` remains the normal supported setup for private credentials
- Molecular files stay local; live voice sends audio, transcripts, and tool-call text to OpenAI
- macOS is the best-supported autolaunch path; Linux and Windows can run the backend and UI but require starting PyMOL / ChimeraX manually
