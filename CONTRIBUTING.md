# Contributing to BioVoice

Thanks for your interest in BioVoice. This project is public as a **scientist-first research prototype**, so good contributions are the ones that make the local experience clearer, safer, and easier to verify.

## Before You Start

- Read the main [README](./README.md) for the public product story
- Use [docs/getting-started.md](./docs/getting-started.md) if you need the newcomer setup path
- Treat real credentials and local machine state as private
- Prefer structured tool improvements and verified workflows over raw-command shortcuts

## Development Setup

```bash
npm install
npm run prepare:data
npm run generate:examples
cp .env.example .env
```

Set `OPENAI_API_KEY` in local `.env` only if you need live voice. For most development, you can still make progress with offline rehearsal and the verification scripts.

## New Contributor Flow

1. Read the README and one tutorial page so you understand the public user story.
2. Run `npm run check` to establish a clean local baseline.
3. If your change touches workflows, run `npm run verify:examples`.
4. If your change affects live demos or scientific walkthroughs, run `npm run verify:showcases`.
5. Update docs when public behavior, commands, screenshots, or support expectations change.

## Testing Tiers

### Fast baseline

```bash
npm run typecheck
npm test
npm run release:check
npm run build
```

### Full baseline

```bash
npm run check
```

### Workflow coverage

```bash
npm run verify:examples
npm run verify:showcases
```

### Target-specific smoke

```bash
npm run smoke:pymol
npm run smoke:chimerax
```

## Generated Docs Expectations

Parts of the public reference library are generated. Do not hand-edit them and assume the changes will stick.

Generated outputs include:

- `examples/README.md`
- `examples/start-here/README.md`
- `examples/scientific-workflows/README.md`
- `examples/prompt-library/README.md`
- `examples/tool-playbooks/README.md`
- `examples/troubleshooting/README.md`
- `examples/gallery/README.md`
- `examples/workflow-recipes/**`

Source of truth:

- `scripts/generate-example-files.ts`
- recipe and workflow definitions under `packages/runtime-and-adapters/src/examples/`

After changing generator logic or recipe content, run:

```bash
npm run generate:examples
```

## When To Update Docs

Update hand-authored docs under `docs/` and the main README when you change:

- supported platforms
- live voice provider support
- setup steps
- workflow commands or recommended tutorials
- privacy or local-storage behavior
- contributor expectations

Update generated examples when you change:

- recipe steps
- scientific workflow mappings
- prompt packs
- sample data references
- verification checklists

## Good Contribution Areas

- New validated workflows for PyMOL or ChimeraX
- Better AlphaFold, Rosetta, or cryo-EM tutorial coverage
- Linux / Windows startup improvements
- UI clarity and accessibility improvements
- Verification hardening for demos and guided workflows
- Better privacy-safe issue reproduction and reporting flows

## Pull Request Expectations

- Keep the scope focused
- Explain the user-facing change, not just the internal edit
- Include the commands you used to verify the change
- Update docs if the public-facing behavior changed
- Avoid committing local secrets, `.runtime/` state, `output/`, or machine-specific files

Use the PR template and make sure you can honestly check the relevant boxes.

## Code and Workflow Norms

- TypeScript strict mode stays on
- Avoid `any` in production code
- Prefer structured actions over raw commands
- Use repo-relative path helpers instead of hardcoded personal paths
- Keep `.env` local and keep `.env.example` as the tracked safe template
- Keep `local/`, `private/`, `.runtime/`, `tmp/`, and `output/` out of commits

## Reporting Bugs and Asking Questions

- For usage questions and reporting guidance, see [SUPPORT.md](./SUPPORT.md)
- For vulnerabilities or privacy-sensitive issues, see [SECURITY.md](./SECURITY.md)
- For community expectations, see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
