# Changelog

All notable changes to BioVoice will be documented in this file.

This project is currently published as a **research prototype**, so release notes emphasize public usability, verified workflows, privacy boundaries, and contributor-facing changes.

## [0.1.0] - 2026-04-10

### Added

- Public GitHub release positioning for BioVoice as a scientist-first research prototype
- Hand-authored onboarding docs for getting started, first live session, AlphaFold, Rosetta, ligand pocket, cryo-EM, architecture, and FAQ
- Support and public changelog docs
- SEO / GEO-oriented metadata and summary improvements for the public repo and web app shell

### Improved

- README rewritten as the main public landing page
- Generated examples now point newcomers back to the hand-authored docs flow
- CONTRIBUTING guidance now explains generated docs, testing tiers, and public-doc update expectations
- Public support and privacy guidance for filing issues and sharing screenshots or logs

### Verified

- `npm run check`
- `npm run verify:examples`
- `npm run verify:showcases`

### Notes

- Live voice support today uses **OpenAI Realtime only**
- Local `.env` remains the normal supported setup for private credentials
- Molecular files stay local; live voice sends audio, transcripts, and tool-call text to OpenAI
