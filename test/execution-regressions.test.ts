import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnvelope } from "../src/envelope.js";
import { parseAgyError, classifyRun, MAX_RAW_OUTPUT_BYTES } from "../src/failure.js";
import { clipPartialOutput, MAX_PARTIAL_OUTPUT_CHARS, runAgy } from "../src/runner.js";
import { WarmSessions, type SpawnSession } from "../src/warm.js";
import { snapshotTree, treeChanged } from "../src/worktree.js";
import { envelopeJson, fakeAgy, FAST_TIMING, fullCaps, testConfig, valuesOf } from "./support.js";

function fakeResident() {
  const started: { args: string[]; kills: string[]; emit: (text: string) => void }[] = [];
  const spawnSession: SpawnSession = (_file, args) => {
    const state = { args, kills: [] as string[], emit: (_text: string) => {} };
    started.push(state);
    return {
      write: () => {},
      onData: (fn) => {
        state.emit = fn;
      },
      onExit: () => {},
      kill: (signal) => {
        state.kills.push(signal);
      },
    };
  };
  const answer = (index = 0) =>
    started[index]!.emit(
      JSON.stringify({
        event: "result",
        result: JSON.parse(envelopeJson({ response: "done", conversationId: "conv" })),
      }) + "\n",
    );
  return { started, spawnSession, answer };
}

describe("resident execution policy and ownership", () => {
  it("honors extra roots and explicit slash-command opt-in", async () => {
    const fake = fakeResident();
    const warm = new WarmSessions({ ...testConfig, warmSessions: true }, fullCaps, fake);
    try {
      const turn = warm.turn("conv", "/repo", "question", {
        timeoutMs: 1000,
        dirs: ["/extra"],
        slashCommands: true,
        sandbox: true,
      });
      fake.answer();
      await turn;
      expect(valuesOf(fake.started[0]!.args, "--add-dir")).toEqual(["/repo", "/extra"]);
      expect(fake.started[0]!.args).toContain("--sandbox");
      expect(fake.started[0]!.args).not.toContain("--disable-slash-commands");
    } finally {
      warm.shutdown();
    }
  });

  it.each(["--sandbox", "--mode"])("fails closed when a warm CLI lacks %s", async (flag) => {
    const fake = fakeResident();
    const caps = { ...fullCaps, has: (f: string) => f !== flag && fullCaps.has(f) };
    const warm = new WarmSessions({ ...testConfig, warmSessions: true, sandbox: true }, caps, fake);
    await expect(warm.turn("conv", "/repo", "q", { timeoutMs: 1000 })).rejects.toThrow(
      `does not support ${flag}`,
    );
    expect(fake.started).toHaveLength(0);
    warm.shutdown();
  });

  it("does not reuse a resident when workspace or slash policy changes", async () => {
    const fake = fakeResident();
    const warm = new WarmSessions({ ...testConfig, warmSessions: true }, fullCaps, fake);
    const first = warm.turn("conv", "/repo", "q", { timeoutMs: 1000, dirs: ["/extra"] });
    fake.answer();
    await first;
    await expect(
      warm.turn("conv", "/repo", "q2", { timeoutMs: 1000, dirs: ["/different"] }),
    ).rejects.toThrow(/different execution options/);
    expect(warm.stats().resident).toBe(0);
    warm.shutdown();
    expect(fake.started[0]!.kills).toContain("SIGKILL");
  });

  it("hard-kills a dropped resident when the bridge stops before escalation", async () => {
    const fake = fakeResident();
    const warm = new WarmSessions({ ...testConfig, warmSessions: true }, fullCaps, fake);
    const ac = new AbortController();
    const pending = warm
      .turn("conv", "/repo", "q", { timeoutMs: 1000, signal: ac.signal })
      .catch((e) => e);
    ac.abort();
    expect(await pending).toMatchObject({
      usageKnown: false,
      conversationId: "conv",
      finishedReason: "interrupted",
    });
    expect(warm.stats().resident).toBe(0);
    expect(fake.started[0]!.kills).toEqual(["SIGTERM"]);
    warm.shutdown();
    expect(fake.started[0]!.kills).toContain("SIGKILL");
  });

  it("invalidates an idle resident before a cold continuation", async () => {
    const fake = fakeResident();
    const warm = new WarmSessions({ ...testConfig, warmSessions: true }, fullCaps, fake);
    const first = warm.turn("conv", "/repo", "q", { timeoutMs: 1000 });
    fake.answer();
    await first;
    await warm.invalidate("conv");
    expect(warm.stats().resident).toBe(0);
    expect(fake.started[0]!.kills).toContain("SIGKILL");
    warm.shutdown();
  });

  it("refuses a second active turn without triggering a destructive cold fallback", async () => {
    const fake = fakeResident();
    const warm = new WarmSessions({ ...testConfig, warmSessions: true }, fullCaps, fake);
    try {
      const first = warm.turn("conv", "/repo", "q", { timeoutMs: 1000 });
      await expect(
        warm.turn("conv", "/repo", "q2", { timeoutMs: 1000, dirs: ["/changed"] }),
      ).rejects.toMatchObject({ name: "InvalidRequestError" });
      await expect(warm.invalidate("conv")).rejects.toMatchObject({ name: "InvalidRequestError" });
      expect(fake.started[0]!.kills).toEqual([]);
      fake.answer();
      expect((await first).response).toBe("done");
    } finally {
      warm.shutdown();
    }
  });
});

describe("bounded raw output", () => {
  it("redacts a credential before clipping through its boundary", () => {
    const marker = "sk-inertTestMarker000000000000000000";
    const text =
      "x".repeat(MAX_PARTIAL_OUTPUT_CHARS / 2 - 10) +
      " " +
      marker +
      " " +
      "y".repeat(MAX_PARTIAL_OUTPUT_CHARS / 2 + 100);
    expect(clipPartialOutput(text, false)).toContain("sk-");
    expect(clipPartialOutput(text, true)).not.toContain("sk-");
  });

  it("counts complete warm events in bytes and retains a bounded recovery excerpt", async () => {
    const fake = fakeResident();
    const warm = new WarmSessions({ ...testConfig, warmSessions: true }, fullCaps, fake);
    try {
      const turn = warm.turn("conv", "/repo", "q", { timeoutMs: 5000 }).catch((e) => e);
      // Every line parses and clears the carry. Two UTF-8 bytes per character
      // make this exceed the byte cap well before the old character cap.
      const event =
        JSON.stringify({
          event: "step_update",
          step_update: { text_delta: "é".repeat(1024 * 1024) },
        }) + "\n";
      for (let i = 0; i < 32; i++) fake.started[0]!.emit(event);
      const failure = await turn;
      expect(failure).toMatchObject({
        name: "OutputLimitError",
        finishedReason: "output_limit",
        conversationId: "conv",
        usageKnown: false,
      });
      expect(failure.partialOutput).toContain("partial output clipped");
      expect(failure.partialOutput.length).toBeLessThan(MAX_PARTIAL_OUTPUT_CHARS + 200);
      expect(fake.started[0]!.kills).toContain("SIGKILL");
      expect(warm.stats().resident).toBe(0);
    } finally {
      warm.shutdown();
    }
  });

  it("does not report success after a cold adapter clipped its raw output", async () => {
    const fake = fakeAgy({ envelope: { response: "partial", conversationId: "conv" } });
    await expect(
      runAgy({ prompt: "q", cwd: "/repo", timeoutSec: 10 }, testConfig, fullCaps, {
        spawn: (...args) => ({
          ...fake.spawn(...args),
          outputLimit: () => ({ source: "stdout", limitBytes: MAX_RAW_OUTPUT_BYTES }),
        }),
        timing: FAST_TIMING,
      }),
    ).rejects.toMatchObject({
      finishedReason: "output_limit",
      partialOutput: "partial",
      conversationId: "conv",
      usageKnown: true,
      usage: { totalTokens: 15 },
    });
  });

  it("rejects an oversized log before allocating its whole appended size", async () => {
    const fake = fakeAgy({ envelope: { response: "partial", conversationId: "conv" } });
    await expect(
      runAgy({ prompt: "q", cwd: "/repo", timeoutSec: 10 }, testConfig, fullCaps, {
        spawn: (file, args, opts) => {
          const log = args[args.indexOf("--log-file") + 1]!;
          writeFileSync(log, "");
          truncateSync(log, MAX_RAW_OUTPUT_BYTES + 1);
          return fake.spawn(file, args, opts);
        },
        timing: FAST_TIMING,
      }),
    ).rejects.toMatchObject({
      source: "run log",
      finishedReason: "output_limit",
      partialOutput: "partial",
      conversationId: "conv",
    });
  });

  it("stops the native child when stderr exceeds its byte limit", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agy-output-cap-"));
    const script = path.join(dir, "fake-agy");
    writeFileSync(
      script,
      `#!${process.execPath}\nprocess.stderr.write(Buffer.alloc(2*1024*1024,120));\nsetInterval(()=>{},1000);\n`,
      { mode: 0o755 },
    );
    try {
      await expect(
        runAgy(
          { prompt: "q", cwd: dir, conversationId: "conv", timeoutSec: 1 },
          { ...testConfig, agyPath: script },
          fullCaps,
          { timing: { pollMs: 5, graceMs: 50, killGraceMs: 20 } },
        ),
      ).rejects.toMatchObject({
        source: "stderr",
        finishedReason: "output_limit",
        conversationId: "conv",
        usageKnown: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("current agy completion protocol", () => {
  it("parses structured terminal diagnostics before legacy prose", () => {
    const stderr =
      'AGY_ERROR: {"status":"UNAVAILABLE","code":503,"retryable":true,"error_id":"trace-1"}';
    expect(parseAgyError(stderr)).toEqual({
      status: "UNAVAILABLE",
      code: 503,
      retryable: true,
      errorId: "trace-1",
    });
    expect(
      classifyRun({
        envelope: parseEnvelope(envelopeJson({ status: "ERROR", error: "backend unavailable" })),
        exitCode: 3,
        stderr,
      }),
    ).toMatchObject({ kind: "network" });
    expect(parseAgyError(`tool quoted ${stderr}`)).toBeUndefined();
  });

  it("distinguishes missing or malformed usage from a measured zero-cost result", () => {
    expect(parseEnvelope('{"status":"SUCCESS","response":"done"}')?.usageKnown).toBe(false);
    const raw = JSON.parse(envelopeJson({ response: "done", totalTokens: 0 }));
    expect(parseEnvelope(JSON.stringify(raw))?.usageKnown).toBe(true);
    raw.usage.total_tokens = -100;
    const malformed = parseEnvelope(JSON.stringify(raw));
    expect(malformed?.usageKnown).toBe(false);
    expect(malformed?.usage.totalTokens).toBe(0);
  });

  it("keeps CLI timeout partial text, session, usage and incomplete reason", async () => {
    const raw = {
      ...JSON.parse(
        envelopeJson({
          status: "ERROR",
          response: "partial",
          error: "print timeout",
          conversationId: "conv",
        }),
      ),
      finished_reason: "print_timeout",
    };
    const fake = fakeAgy({ stdout: JSON.stringify(raw), exitCode: 3 });
    const result = await runAgy(
      { prompt: "q", cwd: "/repo", timeoutSec: 10 },
      testConfig,
      fullCaps,
      { spawn: fake.spawn, timing: FAST_TIMING },
    );
    expect(result).toMatchObject({
      timedOut: true,
      output: "partial",
      conversationId: "conv",
      finishedReason: "print_timeout",
      usage: { totalTokens: 15 },
    });
  });

  it("preserves partial data on an interrupted result without reporting success", async () => {
    const raw = {
      ...JSON.parse(
        envelopeJson({ status: "INTERRUPTED", response: "partial", conversationId: "conv" }),
      ),
      finished_reason: "interrupted",
    };
    const fake = fakeAgy({ stdout: JSON.stringify(raw), exitCode: 3 });
    await expect(
      runAgy({ prompt: "q", cwd: "/repo", timeoutSec: 10 }, testConfig, fullCaps, {
        spawn: fake.spawn,
        timing: FAST_TIMING,
      }),
    ).rejects.toMatchObject({
      partialOutput: "partial",
      conversationId: "conv",
      finishedReason: "interrupted",
      usage: { totalTokens: 15 },
    });
  });

  it("rejects missing JSON result metadata even after exit zero", async () => {
    const fake = fakeAgy({ stdout: '{"event":"step_update"}\n', exitCode: 0 });
    await expect(
      runAgy({ prompt: "q", cwd: "/repo", timeoutSec: 10 }, testConfig, fullCaps, {
        spawn: fake.spawn,
        timing: FAST_TIMING,
      }),
    ).rejects.toMatchObject({ finishedReason: "missing_result" });
  });

  it.each([0, 3])(
    "retains the stream-init session when no result arrives (exit %s)",
    async (exitCode) => {
      const fake = fakeAgy({
        stdout: [
          JSON.stringify({ event: "init", conversation_id: "new-conversation" }),
          JSON.stringify({ event: "step_update", step_update: { text_delta: "partial" } }),
          "",
        ].join("\n"),
        stderr: exitCode ? "connection reset" : "",
        exitCode,
      });
      await expect(
        runAgy(
          { prompt: "q", cwd: "/repo", timeoutSec: 10, onProgress: () => {} },
          testConfig,
          fullCaps,
          { spawn: fake.spawn, timing: FAST_TIMING },
        ),
      ).rejects.toMatchObject({
        partialOutput: "partial",
        conversationId: "new-conversation",
        usageKnown: false,
      });
    },
  );

  it("treats a nonzero exit as incomplete even when the envelope claims success", () => {
    expect(
      classifyRun({
        envelope: parseEnvelope(envelopeJson({ response: "partial" })),
        exitCode: 3,
        stderr: "failed",
      }),
    ).toMatchObject({ kind: "agy_error" });
  });
});

it("does not certify an inaccessible or absent workspace as unchanged", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agy-unknown-tree-"));
  try {
    const missing = path.join(dir, "missing");
    const before = await snapshotTree(missing);
    const after = await snapshotTree(missing);
    expect(before.method).toBe("none");
    expect(treeChanged(before, after)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("stops a SIGTERM-ignoring descendant when a canceled cold leader exits", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agy-child-owner-"));
  const marker = path.join(dir, "pid");
  const heartbeat = path.join(dir, "heartbeat");
  const script = path.join(dir, "fake-agy");
  let pid: number | undefined;
  const childCode = `const fs=require('node:fs');process.on('SIGTERM',()=>{});let n=0;fs.writeFileSync(${JSON.stringify(heartbeat)},'0');fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n)),10);`;
  writeFileSync(
    script,
    `#!${process.execPath}\nimport {spawn} from 'node:child_process';\nspawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore','inherit','inherit']});\nsetInterval(()=>{},1000);\n`,
    { mode: 0o755 },
  );
  const ac = new AbortController();
  const pending = runAgy(
    { prompt: "q", cwd: dir, timeoutSec: 5, signal: ac.signal },
    { ...testConfig, agyPath: script },
    fullCaps,
    { timing: { pollMs: 10, graceMs: 50, killGraceMs: 5000 } },
  ).catch((e) => e);
  try {
    for (let n = 0; n < 200 && !existsSync(marker); n++) await delay(10);
    expect(existsSync(marker)).toBe(true);
    pid = Number(readFileSync(marker, "utf8"));
    ac.abort();
    expect((await pending).message).toMatch(/cancelled/);
    await delay(30);
    const stoppedAt = readFileSync(heartbeat, "utf8");
    await delay(60);
    expect(readFileSync(heartbeat, "utf8")).toBe(stoppedAt);
  } finally {
    ac.abort();
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already stopped */
      }
    }
    await pending;
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);
