# KCC Workbench Agent Guide

## Project

KCC Workbench is a Windows Electron desktop shell for Kimi Code and CloudCLI (Claude Code / Codex), with a shared local Viewer for project files, artifacts, and checkpoints.

## Commands

- Install: `npm ci`
- Test: `npm test`
- Run: `npm start`
- Isolated demo: `npm run demo -- --demo-profile=<name>`
- Build unpacked app: `npm run build`
- Build portable app: `npm run pack`

Use Node.js 22 for development and packaging. CloudCLI currently starts through a compatible system Node runtime; a future release should bundle that runtime before claiming zero-prerequisite portability.

## Architecture and boundaries

- `src/main/`: Electron main process, Kimi/CloudCLI services, settings, quota, Viewer context synchronization.
- `src/renderer/`: title bar, settings, quota, and service status pages.
- `src/viewer/`: local authenticated Viewer server and frontend.
- `test/`: Node test suite; tests must use isolated temporary data.
- Kimi and CloudCLI use separate persistent `WebContentsView` instances. Engine switching must not reload either view.
- Kimi-only controls are Settings, Restart Home, and Quota.
- CloudCLI Viewer context prefers the selected `/session/:id` plus CloudCLI's authenticated session-details API; JSONL activity is fallback only.
- Viewer context diagnostics belong in `%APPDATA%\KCC Workbench\viewer-context.log`; never log auth tokens or cookies.

## GitHub conventions

- This is a GitHub repository. GitLab branch, remote, MR, pipeline, and `zoesoftgitlab/develop` rules do not apply.
- Commit format: `type(scope): 简体中文标题` with a compact root-cause → fix body when useful.
- Footer: `Co-Authored-By: Codex <noreply@openai.com>`.
- Repository author: `Dylan5237 <58796901+Dylan5237@users.noreply.github.com>`.
- One independent change per commit. Run `npm test`; run `npm run build` when the change can affect packaging or runtime behavior.
- Push only after explicit user confirmation; push the current feature branch to GitHub `origin`.

## Current status

- `main` and `feature/kcc-engines` both contain the KCC dual-engine work as of 2026-08-11; no post-rename KCC Release has been published yet.
- Real signed-in CloudCLI Viewer-path acceptance remains pending; unit tests and the unauthenticated fallback path are not equivalent to that live proof.
- Preserve unrelated dirty files. Do not add `BLOCKED.md`, `PROGRESS.md`, `.exp1-results/`, or one-off acceptance scripts unless the user explicitly approves them.
- Known release limitation: CloudCLI is bundled as an npm dependency, but the compatible Node runtime is not yet bundled.
