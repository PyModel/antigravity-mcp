import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the published shape in an empty production installation. No real
// provider is contacted: every agy call goes to the repository's fake CLI.
const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const temp = mkdtempSync(path.join(tmpdir(), "agy-package-smoke-"));
let client;
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HUSKY: "0", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });

try {
  // Verify npm ci --omit=dev itself, including the prepare lifecycle that used
  // to call an absent Husky. This is also the Docker production dependency shape.
  const prod = path.join(temp, "production-ci");
  mkdirSync(prod);
  for (const file of ["package.json", "package-lock.json"])
    copyFileSync(path.join(root, file), path.join(prod, file));
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], prod);
  assert.equal(existsSync(path.join(prod, "node_modules", ".bin", "husky")), false);

  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], root),
  )[0];
  for (const file of [
    "dist/index.js",
    "README.md",
    "scripts/install-skills.mjs",
    "skills/agy-delegate/SKILL.md",
    "skills/agy-delegate/scripts/relay.mjs",
  ]) {
    assert(
      packed.files.some((entry) => entry.path === file),
      `tarball is missing ${file}`,
    );
  }
  assert(
    !packed.files.some((entry) => entry.path.startsWith("test/") || entry.path.startsWith("src/")),
  );
  const project = path.join(temp, "consumer");
  mkdirSync(project);
  writeFileSync(
    path.join(project, "package.json"),
    '{"name":"agy-package-smoke","private":true,"type":"module"}\n',
  );
  run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(temp, packed.filename),
    ],
    project,
  );
  const installed = path.join(project, "node_modules", "@pymodel", "claude-agy-mcp");
  const requireInstalled = createRequire(path.join(installed, "package.json"));
  const { Client } = await import(
    pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/index.js")).href
  );
  const { StdioClientTransport } = await import(
    pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href
  );
  const work = path.join(temp, "work");
  mkdirSync(work);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  );
  Object.assign(env, {
    AGY_PATH: path.join(root, "test", "fixtures", "fake-agy.mjs"),
    AGY_DELEGATION_DEPTH: "0",
    AGY_ASK_MODEL: "false",
    AGY_WARM_SESSIONS: "false",
    AGY_DEFAULT_MODEL: "gemini-flash@latest-high",
    AGY_EFFORT: "",
    AGY_SANDBOX: "false",
    AGY_ALLOWED_ROOTS: work,
    AGY_BUDGET_TOKENS: "",
    AGY_READ_ONLY_ENFORCEMENT: "off",
    XDG_CONFIG_HOME: path.join(temp, "config"),
    XDG_CACHE_HOME: path.join(temp, "cache"),
  });
  client = new Client({ name: "package-smoke", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(installed, "dist", "index.js")],
      env,
      stderr: "pipe",
    }),
  );
  assert.equal(client.getServerVersion()?.version, pkg.version);
  const { tools } = await client.listTools();
  for (const name of ["delegate", "follow_up", "set_model", "delegate_many", "agy_status"]) {
    assert(
      tools.some((tool) => tool.name === name),
      `missing MCP tool: ${name}`,
    );
  }
  const first = await client.callTool({
    name: "delegate",
    arguments: { prompt: "package smoke", cwd: work },
  });
  assert(!first.isError, JSON.stringify(first));
  const next = await client.callTool({
    name: "follow_up",
    arguments: { session_id: "conv-e2e-1", question: "continue package smoke", cwd: work },
  });
  assert(!next.isError, JSON.stringify(next));
  const skillsDir = path.join(temp, "installed-skills");
  run(
    process.execPath,
    [path.join(installed, "scripts", "install-skills.mjs"), "--dir", skillsDir],
    project,
  );
  assert(existsSync(path.join(skillsDir, "agy-delegate", "SKILL.md")));
  assert(existsSync(path.join(skillsDir, "agy-delegate", "scripts", "relay.mjs")));
  console.log(
    `Package smoke passed: ${pkg.name}@${pkg.version}, Node ${process.versions.node}, production install, stdio, follow-up, bundled skills`,
  );
} finally {
  await client?.close().catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
