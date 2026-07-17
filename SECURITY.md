# Security Policy

For normal usage questions, bug reports, or privacy-safe public reporting guidance, see [SUPPORT.md](./SUPPORT.md).

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | Yes                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Use GitHub private vulnerability reporting if it is enabled for the repository
3. If private reporting is unavailable, use the contact address listed on the maintainer GitHub profile
4. If no private address is available, open a minimal public issue requesting a private contact channel without posting sensitive details
5. Include steps to reproduce if possible

You should receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Security Considerations

BioVoice runs as a local server on your machine. Be aware of the following:

- **API keys**: Your `OPENAI_API_KEY` is stored in `.env` and never sent to any service other than OpenAI. Never commit `.env` to version control.
- **Local-only files**: `.env`, `.runtime/`, `local/`, `private/`, `tmp/`, and `output/` are intended to stay local. The tracked `.env.example` file is the safe public template.
- **Network binding**: The server binds to `127.0.0.1` by default (localhost only). Remote access is rejected unless you explicitly set `ALLOW_REMOTE_CLIENTS=true`.
- **LAN access**: If you intentionally expose the service on your LAN, set `HOST=0.0.0.0`, `ALLOW_REMOTE_CLIENTS=true`, and use `REMOTE_ACCESS_TOKEN` or the generated access URL printed at startup. `LOCAL_BROWSER_ORIGINS` only controls which browser origins may make cross-origin requests after that access token is presented.
- **File access**: Structure loading is restricted by default to repo demo data (`examples/data/local`), `.runtime/`, and `output/`. Exports are restricted to `.runtime/exports` and `output/`. If you need additional private structure folders, opt in with `STRUCTURE_ALLOWED_PATHS` or `EXPORT_ALLOWED_PATHS` in local `.env`. The server rejects paths outside those roots.
- **Raw commands**: The `raw_command` action type is disabled by default. It is gated behind both `ENABLE_EXPERT_RAW_COMMANDS=true` (server-side), a per-session `advancedMode` flag, and an explicit confirmation marker on the action. When enabled, the AI model can execute arbitrary PyMOL Python or ChimeraX commands — including file I/O and network operations within those applications. Only enable this in environments where you trust all voice input.
- **Viewport uploads**: Captures stay local by default. Attaching a viewport image to the model conversation requires both `ALLOW_CAPTURE_UPLOADS=true` and a fresh, short-lived, single-use consent grant created by an authenticated user action in that live session. A tool argument cannot grant consent by itself. Attachments above 10 MiB remain local and return a warning. Session and model exports are never attached by this path.
- **CORS**: The server restricts browser access to localhost origins by default. Additional trusted origins can be added via `LOCAL_BROWSER_ORIGINS`.
- **Local retention**: Session event logs, transcripts, captures, workflow exports, run receipts, one-level undo checkpoints, and runtime logs may be written to `.runtime/` or `output/` depending on the feature path and retention settings. Review the `RUNTIME_*` knobs in `.env` and run `npm run cleanup:runtime` before sharing a machine snapshot.
- **Screenshots and bug reports**: Browser URLs, workflow inputs, target endpoints, and transcript text may appear in screenshots or logs. Redact those details before filing public issues.
