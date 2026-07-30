<div align="center">
  <img src="./docs/assets/app-icon.png" width="88" height="88" alt="Kimi Desktop Workbench">

  <h1>Kimi Desktop Workbench</h1>

  <p><a href="./README.md">简体中文</a> · <strong>English</strong></p>

  <p><strong>An unofficial local desktop workbench for Kimi Code</strong></p>
  <p>Bring Kimi Web, Coding Plan quota tracking, visual configuration, session artifacts, and time travel into one Windows app.</p>

  <p>
    <a href="https://github.com/Dylan5237/kimi-code-workbench/actions/workflows/ci.yml"><img src="https://github.com/Dylan5237/kimi-code-workbench/actions/workflows/ci.yml/badge.svg" alt="Windows CI"></a>
    <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows" alt="Windows 10 / 11">
    <img src="https://img.shields.io/badge/status-Beta-F59E0B" alt="Beta">
    <img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey" alt="UNLICENSED">
  </p>

  <p>
    <a href="#quick-start">Quick Start</a>
    ·
    <a href="#core-capabilities">Features</a>
    ·
    <a href="https://github.com/Dylan5237/kimi-code-workbench/releases">Download</a>
    ·
    <a href="./PRIVACY.md">Privacy</a>
    ·
    <a href="./SECURITY.md">Security</a>
  </p>
</div>

> [!IMPORTANT]
> Kimi Desktop Workbench is an unofficial community project. It is not affiliated with, sponsored by, or endorsed by Moonshot AI or Kimi. Kimi, Kimi Code, and related names and marks belong to their respective owners.

## Why this workbench

Kimi Code already provides a complete terminal and web workflow, but quota information, configuration, and session artifacts live in separate places. Kimi Desktop Workbench does not replace Kimi Code. It adds a unified local desktop layer around it:

| Use case | What the workbench provides |
| --- | --- |
| Switching between the browser and terminal | Starts and embeds the local Kimi Web UI while preserving the original session experience |
| Not knowing how long your Coding Plan quota will last | Synchronizes quota on demand and estimates depletion risk from local usage history |
| Configuration files that are hard to discover and easy to mis-edit | Exposes common settings in a visual interface with explicit saves and backups |
| Session-generated files scattered across a project | Combines a live file tree, friendly previews, line diffs, and native file copy |
| Revisiting or continuing from an earlier state | Saves artifact checkpoints and can safely fork a new Git workspace |

## Core capabilities

| | Capability | Description |
| --- | --- | --- |
| **01** | **Kimi Web desktop workspace** | Starts or reuses `kimi web` inside a persistent Home tab, with a file viewer and visual settings. |
| **02** | **Coding Plan quota** | Synchronizes total quota, Kimi / Code shares, five-hour usage, seven-day usage, and reset times only when requested. |
| **03** | **Quota Autopilot** | Stores local quota samples and estimates depletion risk from consumption velocity, turning a percentage into a clearer pacing signal. |
| **04** | **Visual system configuration** | Manages models, thinking, Agent behavior, permissions, MCP, Skills, Hooks (read-only in this release), workspaces, and system prompts; nothing is written until you save. |
| **05** | **Artifact and file viewer** | Watches the project directory, renders Markdown / Mermaid, JSON, and HTML, and supports filtering, source views, line diffs, and native Windows file copy. |
| **06** | **Task time machine** | Persists artifact checkpoints, replays historical content and diffs, and creates an isolated branch + worktree from a checkpoint in Git projects. |

### One window, three fixed work views

```text
Home (Kimi Web) ── current project context ──▶ File Viewer / Artifacts / Time Machine
       │
       ├── open quota widget ────────────────▶ Manual Coding Plan sync and forecast
       │
       └── System Settings ──────────────────▶ Visual Kimi Code configuration
```

## Quick start

### 1. Prerequisites

- Windows 10 / 11 x64
- Kimi Code CLI installed
- `kimi web` can start the local Web UI from PowerShell
- Access to `https://www.kimi.com` when synchronizing quota

### 2. Download and run

Download the latest `Kimi-Desktop-*-x64.exe` from [Releases](https://github.com/Dylan5237/kimi-code-workbench/releases), then run it directly. Current releases are portable and require no installation.

> [!TIP]
> On first launch, make sure the Home tab can load Kimi Web. Quota is never synchronized automatically: open the “Quota” widget in the title bar and click “Update”.

### 3. Start working

1. Create or open a Kimi Code session from Home.
2. Switch to File Viewer. The workbench will prefer the project directory associated with the current conversation.
3. Open Current Artifacts to inspect created, modified, and deleted files with line diffs.
4. Open System Settings when you need to adjust Kimi Code, review the changes, and explicitly save them.

If the current project cannot be detected, File Viewer keeps the last opened directory. It remains empty when no previous directory exists, allowing you to select one manually.

## Feature details

<details>
<summary><strong>Coding Plan quota and forecasting</strong></summary>

- Reads total quota, Kimi / Code shares, five-hour usage, seven-day usage, and their reset times from the Kimi quota page.
- Keeps login state in a persistent Electron session without writing cookies into quota history JSON.
- Visits the quota page only after you click “Update”; there is no scheduled background scraping.
- Quota Autopilot calculates locally from saved samples and avoids presenting a forecast when there is not enough data.

</details>

<details>
<summary><strong>Visual configuration</strong></summary>

- General settings, models and thinking, Agent execution, permissions, and tools.
- MCP services, Skills, Hooks, workspaces, and advanced diagnostics.
- User-level `SYSTEM.md` and global `AGENTS.md` system prompts.
- Every edit requires an explicit save, with a `.bak` backup created before overwriting.
- Demo mode and automated tests always use an isolated configuration directory and never touch real Kimi configuration.

</details>

<details>
<summary><strong>File Viewer and session artifacts</strong></summary>

- Friendly Markdown rendering, source view, and Mermaid diagrams.
- Table, tree, and raw views for JSON.
- Sandboxed HTML preview and source view with scripts, forms, and external network access disabled by default.
- Live file-tree updates, filename filtering, adjustable width, path copy, and native Windows file copy.
- Current Artifacts combines created, modified, and deleted files with line-level diffs.

</details>

<details>
<summary><strong>Task time machine</strong></summary>

- Persists artifact checkpoints per Kimi conversation.
- Replays historical Markdown, JSON, and HTML content with file-level diffs.
- Stores size-limited patches and untracked-file snapshots for Git projects.
- Creates an isolated branch + worktree from any checkpoint for continued development.
- Does not provide an in-place rollback that could overwrite the current project.

</details>

## Data and security boundaries

| Data or operation | How it is handled |
| --- | --- |
| Kimi Web | Home connects only to local `127.0.0.1:5494`; network behavior is owned by the local Kimi Code service |
| Quota login state | Managed by a persistent Electron Chromium session and never written to quota history |
| Quota synchronization | Visits the Kimi quota page only after a user-initiated update |
| Configuration changes | Written only after an explicit save, with a `.bak` backup created first |
| HTML preview | Uses sandboxing, CSP, and resource allowlists without executing page scripts |
| Time machine | Stores snapshots in local app data; snapshots may contain project file content |
| Git fork | Creates a new branch + worktree after confirmation without rewriting the current workspace |

Read the complete [Privacy Notice](./PRIVACY.md) and [Security Policy](./SECURITY.md). Before opening an issue, remove accounts, cookies, tokens, project source code, and absolute local paths from logs.

## Run from source

Development requires Node.js 22 and npm.

```powershell
git clone https://github.com/Dylan5237/kimi-code-workbench.git
cd kimi-code-workbench
npm ci
npm test
npm start
```

Start the demo with an isolated configuration profile:

```powershell
npm run demo -- --demo-profile=manual-test
```

Build an unpacked Windows app:

```powershell
npm run build
& ".\dist\win-unpacked\Kimi Desktop.exe"
```

Build a portable release:

```powershell
npm run dist
```

Pushes and pull requests run tests and a Windows build in GitHub Actions. Tags matching `v*` trigger the portable release workflow.

## FAQ

<details>
<summary><strong>Is this an official Kimi client?</strong></summary>

No. This is an independently developed, unofficial desktop workbench and does not represent Moonshot AI or Kimi.

</details>

<details>
<summary><strong>Does the workbench fetch quota in the background?</strong></summary>

No. It synchronizes quota only after you click “Update”, and forecasting is performed entirely from local history.

</details>

<details>
<summary><strong>Does opening System Settings change my Kimi configuration?</strong></summary>

No. Browsing and editing a draft do not write any file. Changes are written only after an explicit save, with a backup created first.

</details>

<details>
<summary><strong>Does Time Machine roll back my project in place?</strong></summary>

No. It provides historical playback. When you continue from a checkpoint in a Git repository, it creates an isolated worktree instead of overwriting the current directory.

</details>

## Project status and participation

The project is currently in **Beta** and prioritizes local, single-user workflows on Windows. You can participate through:

- [GitHub Issues](https://github.com/Dylan5237/kimi-code-workbench/issues) for bug reports and feature requests
- [Pull Requests](https://github.com/Dylan5237/kimi-code-workbench/pulls) for focused, verifiable improvements
- [Changelog](./CHANGELOG.md) for the current release scope

## License

This repository is currently marked `UNLICENSED`. Public source visibility does not grant permission to copy, modify, distribute, or use the code commercially. Any future transition to an open-source license will be announced in a dedicated release.

---

<div align="center">
  <sub>Built for a focused Kimi Code workflow on Windows.</sub>
</div>
