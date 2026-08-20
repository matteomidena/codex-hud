---
name: codex-hud-setup
description: Set up or repair Codex HUD by configuring Codex's native terminal status line. Use when the user asks to install, initialize, enable, fix, or restore Codex HUD or wants a useful Codex footer with model, project, Git, task progress, context, and usage information.
---

# Set up Codex HUD

Configure Codex's native `[tui].status_line` with the bundled helper. The HUD has no background process and makes no API calls.

## Workflow

1. Resolve this installed skill's directory, then resolve the plugin root two directories above it. Never assume the user's current working directory is the plugin directory.
2. Verify that `node --version` reports Node.js 18 or newer. If Node is unavailable, explain the requirement and stop without editing config.
3. Run this read-only inspection first, substituting the resolved absolute plugin path:

   ```bash
   node "<plugin-root>/scripts/codex-hud.mjs" status --json
   ```

4. Use the `essential` preset unless the user explicitly requested `full`, `minimal`, or a custom item list.
5. Tell the user which config file will change and which preset will be applied. When the environment requires approval to write outside the workspace, request it before continuing.
6. Apply the preset:

   ```bash
   node "<plugin-root>/scripts/codex-hud.mjs" apply --preset essential
   ```

7. Report the configured items and tell the user to start a new Codex CLI session if the current session does not refresh immediately. Mention `/statusline` as the built-in live editor.

## Presets

- `essential` (recommended): model/reasoning, directory, Git branch, task progress, context used, and 5-hour/weekly limits.
- `full`: adds branch changes, run state, tokens, Fast mode, approval mode, and Codex version.
- `minimal`: model/reasoning, directory, and context used.

Use `presets --json` to inspect the exact current definitions. Do not change model, sandbox, approval, MCP, plugin, hook, or other TUI settings. The helper must preserve unrelated TOML content and writes a `config.toml.codex-hud.bak` backup when a config already exists.

If the user wants individual fields rather than a preset, continue with `$codex-hud-configure`.
