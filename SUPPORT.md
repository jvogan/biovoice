# Support

Use this page to choose the right public support path for BioVoice.

## Usage Questions

Use the docs first if your question is about setup, workflows, or expected behavior:

- [README](./README.md)
- [Getting Started](./docs/getting-started.md)
- [First Live Session](./docs/first-live-session.md)
- [FAQ and Glossary](./docs/faq.md)
- [Examples Library](./examples/README.md)

If the docs do not answer your question, open a GitHub issue with:

- what you were trying to do
- which target you used (`pymol` or `chimerax`)
- which command or tutorial you followed
- what you expected to happen

## Bug Reports

Open a GitHub bug report when you can describe a reproducible failure.

Include:

- the exact command you ran
- whether you were in live voice or offline rehearsal
- your OS, Node version, and PyMOL / ChimeraX version
- the smallest reproduction you can manage

Use the bug-report template when available.

## Feature Requests

Open a feature request when you want a new workflow, better platform support, or clearer public docs. Good requests explain:

- the structural biology task
- why the current flow is not enough
- which target matters most
- whether the request is about voice UX, workflow coverage, or platform support

## Security and Privacy Issues

Do **not** open a public issue for vulnerabilities, leaked credentials, or anything that would reveal private machine details or sensitive workflow context.

Use [SECURITY.md](./SECURITY.md) instead.

## Before You Post Logs or Screenshots

Redact:

- API keys and access tokens
- full browser URLs
- local filesystem paths you do not want public
- transcript text you would not want indexed
- screenshots that expose sensitive scene, structure, or machine details

## Local-Only Files and Secrets

Normal BioVoice usage keeps the following local-only:

- `.env`
- `.runtime/`
- `local/`
- `private/`
- `tmp/`
- `output/`

The tracked [`.env.example`](./.env.example) file is the safe public template.

## If You Are Unsure Where To File Something

- product or workflow question: use the docs first, then open a public issue
- reproducible bug: open a bug report
- privacy-sensitive or security-sensitive problem: follow [SECURITY.md](./SECURITY.md)
