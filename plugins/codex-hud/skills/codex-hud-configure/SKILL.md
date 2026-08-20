---
name: codex-hud-configure
description: Customize Codex HUD presets, native status-line items, colors, or reset behavior. Use when the user asks to configure, simplify, expand, change, inspect, or remove fields from the Codex status line, including model, reasoning, project, Git, context, usage, tokens, run state, task progress, or version.
---

# Configure Codex HUD

Read the current status-line configuration, translate the user's preferences to native Codex item identifiers, and update only the relevant `[tui]` keys.

## Workflow

1. Resolve this installed skill's directory and the plugin root two directories above it. Never assume the current working directory is the plugin directory.
2. Inspect the current state:

   ```bash
   node "<plugin-root>/scripts/codex-hud.mjs" status --json
   node "<plugin-root>/scripts/codex-hud.mjs" items --json
   ```

3. If the user specified a preset or exact fields, map and apply it directly. If their preference is genuinely unclear, show the current items and ask one concise question: `Essential, full, minimal, or custom?`
4. Before changing the live Codex config, state the target path. Request approval when required to write outside the workspace.
5. Apply one preset:

   ```bash
   node "<plugin-root>/scripts/codex-hud.mjs" apply --preset full
   ```

   Or apply a custom ordered list:

   ```bash
   node "<plugin-root>/scripts/codex-hud.mjs" apply --items "model-with-reasoning,current-dir,git-branch,task-progress,context-used"
   ```

   Add `--no-colors` only when the user asks for an uncolored footer.
6. Re-run `status --json`, report the result, and suggest starting a new CLI session if the footer does not refresh immediately.

## Native item mapping

| User concept | Item identifier |
| --- | --- |
| Model and reasoning | `model-with-reasoning` |
| Reasoning only | `reasoning` |
| Current directory | `current-dir` |
| Project name | `project-name` |
| Git branch | `git-branch` |
| Pull request number | `pull-request-number` |
| Changes versus default branch | `branch-changes` |
| Ready/working/thinking | `run-state` |
| Permission or sandbox profile | `approval-mode` |
| Context remaining/used | `context-remaining`, `context-used` |
| 5-hour/weekly usage remaining | `five-hour-limit`, `weekly-limit` |
| Context-window size | `context-window-size` |
| Session/input/output tokens | `used-tokens`, `total-input-tokens`, `total-output-tokens` |
| Current task progress | `task-progress` |
| Thread title/id | `thread-title`, `thread-id` |
| Fast/raw mode | `fast-mode`, `raw-output` |
| Codex version | `codex-version` |

Some values are omitted by Codex when unavailable. Codex does not currently expose custom footer identifiers for individual tool names or a live subagent roster; use `run-state` and `task-progress` as the native equivalents and never claim exact parity for those two Claude HUD fields.

## Reset

To remove the custom selection and return to Codex's built-in default status line:

```bash
node "<plugin-root>/scripts/codex-hud.mjs" reset
```

Do not hand-edit marketplace files or unrelated config. If the helper reports an unsupported inline `tui = { ... }` table, direct the user to `/statusline` instead of rewriting the inline table.
