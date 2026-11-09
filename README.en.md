# BuildersLoop Hub

English ｜ [日本語](README.md)

**A Windows desktop app for running many projects in parallel with Claude Code.**

Hub puts per-project Claude Code sessions (the real `claude` CLI) side by side in one window, together with an in-app browser whose logins are isolated per project, and an MCP server that lets the agents coordinate with each other. You can start a whole team of sessions — "dev", "review", "security", "ops" — with one click and let them talk to each other while you stay in control of every approval.

> Current version: **V8** (see [CHANGELOG.md](CHANGELOG.md)). License: [MIT](LICENSE).
> The user interface is in Japanese for now. Contributions for English UI are welcome.

## Features
- **Per-project sessions**: real `claude` processes in ConPTY terminals, shown as tabs or a grid. Stopped sessions resume from the same conversation (`--resume`).
- **Presets and profiles**: saved prompts (presets) and sets of sessions to start together (profiles).
- **Per-project browser**: an in-app browser with cookies isolated per project. Agents can drive it through MCP.
- **Coordination board**: what each session is touching right now (`work_board`) and work claims (`work_claim`). Conflicts are flagged when two sessions touch the same file.
- **Roster and messaging**: every session is told its name, role and ID; sessions can message each other with `session_send` (with the sender shown). If the recipient is stopped, Hub holds the message and delivers it when that session starts (shown as 📨 in the UI).
- **CLAUDE.md management**: edit each project's instructions in the UI. Agents can only *propose* changes; a human reviews the diff and applies it.
- **Organization rules**: write rules once (e.g. "use only the work account") and Hub passes them to every session.
- **Setup agent**: a dedicated Claude Code session that configures Hub (projects, presets, profiles) through conversation.
- **MCP connections**: enable GitHub, Slack and other MCP servers per session. Secrets are stored encrypted with Windows DPAPI.

## Safety model
Hub's first rule: **an agent must never approve things on behalf of the human.**

- Agents (via MCP) **cannot send approval words** (y / yes / OK / はい …). While a permission prompt is on screen, Enter and typing are refused too. First prompts and held messages are not delivered while a confirmation prompt is on screen either. Right after a session starts (until it is ready for input), text from agents is held and Enter/keys are refused, so they cannot answer a confirmation (such as "trust this folder?") that appears a moment later. Hub also re-checks for a confirmation prompt just before it sends Enter (agent text that contains the wording of a confirmation prompt is refused up front, because it could not be told apart).
- Agents (via MCP) can create **Claude Code sessions only**. They cannot create or restart shell or custom-command sessions (including through `session_resume` and `profile_run`), and cannot type into shells the human opened (so MCP is never a way to run commands without Claude Code's permission prompt). The working folder must be inside the project's registered folders (the setup agent can register folders, but not the home folder, drive roots and the like).
- Text written by agents (first prompts from `session_create`, agent-made profiles, `setup_agent_start`, and agent-made presets even when the human clicks them) starts with a "【送信元：…】" (sender) header, so the receiving session can tell it apart from the human.
- Through Hub's MCP tools, agents **cannot change** CLAUDE.md, safety-related settings, organization rules or MCP connections. Only the human can, in the UI.
- The MCP server listens on `127.0.0.1` only, requires a bearer token, and rejects calls from browsers.
- The in-app browser denies page permission requests (camera, microphone, location, notifications and so on) by default.
- Hub's MCP folder tools (folder listing, reading CLAUDE.md and proposing changes) work only inside folders registered to a project. Drive roots, the home folder and its parents, `~\.claude`, Hub's data folders and network shares cannot be registered (junctions and links are checked by their real target). (What Claude Code itself can read is governed by Claude Code's own permission settings.)
- Hub never loosens Claude Code's permission settings (no `--dangerously-skip-permissions`).

**These protections assume Claude Code's permission prompts are in use.** The limits above apply to Hub's MCP tools. What Claude Code's own tools (file edits, shell commands) may do is decided by Claude Code's permission settings. We also recommend not setting Hub's tools that drive other sessions (`session_create`, `session_send`, `session_resume`, `profile_run`) or the browser (`browser_*`) to "always allow", so that text planted in a web page (prompt injection) cannot pass instructions on to other sessions unnoticed.

Turning on the "CDP" setting (to let an external tool such as Playwright drive Hub's browser) opens a debugging port on `127.0.0.1:9333` with no token. Any program on this PC can then control Hub's windows. It is off by default; turn it on only when you need it.

See "安全の不変条件" in [CLAUDE.md](CLAUDE.md) for the full list. To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## Requirements
- Windows 10 / 11 (x64)
- [Node.js](https://nodejs.org/) 22.12 or later
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in (`claude` on your PATH)

## Run from source
```
git clone https://github.com/buildersloop/hub.git
cd hub
npm install
npm start
```
1. You start with one sample project ("はじめての事業") whose working folder is `~\BuildersLoopHub\general`. Open "🗂 事業の管理" (project manager) and set its name and working folder.
2. Optionally write rules for all sessions in "📜 組織のルール" (organization rules).
3. Start Claude Code with "＋ 新規セッション" (new session). Hub's MCP server is passed to the session automatically.
4. You can also ask "⚙ セットアップ担当" (setup agent) to configure things for you.

**Using the UI**
- Copy from a terminal: select by dragging, then press `Ctrl+C` or right-click. In Claude Code's full-screen view, copying inside Claude Code goes straight to the clipboard. If you cannot select, hold `Shift` while dragging. Paste with `Ctrl+V`, or right-click when nothing is selected (pasting text with a line break into a shell asks first, with right-click or Ctrl+V).
- "☰" at the top left folds the side panel. With many tabs, scroll the tab row with the mouse wheel (the colored edge of a tab is its project's color).

To package an exe, see [docs/RELEASING.md](docs/RELEASING.md).

## Known limitations
- If your Windows user name contains non-ASCII characters or spaces, Hub cannot pass its data paths to Claude Code as arguments. Sessions then start without the identity file (roster, organization rules) and without Hub's MCP server, and Hub shows a notice. (The setup agent starts with its role sent as the first message, but without Hub's MCP tools.)
  - Workaround: in the UI, "MCP" → copy the command, and register Hub's MCP server with `claude mcp add` (user scope). Then every session can use it.
- In-app browser logins and MCP connection secrets are not carried over to a new version; enter them again.

## Where data lives
- `%APPDATA%\buildersloop-hub-v<n>\hub.json`: projects, sessions and settings (one folder per version; a new version copies the previous version's settings on first start).
- Conversations stay in Claude Code's usual place (`~\.claude\projects\…`). Hub reads those transcripts to build the coordination board.

## Feedback and contributing
- Feature requests and bugs: [Issues](https://github.com/buildersloop/hub/issues) (English or Japanese is fine).
- How to send changes: [CONTRIBUTING.md](CONTRIBUTING.md).
