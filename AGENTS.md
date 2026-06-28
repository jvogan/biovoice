# BioVoice Agent Guide

This repo is meant to be operable by coding agents without extra discovery.

## Primary commands

- Blessed human-first floating-widget startup: `npm run quickstart:pymol` or `npm run quickstart:chimerax`
- Floating companion startup: `npm run launch:pymol` or `npm run launch:chimerax`
- Browser console startup, only when explicitly requested: `npm run browser:pymol` or `npm run browser:chimerax`
- Legacy explicit floating companion aliases: `npm run overlay:pymol` or `npm run overlay:chimerax`
- Blessed agent-first startup: `npm run agent:start -- <pymol|chimerax>`
- Blessed agent-first overlay startup: `npm run agent:start -- <pymol|chimerax> --overlay`
- Blessed scientific startup: `npm run agent:start -- <pymol|chimerax> --workflow <workflowId> [scientific inputs]`
- Launch the PyMOL floating widget: `npm run launch:pymol`
- Launch the ChimeraX floating widget: `npm run launch:chimerax`
- Launch a polished PyMOL cryo demo directly: `npm run showcase:pymol:cryo`
- Launch a polished PyMOL AlphaFold overlay demo directly: `npm run showcase:pymol:overlay`
- Launch a polished ChimeraX map demo directly: `npm run showcase:chimerax:map`
- Launch a polished ChimeraX AlphaFold overlay demo directly: `npm run showcase:chimerax:overlay`
- Start a target generically: `npm run agent:start -- <pymol|chimerax>`
- Start a task-first scientific workflow: `npm run agent:start -- <pymol|chimerax> --workflow <workflowId> [--uniprot <id>] [--experimental-pdb-id <id>] [--emdb-id <id>] [--structure-format <pdb|cif>] [--pdb-format <pdb|cif>] [--model <path>] [--experimental <path>] [--pae <path>] [--map <path>] [--bundle <path>] [--scorefile <path>] [--top-n <n>]`
- Once the full browser console is open, the `Scientific Launch` rail can also stage the currently pinned AlphaFold or Rosetta workflow directly with `Stage Workflow Now`; this is the safest UI-first rehearsal path before voice.
- Start a target with the browser pre-armed for expert mode: `npm run browser:pymol -- --advanced` or `npm run browser:chimerax -- --advanced`
- Start the PyMOL demo stack: `npm run agent:start:pymol`
- Start the ChimeraX demo stack with the short alias: `npm run agent:start:chimera`
- Start the ChimeraX demo stack: `npm run agent:start:chimerax`
- Restart a target generically: `npm run agent:restart -- <pymol|chimerax>`
- Restart the PyMOL demo stack: `npm run agent:restart:pymol`
- Restart the ChimeraX demo stack with the short alias: `npm run agent:restart:chimera`
- Restart the ChimeraX demo stack: `npm run agent:restart:chimerax`
- Check managed runtime status: `npm run agent:status`
- Stop the managed runtime: `npm run agent:stop`
- Rehearse a workflow without voice: `npm run rehearse:workflow -- <recipeId> --target <pymol|chimerax> --capture`
- Rehearse a scientific workflow without voice: `npm run rehearse:workflow -- <workflowId|recipeId> --target <pymol|chimerax> --capture [scientific inputs, including --uniprot, --experimental-pdb-id, --emdb-id, --structure-format, and --pdb-format]`
- Rehearse the default PyMOL path: `npm run rehearse:pymol`
- Rehearse the default ChimeraX path: `npm run rehearse:chimerax`

## What the start command does

- Loads `.env` from the repo root.
- Verifies `OPENAI_API_KEY` is present.
- Skips the OpenAI key requirement when `--offline` is supplied.
- Keeps raw expert commands disabled unless the backend env also sets `ENABLE_EXPERT_RAW_COMMANDS=true`.
- Ensures the requested target app is ready:
  - PyMOL via XML-RPC on the `9123+` range
  - ChimeraX via REST on port `60958`
- Builds the latest frontend and backend bundle before launch.
- Can skip the build with `--skip-build`, skip Realtime preflight with `--skip-preflight`, and reuse a healthy dev server with `--reuse-dev`.
- Starts the shared voice console on `http://localhost:3000` with the requested default target.
- Emits a recommended URL that already includes the target, optional recipe, audience mode, voice mode, widget mode, and optional advanced mode query params.
- The `launch:*`, `quickstart:*`, and showcase launch paths open the floating Electron widget by default. Use `--browser` or `npm run browser:*` only when the user asks for a browser tab or full console.
- Resets the desktop target to a clean presentation baseline when `--clean-target` is supplied.
- Reuses an already-running managed console only when the health payload matches this repo and the source tree has not changed since it started.
- Writes runtime state to `.runtime/agent-runtime/state.json`.
- Records the pinned target endpoint in `.runtime/agent-runtime/state.json` so later scripts stay on the same PyMOL session.

## When the user says

- “start realtime pymol”
  Run `npm run launch:pymol` for the minimal human floating-widget flow, or `npm run agent:start -- pymol` / `npm run agent:start:pymol` for a pure agent flow. Do not manually open the recommended URL unless the user asks for a browser tab or full console.
  For AlphaFold or Rosetta tasks, add `--workflow <workflowId>` plus scientific inputs, for example `npm run agent:start -- pymol --workflow alphafold_confidence_review --uniprot P12345`
  For database-backed overlays, prefer explicit IDs, for example `npm run agent:start -- chimerax --workflow alphafold_vs_experiment_overlay --uniprot P69905 --experimental-pdb-id 4HHB --structure-format pdb`
  For a rehearsal-only path, run `npm run agent:start -- pymol --offline --clean-target`
- “open realtime pymol”
  Run `npm run launch:pymol`
- “start realtime chimera” or “start realtime chimerax”
  Run `npm run launch:chimerax` for the minimal human floating-widget flow, or `npm run agent:start -- chimerax`, `npm run agent:start:chimera`, or `npm run agent:start:chimerax`. Do not manually open the recommended URL unless the user asks for a browser tab or full console.
  For scientific tasks, add `--workflow <workflowId>` plus `--bundle`, `--scorefile`, or `--top-n` as needed
  For a rehearsal-only path, run `npm run agent:start -- chimerax --offline --clean-target`
- “open realtime chimera” or “open realtime chimerax”
  Run `npm run launch:chimerax`
- “restart realtime pymol”
  Run `npm run agent:restart -- pymol` or `npm run agent:restart:pymol`
- “restart realtime chimera” or “restart realtime chimerax”
  Run `npm run agent:restart -- chimerax`, `npm run agent:restart:chimera`, or `npm run agent:restart:chimerax`
- “is it running?”
  Run `npm run agent:status`
- “stop it”
  Run `npm run agent:stop`

## Environment

- Keep secrets only in local `.env` or shell env.
- Never commit `.env`.
- `OPENAI_API_KEY` is required for Realtime sessions.
- `OPENAI_USAGE_API_KEY` is optional and only needed for org usage and cost pulls.
- `OPENAI_USAGE_PROJECT_ID` is optional and scopes cost reporting if you have a dedicated OpenAI project.
- Voice tuning knobs live in `.env`: `REALTIME_MAX_OUTPUT_TOKENS`, `REALTIME_RETENTION_RATIO`, `REALTIME_POST_INSTRUCTIONS_TOKENS`, `REALTIME_OUTPUT_SPEED`, `REALTIME_TRANSCRIPTION_PROMPT_HINT`, `PYMOL_RENDER_TIMEOUT_MS`, optionally `PYMOL_RPC_URL`, plus `ENABLE_EXPERT_RAW_COMMANDS` and `PERSIST_SESSION_EVENT_LOGS`.
- Set `PYMOL_RPC_URL` only when you need to pin the runtime to one known RPC-enabled PyMOL session. The managed launcher now does this automatically after startup so restarts stay attached to the same session.
- If a pinned PyMOL endpoint stops responding, restart the managed PyMOL target instead of trying to let the console discover a different live RPC port.
- Set `REALTIME_DEBUG_RAW_EVENTS=true` only when debugging Realtime internals; the default filtered mode is better for live demos.
- Leave `ENABLE_EXPERT_RAW_COMMANDS=false` for normal demos. Only turn it on when you genuinely need raw PyMOL or ChimeraX commands, and then also enable `Advanced Expert Commands` inside the UI or launch with `--advanced`.
- Use `--workflow` to launch AlphaFold or Rosetta tasks from the start. Pair it with scientific inputs instead of relying on the model to discover files later.
- Use `resolve_structure_asset` or `/api/assets/resolve` for known online database assets. It supports AlphaFold DB, RCSB, EMDB, and UniProt through allowlisted hosts and writes files under `.runtime/cache/scientific`; it does not accept arbitrary URLs.

## Verification

- Health check: `curl -s http://localhost:3000/api/health`
- Direct structured action execution: `curl -s http://localhost:3000/api/actions -H 'content-type: application/json' -d '{"target":"pymol","actions":[...]}'`
- Clean-slate reset without restarting the desktop app: `curl -s http://localhost:3000/api/actions -H 'content-type: application/json' -d '{"target":"pymol","actions":[{"type":"reset_workspace"}]}'`
- Direct workflow rehearsal: `curl -s http://localhost:3000/api/recipes/<recipeId>/run -H 'content-type: application/json' -d '{"target":"pymol"}'`
- Direct database asset resolution: `curl -s http://localhost:3000/api/assets/resolve -H 'content-type: application/json' -d '{"source":"rcsb","pdbId":"4HHB","format":"pdb","target":"pymol","loadIntoTarget":true}'`
- Direct viewport capture: `curl -s http://localhost:3000/api/capture -H 'content-type: application/json' -d '{"target":"chimerax","attachToConversation":false}'`
- Health payload identity: confirm `"appId":"biovoice"` and match the reported `instanceId` plus `pid` before reusing or stopping a managed server on that port.
- In `npm run dev`, use `http://localhost:5173` for the UI. The backend on `3000` stays API-only so stale built assets are not served during development.
- PyMOL smoke: `npm run smoke:pymol`
- ChimeraX smoke: `npm run smoke:chimerax`
- Full repo check: `npm run check`

## Semantic handles for natural-language workflows

- `get_target_state` now returns `referenceHints` for handles such as `wholeComplex`, `assemblyModel`, `experimentalModel`, `predictedModel`, `referenceModel`, `scaffoldModel`, `binderModel`, `receptorModel`, `map`, and `ligandContext`.
- `get_target_state` also returns chain-aware handles such as `scaffoldChainA`, `designChainA`, `binderChainA`, `receptorChainA`, `partnerA`, and `partnerB` when the current scene has multiple chains.
- When the user says “whole complex”, “the prediction”, “the scaffold”, “the binder”, or “the map”, call `get_target_state` first and reuse those returned selectors instead of inventing object names.
- Useful natural phrasings that should map cleanly now: “pull the predicted model to the right”, “rotate partner A away from partner B”, “keep the whole complex still and move only the binder”, and “compare the Rosetta design against the starting scaffold while focusing the remodeled shell”.
- For single-atom distances, torsions, or angles in multichain assemblies, prefer the chain-aware handles instead of residue-only whole-model selectors.
- The structured action layer now supports model-level `transform` actions for both PyMOL and ChimeraX. Use them when the user wants to move or rotate only one structure or partner instead of moving the camera.
- Descriptive model names improve reliability. Prefer names like `exp_complex`, `af_prediction`, `wt_scaffold`, `rosetta_design_v2`, `binder_model`, and `density_map` when loading user data.

## Notes for agent behavior

- Prefer the `launch:*` commands when a human will immediately use the floating widget and the `agent:start:*` commands when another agent only needs the service up.
- If the console is healthy but the target app stops responding, prefer the matching `agent:restart:*` command over manually killing processes.
- The Realtime UI still needs a human to grant mic permission and click `Connect Voice Session`, unless the agent is also using UI automation.
- The launcher defaults to the compact floating widget. It is a small hold-to-talk voice instrument, not a dashboard. Use `Open Full Console`, `--browser`, or `npm run browser:*` only when you need the full operator layout.
- The `--overlay` path remains as an explicit alias for that transparent, always-on-top Electron companion window.
- For a first live test, prefer push-to-talk, speak the first `Voice Pack` line before freestyle speech, and leave idle auto-sleep enabled.
- Realtime billing is per response and input-transcription turn, not for simply keeping the connection open. Idle silence itself is not billed, but open-mic or VAD can still create billable turns from ambient speech.
- If the user wants to verify the workflow before voice, use `npm run rehearse:workflow` or the direct `/api/recipes/:recipeId/run` route instead of forcing a live mic test first.
- The left-hand workflow dossier now includes `Dry Run` and `Reset Target`; prefer those before live voice when a recipe is visually complex or the target app has stale state.
- The managed startup path now runs runtime housekeeping first. Use `npm run cleanup:runtime` if you want the same stale-export cleanup without restarting the service.
- Treat the session as ready only when the UI shows `Data: READY`, `Controller: READY`, and `Event Stream: OPEN`.
- `Controller: WAIT` means the sideband controller is still waiting for `session.updated` after pushing tools and instructions.
- `Event Stream: STALLED` means the browser lost the local SSE timeline feed; reconnecting the page is safer before recording.
- The session event stream now replays recent buffered events after reconnects, so a brief browser/SSE hiccup should not immediately invalidate the visible timeline.
- `Realtime Key` and `Usage Key` in the UI indicate local env presence, not a guaranteed successful upstream auth check.
- The usage dashboard can show `403` if the key lacks `api.usage.read`; that does not block Realtime voice itself.
- Prefer the built-in hero presets and hero camera frames when the user asks for polished demos or exports.
- Prefer structured actions over raw commands even for complex scientist tasks: clip planes, label clearing, map views, assembly or symmetry, interface contacts, view recall, and export polish are all first-class now.
- Use `capture_view` when the user asks whether the scene looks good, whether labels are cluttered, or before a final hero export. The resulting image will show in the timeline and `Latest View`.
- If a tool result already returns metrics, quote those numeric values directly instead of re-describing them loosely.
- `npm run verify:examples` now compile-checks every recipe step in dry-run mode, so it is safe to run even when PyMOL and ChimeraX are not open.
- The operator panel includes a live `Objects + Views` section. Use it to confirm that scenes, named views, surfaces, and measurements were actually created in the target app.
