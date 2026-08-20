# Codex HUD

A Codex port of [Claude HUD](https://github.com/jarrodwatts/claude-hud) that configures Codex's native terminal status line.

Codex HUD keeps the useful session signals visible below the composer: model and reasoning, project, Git branch, task progress, context health, rate limits, tokens, run state, Fast mode, approval mode, and Codex version.

Unlike the Claude implementation, this port does not run a renderer after every interaction. Codex already owns the footer, so the plugin selects native `tui.status_line` items. After setup there is no background process, transcript parser, network request, or per-turn overhead.

## Install

Requires a recent Codex CLI with `/statusline` support and Node.js 18+ for the one-time configuration helper. It was developed against Codex CLI 0.147.0.

```bash
codex plugin marketplace add mmatteo23/codex-hud
codex plugin add codex-hud@codex-hud
```

Start a new Codex conversation, then invoke:

```text
$codex-hud-setup
```

The setup skill applies the recommended `essential` preset while preserving the rest of `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`).

For a local checkout:

```bash
codex plugin marketplace add .
codex plugin add codex-hud@codex-hud
```

## Configure

Invoke `$codex-hud-configure` and ask for a preset or individual fields. Codex's built-in `/statusline` picker also remains available.

| Preset | Fields |
| --- | --- |
| `minimal` | Model/reasoning, directory, context used |
| `essential` | Minimal + Git, task progress, 5-hour and weekly limits |
| `full` | Essential + branch changes, run state, tokens, Fast mode, approvals, version |

The bundled helper can also be run directly during development:

```bash
node plugins/codex-hud/scripts/codex-hud.mjs status
node plugins/codex-hud/scripts/codex-hud.mjs apply --preset full
node plugins/codex-hud/scripts/codex-hud.mjs apply --items "model-with-reasoning,current-dir,git-branch,context-remaining"
node plugins/codex-hud/scripts/codex-hud.mjs reset
```

Before each live write, the helper preserves unrelated TOML and saves the previous file as `config.toml.codex-hud.bak`.

## Claude HUD feature mapping

| Claude HUD | Codex HUD |
| --- | --- |
| Model and effort | `model-with-reasoning` |
| Project path | `current-dir` or `project-name` |
| Git status | `git-branch`, `branch-changes`, `pull-request-number` |
| Context health | `context-used` or `context-remaining` |
| Subscriber usage | `five-hour-limit`, `weekly-limit` |
| Todo progress | `task-progress` from `update_plan` |
| General activity | `run-state` (Ready/Working/Thinking) |
| Session tokens | `used-tokens`, input/output token items |

Codex does not currently expose custom footer identifiers for individual tool names or a live subagent roster, and its footer is a native single line rather than Claude HUD's custom multi-line renderer. This plugin uses the closest supported Codex signals instead of scraping unstable rollout transcripts.

## Development

```bash
npm test
npm run check
```

The repository is a Codex marketplace; the installable plugin is under [`plugins/codex-hud`](plugins/codex-hud).

## Credits

Inspired by and ported from Claude HUD 0.8.0 by Jarrod Watts. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the pinned upstream revision and license notice.

## License

MIT
