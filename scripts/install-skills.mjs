#!/usr/bin/env node
/**
 * Installs the skills bundled with Antigravity MCP into an agent's skills directory.
 *
 * The MCP server gives an agent the *tools*; a skill tells it when and how to
 * use them. Shipping both in one package means installing the server is enough,
 * instead of asking every user to find and vendor the skill separately.
 *
 * The package exposes this as its own bin, so it is a package selection rather
 * than a subcommand. `npx @pymodel/antigravity-mcp-install-skills` looks like a
 * package name to npx and 404s; `npx @pymodel/antigravity-mcp install-skills`
 * starts the stdio server with a stray argument and hangs.
 *
 *   npx --package @pymodel/antigravity-mcp antigravity-mcp-install-skills
 *   npx --package @pymodel/antigravity-mcp antigravity-mcp-install-skills --list
 *   npx --package @pymodel/antigravity-mcp antigravity-mcp-install-skills --dir DIR
 *
 * Already installed, globally or in a project: `antigravity-mcp-install-skills`.
 * The legacy claude-agy-mcp-install-skills executable remains an alias.
 */
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, "..", "skills");

/**
 * Where the agents on this machine keep skills.
 *
 * Only directories that already exist are written to: creating `~/.claude` for
 * someone who does not use Claude Code would be litter, not installation.
 */
const TARGETS = [
  { name: "Claude Code", dir: path.join(homedir(), ".claude", "skills") },
  { name: "Codex / shared agents", dir: path.join(homedir(), ".agents", "skills") },
  {
    name: "OpenCode",
    dir: path.join(
      process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
      "opencode",
      "skills",
    ),
  },
  { name: "Pi", dir: path.join(homedir(), ".pi", "agent", "skills") },
  { name: "zcode", dir: path.join(homedir(), ".zcode", "skills") },
];

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** The skills this package ships, read from disk rather than hardcoded. */
async function bundledSkills() {
  const names = (await readdir(SOURCE, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(path.join(SOURCE, name, "SKILL.md"), "utf8");
      const described = /^description:\s*(?:>-\s*)?([\s\S]*?)(?=\n\w+:|\n---)/m.exec(text);
      const summary = (described?.[1] ?? "").replace(/\s+/g, " ").trim();
      return { name, summary: summary.slice(0, 100) };
    }),
  );
}

/**
 * True when `dest` is a symlink, which means someone deliberately pointed this
 * skill at a checkout they edit. Replacing it with a frozen copy would silently
 * cut that source of truth loose, so it is skipped unless --force is passed.
 */
async function isSymlink(dest) {
  try {
    return (await lstat(dest)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Inspect legacy entries themselves; never traverse or replace a user's old copy. */
async function reportLegacySkills(parent) {
  const renamed = [];
  for (const [previous, current] of [
    ["agy-delegate", "antigravity-mcp"],
    ["agy-delegation", "antigravity-mcp-routing"],
  ]) {
    try {
      const entry = await lstat(path.join(parent, previous));
      if (entry.isDirectory() || entry.isSymbolicLink()) renamed.push(`${previous} → ${current}`);
    } catch {
      // A missing or unreadable legacy entry must not prevent a new installation.
    }
  }
  if (renamed.length) {
    console.log(`Legacy skills in ${parent}: ${renamed.join("; ")}.`);
    console.log(
      "Existing copies are left untouched, including with --force. Migrate custom changes, " +
        "then remove old copies yourself to avoid loading duplicate skills.",
    );
  }
}

async function install(skill, parent, force) {
  const dest = path.join(parent, skill.name);
  await mkdir(parent, { recursive: true });
  const sourceRoot = await realpath(SOURCE);
  const targetRoot = await realpath(parent);
  if (targetRoot === sourceRoot || targetRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error("the install directory cannot be the bundled skills source or inside it");
  }
  const lock = path.join(parent, `.${skill.name}.install-lock`);
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`another installation owns ${lock}; inspect it before retrying`);
    }
    throw error;
  }
  let staging;
  let previous;
  let preserveBackup = false;
  try {
    if (!force && (await isSymlink(dest))) return { dest, skipped: "symlink" };
    staging = await mkdtemp(path.join(parent, `.${skill.name}.install-`));
    const next = path.join(staging, "next");
    // Finish copying before touching the installed version. Staging beside the
    // destination keeps both publication renames on the same filesystem.
    await cp(path.join(SOURCE, skill.name), next, { recursive: true });
    await readFile(path.join(next, "SKILL.md"), "utf8");
    try {
      await lstat(dest);
      previous = path.join(staging, "previous");
      await rename(dest, previous);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      previous = undefined;
    }
    try {
      await rename(next, dest);
    } catch (error) {
      if (previous) {
        try {
          await rename(previous, dest);
          previous = undefined;
        } catch (rollbackError) {
          preserveBackup = true;
          throw new Error(
            `publication failed (${error.message}); rollback failed (${rollbackError.message}); ` +
              `the previous skill is preserved at ${previous}`,
          );
        }
      }
      throw error;
    }
    return { dest };
  } finally {
    // A failed rollback must retain its recovery copy. A completed publication
    // removes stale references by replacing the directory instead of merging.
    try {
      if (staging && !preserveBackup) await rm(staging, { recursive: true, force: true });
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

function parseArgs(args) {
  const options = { explicit: undefined, listOnly: false, force: false, help: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dir": {
        if (options.explicit !== undefined) throw new Error("--dir may be supplied only once");
        const value = args[++i];
        if (!value?.trim() || value.startsWith("-"))
          throw new Error("--dir requires a directory path");
        options.explicit = value;
        break;
      }
      case "--list":
        options.listOnly = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`install-skills: ${error.message}`);
  process.exit(2);
}
const { explicit, listOnly, force, help } = options;
if (help) {
  console.log("Usage: antigravity-mcp-install-skills [--dir <path>] [--list] [--force]");
  console.log("--list previews without writing; --force replaces a symlinked installation.");
  process.exit(0);
}

const skills = await bundledSkills();
if (listOnly) {
  console.log("Skills bundled with Antigravity MCP:\n");
  for (const s of skills) console.log(`  ${s.name}\n    ${s.summary}\n`);
}

const targets = explicit
  ? [{ name: "explicit", dir: path.resolve(explicit) }]
  : (await Promise.all(TARGETS.map(async (t) => ((await isDir(t.dir)) ? t : null)))).filter(
      Boolean,
    );

for (const target of targets) await reportLegacySkills(target.dir);

if (listOnly) {
  console.log(
    targets.length
      ? `Would install into:\n${targets.map((t) => `  ${t.dir} (${t.name})`).join("\n")}`
      : "No agent skills directory found. Pass --dir to name one.",
  );
  process.exit(0);
}

if (!targets.length) {
  console.error(
    "No agent skills directory found on this machine.\n" +
      "Pass --dir <path> to install somewhere explicitly, or --list to see what is bundled.",
  );
  process.exit(1);
}

let failed = false;
let skipped = 0;
for (const target of targets) {
  for (const skill of skills) {
    try {
      const { dest, skipped: why } = await install(skill, target.dir, force);
      if (why) {
        skipped++;
        console.log(`skipped ${skill.name} -> ${dest} (symlink; --force to replace)`);
      } else {
        console.log(`installed ${skill.name} -> ${dest}`);
      }
    } catch (err) {
      failed = true;
      console.error(`failed ${skill.name} -> ${target.dir}: ${err.message}`);
    }
  }
}
if (failed) process.exit(1);
if (skipped) {
  console.log(`\n${skipped} skipped because they are symlinks to a checkout you maintain.`);
}
console.log("\nRestart your agent so it picks the skills up.");
