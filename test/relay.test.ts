import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GEMINI4_LISTING } from "./gemini4-fixture.js";

const RELAY = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "agy-delegate",
  "scripts",
  "relay.mjs",
);
const temporary: string[] = [];
const children: ChildProcess[] = [];
const descendants: number[] = [];
const LISTING = GEMINI4_LISTING.trimEnd();

// This binary only manipulates disposable fixture files. It never invokes a model.
const FAKE = [
  "#!/usr/bin/env node",
  "const fs = require('node:fs'); const cp = require('node:child_process');",
  "const args = process.argv.slice(2);",
  "if (args[0] === 'changelog') { console.log('1.5.14: fixture'); process.exit(0); }",
  "if (args[0] === 'models') { console.log(process.env.RELAY_FIXTURE_MODELS); process.exit(0); }",
  "fs.writeFileSync(process.env.RELAY_FIXTURE_ARGS, JSON.stringify(args));",
  "const scenario = process.env.RELAY_FIXTURE_SCENARIO, target = process.env.RELAY_FIXTURE_TARGET;",
  'const envelope = JSON.parse(process.env.RELAY_FIXTURE_RESULT || \'{"status":"SUCCESS","response":"Reviewed fixture.","conversation_id":"fixture-session"}\');',
  "const finish = () => {",
  "  if (scenario === 'empty') process.exit(0);",
  "  if (scenario === 'plain') console.log('Unstructured output');",
  "  else console.log(JSON.stringify(envelope));",
  "  process.exit(Number(process.env.RELAY_FIXTURE_EXIT || 0));",
  "};",
  "if (scenario === 'write') { fs.writeFileSync(target, 'changed by fake child'); finish(); }",
  "else if (scenario === 'wait') {",
  "  fs.writeFileSync(target, 'ready');",
  "  const timer = setInterval(() => { if (fs.existsSync(target + '.release')) { clearInterval(timer); finish(); } }, 10);",
  "} else if (scenario === 'descendant') {",
  "  const child = cp.spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)\"], {stdio:['ignore','pipe','ignore']});",
  "  child.stdout.once('data', () => { child.stdout.destroy(); fs.writeFileSync(target, String(child.pid)); });",
  "  process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
  "} else finish();",
].join("\n");

afterEach(() => {
  for (const pid of descendants.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "agy-relay-test-"));
  temporary.push(dir);
  const repo = path.join(dir, "repo"),
    bin = path.join(dir, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "agy"), FAKE);
  chmodSync(path.join(bin, "agy"), 0o755);
  git(repo, "init", "-q");
  writeFileSync(path.join(repo, "tracked.txt"), "initial");
  git(repo, "add", ".");
  git(
    repo,
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "user.name=Fixture",
    "commit",
    "-qm",
    "fixture",
  );
  const out = path.join(dir, "out"),
    argsPath = path.join(dir, "args.json"),
    target = path.join(dir, "ready");
  const launch = (extra: string[] = [], env: Record<string, string> = {}, cwd = repo) => {
    const child = spawn(
      process.execPath,
      [RELAY, "--cd", cwd, "--out-dir", out, "--timeout", "5s", ...extra],
      {
        env: {
          ...process.env,
          PATH: bin + path.delimiter + process.env.PATH,
          RELAY_FIXTURE_MODELS: LISTING,
          RELAY_FIXTURE_ARGS: argsPath,
          RELAY_FIXTURE_TARGET: target,
          ...env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    children.push(child);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.stdin.end("Review this disposable fixture.");
    const done = new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      result: Record<string, any> | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        resolve({
          code,
          stdout,
          stderr,
          result: existsSync(path.join(out, "result.json"))
            ? JSON.parse(readFileSync(path.join(out, "result.json"), "utf8"))
            : null,
        }),
      );
    });
    return { child, done };
  };
  return { dir, repo, out, target, argsPath, launch };
}

async function until(check: () => boolean, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("fixture condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

function alive(pid: number) {
  try {
    if (
      process.platform === "linux" &&
      /\) [ZX] /.test(readFileSync("/proc/" + pid + "/stat", "utf8"))
    )
      return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("standalone relay workspace observation", () => {
  it.each(["extra-root", "ignored-file", "nested-cwd", "dependency-file"])(
    "detects writes in %s",
    async (scenario) => {
      const f = fixture();
      let cwd = f.repo;
      let target: string;
      const extra = ["--read-only"];
      if (scenario === "extra-root") {
        const root = path.join(f.dir, "extra");
        mkdirSync(root);
        target = path.join(root, "file.txt");
        extra.push("--add-dir", root);
      } else if (scenario === "nested-cwd") {
        cwd = path.join(f.repo, "nested");
        mkdirSync(cwd);
        target = path.join(cwd, "file.txt");
        writeFileSync(target, "committed");
        git(f.repo, "add", ".");
        git(
          f.repo,
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "user.name=Fixture",
          "commit",
          "-qm",
          "nested",
        );
      } else {
        target =
          scenario === "ignored-file"
            ? path.join(f.repo, "ignored.txt")
            : path.join(f.repo, "node_modules", "nested", "file.txt");
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(path.join(f.repo, ".gitignore"), "ignored.txt\nnode_modules/\n");
      }
      writeFileSync(target, "already dirty before");
      const { result, code } = await f.launch(
        extra,
        { RELAY_FIXTURE_SCENARIO: "write", RELAY_FIXTURE_TARGET: target },
        cwd,
      ).done;
      expect(readFileSync(target, "utf8")).toBe("changed by fake child");
      expect(code).toBe(1);
      expect(result).toMatchObject({
        status: "read_only_violation",
        readOnlyViolation: true,
        readOnlyEnforced: false,
        snapshotCoverage: { complete: true },
      });
    },
  );

  it("reports unchanged roots without claiming write enforcement", async () => {
    const f = fixture();
    const { code, result, stdout } = await f.launch(["--read-only"]).done;
    expect(code).toBe(0);
    expect(result).toMatchObject({
      status: "completed",
      readOnlyViolation: false,
      readOnlyEnforced: false,
    });
    expect(stdout).toContain("watched, not enforced");
  });

  it("can observe an unborn Git branch without treating it as unreadable", async () => {
    const f = fixture();
    git(f.repo, "checkout", "--orphan", "fixture-unborn");
    const { code, result } = await f.launch(["--read-only"]).done;
    expect(code).toBe(0);
    expect(result?.readOnlyViolation).toBe(false);
  });

  it("excludes only its captures when out-dir is reached through a symlink", async () => {
    const f = fixture();
    const realOut = path.join(f.repo, "artifacts");
    mkdirSync(realOut);
    symlinkSync(realOut, f.out, "dir");
    const { code, result } = await f.launch(["--read-only"]).done;
    expect(code).toBe(0);
    expect(result?.readOnlyViolation).toBe(false);
    expect(result?.briefPath).toBe(path.join(realpathSync.native(realOut), "brief.txt"));
  });

  it("reports unknown coverage for a link whose target is outside the watched roots", async () => {
    const f = fixture();
    const outside = path.join(f.dir, "outside.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, path.join(f.repo, "outside-link"));
    const { code, result } = await f.launch(["--read-only"]).done;
    expect(code).toBe(1);
    expect(result).toMatchObject({ status: "incomplete", readOnlyViolation: null });
    expect(result?.error).toContain("outside the watched roots");
  });

  it("marks an exceeded content budget unknown and incomplete", async () => {
    const f = fixture();
    const large = path.join(f.repo, "large.bin");
    writeFileSync(large, "");
    truncateSync(large, 128 * 1024 * 1024 + 1);
    const { code, result } = await f.launch(["--read-only"]).done;
    expect(code).toBe(1);
    expect(result).toMatchObject({
      status: "incomplete",
      readOnlyViolation: null,
      snapshotCoverage: { complete: false },
    });
    expect(result?.error).toContain("snapshot limit");
  });
});

describe("standalone relay result lifecycle", () => {
  it("publishes a new running record and never inherits old captures", async () => {
    const f = fixture();
    mkdirSync(f.out);
    writeFileSync(
      path.join(f.out, "result.json"),
      JSON.stringify({ status: "completed", runId: "old" }),
    );
    writeFileSync(path.join(f.out, "final.txt"), "old report");
    writeFileSync(
      path.join(f.out, "agy.log"),
      "Created conversation aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    const running = f.launch([], {
      RELAY_FIXTURE_SCENARIO: "wait",
      RELAY_FIXTURE_RESULT: '{"status":"ERROR","response":""}',
    });
    await until(() => existsSync(f.target));
    const live = JSON.parse(readFileSync(path.join(f.out, "result.json"), "utf8"));
    expect(live).toMatchObject({
      status: "running",
      finalPath: null,
      conversationId: null,
      finishedAt: null,
    });
    expect(live.runId).not.toBe("old");
    expect(existsSync(path.join(f.out, "final.txt"))).toBe(false);
    const overlapping = await f.launch().done;
    expect(overlapping.code).toBe(2);
    expect(overlapping.stderr).toContain("out-dir is locked");
    writeFileSync(f.target + ".release", "go");
    const { result } = await running.done;
    expect(result).toMatchObject({
      status: "failed",
      finalPath: null,
      conversationId: null,
      runId: live.runId,
    });
  });

  it.each([
    [{ status: "SUCCESS", response: "partial", finished_reason: "print_timeout" }, "timeout", 124],
    [{ status: "SUCCESS", response: "partial", finished_reason: "interrupted" }, "aborted", 130],
    [{ status: "SUCCESS", response: "partial", finished_reason: "error" }, "failed", 1],
    [{ status: "ERROR", response: "partial", error: "fixture failure" }, "failed", 1],
    [
      { status: "SUCCESS", response: "partial", denied_actions: [{ action: "write" }] },
      "incomplete",
      1,
    ],
    [{ status: "SUCCESS", response: "" }, "incomplete", 1],
  ] as const)("interprets the CLI envelope %j", async (envelope, status, code) => {
    const f = fixture();
    const outcome = await f.launch([], { RELAY_FIXTURE_RESULT: JSON.stringify(envelope) }).done;
    expect(outcome.code).toBe(code);
    expect(outcome.result?.status).toBe(status);
    expect(outcome.result?.finalMessage).toBe(envelope.response);
  });

  it("does not claim a requested conversation was resumed when CLI reports another", async () => {
    const f = fixture();
    const { result, code } = await f.launch(["--conversation", "requested-session"]).done;
    expect(code).toBe(1);
    expect(result).toMatchObject({
      status: "incomplete",
      resumed: false,
      conversationId: "fixture-session",
    });
  });

  it("does not promote unstructured stdout into successful completion", async () => {
    const f = fixture();
    const { result, code } = await f.launch([], { RELAY_FIXTURE_SCENARIO: "plain" }).done;
    expect(code).toBe(1);
    expect(result?.status).toBe("incomplete");
  });

  it("treats a success envelope with no response field as incomplete", async () => {
    const f = fixture();
    const { code, result } = await f.launch([], { RELAY_FIXTURE_RESULT: '{"status":"SUCCESS"}' })
      .done;
    expect(code).toBe(1);
    expect(result).toMatchObject({ status: "incomplete", finalMessage: "", finalPath: null });
  });

  it.skipIf(process.platform === "win32")(
    "kills a TERM-ignoring descendant after the CLI leader exits",
    async () => {
      const f = fixture();
      const run = f.launch([], { RELAY_FIXTURE_SCENARIO: "descendant" });
      await until(() => existsSync(f.target));
      const pid = Number(readFileSync(f.target, "utf8"));
      descendants.push(pid);
      expect(alive(pid)).toBe(true);
      run.child.kill("SIGTERM");
      const { result, code } = await run.done;
      expect(code).toBe(143);
      expect(result?.status).toBe("aborted");
      await until(() => !alive(pid));
    },
  );
});

describe("standalone relay capability selection", () => {
  it.each(
    LISTING.split("\n")
      .slice(1)
      .map((row) => row.split("\t")[0]!),
  )("passes listed ID %s exactly", async (id) => {
    const f = fixture();
    const { result, code } = await f.launch(["--model", id]).done;
    expect(code).toBe(0);
    expect(result).toMatchObject({ requestedModel: id, resolvedModel: id, observedModel: null });
    const args = JSON.parse(readFileSync(f.argsPath, "utf8"));
    expect(args[args.indexOf("--model") + 1]).toBe(id);
    expect(args).not.toContain("--effort");
  });

  it("resolves an advertised xhigh sibling and records a separately observed model", async () => {
    const f = fixture();
    const { result, code } = await f.launch(
      ["--model", "gemini-neon@latest", "--effort", "xhigh"],
      {
        RELAY_FIXTURE_RESULT:
          '{"status":"SUCCESS","response":"done","model_id":"gemini-4-neon-xhigh"}',
      },
    ).done;
    expect(code).toBe(0);
    expect(result).toMatchObject({
      requestedModel: "gemini-neon@latest",
      requestedEffort: "xhigh",
      resolvedModel: "gemini-4-neon-xhigh",
      resolvedEffort: "xhigh",
      observedModel: "gemini-4-neon-xhigh",
    });
  });

  it.each([
    ["gemini-4-neon-low", "xhigh"],
    ["gemini-carbon@latest", "xhigh"],
    ["gemini-neon@latest", "max"],
    ["gemini-pro-orchestrator", "high"],
  ])("rejects unlisted/conflicting effort for %s before dispatch", async (model, effort) => {
    const f = fixture();
    const { code, result } = await f.launch(["--model", model!, "--effort", effort!]).done;
    expect(code).toBe(1);
    expect(result?.status).toBe("failed");
    expect(existsSync(f.argsPath)).toBe(false);
  });

  it("accepts max only after the inventory advertises that variant", async () => {
    const f = fixture();
    const { code, result } = await f.launch(["--model", "gemini-neon@latest", "--effort", "max"], {
      RELAY_FIXTURE_MODELS: LISTING + "\nopaque-future-id\tGemini 4 Neon (Max)",
    }).done;
    expect(code).toBe(0);
    expect(result?.resolvedModel).toBe("opaque-future-id");
  });

  it("rejects effort without a known model as a pre-run usage error", async () => {
    const f = fixture();
    const { code, result } = await f.launch(["--effort", "xhigh"]).done;
    expect(code).toBe(2);
    expect(result).toBe(null);
    expect(existsSync(f.argsPath)).toBe(false);
  });
});
