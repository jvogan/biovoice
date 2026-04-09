# Contributing to BioVoice

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
4. Set your `OPENAI_API_KEY` in `.env`
5. Pull demo data and generate examples:
   ```bash
   npm run prepare:data
   npm run generate:examples
   ```

## Development Workflow

Start the dev server:

```bash
npm run dev
```

This runs the Vite frontend (port 5173) and the Express backend (port 3000) concurrently.

### Running Checks

Before submitting a PR, make sure everything passes:

```bash
npm run typecheck   # TypeScript strict mode
npm test            # Vitest unit tests
npm run release:check  # Tracked-file release hygiene and secret scan
npm run build       # Full production build
npm run check       # All of the above
```

## Project Structure

```
apps/voice-console/      React frontend + Express backend
packages/runtime-and-adapters/  Shared schemas, adapters, prompts, recipes
scripts/                 CLI tools (startup, rehearsal, data fetch)
tests/                   Unit and integration tests
examples/                Generated docs, workflows, prompt packs
```

## What to Contribute

### Good First Issues

Look for issues labeled `good first issue` in the issue tracker.

### Areas Where Help is Welcome

- **Platform support** — The autolaunch system currently targets macOS only. Linux and Windows adapter paths would be valuable.
- **New demo workflows** — Each recipe is defined in `packages/runtime-and-adapters/src/examples/library.ts`. If you have a good structural biology workflow, we'd love to include it.
- **Documentation** — Guides, tutorials, and examples are always appreciated.
- **Testing** — More unit tests and integration coverage.
- **Accessibility** — Making the voice console more accessible.

### Adding a New Demo Workflow

1. Add your recipe to the catalog in `packages/runtime-and-adapters/src/examples/library.ts`
2. Follow the existing recipe schema (typed via Zod in `packages/runtime-and-adapters/src/schemas/`)
3. Run `npm run generate:examples` to regenerate docs
4. Run `npm run verify:examples` to validate
5. If possible, test with `npm run rehearse:workflow -- <your-recipe-id> --target <pymol|chimerax> --dry-run`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Make sure `npm run check` passes
- Add tests for new functionality
- Update documentation if behavior changes

## Code Style

- TypeScript strict mode (`"strict": true`)
- No `any` types in production code
- Prefer structured actions over raw commands in adapters
- Use `resolveFromRoot()` for file paths, never hardcoded absolute paths

## Reporting Issues

Use the GitHub issue templates for bug reports and feature requests. Include:

- Steps to reproduce (for bugs)
- Your environment (OS, Node version, PyMOL/ChimeraX version)
- Console output or error messages

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
