import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { probeCapabilities, type Capabilities } from "./capabilities.js";
import { probeConfinement, unavailableConfinement, type Confinement } from "./confine.js";
import { loadConfig, timeoutFor, type Config } from "./config.js";
import { FileCooldownStore } from "./cooldown-store.js";
import { FilePreferenceStore } from "./preferences.js";
import {
  Delegator,
  ModelNotChosenError,
  NotRepeatedError,
  treeMovedWarning,
  type Delegation,
} from "./delegation.js";
import { redact, redactDeep } from "./egress.js";
import { AgyFailure, InvalidRequestError } from "./failure.js";
import { removeLogDir, sweepStaleLogs, truncate } from "./runner.js";
import { EFFORTS, ModelRegistry, listModels } from "./models.js";
import { CooldownRegistry, QuotaError } from "./quota.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ElicitRequestFormParams,
  ElicitResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ROUTING_ARGS, TOOLS, type ToolDef } from "./tools.js";
import { SERVER_NAME, SERVER_TITLE } from "./identity.js";

export { SERVER_NAME, SERVER_TITLE } from "./identity.js";

const SET_MODEL_ARGS = z.object({
  model: z.string().min(1).optional(),
  effort: z.enum(EFFORTS).optional(),
});

/**
 * Read from package.json rather than restated here, so the handshake cannot
 * advertise a version the package does not have. `../package.json` resolves to
 * the package root from both `src/` and the bundled `dist/`, and npm always
 * ships package.json regardless of the `files` array.
 */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * What the SDK hands a tool handler. Every field is optional here so the handler
 * can also be called directly from a test with just the parts it needs.
 */
type HandlerExtra = Partial<RequestHandlerExtra<ServerRequest, ServerNotification>>;

/** A per-call fence so a delegated payload cannot forge this server's own metadata. */
export function makeNonce(): string {
  return randomBytes(6).toString("hex");
}

function deniedNote(d: Delegation): string | undefined {
  if (d.deniedActions.length === 0) return undefined;
  const names = [...new Set(d.deniedActions.map((a) => a.displayName || a.action))];
  return (
    `agy answered but ${d.deniedActions.length} tool action(s) were auto-denied ` +
    `(${names.join(", ")}) — the answer may be incomplete. Read-only tools ask agy to deny ` +
    `writes and commands, so this is expected for a review; for work that must run commands, ` +
    `use \`delegate\` with \`write: true\`.`
  );
}

/**
 * Renders a delegation as the text an agent reads.
 *
 * The metadata is fenced with a per-call nonce and placed *before* the payload.
 * The previous format appended it after raw model output behind a `---` rule,
 * which any analysed file containing `---` could forge.
 */
export function renderDelegation(d: Delegation, timeoutSec: number, nonce: string): string {
  const meta: string[] = [
    `model: ${d.model ?? (d.warm ? "the conversation's own" : "agy default")}`,
  ];
  if (d.warm) meta.push("warm session");
  if (d.readOnly) {
    meta.push(
      d.readOnly.enforced
        ? "read-only: enforced, writes into the workspace blocked"
        : `read-only: watched, not enforced (${d.readOnly.reason})`,
    );
  }
  if (d.note) meta.push(`note: ${d.note}`);
  if (d.attempts.length) meta.push(`failover: ${d.attempts.join("; ")}`);
  if (d.sessionId) meta.push(`session: ${d.sessionId} (use follow_up to continue)`);
  if (d.finishedReason) meta.push(`finished reason: ${d.finishedReason}`);
  if (d.usage.totalTokens) meta.push(`tokens: ${d.usage.totalTokens}`);
  if (d.usageKnown === false)
    meta.push("complete usage unavailable; reported tokens are a lower bound");
  if (d.redactions) meta.push(`redacted ${d.redactions} credential-shaped string(s)`);
  if (d.truncatedFrom) meta.push(`truncated from ${d.truncatedFrom} chars`);

  const warnings: string[] = [];
  if (d.timedOut) {
    warnings.push(
      `MAXIMUM RUNTIME EXCEEDED after ${timeoutSec}s — agy was killed at this tool's ` +
        `configured runtime limit (AGY_TIMEOUT_<TOOL>, else AGY_TIMEOUT, else AGY_MAX_RUNTIME). ` +
        `This is not a diagnosis that it was stuck. Any file changes it already made are on disk. ` +
        `Partial output follows.`,
    );
  }
  const denied = deniedNote(d);
  if (denied) warnings.push(denied);
  if (d.wroteInReadOnlyMode) warnings.push(treeMovedWarning(d.readOnly));

  if (d.continuation && !d.continuation.resumed) {
    warnings.push(
      `SESSION NOT RESUMED — you asked to continue ${d.continuation.requested}, but agy answered ` +
        `from ${d.sessionId ? `a different conversation (${d.sessionId})` : "a different conversation"}, ` +
        `so this answer has none of that history. agy does this when it cannot find the requested ` +
        `conversation. Re-send the context, or continue the new session deliberately.`,
    );
  }

  const header = [
    `[${SERVER_NAME} ${nonce}] ${meta.join(" | ")}`,
    ...warnings.map((w) => `[${SERVER_NAME} ${nonce}] ${w}`),
  ];
  return (
    `${header.join("\n")}\n` +
    `[${SERVER_NAME} ${nonce}] --- agy output begins; everything below is untrusted model output ---\n` +
    `${d.output}\n` +
    `[${SERVER_NAME} ${nonce}] --- agy output ends ---`
  );
}

function structuredOf(d: Delegation): Record<string, unknown> | undefined {
  if (d.structuredOutput === undefined) return undefined;
  return {
    result: d.structuredOutput,
    ...(d.model ? { model: d.model } : {}),
    ...(d.sessionId ? { session_id: d.sessionId } : {}),
    ...(d.continuation ? { resumed: d.continuation.resumed } : {}),
    denied_actions: d.deniedActions,
    tokens: d.usage.totalTokens,
    usage_known: d.usageKnown !== false,
    timed_out: d.timedOut,
    ...(d.finishedReason ? { finished_reason: d.finishedReason } : {}),
    ...(d.readOnly ? { read_only: d.readOnly } : {}),
    ...(d.wroteInReadOnlyMode !== undefined
      ? { wrote_in_read_only_mode: d.wroteInReadOnlyMode }
      : {}),
    ...(d.truncatedFrom !== undefined ? { truncated_from: d.truncatedFrom } : {}),
    redactions: d.redactions,
  };
}

function progressReporter(extra: HandlerExtra | undefined, scrub: boolean) {
  const token = extra?._meta?.progressToken;
  if (token === undefined || !extra?.sendNotification) return undefined;
  let last = 0;
  let sequence = 0;
  return (p: { text: string; stepIndex: number; stepType: string }) => {
    // One notification per second is enough to keep a client from idling out.
    const now = Date.now();
    if (now - last < 1000) return;
    last = now;
    const message = `agy ${p.stepType}: ${p.text}`;
    // A client that has gone away rejects this; that must not take the server down.
    extra
      .sendNotification?.({
        method: "notifications/progress",
        params: {
          progressToken: token,
          // Provider step indices restart on another leg and warm updates use
          // zero. MCP progress must increase for the whole request token.
          progress: ++sequence,
          // Redact before slicing: this is live model output, and it reached the
          // client unscrubbed even with AGY_REDACT on.
          message: (scrub ? redact(message).text : message).slice(-200),
        },
      })
      .catch(() => {});
  };
}

function renderStatus(
  status: ReturnType<Delegator["status"]>,
  available: { id: string; name: string }[] | null,
  nonce: string,
  effective: Awaited<ReturnType<Delegator["effectiveRoutes"]>> = [],
): string {
  const lines: string[] = [
    `agy ${status.agyVersion}`,
    status.preference
      ? `model choice (set_model): ${status.preference.model}` +
        (status.preference.effort ? ` at ${status.preference.effort} effort` : "") +
        ", placed ahead of every tool chain"
      : status.askModel
        ? "model choice (set_model): none yet — tools refuse to run until the user picks one"
        : "model choice (set_model): none; AGY_ASK_MODEL is off, tool chains route on their own",
    status.missingFlags.length
      ? `flags this agy lacks: ${status.missingFlags.join(", ")}`
      : "all flags this bridge uses are supported",
    `runs: ${status.inFlight} in flight, ${status.queued} queued`,
    `delegation depth: ${status.depth}`,
    status.budget !== undefined
      ? `reported tokens: ${status.spent} of ${status.budget} admission budget (in-flight/unknown usage may exceed it)`
      : `reported tokens: ${status.spent} (no budget set)`,
    `warm sessions: ${status.warm.resident} resident`,
    `read-only runs: ${
      status.readOnly.enforced
        ? "enforced, writes into their roots blocked"
        : status.readOnly.policy === "require"
          ? `refused, they cannot be confined — ${status.readOnly.reason}`
          : `watched, not enforced — ${status.readOnly.reason}`
    } (AGY_READ_ONLY_ENFORCEMENT=${status.readOnly.policy})`,
  ];
  if (status.usage.length) {
    lines.push("", "usage by model:");
    for (const row of status.usage) {
      lines.push(
        `  ${row.model}: ${row.runs} run(s), ${row.totalTokens} reported tokens${row.unknownRuns ? `, ${row.unknownRuns} run(s) with incomplete usage` : ""}`,
      );
    }
  }
  lines.push("", status.cooldowns.length ? "quota cooldowns:" : "quota cooldowns: none");
  for (const c of status.cooldowns) lines.push(`  ${c.model}: ${c.secondsLeft}s left`);
  lines.push("", "configured tool chains (selectors, not observed model use):");
  for (const tool of TOOLS) {
    if (tool.chain) lines.push(`  ${tool.name}: ${tool.chain.join(" -> ")}`);
  }
  lines.push("", "effective single-call routes (listed IDs, subject to cooldown):");
  for (const row of effective) lines.push(`  ${row.tool}: ${row.error ?? row.models.join(" -> ")}`);
  lines.push("default council policy (separate paid legs): " + COUNCIL.join(", "));
  lines.push("", available ? "models agy offers:" : "models agy offers: could not be listed");
  for (const m of available ?? []) lines.push(`  ${m.id} — ${m.name}`);
  return `[${SERVER_NAME} ${nonce}] status\n${lines.join("\n")}`;
}

/** Same members and order as `delegate_many`'s chain: one model per family, Flash first. */
const COUNCIL = ["gemini-flash@latest-high", "gemini-pro@latest-high", "claude-opus@latest"];

/** Failure payloads obey the same scrub-before-cap order as successful answers. */
function failureText(text: string, cfg: Config): { text: string; from?: number } {
  return truncate(cfg.redact ? redact(text).text : text, cfg.maxOutputChars);
}

function fanoutLegs(
  args: Record<string, unknown>,
): { model?: string; prompt?: string; label: string; automatic?: boolean }[] {
  const tasks = Array.isArray(args.tasks) ? (args.tasks as string[]) : [];
  const models = Array.isArray(args.models) ? (args.models as string[]) : [];
  if (tasks.length) {
    return tasks.map((prompt, i) => ({ prompt, label: `task ${i + 1}` }));
  }
  if (models.length) return models.map((model) => ({ model, label: model }));
  if (typeof args.model === "string") return [{ model: args.model, label: args.model }];
  return COUNCIL.map((model) => ({ model, label: model, automatic: true }));
}

function renderFanout(
  results: { label: string; delegation?: Delegation; error?: string }[],
  timeoutSec: number,
  nonce: string,
  cfg: Config,
): string {
  // SEC-M8. The leg heading has to carry the nonce like every other trusted
  // line. A bare "### <model>" is forgeable from inside a leg's own payload, so
  // one model could attribute fabricated text to another and defeat the whole
  // point of comparing the legs.
  const parts = results.map((r) =>
    r.delegation
      ? `[${SERVER_NAME} ${nonce}] leg: ${r.label}\n${renderDelegation(r.delegation, timeoutSec, nonce)}`
      : `[${SERVER_NAME} ${nonce}] leg: ${r.label}\n[${SERVER_NAME} ${nonce}] failed: ${failureText(r.error ?? "Unknown failure", cfg).text}`,
  );
  const answered = results.filter((r) => r.delegation).length;
  return (
    `[${SERVER_NAME} ${nonce}] fan-out: ${answered} of ${results.length} legs answered. ` +
    `Compare them yourself — agreement between models is evidence, not proof.\n\n` +
    parts.join("\n\n")
  );
}

/** Puts a form in front of the user; undefined when the client cannot show one. */
export type Elicit = (params: ElicitRequestFormParams) => Promise<ElicitResult>;

/**
 * Asks the user for the model and tier through the client's own UI, records the
 * answer, and reports whether delegation may go ahead.
 *
 * The gate's error text asks the *agent* to put the question to the user, but an
 * agent can just accept the default itself. A client that supports elicitation
 * lets the server ask the user directly, which the agent cannot short-circuit.
 */
async function askUserForModel(delegator: Delegator, elicit: Elicit): Promise<string | null> {
  const [suggested, available] = await Promise.all([
    delegator.defaultChoice(),
    delegator.availableModels(),
  ]);
  const choices = available?.map((m) => ({ const: m.id, title: m.name })) ?? [];
  if (choices.length === 0)
    return "Cannot choose a model until agy models can be read. Nothing was dispatched.";
  const defaultModel = suggested?.model;
  const result = await elicit({
    mode: "form",
    message:
      (defaultModel
        ? `Proceed with the default — ${defaultModel} — or choose a listed variant? `
        : "Choose a listed model variant. ") +
      "The model ID includes its tier. This choice is saved for this machine.",
    requestedSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          title: "Model",
          oneOf: choices,
          ...(defaultModel ? { default: defaultModel } : {}),
        },
      },
      required: ["model"],
    },
  });
  if (result.action !== "accept") {
    return (
      `The user ${result.action === "decline" ? "declined" : "cancelled"} the model choice, so ` +
      "nothing was delegated. Ask them what they want, then call `set_model`, or set " +
      "AGY_ASK_MODEL=false."
    );
  }
  const content = (result.content ?? {}) as Record<string, unknown>;
  const model = typeof content.model === "string" && content.model ? content.model : defaultModel;
  if (!model) return "No model was selected; nothing was dispatched.";
  // Accepting the proposed default uses the same setter as a bare set_model.
  await delegator.setPreference(model === defaultModel ? undefined : model, undefined);
  return null;
}

export function createToolHandler(
  tool: ToolDef,
  cfg: Config,
  delegator: Delegator,
  elicitFor: (extra?: HandlerExtra) => Elicit | undefined = () => undefined,
): (args: Record<string, unknown>, extra?: HandlerExtra) => Promise<ToolResponse> {
  const timeoutSec = timeoutFor(cfg, tool.name);
  /**
   * `delegationFailed` is false for a call that was never delegated because the
   * call itself was unusable. Strict mode's "do not do this work yourself"
   * belongs to a failed delegation; on a bad path or argument it told the agent
   * to give up on work it only had to ask for correctly.
   */
  const failed = (text: string, delegationFailed = true): ToolResponse => ({
    content: [
      {
        type: "text",
        text:
          cfg.onFailure === "strict" && delegationFailed
            ? text +
              `\n\n[${SERVER_NAME} strict mode] Delegation failed. Do NOT perform this work yourself ` +
              "in the main context — report the failure to the user and let them decide how to proceed."
            : text,
      },
    ],
    isError: true,
  });
  const handle = async (
    args: Record<string, unknown>,
    extra?: HandlerExtra,
  ): Promise<ToolResponse> => {
    const nonce = makeNonce();
    const gated = async <T>(delegate: () => Promise<T>): Promise<T> => {
      try {
        return await delegate();
      } catch (err) {
        const elicit = elicitFor(extra);
        if (!(err instanceof ModelNotChosenError) || !elicit) throw err;
        const refusal = await askUserForModel(delegator, elicit);
        if (refusal) throw new Error(refusal);
        return await delegate();
      }
    };
    try {
      if (tool.kind === "status") {
        const available = await delegator.availableModels();
        return {
          content: [
            {
              type: "text",
              text: renderStatus(
                delegator.status(),
                available,
                nonce,
                await delegator.effectiveRoutes(),
              ),
            },
          ],
        };
      }
      if (tool.kind === "configure") {
        const choice = SET_MODEL_ARGS.parse(args);
        const pref = await delegator.setPreference(choice.model, choice.effort);
        return {
          content: [
            {
              type: "text",
              text:
                `[${SERVER_NAME} ${nonce}] model set to ${pref.model}` +
                (pref.effort ? ` at ${pref.effort} effort` : "") +
                ". Saved for this machine; every tool routes to it first from now on.",
            },
          ],
        };
      }

      const routing = ROUTING_ARGS.parse(args);
      const onProgress = progressReporter(extra, cfg.redact);
      const base = {
        tool,
        args,
        cwd: routing.cwd ?? process.cwd(),
        ...(routing.dirs?.length ? { dirs: routing.dirs } : {}),
        ...(routing.session_id ? { conversationId: routing.session_id } : {}),
        ...(routing.model ? { model: routing.model } : {}),
        ...(routing.effort ? { effort: routing.effort } : {}),
        ...(routing.schema ? { jsonSchema: routing.schema } : {}),
        ...(routing.slash_commands !== undefined ? { slashCommands: routing.slash_commands } : {}),
        ...(routing.write !== undefined ? { write: routing.write } : {}),
        ...(routing.sandbox !== undefined ? { sandbox: routing.sandbox } : {}),
        timeoutSec,
        ...(extra?.signal ? { signal: extra.signal } : {}),
        ...(onProgress ? { onProgress } : {}),
      };

      if (tool.kind === "fanout") {
        // Also validate direct handler calls before any leg is prepared.
        tool.schema.parse(args);
        const modelsChosen = Array.isArray(args.models) && args.models.length > 0;
        const results = await gated(() =>
          delegator.runMany(base, fanoutLegs(args), { modelsChosen }),
        );
        const text = renderFanout(results, timeoutSec, nonce, cfg);
        // A leg that timed out answered with a fragment; if that is all there
        // is, the fan-out failed, just as a single timed-out delegation does.
        if (results.every((r) => r.error || r.delegation?.timedOut)) return failed(text);
        return { content: [{ type: "text", text }] };
      }

      const delegation = await gated(() => delegator.run(base));
      const structured = structuredOf(delegation);
      return {
        content: [{ type: "text", text: renderDelegation(delegation, timeoutSec, nonce) }],
        ...(structured ? { structuredContent: structured } : {}),
        isError: delegation.timedOut || undefined,
      };
    } catch (err) {
      // Error text is a return path like any other: AgyFailure carries agy's
      // stderr and the envelope's error string through verbatim.
      const msg = failureText((err as Error).message, cfg).text;
      const invalid = err instanceof InvalidRequestError || err instanceof z.ZodError;
      const cause = err instanceof NotRepeatedError ? err.cause : err;
      if (
        (cause instanceof AgyFailure || cause instanceof QuotaError) &&
        (cause.partialOutput || cause.conversationId)
      ) {
        const partial = failureText(cause.partialOutput ?? "", cfg);
        return {
          ...failed(
            `${msg}\n[${SERVER_NAME} ${nonce}] incomplete response${cause.conversationId ? ` | session: ${cause.conversationId}` : ""}` +
              `${cause.finishedReason ? ` | finished reason: ${cause.finishedReason}` : ""}\n` +
              `${partial.from !== undefined ? `[${SERVER_NAME} ${nonce}] partial output truncated from ${partial.from} chars\n` : ""}` +
              `[${SERVER_NAME} ${nonce}] --- untrusted partial output begins ---\n${partial.text}\n` +
              `[${SERVER_NAME} ${nonce}] --- untrusted partial output ends ---`,
            !invalid,
          ),
          structuredContent: {
            complete: false,
            ...(cause.conversationId ? { session_id: cause.conversationId } : {}),
            ...(cause.finishedReason ? { finished_reason: cause.finishedReason } : {}),
            ...(partial.from !== undefined ? { partial_truncated_from: partial.from } : {}),
            ...(cause.structuredOutput !== undefined
              ? { partial_result: cause.structuredOutput }
              : {}),
            ...(cause.usage ? { reported_usage: cause.usage } : {}),
            usage_known: cause.usageKnown !== false,
          },
        };
      }
      return failed(msg, !invalid);
    }
  };
  // One final egress boundary covers success metadata, denied actions, status,
  // single errors, partial council errors, and all structured results alike.
  return async (args, extra) => {
    const response = await handle(args, extra);
    return cfg.redact ? (redactDeep(response).value as ToolResponse) : response;
  };
}

export async function createServer(): Promise<McpServer> {
  const cfg = loadConfig();
  // Logs a crashed bridge left behind hold prompt text; clear them before adding more.
  sweepStaleLogs();
  const [caps, confinement] = await Promise.all([
    probeCapabilities(cfg.agyPath),
    cfg.readOnlyEnforcement === "off"
      ? Promise.resolve(unavailableConfinement("AGY_READ_ONLY_ENFORCEMENT is off"))
      : probeConfinement(),
  ]);
  if (!confinement.available && cfg.readOnlyEnforcement !== "off") {
    console.error(
      `${SERVER_NAME}: read-only runs cannot be confined here (${confinement.reason}); ` +
        (cfg.readOnlyEnforcement === "require"
          ? "AGY_READ_ONLY_ENFORCEMENT=require, so read-only tools will refuse to run."
          : "they will be watched, not enforced."),
    );
  }
  // A pre-flight failure here is the difference between "every call fails with a
  // confusing argument error" and one clear line before the first call.
  if (caps.version.startsWith("unknown")) {
    console.error(
      `${SERVER_NAME}: could not probe "${cfg.agyPath}" (${caps.version}). ` +
        `Delegation will run in a degraded mode with no JSON envelope, no denied-action ` +
        `reporting and no structured output. Check AGY_PATH, or install the Antigravity CLI.`,
    );
  } else if (caps.missing.length) {
    console.error(
      `${SERVER_NAME}: agy ${caps.version} does not support ${caps.missing.join(", ")}; ` +
        `those features are disabled for this session.`,
    );
  }
  return buildServer(cfg, caps, confinement);
}

/** The ways this process can end that the bridge needs to clean up for. */
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Runs `stop` once, on every ordinary way this process ends.
 *
 * The subtlety is that *adding* a signal listener suppresses Node's default
 * termination, so a handler that only cleans up would leave the bridge running
 * after a Ctrl-C. Rather than calling `process.exit` — which a library has no
 * business doing to its host, and which would fire under a test runner or an
 * embedder — the handler removes itself and re-raises the signal, letting the
 * default disposition apply with the correct exit status.
 *
 * `stop` must be synchronous: the `exit` path cannot await.
 */
export function installShutdown(stop: () => void, proc: NodeJS.Process = process): void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    try {
      stop();
    } catch {
      // Shutdown must never itself throw on the way out.
    }
  };
  proc.once("exit", run);
  for (const sig of SHUTDOWN_SIGNALS) {
    const handler = () => {
      run();
      proc.removeListener(sig, handler);
      proc.kill(proc.pid, sig);
    };
    proc.once(sig, handler);
  }
}

export function buildServer(
  cfg: Config,
  caps: Capabilities,
  confinement: Confinement = unavailableConfinement("write confinement was not set up"),
): McpServer {
  const delegator = new Delegator(cfg, new ModelRegistry(() => listModels(cfg.agyPath)), caps, {
    confinement,
    cooldowns: new CooldownRegistry(new FileCooldownStore()),
    preferences: new FilePreferenceStore(),
  });
  // Resident agy children are spawned detached and with permissions skipped, so
  // nothing reaps them if this process just exits. `shutdown()` existed but was
  // never called, which is why a bridge restart left agy processes behind.
  installShutdown(() => {
    delegator.shutdown();
    removeLogDir();
  });

  const server = new McpServer({ name: SERVER_NAME, title: SERVER_TITLE, version: VERSION });
  // Client capabilities are only known after the handshake, so look them up per
  // call. Only a client that can render a form is asked; the SDK throws for a
  // URL-only elicitation client, which would turn the gate into a crash.
  const elicitFor = (): Elicit | undefined =>
    server.server.getClientCapabilities()?.elicitation?.form
      ? (params) => server.server.elicitInput(params)
      : undefined;
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      createToolHandler(tool, cfg, delegator, elicitFor),
    );
  }
  return server;
}
