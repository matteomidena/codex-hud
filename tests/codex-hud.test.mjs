import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CODEX_DEFAULT_ITEMS,
  PRESETS,
  STATUS_ITEMS,
  applyItems,
  identifyPreset,
  parseStatusItems,
  parseUseColors,
  removeTuiValue,
  resetHud,
  resolveConfigPath,
  setTuiValue,
  validateItems,
  writeConfig,
} from "../plugins/codex-hud/scripts/codex-hud.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("marketplace entry resolves to the matching plugin manifest", async () => {
  const marketplace = JSON.parse(
    await readFile(path.join(repositoryRoot, ".agents/plugins/marketplace.json"), "utf8"),
  );
  const entry = marketplace.plugins.find(({ name }) => name === "codex-hud");
  assert.ok(entry);
  const pluginRoot = path.resolve(repositoryRoot, entry.source.path);
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.name, entry.name);
  assert.equal(manifest.version, "0.1.0");
});

test("presets contain only known, unique native items", () => {
  const known = new Set(STATUS_ITEMS.map(({ id }) => id));
  for (const items of Object.values(PRESETS)) {
    assert.equal(new Set(items).size, items.length);
    assert.ok(items.every((item) => known.has(item)));
  }
  assert.deepEqual(CODEX_DEFAULT_ITEMS, ["model-with-reasoning", "current-dir"]);
});

test("adds a tui table without changing existing config", () => {
  const source = 'model = "gpt-5.6-sol"\n';
  const updated = applyItems(source, PRESETS.essential);
  assert.match(updated, /^model = "gpt-5\.6-sol"/);
  assert.match(updated, /\[tui\]\nstatus_line = \["model-with-reasoning"/);
  assert.equal(parseUseColors(updated), true);
  assert.deepEqual(parseStatusItems(updated), PRESETS.essential);
});

test("replaces multiline status_line and preserves neighboring tui keys", () => {
  const source = `[tui]
notifications = true
status_line = [
  "model",
  "current-dir",
]
theme = "dracula"

[features]
hooks = true
`;
  const updated = applyItems(source, PRESETS.minimal, false);
  assert.deepEqual(parseStatusItems(updated), PRESETS.minimal);
  assert.equal(parseUseColors(updated), false);
  assert.match(updated, /notifications = true/);
  assert.match(updated, /theme = "dracula"/);
  assert.match(updated, /\[features\]\nhooks = true/);
});

test("supports dotted tui keys", () => {
  const source = 'tui.status_line = ["model"]\ntui.status_line_use_colors = true\n';
  const updated = applyItems(source, PRESETS.full, false);
  assert.match(updated, /^tui\.status_line = \[/);
  assert.doesNotMatch(updated, /\[tui\]/);
  assert.deepEqual(parseStatusItems(updated), PRESETS.full);
  assert.equal(parseUseColors(updated), false);
});

test("keeps dotted-key style when adding the colors setting", () => {
  const source = 'tui.status_line = ["model"]\n';
  const updated = applyItems(source, PRESETS.minimal);
  assert.match(updated, /^tui\.status_line = \[/);
  assert.match(updated, /tui\.status_line_use_colors = true/);
  assert.doesNotMatch(updated, /\[tui\]/);
  assert.deepEqual(parseStatusItems(updated), PRESETS.minimal);
});

test("parsing ignores strings inside TOML comments", () => {
  const source = `[tui]
status_line = [
  "model", # "not-an-item"
  'current-dir',
] # "also-not-an-item"
`;
  assert.deepEqual(parseStatusItems(source), ["model", "current-dir"]);
});

test("refuses to rewrite an inline tui table", () => {
  assert.throws(
    () => setTuiValue('tui = { status_line = ["model"] }\n', "status_line", '["current-dir"]'),
    /inline `tui =/,
  );
});

test("reset removes only HUD keys", () => {
  const source = `[tui]
notifications = true
status_line = ["model"]
status_line_use_colors = false
theme = "dracula"
`;
  const updated = resetHud(source);
  assert.equal(parseStatusItems(updated), null);
  assert.equal(parseUseColors(updated), null);
  assert.match(updated, /notifications = true/);
  assert.match(updated, /theme = "dracula"/);
});

test("removeTuiValue is a no-op when the key is absent", () => {
  const source = "[tui]\nnotifications = true\n";
  assert.equal(removeTuiValue(source, "status_line"), source);
  assert.equal(removeTuiValue("model = 'gpt'", "status_line"), "model = 'gpt'");
});

test("rejects unknown and duplicate items", () => {
  assert.throws(() => validateItems(["model", "made-up"]), /unknown/);
  assert.throws(() => validateItems(["model", "model"]), /duplicate/);
  assert.throws(() => validateItems([]), /at least one/);
});

test("identifies presets and custom selections", () => {
  assert.equal(identifyPreset(null), "codex-default");
  assert.equal(identifyPreset(PRESETS.essential), "essential");
  assert.equal(identifyPreset(["model"]), "custom");
});

test("resolveConfigPath respects an explicit path and the real CODEX_HOME setting", () => {
  assert.equal(resolveConfigPath("./sample.toml", {}), path.resolve("sample.toml"));
  assert.equal(resolveConfigPath(undefined, { CODEX_HOME: "/tmp/codex-hud-home" }), "/tmp/codex-hud-home/config.toml");
});

test("writeConfig creates a private backup and preserves content", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-hud-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml");
  await writeFile(configPath, 'model = "old"\n', { mode: 0o600 });
  await writeConfig(configPath, 'model = "new"\n');
  assert.equal(await readFile(configPath, "utf8"), 'model = "new"\n');
  assert.equal(await readFile(`${configPath}.codex-hud.bak`, "utf8"), 'model = "old"\n');
});

test("preserves CRLF line endings", () => {
  const source = "[tui]\r\nnotifications = true\r\n";
  const updated = applyItems(source, PRESETS.minimal);
  assert.ok(updated.includes("\r\n"));
  assert.equal(updated.replace(/\r\n/g, "").includes("\n"), false);
});
