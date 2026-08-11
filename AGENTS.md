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

- `main` contains the KCC dual-engine work and the zip packaging switch (3223ff1 onward). Real signed-in Kimi / Claude Code / Codex sessions, the CloudCLI Viewer-path acceptance, and the RC clean-environment acceptance are completed; `v1.0.0` is released.
- Production audit still reports 4 moderate findings, all from CloudCLI's transitive frontend dependencies (prismjs DOM clobbering chain); upstream has no fixed release, so do not apply unverified overrides to CloudCLI's own frontend tree.
- Preserve unrelated dirty files. Do not add `BLOCKED.md`, `PROGRESS.md`, `.exp1-results/`, or one-off acceptance scripts unless the user explicitly approves them.
- Known release limitation: CloudCLI is bundled as an npm dependency, but the compatible Node runtime is not yet bundled; the system needs Node.js 22 (ABI 127) to run CloudCLI.
