# Public Release Checklist

Use this checklist before making the GitHub repository public, cutting a tag, or sharing the repo with external users.

BioVoice is ready to publish as a **research prototype**, not as a packaged commercial app. The public story should stay clear about that boundary.

## Release Positioning

Ready:

- Local voice-control prototype for PyMOL and ChimeraX
- OpenAI Realtime is the only supported live voice provider
- Offline rehearsal mode works without an OpenAI key
- Demo data is downloaded locally with `npm run prepare:data`
- Public docs, examples, support, security, license, citation, issue templates, and CI are present

Not ready to claim:

- No npm package distribution
- No packaged desktop installer
- No local/offline speech stack
- No Anthropic, Gemini, or multi-provider live voice support
- No first-class Linux / Windows autolaunch flow
- No guarantee that arbitrary private structure workflows are safe to post in public logs or screenshots

## Required Local Checks

Run these from a clean checkout:

```bash
npm ci
npm run prepare:data
npm run check
npm run verify:examples
```

Run showcase verification when demo workflows changed:

```bash
npm run verify:showcases
```

Run target smoke checks when you have the desktop apps installed:

```bash
npm run smoke:pymol
npm run smoke:chimerax
```

## Privacy And Security Gate

Before publishing:

- Confirm `.env` is untracked and ignored
- Confirm `.runtime/`, `tmp/`, `output/`, `local/`, and `private/` are untracked
- Run `npm run release:check`
- Run `npm audit --audit-level=high --omit=dev`
- Redact screenshots, logs, browser URLs, local paths, hostnames, transcripts, and private structures before putting them in issues or docs
- Keep `ENABLE_EXPERT_RAW_COMMANDS=false` in public demos unless you explicitly trust the environment

`npm run release:check` currently blocks tracked secrets, personal filesystem paths, local-only artifact paths, and broken relative Markdown links.

## GitHub Settings To Confirm

Before switching visibility to public:

- Repository description matches the README one-line story
- Topics include `pymol`, `chimerax`, `structural-biology`, `molecular-visualization`, `voice-control`, `openai-realtime`, `alphafold`, and `rosetta`
- Issues are enabled
- Private vulnerability reporting is enabled if available
- `main` is the default branch
- Branch protection or rulesets require CI before merging
- The README social preview image renders correctly

## First External User Path

The recommended path for a brand-new user is:

1. Read [Getting Started](./getting-started.md)
2. Run `npm install`
3. Run `npm run prepare:data`
4. Run `npm run agent:start -- pymol --offline --clean-target`
5. Move to [First Live Session](./first-live-session.md) only after offline rehearsal works

## Known Public Friction

These are acceptable for a 0.1 research prototype but should be visible:

- Installing PyMOL and ChimeraX is outside this repo
- Demo data download depends on external structural biology data hosts
- Live voice requires an OpenAI API key and may incur usage costs
- macOS is the best-supported launch path
- Some advanced molecular edits still need improved structured actions instead of raw command fallback

## Release Notes

Before tagging a release:

- Update [CHANGELOG.md](../CHANGELOG.md)
- Confirm [CITATION.cff](../CITATION.cff) version/date match the release
- Confirm README badges and support boundaries still match the implementation
- Commit generated example docs after changing recipe source or generator logic
