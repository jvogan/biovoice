# BioVoice Docs

This directory is the hand-authored public docs hub for BioVoice.

## If You Are A Scientist

Read in order:

1. [Getting Started](./getting-started.md)
2. [First Live Session](./first-live-session.md)
3. One of the science tutorials:
   - [Ligand Pocket Tutorial](./tutorial-ligand-pocket.md)
   - [AlphaFold Tutorial](./tutorial-alphafold.md)
   - [Rosetta Tutorial](./tutorial-rosetta.md)
   - [Cryo-EM Tutorial](./tutorial-cryo-em.md)
4. [Architecture and Provider Support](./architecture.md)
5. [FAQ and Glossary](./faq.md)

## If You Are A Developer Or AI Engineer

Read these first:

1. [How Tool Calling Works](./realtime-tool-calling.md) — the 11 Realtime function tools in the catalog, the selector schema pattern, `get_target_state` grounding, database asset resolution, scientific-workflow compilation, dry-run mode, and session guardrails
2. [Architecture and Provider Support](./architecture.md) — local-versus-remote boundary, WebRTC path, privacy matrix
3. [Local Agent Contract](./agent-contract.md) — loopback-only JSON commands for readiness, planning, execution, state, capture, undo, and receipts
4. [Tool Playbooks](../examples/tool-playbooks/README.md) — the atomic PyMOL and ChimeraX action surface available to the model
5. [Scientific Workflows Catalog](../examples/scientific-workflows/README.md) — task-level AlphaFold, Rosetta, and variant workflows exposed behind a single function tool

The authoritative source for every tool schema is [`packages/runtime-and-adapters/src/realtime/tool-definitions.ts`](../packages/runtime-and-adapters/src/realtime/tool-definitions.ts).

## Operator Reference

- [Public Release Checklist](./public-release.md)
- [Examples Library](../examples/README.md) — the generated reference set (recipes, prompt packs, troubleshooting, gallery, verification)
- [Guided Tutorials](../examples/guided-tutorials/) — AlphaFold / Rosetta and natural-language structure control walkthroughs

## What These Docs Are For

- newcomer onboarding
- first-session success
- scientist-facing tutorial flow
- developer-facing tool-calling reference
- privacy and support guidance
- public architecture and support boundaries
- public release readiness and repository settings

## What These Docs Are Not

- they are not the generated recipe source of truth
- they are not a replacement for `examples/`
- they do not imply support for live voice providers beyond OpenAI Realtime today
