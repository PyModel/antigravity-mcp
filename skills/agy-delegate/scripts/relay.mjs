#!/usr/bin/env node
/**
 * delegate-skills · agy-delegate · relay.mjs
 *
 * Dispatch a self-contained brief to the Google Antigravity CLI (`agy --print`),
 * capture the run, and write a structured result the orchestrating agent can
 * review. The orchestrator runs this one command and reads the result JSON -
 * every Antigravity-specific mechanic lives in here, which keeps the skill
 * orchestrator-agnostic.
 *
 * Trust posture: relay.mjs itself makes no network calls, reads or writes no
 * credentials, and sends no telemetry; it has no dependencies (Node built-ins
 * only). It shells out only to `agy` and `git`. The `agy` process it launches
 * does authenticate - exactly as you do at the terminal. Read this file before
 * you run it.
 *
 * Note: `agy --print` takes the prompt as a command-line argument, so the brief is
 * visible in the host process list (`ps`, /proc). On a shared machine keep secrets
 * out of the brief - reference them by a path or env var the workspace can read.
 *
 * It deliberately does NOT commit. Committing is always the orchestrator's job -
 * after it reviews the diff and re-runs the project gates.
 *
 * Headless --print cannot answer a permission prompt, so this helper passes
 * --dangerously-skip-permissions by default. Use it only for an authorized task.
 * Pass --no-dangerously-skip-permissions to let agy auto-deny instead. --read-only
 * requests plan mode and watches the supplied roots; it does not prevent writes.
 * Pass --sandbox to enable Antigravity's terminal sandbox. Do not treat --sandbox
 * as an enforced boundary while the bypass is on; treat the run as full access.
 *
 * Usage:
 *   node relay.mjs --brief <file> [options]
 *   cat brief.txt | node relay.mjs [options]
 *
 * Options:
 *   --brief <file>          Path to the brief. If omitted, the brief is read from stdin.
 *   --cd <dir>              Working root for Antigravity (default: current directory).
 *   --lane <name>           Fleet lane from delegate-setup config (dials apply; explicit flags win).
 *   --model <name>          Listed CLI ID/label or family selector (default: agy's configured default).
 *   --effort <level>        low, medium, high, xhigh, or max; only listed variants are usable.
 *                           Requires --model. An exact ID/label fixes its effort; selectors
 *                           such as gemini-neon@latest may select a listed effort sibling.
 *   --project <id>          Use an existing Antigravity project.
 *   --new-project           Force a fresh Antigravity project (default for fresh runs).
 *   --resume-last           Continue the most recent Antigravity conversation; send only the delta brief.
 *   --conversation <id>     Continue a specific Antigravity conversation; send only the delta brief.
 *   --sandbox               Enable Antigravity's terminal sandbox for this run.
 *   --read-only             Request plan mode (`--mode plan`) and watch all supplied roots.
 *                           Advisory only: no sandbox or write enforcement is provided.
 *                           A write is a violation; unknown snapshot coverage is incomplete.
 *   --dangerously-skip-permissions
 *                           Auto-approve Antigravity tool permission requests (default: on).
 *   --no-dangerously-skip-permissions
 *                           Let agy auto-deny permission requests instead.
 *   --print-timeout <dur>   Timeout agy itself applies to print mode (default: 30m).
 *   --timeout <dur>         Relay-side watchdog, h/m/s like 30m (default: --print-timeout
 *                           plus a 60s grace). On expiry the agy process tree is killed and
 *                           result.json gets status "timeout". Set it explicitly when agy
 *                           may hang past its own print timeout.
 *   --add-dir <dir>         Add an extra workspace directory. Repeatable.
 *   --out-dir <dir>         Artifact directory (default: a fresh system temp directory).
 *                           Reuse clears old captures and publishes a new running result;
 *                           concurrent reuse is refused. Other files are left intact.
 *   -h, --help              Show this help.
 *
 * Result: written to <out-dir>/result.json and summarized on stdout -
 *   runId, status, exitCode, agyVersion, projectId, conversationId, finalMessage,
 *   requested/resolved/observed model facts, finishedReason, touchedFilesByRoot,
 *   readOnlyViolation, snapshotCoverage, and paths to the captured artifacts.
 *
 * Exit codes: a pre-run usage error (bad/missing args, empty brief) exits 2
 * before any run and writes no result file; a missing `agy` binary exits 127;
 * otherwise a partial result, permission denial, read-only violation, or unknown
 * read-only coverage exits nonzero even when Antigravity exits zero.
 * If the child dies on a signal, the exit code is 128 plus the signal number and
 * `result.json` records the signal.
 * Once the brief validates, `result.json` is written on every outcome -
 * running, completed, incomplete, read_only_violation, failed, timeout (the relay watchdog fired after explicit --timeout,
 * or after --print-timeout plus 60s grace), aborted (the relay itself was killed
 * and forwarded the kill to agy), or agy_unavailable. An orchestrator that polls for the
 * file must therefore also treat a non-zero exit with no file as a usage error.
 */

import { spawn, execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  existsSync,
  appendFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { EFFORTS, selectModel } from "./model-selection.mjs";
import { workspaceRoots, workspaceSnapshot, touchedFilesByRoot } from "./workspace.mjs";

const DEFAULT_PRINT_TIMEOUT = "30m";
const MAX_TIMER_MS = 2_147_483_647;
const MAX_TIMER_DURATION = "596h31m23s";
const VERSION_PROBE_TIMEOUT_MS = 10_000;

const IMPLEMENTER_KEY = "agy";

function applyFleetLane(opts, flagged) {
  if (!opts.lane) return;
  const script = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../delegate-setup/scripts/lane.mjs",
  );
  if (!existsSync(script)) {
    fail("--lane requires the delegate-setup skill installed beside this relay");
  }
  const r = spawnSync(
    process.execPath,
    [script, "resolve", "--cwd", opts.cd, "--lane", opts.lane, "--implementer", IMPLEMENTER_KEY],
    { encoding: "utf8", env: process.env },
  );
  if (r.error) fail(`lane resolve failed: ${r.error.message}`);
  if (r.status !== 0) {
    fail((r.stderr || "lane resolve failed").trim().replace(/^lane\.mjs:\s*/, ""));
  }
  let resolved;
  try {
    const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
    resolved = JSON.parse(lines[lines.length - 1]);
  } catch {
    fail("lane resolve returned invalid JSON");
  }
  opts.laneSource = resolved.source;
  for (const [field, value] of Object.entries(resolved.dials || {})) {
    if (flagged.has(field)) continue;
    if (
      field === "autonomy" &&
      (flagged.has("autonomy") || flagged.has("sandbox") || flagged.has("readOnly"))
    )
      continue;
    if (field === "agent" && (flagged.has("agent") || flagged.has("readOnly"))) continue;
    if (field === "sandbox" && (flagged.has("sandbox") || flagged.has("readOnly"))) continue;
    if (field === "permissionMode" && (flagged.has("permissionMode") || flagged.has("readOnly")))
      continue;
    if (field === "planOnly" && (flagged.has("planOnly") || flagged.has("readOnly"))) continue;
    if (field === "readOnly" && flagged.has("readOnly")) continue;
    if (field === "force" && flagged.has("force")) continue;
    opts[field] = value;
  }
}

function fail(message, code = 2) {
  process.stderr.write(`relay: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const flagged = new Set();
  const opts = {
    lane: null,
    laneSource: null,
    brief: null,
    cd: process.cwd(),
    model: null,
    effort: null,
    project: null,
    newProject: false,
    resumeLast: false,
    conversation: null,
    sandbox: false,
    readOnly: false,
    dangerouslySkipPermissions: true,
    printTimeout: DEFAULT_PRINT_TIMEOUT,
    timeout: null,
    addDirs: [],
    outDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value?.trim() || value.startsWith("--")) fail(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(headerComment());
        process.exit(0);
        break;
      case "--brief":
        opts.brief = next();
        break;
      case "--cd":
        opts.cd = resolve(next());
        break;
      case "--lane":
        opts.lane = next();
        break;
      case "--model":
        opts.model = next();
        flagged.add("model");
        break;
      case "--effort":
        opts.effort = next();
        flagged.add("effort");
        break;
      case "--project":
        opts.project = next();
        break;
      case "--new-project":
        opts.newProject = true;
        break;
      case "--resume-last":
        opts.resumeLast = true;
        break;
      case "--conversation":
        opts.conversation = next();
        break;
      case "--sandbox":
        opts.sandbox = true;
        flagged.add("sandbox");
        break;
      case "--read-only":
        opts.readOnly = true;
        flagged.add("readOnly");
        break;
      case "--dangerously-skip-permissions":
        opts.dangerouslySkipPermissions = true;
        flagged.add("dangerouslySkipPermissions");
        break;
      case "--no-dangerously-skip-permissions":
        opts.dangerouslySkipPermissions = false;
        flagged.add("dangerouslySkipPermissions");
        break;
      case "--print-timeout":
        opts.printTimeout = next();
        break;
      case "--timeout":
        opts.timeout = next();
        flagged.add("timeout");
        break;
      case "--add-dir":
        opts.addDirs.push(next());
        break;
      case "--out-dir":
        opts.outDir = resolve(next());
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  applyFleetLane(opts, flagged);
  if (opts.effort !== null && !EFFORTS.includes(opts.effort)) {
    fail(
      `invalid --effort "${opts.effort}" (expected: ${EFFORTS.join(", ")}; must be listed for the model)`,
    );
  }
  if (opts.effort && !opts.model) fail("--effort requires --model; the inherited model is unknown");
  if (opts.resumeLast && opts.conversation) {
    fail("--resume-last and --conversation are mutually exclusive; pass only one");
  }
  // A malformed --timeout must fail loudly: parseDuration returns null for it, and a null
  // delay makes setTimeout fire on the next tick - a silent instant "timeout", the worst
  // failure mode a watchdog has. Zero is rejected for the same reason.
  if (opts.timeout !== null) {
    const milliseconds = parseDuration(opts.timeout);
    if (milliseconds === null || milliseconds <= 0 || milliseconds > MAX_TIMER_MS) {
      fail(
        `--timeout "${opts.timeout}" must be an h/m/s duration from 1s through ${MAX_TIMER_DURATION}`,
      );
    }
  }
  const printTimeoutMs = parseDuration(opts.printTimeout);
  if (printTimeoutMs === null || printTimeoutMs <= 0 || printTimeoutMs + 60_000 > MAX_TIMER_MS) {
    fail(
      `--print-timeout "${opts.printTimeout}" must be an h/m/s duration from 1s through 596h30m23s so its 60s grace fits the relay watchdog limit`,
    );
  }
  if (opts.project && (opts.resumeLast || opts.conversation)) {
    fail("--project cannot be combined with --resume-last or --conversation");
  }
  if (opts.project && opts.newProject) {
    fail("--project and --new-project are mutually exclusive");
  }
  if (opts.newProject && (opts.resumeLast || opts.conversation)) {
    fail("--new-project cannot be combined with --resume-last or --conversation");
  }
  // agy requires absolute --add-dir paths; resolve a relative one against --cd
  // (not the relay's own cwd) - and only after the loop, since --add-dir may
  // appear before --cd on the command line. resolve() passes absolutes through.
  opts.addDirs = opts.addDirs.map((dir) => resolve(opts.cd, dir));
  return opts;
}

function headerComment() {
  // The leading block comment doubles as --help text.
  const src = readFileSync(new URL(import.meta.url), "utf8");
  const match = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return "relay.mjs - dispatch a brief to agy --print\n";
  return `${match[1].replace(/^\s*\* ?/gm, "").trim()}\n`;
}

function readBrief(opts) {
  if (opts.brief) {
    if (!existsSync(opts.brief)) fail(`brief file not found: ${opts.brief}`);
    return readFileSync(opts.brief, "utf8");
  }
  if (process.stdin.isTTY) {
    fail("no --brief given and stdin is a TTY; pass --brief <file> or pipe the brief on stdin");
  }
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }
  return stdin;
}

function killChild(child, signal = "SIGTERM") {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    if (signal !== "SIGTERM") return;
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: ["ignore", "ignore", "inherit"],
      });
    } catch {
      // The process tree already exited.
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process group already exited.
    }
  }
}

function agyVersion(timeoutMs) {
  try {
    const out = execFileSync("agy", ["changelog"], {
      encoding: "utf8",
      timeout: Math.min(timeoutMs, VERSION_PROBE_TIMEOUT_MS),
      killSignal: "SIGKILL",
    }).trim();
    const firstLine = out.split("\n").find(Boolean) || "";
    const match = firstLine.match(/^([^:\s]+):/);
    return match ? match[1] : firstLine || null;
  } catch (err) {
    // Only a missing binary means "unavailable"; any other changelog failure
    // (permissions, a broken subcommand) must not masquerade as exit 127.
    if (err && err.code === "ENOENT") return null;
    if (err && err.code === "ETIMEDOUT") throw err;
    return "unknown";
  }
}

function parseDuration(duration) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  try {
    const seconds =
      BigInt(match[1] || 0) * 3600n + BigInt(match[2] || 0) * 60n + BigInt(match[3] || 0);
    const milliseconds = seconds * 1000n;
    if (milliseconds <= 0n || milliseconds > BigInt(MAX_TIMER_MS)) return null;
    return Number(milliseconds);
  } catch {
    return null;
  }
}

function readOnlyVerdict(opts, before, after) {
  if (!opts.readOnly || before.digest === null || after.digest === null) return null;
  return before.digest !== after.digest;
}

function prepareRunDir(opts, brief) {
  let outDir = opts.outDir;
  if (!outDir) {
    const parent = join(tmpdir(), "delegate-relay");
    mkdirSync(parent, { recursive: true });
    outDir = mkdtempSync(join(parent, `${basename(opts.cd) || "repo"}-`));
  } else {
    mkdirSync(outDir, { recursive: true });
  }
  outDir = realpathSync.native(outDir);
  const lockPath = join(outDir, ".relay-lock");
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error.code === "EEXIST")
      fail(`out-dir is locked: ${outDir}; inspect its active run before reuse`);
    throw error;
  }
  process.once("exit", () => rmSync(lockPath, { recursive: true, force: true }));
  const run = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    lockPath,
    briefPath: join(outDir, "brief.txt"),
    finalPath: join(outDir, "final.txt"),
    stdoutPath: join(outDir, "stdout.txt"),
    logPath: join(outDir, "agy.log"),
    stderrPath: join(outDir, "stderr.txt"),
    resultPath: join(outDir, "result.json"),
  };
  // Replace prior completion before any metadata probe or model dispatch. A
  // watcher can associate every capture with this runId instead of stale output.
  makeResultWriter(opts, null, run)({ status: "running", exitCode: null, finalMessage: "" });
  for (const file of [run.briefPath, run.finalPath, run.stdoutPath, run.logPath, run.stderrPath]) {
    rmSync(file, { force: true });
  }
  writeFileSync(run.briefPath, brief, "utf8");
  writeFileSync(run.stderrPath, "", "utf8");
  return run;
}

function buildArgv(opts, brief, run) {
  const argv = [];
  if (opts.project) {
    argv.push("--project", opts.project);
  } else if (opts.conversation) {
    argv.push("--conversation", opts.conversation);
  } else if (opts.resumeLast) {
    argv.push("--continue");
  } else {
    argv.push("--new-project");
  }

  // Keep explicit roots on continuations too. Older conversation state does not
  // replace the caller's current workspace request.
  argv.push("--add-dir", opts.cd);
  for (const dir of opts.addDirs) argv.push("--add-dir", dir);
  if (opts.selection?.model) argv.push("--model", opts.selection.model);
  // Listed effort variants are complete CLI IDs; never invent an ID or combine
  // a fixed variant with an independent --effort that can contradict it.
  argv.push("--output-format", "json");
  if (opts.readOnly) argv.push("--mode", "plan");
  if (opts.sandbox) argv.push("--sandbox");
  if (opts.dangerouslySkipPermissions) argv.push("--dangerously-skip-permissions");
  if (opts.printTimeout) argv.push("--print-timeout", opts.printTimeout);
  argv.push("--log-file", run.logPath);
  // Use the --print=<brief> form, not a separate ["--print", brief] pair: agy's flag
  // parser intercepts a value that is exactly a bare flag (a brief consisting only of
  // "--help" or "-h" prints usage instead of running). The = form always binds the value.
  argv.push(`--print=${brief}`);
  return argv;
}

function parseIdsFromLog(logPath) {
  if (!existsSync(logPath)) return { projectId: null, conversationId: null };
  const text = readFileSync(logPath, "utf8");
  const projectMatches = [
    /project: created project "[^"]*" \(id=([0-9a-f-]+)\)/i,
    /Conversation using project ID: ([0-9a-f-]+)/i,
    /Backend project ID updated dynamically to: ([0-9a-f-]+)/i,
  ];
  const conversationMatches = [
    /Print mode: conversation=([0-9a-f-]+)/i,
    /Created conversation ([0-9a-f-]+)/i,
  ];
  const firstMatch = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  };
  return {
    projectId: firstMatch(projectMatches),
    conversationId: firstMatch(conversationMatches),
  };
}

function makeResultWriter(opts, version, run) {
  return (extra) => {
    const running = extra.status === "running";
    const ids = running ? { projectId: null, conversationId: null } : parseIdsFromLog(run.logPath);
    const result = {
      schema: "delegate-relay.result.v2",
      runId: run.runId,
      lane: opts.lane,
      laneSource: opts.laneSource,
      tool: "agy",
      workdir: opts.cd,
      requestedModel: opts.model,
      requestedEffort: opts.effort,
      resolvedModel: opts.selection?.model ?? null,
      resolvedEffort: opts.selection?.effort ?? null,
      observedModel: null,
      // Compatibility fields identify the dispatched selection, not model observation.
      model: opts.selection?.model ?? null,
      effort: opts.selection?.effort ?? null,
      project: opts.project,
      sandbox: opts.sandbox,
      readOnly: opts.readOnly,
      readOnlyEnforced: false,
      readOnlyViolation: null,
      snapshotCoverage: null,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      resumeRequested: Boolean(opts.resumeLast || opts.conversation),
      requestedConversationId: opts.conversation,
      resumed: opts.resumeLast || opts.conversation ? null : false,
      agyVersion: version,
      projectId: ids.projectId,
      conversationId: ids.conversationId,
      startedAt: run.startedAt,
      finishedAt: running ? null : new Date().toISOString(),
      briefPath: run.briefPath,
      finalPath: !running && existsSync(run.finalPath) ? run.finalPath : null,
      stdoutPath: !running && existsSync(run.stdoutPath) ? run.stdoutPath : null,
      logPath: !running && existsSync(run.logPath) ? run.logPath : null,
      stderrPath: run.stderrPath,
      touchedFiles: null,
      touchedFilesByRoot: [],
      ...extra,
    };
    if (opts.conversation && result.conversationId) {
      result.resumed = opts.conversation === result.conversationId;
    }
    // Publish atomically so a polling orchestrator never reads a half-written file
    // (same idiom as claude-delegate's writeJsonAtomic and qoder-delegate).
    const temporary = join(run.lockPath, "result.tmp");
    writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    renameSync(temporary, run.resultPath);
    return result;
  };
}

function reportUnavailable(writeResult, resultPath) {
  const result = writeResult({
    status: "agy_unavailable",
    exitCode: 127,
    signal: null,
    finalMessage: "",
    touchedFiles: null,
  });
  printSummary(result, resultPath);
  process.stderr.write(
    "relay: `agy` not found on PATH. Install the Antigravity CLI and complete first-launch setup.\n",
  );
  process.exit(127);
}

function reportVersionTimeout(writeResult, run, timeoutMs, error) {
  const stderr = String(error?.stderr || "").trim();
  if (stderr) writeFileSync(run.stderrPath, `${stderr}\n`, "utf8");
  const message = `agy changelog version preflight timed out after ${Math.min(timeoutMs, VERSION_PROBE_TIMEOUT_MS)}ms; agy was not dispatched`;
  const result = writeResult({
    status: "timeout",
    exitCode: 124,
    signal: null,
    finalMessage: "",
    touchedFiles: null,
    ...(stderr ? { stderrTail: stderr.split("\n").slice(-20) } : {}),
    error: message,
  });
  printSummary(result, run.resultPath);
  process.stderr.write(`relay: ${message}\n`);
  process.exit(result.exitCode);
}

function parseTerminalEnvelope(stdout) {
  const shape = (value) => {
    if (!value || typeof value !== "object") return null;
    const result = value.event === "result" ? value.result : value;
    return result && typeof result.status === "string" ? result : null;
  };
  // Accept a pretty-printed object as well as the final compact JSON/NDJSON line.
  try {
    const value = shape(JSON.parse(stdout));
    if (value) return value;
  } catch {
    /* A CLI startup diagnostic may precede the envelope. */
  }
  for (const line of stdout.split("\n").reverse()) {
    try {
      const value = shape(JSON.parse(line));
      if (value) return value;
    } catch {
      /* Skip non-JSON diagnostic lines. */
    }
  }
  return null;
}

function dispatchToAgy(opts, brief, run, writeResult, watchdogMs) {
  const relayArtifacts = [
    run.lockPath,
    run.briefPath,
    run.finalPath,
    run.stdoutPath,
    run.logPath,
    run.stderrPath,
    run.resultPath,
  ];
  const snapshot = () =>
    opts.readOnly
      ? workspaceSnapshot(opts.roots, relayArtifacts)
      : { digest: null, roots: opts.roots, reason: "read-only snapshot not requested" };
  const before = snapshot();
  const child = spawn("agy", buildArgv(opts, brief, run), {
    cwd: opts.cd,
    env: { ...process.env, PWD: opts.cd },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let stdout = "";
  let settled = false;
  let termination = null;
  let sigkillTimer = null;
  const stdoutDecoder = new StringDecoder("utf8");
  const watchdogTimer = setTimeout(() => stop("timeout", "SIGTERM"), watchdogMs);

  function stop(kind, signal) {
    if (settled) return;
    if (termination) {
      killChild(child, "SIGKILL");
      return;
    }
    termination = { kind, signal };
    clearTimeout(watchdogTimer);
    // A descendant holding stdout open must not prevent the parent's close event.
    child.once("exit", () => {
      child.stdout.destroy();
      child.stderr.destroy();
    });
    killChild(child);
    sigkillTimer = setTimeout(() => {
      killChild(child, "SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
    }, 2000);
  }

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => stop("aborted", signal));
  }
  child.stdout.on("data", (chunk) => {
    stdout += stdoutDecoder.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    appendFileSync(run.stderrPath, chunk);
  });

  function finish(code, signal, spawnError = null) {
    if (settled) return;
    settled = true;
    clearTimeout(watchdogTimer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
    // Always sweep the group after an abort or timeout, even if the leader exited
    // promptly. Its descendants may have ignored TERM and detached their pipes.
    if (termination) killChild(child, "SIGKILL");
    stdout += stdoutDecoder.end();
    writeFileSync(run.stdoutPath, stdout, "utf8");
    const envelope = parseTerminalEnvelope(stdout);
    const finalMessage = envelope
      ? typeof envelope.response === "string"
        ? envelope.response.trim()
        : ""
      : stdout.trim();
    if (finalMessage) writeFileSync(run.finalPath, finalMessage, "utf8");
    const after = snapshot();
    const readOnlyViolation = readOnlyVerdict(opts, before, after);
    const snapshotCoverage = opts.readOnly
      ? {
          roots: opts.roots,
          complete: before.digest !== null && after.digest !== null,
          beforeError: before.reason,
          afterError: after.reason,
          excludes: "relay artifacts and Git administrative files; Git HEAD and index are included",
        }
      : null;
    const touched = touchedFilesByRoot(opts.roots);
    const finishedReason =
      typeof envelope?.finished_reason === "string" ? envelope.finished_reason : null;
    const deniedActions = Array.isArray(envelope?.denied_actions) ? envelope.denied_actions : [];
    const conversationId =
      typeof envelope?.conversation_id === "string" && envelope.conversation_id
        ? envelope.conversation_id
        : parseIdsFromLog(run.logPath).conversationId;
    const observedModel =
      typeof envelope?.model_id === "string"
        ? envelope.model_id
        : typeof envelope?.model === "string"
          ? envelope.model
          : null;
    const stderr = readFileSync(run.stderrPath, "utf8");
    const permissionDenied =
      deniedActions.length > 0 ||
      /no output produced\s+[—-]\s+a tool required.+permission.+auto-denied/is.test(stderr);
    const resumeUnknown = opts.conversation && !conversationId;
    const resumeMismatch =
      opts.conversation && conversationId && opts.conversation !== conversationId;
    let status = "completed";
    let exitCode = code ?? (constants.signals[signal] ? 128 + constants.signals[signal] : 1);
    let error = null;
    if (termination?.kind === "aborted") {
      status = "aborted";
      signal = termination.signal;
      exitCode = 128 + (constants.signals[signal] || 15);
      error = `the relay was stopped by ${signal}; its agy process group was terminated; inspect the roots before re-dispatching`;
    } else if (termination?.kind === "timeout" || finishedReason === "print_timeout") {
      status = "timeout";
      exitCode = 124;
      error =
        finishedReason === "print_timeout"
          ? "agy reported print_timeout; the response is incomplete"
          : `agy exceeded the relay watchdog (${opts.timeout || `${opts.printTimeout} plus 60s grace`})`;
    } else if (finishedReason === "interrupted") {
      status = "aborted";
      exitCode = exitCode || 130;
      error = "agy reported an interrupted turn; inspect the roots before resuming";
    } else if (
      spawnError ||
      code !== 0 ||
      envelope?.status === "ERROR" ||
      finishedReason === "error"
    ) {
      status = "failed";
      exitCode = exitCode || 1;
      error = spawnError?.message || envelope?.error || "agy did not complete successfully";
    } else if (readOnlyViolation === true) {
      status = "read_only_violation";
      exitCode = 1;
      error =
        "the watched roots changed during an advisory read-only run; inspect the changes before using its answer";
    } else if (
      !envelope ||
      envelope.status !== "SUCCESS" ||
      finishedReason ||
      permissionDenied ||
      !finalMessage ||
      (opts.readOnly && !snapshotCoverage?.complete) ||
      resumeUnknown ||
      resumeMismatch
    ) {
      status = "incomplete";
      exitCode = 1;
      if (resumeMismatch)
        error = `requested conversation ${opts.conversation} was not resumed; agy reported ${conversationId}`;
      else if (resumeUnknown)
        error = "agy did not report a conversation ID; the requested continuation is unverified";
      else if (permissionDenied)
        error = "agy denied one or more required actions; the task is incomplete";
      else if (opts.readOnly && !snapshotCoverage?.complete)
        error = `read-only coverage is unknown: ${before.reason || after.reason}`;
      else if (finishedReason)
        error = `agy ended with finished_reason=${finishedReason}; completion is unverified`;
      else if (!envelope || envelope.status !== "SUCCESS")
        error = "no successful structured CLI result was received; completion is unverified";
      else error = "agy returned no final report; completion is unverified";
    }
    const result = writeResult({
      status,
      exitCode,
      childExitCode: code,
      signal: signal ?? null,
      finalMessage,
      cliStatus: envelope?.status ?? null,
      finishedReason,
      deniedActions,
      observedModel,
      conversationId,
      usage: envelope?.usage ?? null,
      modelUsage: envelope?.model_usage ?? null,
      touchedFiles: touched[0]?.files ?? null,
      touchedFilesByRoot: touched,
      readOnlyViolation,
      snapshotCoverage,
      ...(error ? { error, stderrTail: stderr.trim().split("\n").filter(Boolean).slice(-20) } : {}),
    });
    printSummary(result, run.resultPath);
    process.exit(result.exitCode);
  }
  child.once("error", (error) => finish(null, null, error));
  child.once("close", (code, signal) => finish(code, signal));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const brief = readBrief(opts);
  if (!brief.trim()) fail("empty brief (pass --brief <file> or pipe the brief on stdin)");

  // agy --print takes the prompt as a CLI argument, so the brief rides argv. The OS caps a
  // single argument (~128KB on Linux via MAX_ARG_STRLEN), so a huge brief would fail to spawn
  // with an opaque E2BIG. Reject it early with a clear message instead of a generic failure.
  const briefBytes = Buffer.byteLength(brief, "utf8");
  const MAX_BRIEF_BYTES = 120 * 1024;
  if (briefBytes > MAX_BRIEF_BYTES) {
    fail(
      `brief is ${Math.round(briefBytes / 1024)}KB; agy passes the prompt as a CLI argument, which the OS caps (~128KB on Linux). Trim it, or have agy read large context from the workspace instead of inlining it.`,
    );
  }

  const printTimeoutMs = parseDuration(opts.printTimeout);
  // An explicit --timeout wins over the default print-timeout-plus-grace: agy can hang well
  // past its own print timeout, which is exactly the case the grace window cannot cover.
  const watchdogMs = opts.timeout !== null ? parseDuration(opts.timeout) : printTimeoutMs + 60_000;
  const run = prepareRunDir(opts, brief);
  let version;
  try {
    version = agyVersion(watchdogMs);
  } catch (error) {
    const writeResult = makeResultWriter(opts, "unknown", run);
    reportVersionTimeout(writeResult, run, watchdogMs, error);
    return;
  }
  const writeResult = makeResultWriter(opts, version, run);

  if (!version) {
    reportUnavailable(writeResult, run.resultPath);
    return;
  }
  try {
    opts.selection = selectModel(opts, watchdogMs);
    opts.roots = workspaceRoots([opts.cd, ...opts.addDirs]);
  } catch (error) {
    const result = writeResult({
      status: "failed",
      exitCode: 1,
      signal: null,
      finalMessage: "",
      error: `preflight failed; no task was dispatched: ${error.message}`,
    });
    printSummary(result, run.resultPath);
    process.exit(1);
  }
  dispatchToAgy(opts, brief, run, writeResult, watchdogMs);
}

function printSummary(result, resultPath) {
  const lines = [];
  lines.push("");
  lines.push(
    `relay: ${result.status} (exit ${result.exitCode}${result.signal ? `, killed by ${result.signal}` : ""})  ·  agy ${result.agyVersion ?? "?"}`,
  );
  if (result.error) lines.push(`error: ${result.error}`);
  if (result.readOnly) {
    lines.push("read-only: watched, not enforced by this relay");
    if (result.readOnlyViolation === true) lines.push("READ-ONLY VIOLATION: watched roots changed");
    else if (result.readOnlyViolation === null) lines.push("read-only coverage: unknown");
  }
  lines.push(
    `model: requested=${result.requestedModel ?? "CLI default"}; resolved=${result.resolvedModel ?? "unknown"}; observed=${result.observedModel ?? "unknown"}`,
  );
  if (result.signal === "SIGKILL" && result.status === "failed")
    lines.push(
      "hint: the host killed the process (commonly the OOM killer or a supervisor timeout) — this is not an agy error; check host memory and re-dispatch, or split the task into smaller briefs.",
    );
  if (result.signal === "SIGTERM" && result.status === "failed")
    lines.push(
      'hint: something outside the relay terminated agy (a supervisor, the session ending, or a manual kill) — when the relay itself does the killing it reports status "timeout" or "aborted" instead; inspect the working tree before re-dispatching.',
    );
  if (result.resumed) lines.push("mode: resumed an existing conversation");
  else if (result.resumeRequested)
    lines.push(`mode: continuation ${result.resumed === false ? "not resumed" : "unverified"}`);
  if (result.projectId) lines.push(`project id: ${result.projectId}`);
  if (result.conversationId)
    lines.push(
      `conversation id (resume with: --conversation ${result.conversationId}): ${result.conversationId}`,
    );
  const touched = result.touchedFiles;
  if (touched === null) {
    lines.push("touched files: git unavailable - inspect the working tree directly");
  } else {
    lines.push(`touched files: ${touched.length}`);
    for (const file of touched.slice(0, 40)) lines.push(`  ${file}`);
    if (touched.length > 40) lines.push(`  ... and ${touched.length - 40} more`);
  }
  if (result.stderrTail && result.stderrTail.length) {
    lines.push("last stderr:");
    for (const line of result.stderrTail.slice(-8)) lines.push(`  ${line}`);
  }
  lines.push("");
  lines.push("--- agy final report ---");
  lines.push(result.finalMessage || "(no final message captured)");
  lines.push("--- end report ---");
  lines.push("");
  lines.push(`result: ${resultPath}`);
  lines.push(
    "relay does not commit. Review the diff, re-run the project gates yourself, then commit from the orchestrator.",
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
