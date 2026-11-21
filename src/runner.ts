import { spawn } from "node:child_process";
import type { Confinement } from "./confine.js";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Config } from "./config.js";
import type { Effort } from "./models.js";
import type { Capabilities } from "./capabilities.js";
import {
  parseEnvelope,
  parseStreamEvents,
  EMPTY_USAGE,
  type AgyEnvelope,
  type AgyUsage,
  type DeniedAction,
} from "./envelope.js";
import {
  AgyFailure,
  classifyRun,
  InvalidRequestError,
  MAX_RAW_OUTPUT_BYTES,
  OutputLimitError,
  parseAgyError,
} from "./failure.js";
import { LogTail } from "./logtail.js";
import { detectQuota, QuotaError } from "./quota.js";
import { redact } from "./egress.js";
import { LEGACY_SERVER_NAME, SERVER_NAME } from "./identity.js";

/** How much authority a single run is granted. */
export type RunMode = "plan" | "accept-edits";

export interface RunRequest {
  prompt: string;
  cwd: string;
  /** Extra workspace roots, each passed as its own --add-dir. */
  dirs?: string[];
  model?: string;
  /** Reasoning tier, separate from the model. */
  effort?: Effort;
  mode?: RunMode;
  sandbox?: boolean;
  /** Let agy expand the user's slash commands and skills. Off unless asked for. */
  slashCommands?: boolean;
  /** JSON schema string constraining the answer; fills `structuredOutput`. */
  jsonSchema?: string;
  conversationId?: string;
  /** How long this run may take, already resolved by `timeoutFor`. */
  timeoutSec: number;
  /** MCP cancellation signal — kills the agy process when aborted. */
  signal?: AbortSignal;
  /** Extra environment for the child, e.g. the delegation-depth counter. */
  env?: Record<string, string>;
  /** Deny agy and its children every write beneath these roots. Needs `RunnerDeps.confinement`. */
  confineTo?: string[];
  /** Called as agy streams; enables --output-format stream-json when supported. */
  onProgress?: (p: RunProgress) => void;
}

export interface RunProgress {
  /** Text agy has produced so far. */
  text: string;
  stepIndex: number;
  stepType: string;
  tokens: number;
}

export interface RunResult {
  output: string;
  conversationId?: string;
  /** Tool actions agy wanted and was refused — the proof of what it could not do. */
  deniedActions: DeniedAction[];
  usage: AgyUsage;
  usageKnown: boolean;
  structuredOutput?: unknown;
  numTurns: number;
  timedOut: boolean;
  finishedReason?: string;
}

export interface AgyProcess {
  /** What agy printed, up to the raw output cap. */
  stdout(): string;
  /** Legacy adapters may report dropped characters; dropping is an incomplete result. */
  stdoutDropped?(): number;
  stderr(): string;
  /** The native adapter stops accepting bytes after this limit is exceeded. */
  outputLimit?(): { source: string; limitBytes: number } | undefined;
  /** Settles when the process is fully done (exit + closed pipes, or spawn error). */
  wait(): Promise<{ code: number | null; error?: NodeJS.ErrnoException }>;
  /** Signals the whole process group so web-search helpers can't outlive agy. */
  kill(signal: NodeJS.Signals): void;
}

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
}

/**
 * The one seam of this module: how an agy process comes into being. Two adapters
 * satisfy it — a detached child process in production, a fake agy in tests.
 */
export type SpawnAgy = (file: string, args: string[], opts: SpawnOptions) => AgyProcess;

/** Knobs, not seams: how long the supervisor waits at each stage. */
export interface RunTiming {
  /** How often to scan the run log for quota errors and drain streamed progress. */
  pollMs?: number;
  /**
   * Extra wait beyond agy's own --print-timeout before we hard-kill, and, with
   * `killGraceMs`, how long a killed child is given to exit before its output is
   * taken as final and its log removed.
   */
  graceMs?: number;
  /** Delay between SIGTERM and SIGKILL escalation. */
  killGraceMs?: number;
}

export interface RunnerDeps {
  spawn?: SpawnAgy;
  timing?: RunTiming;
  /**
   * Told about every agy process this run starts; the returned function is
   * called once the process is done. The owner uses it to kill runs still in
   * flight when the bridge shuts down, since detached children outlive it.
   */
  track?: (proc: AgyProcess) => () => void;
  /** How `RunRequest.confineTo` is carried out on this machine. */
  confinement?: Confinement;
}

/** Retained for adapters that used the old character ceiling. Raw limits use bytes. */
export const MAX_STDOUT_CHARS = MAX_RAW_OUTPUT_BYTES;
const MAX_STDERR_BYTES = 1024 * 1024;
/** Error metadata is useful for recovery but must not duplicate an entire oversized stream. */
export const MAX_PARTIAL_OUTPUT_CHARS = 1024 * 1024;
/** How much of the run log is kept for the final quota check; a 429 is one line. */
const MAX_TRAILING_LOG_CHARS = 1024 * 1024;

/**
 * Appends `chunk`, keeping only the last `max` chars. Trims with slack so a
 * stream past the cap does not copy the whole buffer on every chunk.
 */
export function appendTail(
  buf: string,
  chunk: string,
  max: number,
): { text: string; dropped: number } {
  const next = buf + chunk;
  if (next.length <= max + max / 4) return { text: next, dropped: 0 };
  return { text: next.slice(next.length - max), dropped: next.length - max };
}

/**
 * agy takes the prompt as a single argv entry. Linux caps one argument at
 * 128 KiB (MAX_ARG_STRLEN) and macOS caps the whole argv near 1 MiB, and past
 * either spawn fails with a bare E2BIG. The byte limit is the Linux one, so a
 * call behaves the same on every platform.
 */
export const MAX_PROMPT_BYTES = 128 * 1024 - 1;

const spawnDetached: SpawnAgy = (file, args, opts) => {
  const child = spawn(file, args, {
    cwd: opts.cwd,
    detached: true,
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  // A child that dies before reading its stdin turns end() into EPIPE, and an
  // unlistened 'error' on the pipe takes the whole bridge down with it.
  child.stdin?.on("error", () => {});
  child.stdin?.end();

  let out = "";
  let err = "";
  let outBytes = 0;
  let errBytes = 0;
  let outputLimit: { source: string; limitBytes: number } | undefined;
  const stopAtLimit = (source: string, limitBytes: number) => {
    outputLimit ??= { source, limitBytes };
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };
  // A UTF-8 sequence can straddle two chunks; StringDecoder holds the partial
  // bytes instead of turning them into U+FFFD.
  const outDecoder = new StringDecoder("utf8");
  const errDecoder = new StringDecoder("utf8");
  child.stdout?.on("data", (d: Buffer) => {
    if (outputLimit) return;
    const room = MAX_RAW_OUTPUT_BYTES - outBytes;
    out += outDecoder.write(d.subarray(0, room));
    outBytes += Math.min(d.length, room);
    if (d.length > room) stopAtLimit("stdout", MAX_RAW_OUTPUT_BYTES);
  });
  child.stderr?.on("data", (d: Buffer) => {
    if (outputLimit) return;
    const room = MAX_STDERR_BYTES - errBytes;
    err += errDecoder.write(d.subarray(0, room));
    errBytes += Math.min(d.length, room);
    if (d.length > room) stopAtLimit("stderr", MAX_STDERR_BYTES);
  });
  const flush = () => {
    out += outDecoder.end();
    err += errDecoder.end();
  };

  const done = new Promise<{ code: number | null; error?: NodeJS.ErrnoException }>((resolve) => {
    let exitCode: number | null = null;
    // "close" needs all pipes shut; orphaned grandchildren can hold them open
    // forever, so resolve from "exit" after a short grace if "close" never fires.
    let closeFallback: NodeJS.Timeout | undefined;
    child.on("exit", (code) => {
      exitCode = code;
      // The group can still contain helpers after its leader exits. Reaping
      // only the leader (or resolving after a pipe-drain timeout) must not
      // cancel the only escalation capable of stopping those descendants.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* group already gone */
        }
      }
      closeFallback = setTimeout(() => {
        flush();
        resolve({ code: exitCode });
      }, 2000);
      closeFallback.unref();
    });
    child.on("close", (code) => {
      if (closeFallback) clearTimeout(closeFallback);
      flush();
      resolve({ code: code ?? exitCode });
    });
    child.on("error", (e) => {
      flush();
      resolve({ code: null, error: e as NodeJS.ErrnoException });
    });
  });

  return {
    stdout: () => out,
    stderr: () => err,
    outputLimit: () => outputLimit,
    wait: () => done,
    kill: (signal) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal); // whole process group
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return;
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
    },
  };
};

const LOG_DIR_PREFIX = `${SERVER_NAME}-`;
const LOG_DIR_PATTERN = new RegExp(`^(?:${SERVER_NAME}|${LEGACY_SERVER_NAME})-(\\d+)-`);
let logDir: string | undefined;

/**
 * Run logs carry prompt text and model output, so they live in a directory only
 * this user can read (mkdtemp creates it 0700), not loose in a shared tmpdir.
 */
function makeLogPath(): string {
  logDir ??= mkdtempSync(path.join(tmpdir(), `${LOG_DIR_PREFIX}${process.pid}-`));
  return path.join(logDir, `${randomUUID()}.log`);
}

/** Removes this process's log directory; for shutdown, so it must be synchronous. */
export function removeLogDir(): void {
  if (logDir) rmSync(logDir, { recursive: true, force: true });
  logDir = undefined;
}

/**
 * Removes run logs left behind by bridges that died without cleaning up. Only
 * entries this user owns whose recorded pid is no longer running are touched.
 */
export function sweepStaleLogs(dir: string = tmpdir()): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = LOG_DIR_PATTERN.exec(name)?.[1];
    if (!pid || Number(pid) === process.pid || isRunning(Number(pid))) continue;
    const full = path.join(dir, name);
    try {
      if (statSync(full).uid !== process.getuid?.()) continue;
      rmSync(full, { recursive: true, force: true });
    } catch {
      // Gone already, or not ours to remove.
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * agy's own flag parser sees `-p <prompt>`; a prompt that itself starts with a
 * dash can be read as a flag. Prefixing a zero-width space would corrupt the
 * text, so the guard is explicit and refuses instead.
 */
export function assertPromptIsNotFlagLike(prompt: string): void {
  if (/^\s*-/.test(prompt)) {
    throw new InvalidRequestError(
      "Prompt starts with '-', which agy's argument parser would read as a flag. " +
        "Rephrase it, or quote the leading dash.",
    );
  }
}

/**
 * Everything that makes a prompt impossible to hand to agy, checked before any
 * process exists. The messages never quote the prompt: Node's own errors for a
 * NUL byte echoed the whole argument back to the caller.
 */
export function assertPromptIsSendable(prompt: string): void {
  assertPromptIsNotFlagLike(prompt);
  if (prompt.includes("\0")) {
    throw new InvalidRequestError(
      "Prompt contains a NUL byte, which cannot be passed to agy as a command-line argument.",
    );
  }
  const bytes = Buffer.byteLength(prompt, "utf8");
  if (bytes > MAX_PROMPT_BYTES) {
    throw new InvalidRequestError(
      `Prompt is ${bytes} bytes; agy takes it as one command-line argument, limited to ` +
        `${MAX_PROMPT_BYTES} bytes. Pass file paths instead of inlining the content.`,
    );
  }
}

/**
 * Why spawn failed with ENOENT or ENOTDIR. Node reports a missing working
 * directory with the same code as a missing binary, and blaming the install
 * sent people to reinstall agy over a typo in `cwd`.
 */
async function spawnFailure(
  error: NodeJS.ErrnoException,
  cwd: string,
  agyPath: string,
): Promise<Error> {
  if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
    return new AgyFailure("agy_error", `agy failed: ${error.message}`);
  }
  const dir = await stat(cwd).catch(() => undefined);
  if (!dir) return new InvalidRequestError(`Working directory "${cwd}" does not exist.`);
  if (!dir.isDirectory())
    return new InvalidRequestError(`Working directory "${cwd}" is not a directory.`);
  return new AgyFailure(
    "not_installed",
    `agy CLI not found at "${agyPath}". Install the Antigravity CLI ` +
      `(https://antigravity.google/docs/cli-getting-started) or set AGY_PATH.`,
  );
}

/** Calls a caller's progress hook without letting its failure take the run with it. */
function report(onProgress: ((p: RunProgress) => void) | undefined, p: RunProgress): void {
  try {
    onProgress?.(p);
  } catch {
    // Progress is advisory; the answer still has to come back.
  }
}

export interface BuildArgsOptions {
  logPath: string;
  caps: Capabilities;
  /** "json" | "stream-json" | undefined for agy builds with no --output-format. */
  outputFormat?: "json" | "stream-json";
}

/** Shared by cold and resident processes: requested restrictions fail closed. */
export function permissionArgs(
  req: Pick<RunRequest, "mode" | "sandbox" | "slashCommands">,
  cfg: Config,
  caps: Capabilities,
): string[] {
  const args: string[] = [];
  const push = (flag: string, ...values: string[]) => {
    if (caps.has(flag)) args.push(flag, ...values);
  };
  /**
   * A flag whose whole job is to take authority away. Dropping one silently
   * grants the authority it was meant to remove, so an agy build that cannot
   * honour it fails the call instead of running with more power than asked.
   */
  const require = (flag: string, ...values: string[]) => {
    if (!caps.has(flag)) {
      throw new AgyFailure(
        "agy_error",
        `agy ${caps.version} does not support ${flag}, which this call needs in order to ` +
          `restrict the run. Refusing rather than running with more authority than requested. ` +
          `Upgrade the Antigravity CLI, or set AGY_PATH to a build that supports it.`,
      );
    }
    args.push(flag, ...values);
  };

  if (cfg.skipPermissions) push("--dangerously-skip-permissions");
  // A caller who asked to be confined must not be quietly unconfined.
  if (req.sandbox ?? cfg.sandbox) require("--sandbox");
  // "plan" is the read-only guarantee, so it is required; "accept-edits" only
  // grants authority, and a build that ignores it simply does less.
  if (req.mode === "plan") require("--mode", req.mode);
  else if (req.mode) push("--mode", req.mode);
  // Best-effort: a build with no such flag most plausibly has no slash-command
  // expansion to disable, so refusing the run would buy nothing.
  if (!req.slashCommands) push("--disable-slash-commands");
  return args;
}

export function buildArgs(req: RunRequest, cfg: Config, opts: BuildArgsOptions): string[] {
  const { caps, logPath } = opts;
  const args = permissionArgs(req, cfg, caps);
  const push = (flag: string, ...values: string[]) => {
    if (caps.has(flag)) args.push(flag, ...values);
  };

  args.push("--add-dir", req.cwd);
  for (const dir of req.dirs ?? []) if (dir !== req.cwd) args.push("--add-dir", dir);

  args.push("--log-file", logPath);
  if (req.conversationId) args.push("--conversation", req.conversationId);
  if (req.model) args.push("--model", req.model);
  if (req.effort) push("--effort", req.effort);
  if (req.jsonSchema) push("--json-schema", req.jsonSchema);
  if (opts.outputFormat) push("--output-format", opts.outputFormat);

  args.push("--print-timeout", `${req.timeoutSec}s`, "-p", req.prompt);
  return args;
}

export interface Truncation {
  text: string;
  /** Original length, present only when the text was cut. */
  from?: number;
}

/**
 * Cuts `text` to `max`, keeping both ends.
 *
 * Reviews and analyses put their conclusion last, so a head-only cut throws away
 * the part the caller most needs. The gap is stated in the text it returns.
 */
export function truncate(text: string, max: number): Truncation {
  if (text.length <= max) return { text };
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  const dropped = text.length - max;
  return {
    text:
      `${text.slice(0, head)}\n\n[${SERVER_NAME}: ${dropped} chars omitted here — output was ` +
      `${text.length} chars, limit ${max}. Ask a narrower question or raise AGY_MAX_OUTPUT_CHARS. ` +
      `The end of the output follows.]\n\n${text.slice(-tail)}`,
    from: text.length,
  };
}

/** Preserve both ends of a stopped turn without copying its whole raw transcript. */
export function clipPartialOutput(text: string, scrub = false): string {
  if (scrub) text = redact(text).text;
  if (text.length <= MAX_PARTIAL_OUTPUT_CHARS) return text;
  const half = MAX_PARTIAL_OUTPUT_CHARS / 2;
  return (
    `${text.slice(0, half)}\n\n[${SERVER_NAME}: partial output clipped; ` +
    `${text.length - MAX_PARTIAL_OUTPUT_CHARS} characters omitted.]\n\n${text.slice(-half)}`
  );
}

function outputLimitOf(proc: AgyProcess): { source: string; limitBytes: number } | undefined {
  if (proc.outputLimit) return proc.outputLimit();
  // Compatibility for external/fake adapters; the native adapter counts bytes
  // as they arrive instead of rescanning its accumulated output on every poll.
  if ((proc.stdoutDropped?.() ?? 0) > 0 || Buffer.byteLength(proc.stdout()) > MAX_RAW_OUTPUT_BYTES)
    return { source: "stdout", limitBytes: MAX_RAW_OUTPUT_BYTES };
  if (Buffer.byteLength(proc.stderr()) > MAX_STDERR_BYTES)
    return { source: "stderr", limitBytes: MAX_STDERR_BYTES };
  return undefined;
}

/**
 * Text agy produced, whichever output format it was asked for. A streaming run
 * cut off before its result event has no envelope, and its stdout is raw event
 * JSON, so what it streamed is the answer.
 */
function answerOf(
  envelope: AgyEnvelope | null,
  stdout: string,
  format: "json" | "stream-json" | undefined,
  streamed: string,
): string {
  if (envelope) return envelope.response.trim();
  if (format === "stream-json") return streamed.trim();
  return stdout.trim();
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

function outputFormatFor(req: RunRequest, caps: Capabilities): "json" | "stream-json" | undefined {
  if (!caps.has("--output-format")) return undefined;
  return req.onProgress ? "stream-json" : "json";
}

/**
 * The process to start for a run: agy itself, or agy under the write confinement
 * the request asked for. A confinement that cannot be applied fails the call, the
 * same rule `buildArgs` applies to a restricting flag agy lacks.
 */
export function commandFor(
  confineTo: string[] | undefined,
  agyPath: string,
  args: string[],
  confinement: Confinement | undefined,
): { file: string; args: string[] } {
  if (!confineTo) return { file: agyPath, args };
  if (!confinement?.available) {
    throw new AgyFailure(
      "agy_error",
      `This run asked to be confined against writes, but confinement is unavailable` +
        `${confinement?.reason ? ` (${confinement.reason})` : ""}. Refusing rather than ` +
        `running with more authority than requested.`,
    );
  }
  return confinement.wrap(agyPath, args, confineTo);
}

export async function runAgy(
  req: RunRequest,
  cfg: Config,
  caps: Capabilities,
  deps: RunnerDeps = {},
): Promise<RunResult> {
  assertPromptIsSendable(req.prompt);
  if (req.signal?.aborted) throw new Error("agy run cancelled by client.");
  if (caps.notInstalled) {
    throw new AgyFailure(
      "not_installed",
      `agy CLI not found at "${cfg.agyPath}" when this server started. Install the Antigravity ` +
        `CLI (https://antigravity.google/docs/cli-getting-started) or set AGY_PATH, then restart ` +
        `the MCP server.`,
    );
  }

  const spawnAgy = deps.spawn ?? spawnDetached;
  const pollMs = deps.timing?.pollMs ?? 1000;
  const graceMs = deps.timing?.graceMs ?? 15_000;
  const killGraceMs = deps.timing?.killGraceMs ?? 5_000;
  const logPath = makeLogPath();
  const outputFormat = outputFormatFor(req, caps);
  const tail = new LogTail(logPath);
  // A killed child gets this long to exit before its output is taken as final.
  const reapMs = killGraceMs + graceMs;
  let timedOut = false;
  let trailingLog = "";
  let child: AgyProcess | undefined;
  let untrack: (() => void) | undefined;
  let exited = false;
  let streamedText = "";
  let streamedConversationId: string | undefined;
  let outputFailure: OutputLimitError | undefined;

  const command = commandFor(
    req.confineTo,
    cfg.agyPath,
    buildArgs(req, cfg, { logPath, caps, outputFormat }),
    deps.confinement,
  );
  const finished = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      child = spawnAgy(command.file, command.args, {
        cwd: req.cwd,
        ...(req.env ? { env: req.env } : {}),
      });
      const proc = child;
      untrack = deps.track?.(proc);

      let settled = false;
      let polling = false;
      let streamCursor = 0;
      let streamRest = "";
      let escalate: NodeJS.Timeout | undefined;
      const timers: NodeJS.Timeout[] = [];

      const killChild = () => {
        proc.kill("SIGTERM");
        // Escalation must survive finish()'s cleanup, and unref keeps it from
        // holding the process open. It is cancelled once the child exits: a
        // group signal sent after that can land on whatever reused the id.
        escalate ??= setTimeout(() => proc.kill("SIGKILL"), killGraceMs);
        escalate.unref?.();
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(poller);
        for (const t of timers) clearTimeout(t);
        req.signal?.removeEventListener("abort", onAbort);
        fn();
      };

      const drainProgress = () => {
        if (!req.onProgress || outputFormat !== "stream-json") return;
        // The cursor counts every char ever printed; the buffer may have dropped
        // its head to stay under the cap, and a cursor past a dropped head
        // would otherwise stall progress for the rest of the run.
        const all = proc.stdout();
        const dropped = proc.stdoutDropped?.() ?? 0;
        if (dropped + all.length <= streamCursor) return;
        const from = streamCursor - dropped;
        if (from < 0) streamRest = "";
        const chunk = streamRest + all.slice(Math.max(0, from));
        streamCursor = dropped + all.length;
        const { events, rest } = parseStreamEvents(chunk);
        streamRest = rest;
        for (const ev of events) {
          if (ev.kind === "init") {
            streamedConversationId = ev.conversationId ?? streamedConversationId;
            continue;
          }
          if (ev.kind !== "step") continue;
          streamedText += ev.textDelta;
          report(req.onProgress, {
            text: streamedText,
            stepIndex: ev.stepIndex,
            stepType: ev.stepType,
            tokens: ev.usage?.totalTokens ?? 0,
          });
        }
      };

      const stopForOutputLimit = (failure: OutputLimitError) => {
        outputFailure ??= failure;
        drainProgress();
        if (!exited) killChild();
        finish(() => resolve({ stdout: proc.stdout(), stderr: proc.stderr(), code: null }));
      };

      const poller = setInterval(async () => {
        if (polling || settled) return;
        polling = true;
        try {
          const limit = outputLimitOf(proc);
          if (limit) {
            stopForOutputLimit(new OutputLimitError(limit.source, limit.limitBytes, req.model));
            return;
          }
          drainProgress();
          // Bank each consumed line even if the process settles during the read:
          // a terminal quota diagnostic can arrive just before process exit.
          const appended = await tail.read();
          if (appended)
            trailingLog = appendTail(trailingLog, appended, MAX_TRAILING_LOG_CHARS).text;
          if (settled) return; // settled during the async read — don't kill a finished run
          // A 429 in the log may be a transient per-minute limit. Current agy
          // retries it in-process while retaining completed tool outputs.
          // Observe logs, but only classify the terminal outcome below.
        } catch (error) {
          if (error instanceof OutputLimitError) stopForOutputLimit(error);
          // File errors are swallowed by LogTail; no rejected polling promise
          // may become an unhandled exception in a stream supervisor.
        } finally {
          polling = false;
        }
      }, pollMs);

      // Hard deadline independent of the child's pipes: agy's own --print-timeout
      // should fire first. If it doesn't, kill the child and let its exit deliver
      // whatever it printed on the way out; a child that will not die is given
      // `reapMs`, then its output so far is taken as the partial answer.
      timers.push(
        setTimeout(
          () => {
            killChild();
            timedOut = true;
            timers.push(
              setTimeout(() => {
                finish(() => resolve({ stdout: proc.stdout(), stderr: proc.stderr(), code: 0 }));
              }, reapMs),
            );
          },
          req.timeoutSec * 1000 + graceMs,
        ),
      );

      const onAbort = () => {
        killChild();
        drainProgress();
        const envelope = outputFormat ? parseEnvelope(proc.stdout()) : null;
        const partial = answerOf(envelope, proc.stdout(), outputFormat, streamedText);
        finish(() =>
          reject(
            Object.assign(new AgyFailure("agy_error", "agy run cancelled by client.", req.model), {
              usageKnown: envelope?.usageKnown ?? false,
              ...(envelope ? { usage: envelope.usage, numTurns: envelope.numTurns } : {}),
              conversationId:
                envelope?.conversationId ?? streamedConversationId ?? req.conversationId,
              finishedReason: "interrupted",
              ...(partial ? { partialOutput: clipPartialOutput(partial, cfg.redact) } : {}),
            }),
          ),
        );
      };
      if (req.signal?.aborted) {
        onAbort();
        return;
      }
      req.signal?.addEventListener("abort", onAbort, { once: true });

      void proc.wait().then(async ({ code, error }) => {
        exited = true;
        if (escalate) clearTimeout(escalate);
        if (settled) return;
        const limit = outputLimitOf(proc);
        if (limit) {
          stopForOutputLimit(new OutputLimitError(limit.source, limit.limitBytes, req.model));
          return;
        }
        drainProgress();
        if (error) {
          const failure = await spawnFailure(error, req.cwd, cfg.agyPath);
          finish(() => reject(failure));
          return;
        }
        finish(() => resolve({ stdout: proc.stdout(), stderr: proc.stderr(), code }));
      });
    },
  ).finally(async () => {
    // A cancelled or timed-out child may still be writing its log: give it a
    // bounded chance to exit before the log is drained and removed.
    if (child && !exited) await Promise.race([child.wait(), delay(reapMs)]);
    untrack?.();
    // Drain before deleting: a 429 that lands between the last poll tick and the
    // exit only exists in this file, and the post-run check below needs it.
    try {
      trailingLog = appendTail(trailingLog, await tail.flush(), MAX_TRAILING_LOG_CHARS).text;
    } catch (error) {
      if (error instanceof OutputLimitError) outputFailure ??= error;
    } finally {
      await rm(logPath, { force: true }).catch(() => {});
    }
  });

  // In text mode every line is model output, so nothing there may pass for an envelope.
  const envelope = outputFormat ? parseEnvelope(finished.stdout) : null;
  const answer = answerOf(envelope, finished.stdout, outputFormat, streamedText);
  const spent = envelope?.usage;
  const details = parseAgyError(finished.stderr);
  const conversationId = envelope?.conversationId ?? streamedConversationId;
  if (outputFailure) {
    throw Object.assign(outputFailure, {
      ...(spent ? { usage: spent } : {}),
      ...(details ? { details } : {}),
      usageKnown: envelope?.usageKnown ?? false,
      ...(answer ? { partialOutput: clipPartialOutput(answer, cfg.redact) } : {}),
      ...(conversationId || req.conversationId
        ? { conversationId: conversationId ?? req.conversationId }
        : {}),
      ...(envelope ? { numTurns: envelope.numTurns, deniedActions: envelope.deniedActions } : {}),
    });
  }
  const finishedReason =
    envelope?.finishedReason ??
    (/^\[agy\] print timeout after\b/im.test(finished.stderr) ? "print_timeout" : undefined);
  if (finishedReason === "print_timeout") timedOut = true;

  if (!timedOut) {
    const failure = classifyRun({
      envelope,
      exitCode: finished.code,
      stderr: finished.stderr,
    });
    if (failure) {
      const quota = failure.kind === "quota" ? detectQuota(trailingLog) : null;
      throw Object.assign(
        quota
          ? new QuotaError(req.model, quota)
          : new AgyFailure(failure.kind, failure.message, req.model),
        {
          ...(spent ? { usage: spent } : {}),
          ...(details ? { details } : {}),
          usageKnown: envelope?.usageKnown ?? false,
          ...(answer ? { partialOutput: answer } : {}),
          ...(conversationId ? { conversationId } : {}),
          ...(finishedReason ? { finishedReason } : {}),
          ...(envelope
            ? { numTurns: envelope.numTurns, deniedActions: envelope.deniedActions }
            : {}),
          ...(envelope?.structuredOutput !== undefined
            ? { structuredOutput: envelope.structuredOutput }
            : {}),
        },
      );
    }
    // A promised JSON protocol with no envelope is incomplete, even when the
    // process exits zero. Never pass raw protocol fragments off as an answer.
    if (outputFormat && !envelope) {
      throw Object.assign(
        new AgyFailure("agy_error", "agy exited without a complete result envelope.", req.model),
        {
          ...(answer ? { partialOutput: answer } : {}),
          ...(conversationId ? { conversationId } : {}),
          finishedReason: "missing_result",
          usageKnown: false,
        },
      );
    }
  }

  // Redaction and truncation both live in `Delegator.finish`, in that order, so
  // that every path — cold run, warm turn, warm timeout — gets both, and so a
  // secret straddling the cut point cannot survive by being split in half.
  return {
    output: answer,
    ...(conversationId ? { conversationId } : {}),
    deniedActions: envelope?.deniedActions ?? [],
    usage: envelope?.usage ?? EMPTY_USAGE,
    usageKnown: envelope?.usageKnown ?? false,
    ...(envelope && envelope.structuredOutput !== undefined
      ? { structuredOutput: envelope.structuredOutput }
      : {}),
    numTurns: envelope?.numTurns ?? 0,
    timedOut,
    ...(finishedReason ? { finishedReason } : {}),
  };
}
