#!/usr/bin/env node

import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const STATUS_ITEMS = Object.freeze([
  { id: "model", description: "Current model name" },
  { id: "model-with-reasoning", description: "Current model and reasoning level" },
  { id: "reasoning", description: "Current reasoning level" },
  { id: "current-dir", description: "Current working directory" },
  { id: "project-name", description: "Project name" },
  { id: "git-branch", description: "Current Git branch" },
  { id: "pull-request-number", description: "Pull request number for the branch" },
  { id: "branch-changes", description: "Committed changes against the default branch" },
  { id: "run-state", description: "Ready, working, or thinking state" },
  { id: "approval-mode", description: "Permission profile or sandbox mode" },
  { id: "context-remaining", description: "Percentage of context remaining" },
  { id: "context-used", description: "Percentage of context used" },
  { id: "five-hour-limit", description: "Remaining primary usage limit" },
  { id: "weekly-limit", description: "Remaining secondary usage limit" },
  { id: "codex-version", description: "Codex application version" },
  { id: "context-window-size", description: "Context-window size in tokens" },
  { id: "used-tokens", description: "Total tokens used in the session" },
  { id: "total-input-tokens", description: "Total input tokens" },
  { id: "total-output-tokens", description: "Total output tokens" },
  { id: "thread-id", description: "Current thread identifier" },
  { id: "thread-title", description: "Current thread title" },
  { id: "fast-mode", description: "Whether Fast mode is active" },
  { id: "raw-output", description: "Whether raw scrollback mode is active" },
  { id: "workspace-headline", description: "Enterprise workspace notification headline" },
  { id: "task-progress", description: "Latest update_plan task progress" },
]);

export const PRESETS = Object.freeze({
  minimal: Object.freeze(["model-with-reasoning", "current-dir", "context-used"]),
  essential: Object.freeze([
    "model-with-reasoning",
    "current-dir",
    "git-branch",
    "task-progress",
    "context-used",
    "five-hour-limit",
    "weekly-limit",
  ]),
  full: Object.freeze([
    "model-with-reasoning",
    "current-dir",
    "git-branch",
    "branch-changes",
    "run-state",
    "task-progress",
    "context-used",
    "five-hour-limit",
    "weekly-limit",
    "used-tokens",
    "fast-mode",
    "approval-mode",
    "codex-version",
  ]),
});

export const CODEX_DEFAULT_ITEMS = Object.freeze(["model-with-reasoning", "current-dir"]);

const KNOWN_ITEM_IDS = new Set(STATUS_ITEMS.map(({ id }) => id));
const TABLE_HEADER = /^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/;

function tableName(line) {
  const match = TABLE_HEADER.exec(line);
  if (!match) return null;
  const value = match[1].trim();
  if (value === "tui" || value === '"tui"' || value === "'tui'") return "tui";
  return value;
}

function splitDocument(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalEol = source.endsWith("\n");
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  if (hadFinalEol) lines.pop();
  return { lines, eol, hadFinalEol };
}

function joinDocument(lines, eol, hadFinalEol = true) {
  if (lines.length === 0) return "";
  return `${lines.join(eol)}${hadFinalEol ? eol : ""}`;
}

function assignmentEnd(lines, start) {
  const first = lines[start];
  const equals = first.indexOf("=");
  let squareDepth = 0;
  let braceDepth = 0;
  let sawContainer = false;
  let quote = null;
  let escaped = false;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const from = index === start ? equals + 1 : 0;
    for (let cursor = from; cursor < line.length; cursor += 1) {
      const char = line[cursor];
      if (quote) {
        if (quote === '"' && escaped) {
          escaped = false;
        } else if (quote === '"' && char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === "#") break;
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "[") {
        squareDepth += 1;
        sawContainer = true;
      } else if (char === "]") {
        squareDepth -= 1;
      } else if (char === "{") {
        braceDepth += 1;
        sawContainer = true;
      } else if (char === "}") {
        braceDepth -= 1;
      }
    }
    if (!quote && (!sawContainer || (squareDepth <= 0 && braceDepth <= 0))) return index;
  }
  return lines.length - 1;
}

function findTuiSection(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (tableName(lines[index]) === "tui") starts.push(index);
  }
  if (starts.length > 1) {
    throw new Error("config.toml contains more than one [tui] table; use /statusline to repair it");
  }
  if (starts.length === 0) return null;
  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (TABLE_HEADER.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function findAssignments(lines, key, bounds, dotted = false) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const name = dotted ? `tui\\.${escapedKey}` : escapedKey;
  const matcher = new RegExp(`^\\s*${name}\\s*=`);
  const start = bounds?.start ?? 0;
  const end = bounds?.end ?? lines.length;
  const matches = [];
  for (let index = start; index < end; index += 1) {
    if (matcher.test(lines[index])) matches.push({ start: index, end: assignmentEnd(lines, index) });
  }
  return matches;
}

function assertSingle(matches, key) {
  if (matches.length > 1) {
    throw new Error(`config.toml contains duplicate ${key} assignments; use /statusline to repair it`);
  }
}

function hasInlineTui(lines) {
  return lines.some((line) => /^\s*tui\s*=\s*\{/.test(line));
}

function hasDottedTui(lines) {
  return lines.some((line) => /^\s*tui\.[A-Za-z0-9_-]+\s*=/.test(line));
}

function replaceRange(lines, range, replacement) {
  lines.splice(range.start, range.end - range.start + 1, replacement);
}

export function setTuiValue(source, key, serializedValue) {
  const document = splitDocument(source);
  const { lines } = document;
  let section = findTuiSection(lines);

  if (section) {
    const matches = findAssignments(lines, key, { start: section.start + 1, end: section.end });
    assertSingle(matches, `[tui].${key}`);
    if (matches.length === 1) {
      replaceRange(lines, matches[0], `${key} = ${serializedValue}`);
    } else {
      lines.splice(section.end, 0, `${key} = ${serializedValue}`);
    }
    return joinDocument(lines, document.eol, true);
  }

  const dotted = findAssignments(lines, key, null, true);
  assertSingle(dotted, `tui.${key}`);
  if (dotted.length === 1) {
    replaceRange(lines, dotted[0], `tui.${key} = ${serializedValue}`);
    return joinDocument(lines, document.eol, true);
  }

  if (hasInlineTui(lines)) {
    throw new Error("inline `tui = { ... }` tables are not rewritten safely; use /statusline instead");
  }

  if (hasDottedTui(lines)) {
    lines.push(`tui.${key} = ${serializedValue}`);
    return joinDocument(lines, document.eol, true);
  }

  if (lines.length > 0 && lines.at(-1)?.trim() !== "") lines.push("");
  lines.push("[tui]", `${key} = ${serializedValue}`);
  return joinDocument(lines, document.eol, true);
}

export function removeTuiValue(source, key) {
  const document = splitDocument(source);
  const { lines } = document;
  const section = findTuiSection(lines);
  const matches = section
    ? findAssignments(lines, key, { start: section.start + 1, end: section.end })
    : findAssignments(lines, key, null, true);
  assertSingle(matches, section ? `[tui].${key}` : `tui.${key}`);
  if (matches.length === 0) return source;
  lines.splice(matches[0].start, matches[0].end - matches[0].start + 1);
  return joinDocument(lines, document.eol, document.hadFinalEol);
}

function assignmentText(source, key) {
  const { lines } = splitDocument(source);
  const section = findTuiSection(lines);
  const matches = section
    ? findAssignments(lines, key, { start: section.start + 1, end: section.end })
    : findAssignments(lines, key, null, true);
  assertSingle(matches, section ? `[tui].${key}` : `tui.${key}`);
  if (matches.length === 0) return null;
  return lines.slice(matches[0].start, matches[0].end + 1).join("\n");
}

export function parseStatusItems(source) {
  const text = assignmentText(source, "status_line");
  if (text === null) return null;
  const equals = text.indexOf("=");
  const value = stripTomlComments(text.slice(equals + 1));
  const open = value.indexOf("[");
  const close = value.lastIndexOf("]");
  if (open < 0 || close < open) throw new Error("[tui].status_line is not a readable TOML array");
  const array = value.slice(open + 1, close);
  const result = [];
  const matcher = /"(?:\\.|[^"\\])*"|'[^']*'/g;
  for (const match of array.matchAll(matcher)) {
    const literal = match[0];
    result.push(literal.startsWith('"') ? JSON.parse(literal) : literal.slice(1, -1));
  }
  return result;
}

function stripTomlComments(value) {
  let result = "";
  let quote = null;
  let escaped = false;
  for (const line of value.split("\n")) {
    for (const char of line) {
      if (quote) {
        result += char;
        if (quote === '"' && escaped) escaped = false;
        else if (quote === '"' && char === "\\") escaped = true;
        else if (char === quote) quote = null;
      } else if (char === "#") {
        break;
      } else {
        result += char;
        if (char === '"' || char === "'") quote = char;
      }
    }
    result += "\n";
  }
  return result;
}

export function parseUseColors(source) {
  const text = assignmentText(source, "status_line_use_colors");
  if (text === null) return null;
  const value = text.slice(text.indexOf("=") + 1).replace(/#.*$/gm, "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("choose at least one status-line item");
  const unknown = items.filter((item) => !KNOWN_ITEM_IDS.has(item));
  if (unknown.length > 0) throw new Error(`unknown status-line item(s): ${unknown.join(", ")}`);
  const duplicates = items.filter((item, index) => items.indexOf(item) !== index);
  if (duplicates.length > 0) throw new Error(`duplicate status-line item(s): ${[...new Set(duplicates)].join(", ")}`);
  return [...items];
}

export function applyItems(source, items, useColors = true) {
  const validItems = validateItems(items);
  let updated = setTuiValue(source, "status_line", JSON.stringify(validItems));
  updated = setTuiValue(updated, "status_line_use_colors", String(Boolean(useColors)));
  return updated;
}

export function resetHud(source) {
  return removeTuiValue(removeTuiValue(source, "status_line"), "status_line_use_colors");
}

export function identifyPreset(items) {
  if (items === null) return "codex-default";
  for (const [name, presetItems] of Object.entries(PRESETS)) {
    if (items.length === presetItems.length && items.every((item, index) => item === presetItems[index])) return name;
  }
  return "custom";
}

export function resolveConfigPath(explicitPath, environment = process.env) {
  if (explicitPath) return path.resolve(explicitPath);
  const configuredHome = environment.CODEX_HOME?.trim();
  const codexHome = configuredHome ? path.resolve(configuredHome) : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "config.toml");
}

async function readConfig(configPath) {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export async function writeConfig(configPath, source, { backup = true } = {}) {
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let existing = false;
  let symbolicLink = false;
  let mode = 0o600;
  try {
    const info = await lstat(configPath);
    existing = true;
    symbolicLink = info.isSymbolicLink();
    mode = info.mode & 0o777;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (existing && backup) {
    const backupPath = `${configPath}.codex-hud.bak`;
    await copyFile(configPath, backupPath);
    await chmod(backupPath, 0o600);
  }

  if (symbolicLink) {
    await writeFile(configPath, source, "utf8");
    return;
  }

  const temporaryPath = path.join(directory, `.${path.basename(configPath)}.codex-hud-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", flag: "wx", mode });
    await rename(temporaryPath, configPath);
  } catch (error) {
    if (existing && ["EEXIST", "EPERM"].includes(error?.code)) {
      await writeFile(configPath, source, "utf8");
      await unlink(temporaryPath).catch(() => {});
      return;
    }
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function parseArguments(argv) {
  const values = { command: argv[0] ?? "help", json: false, dryRun: false, colors: true };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") values.json = true;
    else if (argument === "--dry-run") values.dryRun = true;
    else if (argument === "--no-colors") values.colors = false;
    else if (["--config", "--preset", "--items"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      values[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return values;
}

function jsonPrint(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write(`Codex HUD configuration helper

Usage:
  codex-hud.mjs status [--json] [--config PATH]
  codex-hud.mjs presets [--json]
  codex-hud.mjs items [--json]
  codex-hud.mjs apply (--preset NAME | --items CSV) [--no-colors] [--dry-run] [--config PATH]
  codex-hud.mjs reset [--dry-run] [--config PATH]
`);
}

async function run(argv) {
  const options = parseArguments(argv);
  if (options.command === "help" || options.command === "--help" || options.command === "-h") {
    help();
    return;
  }
  if (options.command === "presets") {
    if (options.json) jsonPrint(PRESETS);
    else for (const [name, items] of Object.entries(PRESETS)) process.stdout.write(`${name}: ${items.join(", ")}\n`);
    return;
  }
  if (options.command === "items") {
    if (options.json) jsonPrint(STATUS_ITEMS);
    else for (const item of STATUS_ITEMS) process.stdout.write(`${item.id.padEnd(24)} ${item.description}\n`);
    return;
  }

  const configPath = resolveConfigPath(options.config);
  const source = await readConfig(configPath);

  if (options.command === "status") {
    const items = parseStatusItems(source);
    const result = {
      configPath,
      configured: items !== null,
      preset: identifyPreset(items),
      items: items ?? CODEX_DEFAULT_ITEMS,
      useColors: parseUseColors(source),
    };
    if (options.json) jsonPrint(result);
    else {
      process.stdout.write(`Config: ${result.configPath}\nPreset: ${result.preset}\nItems: ${result.items.join(", ")}\n`);
    }
    return;
  }

  let updated;
  let summary;
  if (options.command === "apply") {
    if (Boolean(options.preset) === Boolean(options.items)) {
      throw new Error("apply requires exactly one of --preset or --items");
    }
    let items;
    if (options.preset) {
      items = PRESETS[options.preset];
      if (!items) throw new Error(`unknown preset: ${options.preset}`);
      summary = `Applied ${options.preset} Codex HUD preset`;
    } else {
      items = options.items.split(",").map((item) => item.trim()).filter(Boolean);
      summary = "Applied custom Codex HUD status line";
    }
    updated = applyItems(source, items, options.colors);
  } else if (options.command === "reset") {
    updated = resetHud(source);
    summary = "Reset Codex HUD to the native Codex default";
  } else {
    throw new Error(`unknown command: ${options.command}`);
  }

  if (options.dryRun) {
    process.stdout.write(updated);
    return;
  }
  if (updated === source) {
    process.stdout.write(`${summary} (no changes needed)\nConfig: ${configPath}\n`);
    return;
  }
  await writeConfig(configPath, updated);
  process.stdout.write(`${summary}\nConfig: ${configPath}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[codex-hud] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
