import type { Capabilities } from "./capabilities.js";
import { Admission } from "./concurrency.js";
import { delegationDepth, type Config } from "./config.js";
import { assertWithinRoots, redact, redactDeep } from "./egress.js";
import { rootInsideState } from "./confine.js";
import { combineSnapshots, snapshotTree, treeChanged, type TreeSnapshot } from "./worktree.js";
import { EMPTY_USAGE, type AgyUsage, type DeniedAction } from "./envelope.js";
import { AgyFailure, classifyRun, InvalidRequestError } from "./failure.js";
import {
  isEffort,
  resolveEntry,
  type Effort,
  type ModelInfo,
  type ModelRegistry,
} from "./models.js";
import {
  MemoryPreferenceStore,
  type ModelPreference,
  type PreferenceStore,
} from "./preferences.js";
import { CooldownRegistry, QuotaError } from "./quota.js";
import {
  assertPromptIsSendable,
  runAgy,
  type AgyProcess,
  type RunnerDeps,
  type RunProgress,
  truncate,
} from "./runner.js";
import { modeFor, TOOLS, type ToolDef } from "./tools.js";
import { UsageLedger } from "./usage.js";
import { WarmSessions, WarmTimeout, WarmUnavailable, type WarmDeps } from "./warm.js";

export interface DelegationRequest {
  tool: ToolDef;
  /** Raw tool arguments; the tool validates them while building its prompt. */
  args: unknown;
  cwd: string;
  dirs?: string[];
  /** Continue this agy conversation instead of routing to a model. */
  conversationId?: string;
  /** Caller-pinned model; skips the tool's chain. */
  model?: string;
  effort?: Effort;
  /** Internal provenance: automatic council members do not bypass cooldowns. */
  modelOrigin?: "explicit" | "automatic";
  /** JSON Schema string; fills `structuredOutput`. */
  jsonSchema?: string;
  slashCommands?: boolean;
  write?: boolean;
  sandbox?: boolean;
  timeoutSec: number;
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
}

/** What one delegation produced. `attempts` carries the only pre-rendered strings. */
export interface Delegation {
  output: string;
  /** The model that answered; undefined when agy chose for itself. */
  model?: string;
  /** One line per model skipped or exhausted before this one answered. */
  attempts: string[];
  /** Set when model resolution had to degrade. */
  note?: string;
  sessionId?: string;
  timedOut: boolean;
  finishedReason?: string;
  /** Tool actions agy was refused. Non-empty means the answer may be incomplete. */
  deniedActions: DeniedAction[];
  usage: AgyUsage;
  usageKnown?: boolean;
  structuredOutput?: unknown;
  numTurns: number;
  /** Original length when the output was cut. */
  truncatedFrom?: number;
  /** Answered by a resident session rather than a fresh process. */
  warm: boolean;
  /** How many credential-shaped strings were scrubbed from the output. */
  redactions: number;
  /**
   * A plan-mode run changed the working tree anyway.
   *
   * `true` means the fingerprint moved and the run wrote despite being asked
   * not to; `false` means it demonstrably did not; `undefined` means the tree
   * could not be fingerprinted, which is not the same as "nothing happened".
   */
  wroteInReadOnlyMode?: boolean;
  /**
   * How a plan-mode run was kept read-only; absent for a run allowed to write.
   * `enforced` means agy and its children were denied writes inside every root.
   */
  readOnly?: ReadOnlyState;
  /**
   * Whether a continuation actually continued.
   *
   * agy answers `--conversation <id>` for an id it cannot find from a brand-new
   * conversation, exits 0, and only warns on the side. Present only when the call
   * asked to continue a conversation *and* agy reported which one answered:
   * `resumed: false` means the answer carries none of the history the caller
   * believes it is continuing. Absent means there is nothing to claim.
   */
  continuation?: { requested: string; resumed: boolean };
}

/** Compares the conversation a call asked for with the one agy says answered. */
function continuationOf(
  requested: string | undefined,
  reported: string | undefined,
): Pick<Delegation, "continuation"> {
  if (requested === undefined || reported === undefined) return {};
  return { continuation: { requested, resumed: requested === reported } };
}

/** Thrown while AGY_ASK_MODEL is on and nobody has called `set_model` yet. */
export class ModelNotChosenError extends Error {
  constructor(suggested: ModelPreference | null, available: ModelInfo[] | null) {
    const listing = available
      ? available.map((m) => `- ${m.name}`).join("\n")
      : "- (agy models could not be listed; run `agy models` yourself)";
    const fallback = suggested
      ? `${suggested.model}${suggested.effort ? ` at ${suggested.effort} effort` : ""}`
      : "agy's own default model";
    super(
      "No model has been chosen for this machine yet. Ask the user this, in these words: " +
        `"Proceed with the default — ${fallback} — or change the model or effort?" ` +
        "Then call `set_model` once: with no arguments to accept the default, or with the " +
        "model and effort they chose. The choice is saved and this will not be asked again.\n" +
        `Models agy offers:\n${listing}\n` +
        "Set AGY_ASK_MODEL=false to skip this and route on the built-in chains.",
    );
    this.name = "ModelNotChosenError";
  }
}

export interface DelegationDeps extends RunnerDeps, WarmDeps {
  /** Where the user\'s `set_model` choice lives; in memory unless given. */
  preferences?: PreferenceStore;
  cooldowns?: CooldownRegistry;
  /** Fingerprints the working tree; injected so tests need no real filesystem. */
  snapshot?: (cwd: string) => Promise<TreeSnapshot>;
}

/** One model to try, already reconciled with the effort agy will accept for it. */
interface Candidate {
  /** Undefined lets agy choose: a continued conversation, or an unreadable listing. */
  model?: string;
  effort?: Effort;
}

interface Route {
  candidates: Candidate[];
  note?: string;
}

/**
 * A failed run was not retried or failed over, because it may already have
 * taken effect. Re-running a write that half-happened applies it twice.
 */
export class NotRepeatedError extends Error {
  constructor(cause: Error, what: "retried" | "failed over to the next model") {
    super(
      `${cause.message}\n\nNot ${what}: the request was sent to agy and its outcome may include ` +
        `file changes or external effects. An unchanged or unreadable working tree cannot ` +
        `prove that nothing happened. Inspect the working tree and conversation before ` +
        `deliberately dispatching another turn.`,
      { cause },
    );
    this.name = "NotRepeatedError";
  }
}

export interface ReadOnlyState {
  enforced: boolean;
  /** Why the run was only watched, when it was not enforced. */
  reason?: string;
}

/**
 * The tree moved although agy was denied writes into it. That is not agy
 * ignoring plan mode: something outside its sandbox changed the tree.
 */
export const READ_ONLY_TREE_MOVED =
  "WORKING TREE CHANGED — this call ran in plan mode with writes into its roots blocked for agy " +
  "and every process it started, yet the tree changed while it ran. Another process changed it, " +
  "or agy reached it through a process started outside its sandbox, such as an app or a launchd " +
  "job. Inspect the tree before trusting it.";

/** The one wording of the read-only warning, for headers and for errors alike. */
export const READ_ONLY_VIOLATION =
  "READ-ONLY VIOLATION — this call ran in plan mode, and the working tree changed while it ran. " +
  "agy does not enforce plan mode, with the permission bypass on or off, and this run could not " +
  "be confined, so treat it as having had write access: inspect the tree before trusting it.";

/** The warning for a plan run whose tree moved, worded for how it was kept read-only. */
export function treeMovedWarning(state: ReadOnlyState | undefined): string {
  return state?.enforced ? READ_ONLY_TREE_MOVED : READ_ONLY_VIOLATION;
}

export class DelegationDepthError extends Error {
  constructor(depth: number, max: number) {
    super(
      `Refusing to delegate: this server is already ${depth} delegation(s) deep ` +
        `(limit ${max}). claude-agy-mcp is registered as an MCP server inside the agy ` +
        `session that called it, so the call would loop Claude -> agy -> claude-agy-mcp -> agy ` +
        `until the quota is gone. Unregister it with \`agy mcp remove\`, or raise ` +
        `AGY_MAX_DELEGATION_DEPTH if the nesting is deliberate.`,
    );
    this.name = "DelegationDepthError";
  }
}

/**
 * Runs a tool's prompt through agy, walking the tool's model chain and skipping
 * models that are still cooling down from a quota error. Owns everything that
 * has to be true across calls: admission control, cooldowns, spend, and the
 * resident sessions that make a follow-up cheap.
 */
export class Delegator {
  private readonly cooldowns: CooldownRegistry;
  private readonly admission: Admission;
  private readonly ledger: UsageLedger;
  private readonly warm: WarmSessions;
  private readonly prefs: PreferenceStore;
  private readonly depth: number;
  /** Cold agy processes still running, so shutdown can reap what it started. */
  private readonly live = new Set<AgyProcess>();

  constructor(
    private readonly cfg: Config,
    private readonly models: ModelRegistry,
    private readonly caps: Capabilities,
    private readonly deps: DelegationDeps = {},
    env: Record<string, string | undefined> = process.env,
  ) {
    this.depth = delegationDepth(env);
    this.cooldowns = deps.cooldowns ?? new CooldownRegistry();
    this.admission = new Admission(cfg.maxConcurrency);
    this.ledger = new UsageLedger(cfg.budgetTokens);
    this.warm = new WarmSessions(cfg, caps, { ...deps, env: this.childEnv() });
    this.prefs = deps.preferences ?? new MemoryPreferenceStore();
  }

  /** Everything the `agy_status` tool reports. */
  status(): {
    agyVersion: string;
    missingFlags: string[];
    spent: number;
    budget?: number;
    usage: ReturnType<UsageLedger["rows"]>;
    cooldowns: ReturnType<CooldownRegistry["active"]>;
    inFlight: number;
    queued: number;
    warm: ReturnType<WarmSessions["stats"]>;
    depth: number;
    preference: ModelPreference | null;
    askModel: boolean;
    readOnly: { policy: Config["readOnlyEnforcement"]; enforced: boolean; reason?: string };
  } {
    const confinement = this.deps.confinement;
    const enforced = this.cfg.readOnlyEnforcement !== "off" && confinement?.available === true;
    return {
      preference: this.prefs.load(),
      askModel: this.cfg.askModel,
      agyVersion: this.caps.version,
      missingFlags: this.caps.missing,
      spent: this.ledger.spent,
      ...(this.ledger.budget !== undefined ? { budget: this.ledger.budget } : {}),
      usage: this.ledger.rows(),
      cooldowns: this.cooldowns.active(),
      inFlight: this.admission.inFlight,
      queued: this.admission.queued,
      warm: this.warm.stats(),
      depth: this.depth,
      readOnly: {
        policy: this.cfg.readOnlyEnforcement,
        enforced,
        ...(enforced
          ? {}
          : {
              reason:
                this.cfg.readOnlyEnforcement === "off"
                  ? "AGY_READ_ONLY_ENFORCEMENT is off"
                  : (confinement?.reason ?? "write confinement was not set up"),
            }),
      },
    };
  }

  /** The models agy offers, or null when the listing could not be read. */
  availableModels(): Promise<ModelInfo[] | null> {
    return this.models.available();
  }

  /**
   * What `set_model` accepts when the user just says "proceed": the configured
   * default model resolved against the live listing, at the tier its name carries.
   */
  async defaultChoice(): Promise<ModelPreference | null> {
    if (!this.cfg.defaultModel) return null;
    const available = await this.models.available();
    if (!available) return null;
    const id = resolveEntry(this.cfg.defaultModel, available);
    if (!id) {
      throw new InvalidRequestError(
        `AGY_DEFAULT_MODEL "${this.cfg.defaultModel}" is not offered by this installation. ` +
          `Run agy models and choose an available default or call set_model with a listed ID.`,
      );
    }
    const pick = await this.selection(this.cfg.defaultModel, this.cfg.defaultEffort, available);
    const tier = available.find((m) => m.id === pick.model)?.effort;
    return { model: pick.model!, ...(isEffort(tier) ? { effort: tier } : {}), setAt: "" };
  }

  /** Resolve a fixed variant or an intentional family/effort selection exactly once. */
  private async selection(
    entry: string,
    effort: Effort | undefined,
    available: ModelInfo[],
  ): Promise<Candidate> {
    const id = resolveEntry(entry, available);
    if (!id) {
      throw new InvalidRequestError(
        `Model "${entry}" is not available. Run agy models and select a listed model ID.`,
      );
    }
    const fixed = available.find((m) => m.id === entry || m.name === entry);
    if (fixed && effort && fixed.effort !== effort) {
      throw new InvalidRequestError(
        `Model "${entry}" fixes the ${fixed.effort ?? "untiered"} variant; effort "${effort}" ` +
          `conflicts with that selection. Select the desired listed ID or use a family selector.`,
      );
    }
    return (await this.models.forEffort(id, effort)) ?? { model: id };
  }

  /**
   * Records the user's choice for every later call on this machine.
   *
   * The model is validated against the live listing; a tier that differs from
   * the one in the model's name selects the sibling at that tier, so what is
   * stored is exactly what will be passed to agy.
   */
  async setPreference(
    model: string | undefined,
    effort: Effort | undefined,
  ): Promise<ModelPreference> {
    // A choice that cannot be checked is not saved. Stored unverified, a
    // misspelt name was later dropped from every chain without a word, while
    // the status tool kept reporting it as the model in charge.
    const available = await this.models.available();
    if (!available) {
      throw new Error(
        "set_model could not verify the model: `agy models` failed, so nothing was saved. " +
          "Check that agy is installed and signed in, then call set_model again.",
      );
    }
    if (!model && !effort) {
      const fallback = await this.defaultChoice();
      if (!fallback) {
        throw new Error(
          "set_model needs a `model`: the default could not be resolved against agy's model list.",
        );
      }
      const pref = { ...fallback, setAt: new Date().toISOString() };
      this.prefs.save(pref);
      return pref;
    }
    model ??= this.cfg.defaultModel;
    if (!model)
      throw new InvalidRequestError("set_model requires a listed model or configured default.");
    const pick = await this.selection(model, effort, available);
    const tier = available.find((m) => m.id === pick.model)?.effort;
    const pref: ModelPreference = {
      model: pick.model!,
      ...(isEffort(tier) ? { effort: tier } : {}),
      setAt: new Date().toISOString(),
    };
    this.prefs.save(pref);
    return pref;
  }

  /**
   * Kills everything this delegator started. Cold runs are detached process
   * groups running with permissions skipped, so the bridge's own exit does not
   * stop them; without this they ran on for up to AGY_TIMEOUT after the client
   * was gone. Synchronous, because the exit path cannot wait.
   */
  shutdown(): void {
    this.warm.shutdown();
    for (const proc of this.live) {
      proc.kill("SIGTERM");
      proc.kill("SIGKILL");
    }
    this.live.clear();
  }

  /** The environment a child agy inherits, carrying the recursion counter. */
  private childEnv(): Record<string, string> {
    return { AGY_DELEGATION_DEPTH: String(this.depth + 1) };
  }

  private assertMayDelegate(req: DelegationRequest): void {
    if (this.depth >= this.cfg.maxDelegationDepth) {
      throw new DelegationDepthError(this.depth, this.cfg.maxDelegationDepth);
    }
    this.ledger.assertWithinBudget();
    // Everything agy will be given, not a similar-looking subset. `dirsFor`
    // derives workspace roots with dirname(), so validating only the caller's
    // own paths let a file argument equal to an allowed root contribute that
    // root's PARENT as a workspace directory — one level outside containment,
    // once per call.
    assertWithinRoots(
      [req.cwd, ...this.dirsFor(req), ...req.tool.touchedPaths(req.args, req.cwd)],
      this.cfg.allowedRoots,
    );
  }

  /**
   * How this call is kept read-only, or undefined for a call allowed to write.
   * Confinement follows the configured policy and what the machine supports.
   */
  private readOnlyFor(req: DelegationRequest): ReadOnlyState | undefined {
    if (modeFor(req.tool, req.write) !== "plan") return undefined;
    if (this.cfg.readOnlyEnforcement === "off") {
      return { enforced: false, reason: "AGY_READ_ONLY_ENFORCEMENT is off" };
    }
    const confinement = this.deps.confinement;
    if (!confinement?.available) {
      return { enforced: false, reason: confinement?.reason ?? "write confinement was not set up" };
    }
    if (rootInsideState([req.cwd, ...this.dirsFor(req)])) {
      return { enforced: false, reason: "a root is inside agy's own state directory" };
    }
    return { enforced: true };
  }

  /** The roots a read-only run is confined against, when it is confined at all. */
  private confineFor(req: DelegationRequest): string[] | undefined {
    return this.readOnlyFor(req)?.enforced ? [req.cwd, ...this.dirsFor(req)] : undefined;
  }

  /**
   * Every workspace root this call needs: what the caller asked for, plus the
   * directories the tool's own arguments imply — a file outside `cwd` is not in
   * agy's workspace unless its directory is added too.
   *
   * Whatever this returns is containment-checked by `assertMayDelegate`, so a
   * derived root can never widen the caller's reach.
   */
  private dirsFor(req: DelegationRequest): string[] {
    return [...new Set([...(req.dirs ?? []), ...req.tool.extraDirs(req.args, req.cwd)])];
  }

  async run(req: DelegationRequest): Promise<Delegation> {
    this.assertMayDelegate(req);
    const prompt = req.tool.buildPrompt(req.args, req.cwd);
    // Before the model gate, the queue and the fingerprint: a prompt agy can
    // never receive should cost nothing.
    assertPromptIsSendable(prompt);
    const pref = this.prefs.load();
    if (this.cfg.askModel && !pref && !req.model && !req.conversationId) {
      throw new ModelNotChosenError(await this.defaultChoice(), await this.models.available());
    }
    const route = await this.routeFor(req, pref);
    // agy does not honour plan mode, so where it can the bridge confines the
    // run (see readOnlyFor) and it watches in every case. Only plan-mode runs are watched:
    // a write run changing the tree is the point of it. Both fingerprints are
    // taken inside the admission gate, so this filesystem work is bounded by
    // AGY_MAX_CONCURRENCY like everything else and cannot stampede a big tree.
    //
    // Every root a read-only run receives is fingerprinted, not only `cwd`.
    // Fingerprints report local changes; they never authorize replay.
    const plan = modeFor(req.tool, req.write) === "plan";
    const readOnly = this.readOnlyFor(req);
    if (readOnly && !readOnly.enforced && this.cfg.readOnlyEnforcement === "require") {
      throw new AgyFailure(
        "agy_error",
        `Refusing a read-only run that cannot be confined (${readOnly.reason}). ` +
          `AGY_READ_ONLY_ENFORCEMENT=require forbids falling back to watching the tree.`,
      );
    }
    const roots = [req.cwd, ...this.dirsFor(req)];
    const snap = this.deps.snapshot ?? snapshotTree;
    const fingerprint = async () => combineSnapshots(await Promise.all(roots.map((r) => snap(r))));
    return this.admission.run(
      req.conversationId,
      async () => {
        // COR-M4. Re-check the budget here, inside the gate, not only before
        // queueing: `runMany` fans every leg out at once, so all of them used to
        // pass the pre-flight check while spend was still zero and overshoot was
        // bounded by leg count rather than by the limit.
        this.ledger.assertWithinBudget();
        const before = plan ? await fingerprint() : { method: "none" as const };
        let result: Delegation;
        try {
          result = await this.attemptWithInventoryRefresh(req, prompt, route);
        } catch (err) {
          // A plan run that wrote and then failed still wrote; the failure must
          // not swallow the evidence.
          if (plan && err instanceof Error && treeChanged(before, await fingerprint())) {
            err.message = `${err.message}\n\n${treeMovedWarning(readOnly)}`;
          }
          throw err;
        }
        if (!plan) return result;
        const wrote = treeChanged(before, await fingerprint());
        const watched = readOnly ? { ...result, readOnly } : result;
        return wrote === undefined ? watched : { ...watched, wroteInReadOnlyMode: wrote };
      },
      req.signal,
    );
  }

  /**
   * The models to try, in order, each with the `--effort` it will be sent.
   *
   * A requested effort belongs to the primary model only — the caller's
   * `model`, else the user's `set_model` choice, else the chain's head.
   * Re-tiering the fallbacks as well would turn "Flash (Medium)" back into the
   * "Flash (High)" that just hit its quota, so they keep the tier their name
   * carries. No effort is invented for an untiered fallback.
   */
  private async routeFor(req: DelegationRequest, pref: ModelPreference | null): Promise<Route> {
    // Continuing a conversation reuses the model it was started with, unless the
    // caller pinned one — agy honours a model switch on a resumed conversation,
    // which is how a cheap session gets a second opinion without re-sending it.
    if (req.conversationId && !req.model) {
      if (req.effort) {
        throw new InvalidRequestError(
          "An effort-only follow_up cannot be verified because this bridge does not know the " +
            "conversation's current model. Include its listed model ID (or a family selector) " +
            "with the effort, or omit effort to preserve the conversation's choice.",
        );
      }
      return { candidates: [{}] };
    }

    const available = await this.models.available();
    if (req.model) {
      // A call-local model selection never inherits the saved model's effort.
      if (available)
        return { candidates: [await this.selection(req.model, req.effort, available)] };
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(req.model)) {
        throw new InvalidRequestError(
          "Model discovery is unavailable, so a bridge selector or display label cannot be " +
            "converted to a CLI ID. Check agy models or provide an exact CLI model ID; nothing was dispatched.",
        );
      }
      const resolution = await this.models.resolveChain({ explicit: req.model, chain: [] });
      const pick = await this.models.forEffort(resolution.models[0], req.effort);
      return { candidates: [pick ?? { model: resolution.models[0] }], note: resolution.note };
    }

    if (pref) {
      if (!available || !resolveEntry(pref.model, available)) {
        throw new InvalidRequestError(
          `Saved model "${pref.model}" cannot be verified in agy models. No replacement was ` +
            `chosen and the saved preference was kept. Run agy models, then call set_model ` +
            `with an available model ID to recover.`,
        );
      }
      const saved = available.find((m) => m.id === resolveEntry(pref.model, available));
      if (pref.effort && saved?.effort !== pref.effort) {
        throw new InvalidRequestError(
          `Saved model "${pref.model}" and effort "${pref.effort}" disagree with the listing. ` +
            `Call set_model with the exact variant you intend; the preference was kept unchanged.`,
        );
      }
    }

    // A last-resort default is irrelevant when the chosen tool policy resolves.
    // Accepting that default through set_model still validates it explicitly.
    const resolution = await this.models.resolveChain({
      chain: [...(pref ? [pref.model] : []), ...(req.tool.chain ?? [])],
      defaultModel: this.cfg.defaultModel,
    });
    const tierOf = (id: string) => available?.find((m) => m.id === id)?.effort;

    const candidates: Candidate[] = [];
    for (const [i, model] of resolution.models.entries()) {
      if (!model) {
        candidates.push({});
        continue;
      }
      // Request effort deliberately re-tiers an automatic choice. A fixed saved
      // choice otherwise keeps its own tier, regardless of environment defaults.
      const primaryEffort = req.effort ?? (pref ? undefined : this.cfg.defaultEffort);
      const pick =
        i === 0
          ? await this.models.forEffort(model, primaryEffort)
          : tierOf(model)
            ? { model }
            : await this.models.forEffort(model, undefined);
      const candidate: Candidate = pick ?? { model };
      if (!candidates.some((c) => c.model === candidate.model)) candidates.push(candidate);
    }
    return { candidates, ...(resolution.note ? { note: resolution.note } : {}) };
  }

  /** Configured policy and effective IDs are distinct status facts. */
  async effectiveRoutes(): Promise<{ tool: string; models: string[]; error?: string }[]> {
    const preference = this.prefs.load();
    const rows: { tool: string; models: string[]; error?: string }[] = [];
    for (const tool of TOOLS) {
      if (!tool.chain) continue;
      try {
        const route = await this.routeFor({ tool, args: {}, cwd: "", timeoutSec: 0 }, preference);
        rows.push({
          tool: tool.name,
          models: route.candidates.map((c) => c.model ?? "agy default (unverified)"),
        });
      } catch (error) {
        rows.push({ tool: tool.name, models: [], error: (error as Error).message });
      }
    }
    return rows;
  }

  /**
   * The single exit through which every answer leaves this bridge.
   *
   * Order matters and is the reason both steps live here rather than in the
   * runner: redaction runs on the whole answer first, then truncation cuts it.
   * The other way round, a secret that straddled the cut point was split into
   * two halves that no longer matched any credential shape, and survived.
   * Routing both through one funnel also means the warm-session paths, which
   * never touch the runner, are scrubbed and capped exactly like a cold run.
   */
  private finish(partial: Omit<Delegation, "redactions" | "truncatedFrom">): Delegation {
    const scrubbed = this.cfg.redact ? redact(partial.output) : { text: partial.output, count: 0 };
    // SEC-M2. structuredContent is model output the caller *parses*, so leaving
    // it unscrubbed defeated the setting entirely for any schema-constrained call.
    const structured =
      this.cfg.redact && partial.structuredOutput !== undefined
        ? redactDeep(partial.structuredOutput)
        : undefined;
    const cut = truncate(scrubbed.text, this.cfg.maxOutputChars);
    return {
      ...partial,
      ...(structured ? { structuredOutput: structured.value } : {}),
      output: cut.text,
      ...(cut.from !== undefined ? { truncatedFrom: cut.from } : {}),
      redactions: scrubbed.count + (structured?.count ?? 0),
    };
  }

  /**
   * A resident session runs with the conversation's own model, in plan mode,
   * so it can only stand in for a call that asks for nothing else.
   */
  private warmEligible(req: DelegationRequest): boolean {
    return (
      this.warm.enabled &&
      req.conversationId !== undefined &&
      !req.jsonSchema &&
      !req.model &&
      !req.effort &&
      modeFor(req.tool, req.write) === "plan"
    );
  }

  /**
   * Invalidates discovery after an invalid-model failure for the next deliberate
   * call. Error text alone never authorizes replay of a dispatched turn.
   */
  private async attemptWithInventoryRefresh(
    req: DelegationRequest,
    prompt: string,
    route: Route,
  ): Promise<Delegation> {
    try {
      return await this.attempt(req, prompt, route);
    } catch (err) {
      const cause = err instanceof NotRepeatedError ? err.cause : err;
      if (cause instanceof AgyFailure && cause.kind === "invalid_model") this.models.invalidate();
      // Error text is not proof that the entire agent turn was never admitted.
      // Refresh discovery for the next deliberate call; never resend this turn.
      throw err;
    }
  }

  /** Legacy releases stored display labels; honor a uniquely mapped label too. */
  private async coolingFor(model: string): Promise<string | undefined> {
    const available = await this.models.available();
    const row = available?.find((item) => item.id === model);
    const aliases = new Set([model]);
    if (row && available?.filter((item) => item.name === row.name).length === 1)
      aliases.add(row.name);
    const longest = this.cooldowns.active().find((entry) => aliases.has(entry.model));
    return longest ? this.cooldowns.describe(longest.model) : undefined;
  }

  private async attempt(req: DelegationRequest, prompt: string, route: Route): Promise<Delegation> {
    const attempts: string[] = [];

    // A follow-up on a live conversation is the case a resident process is for.
    if (this.warmEligible(req)) {
      const conversationId = req.conversationId!;
      try {
        this.ledger.assertWithinBudget();
        const confineTo = this.confineFor(req);
        const envelope = await this.warm.turn(conversationId, req.cwd, prompt, {
          timeoutMs: req.timeoutSec * 1000,
          dirs: this.dirsFor(req),
          slashCommands: req.slashCommands,
          sandbox: req.sandbox,
          ...(confineTo ? { confineTo } : {}),
          ...(req.signal ? { signal: req.signal } : {}),
          ...(req.onProgress
            ? {
                onProgress: (text: string) =>
                  req.onProgress?.({ text, stepIndex: 0, stepType: "agent_response", tokens: 0 }),
              }
            : {}),
        });
        // Every observed result spent these tokens, including an error/empty
        // answer. Recording only successes made failed warm turns invisible.
        this.ledger.record(undefined, envelope.usage, envelope.usageKnown);
        const classified = classifyRun({ envelope, exitCode: 0, stderr: "" });
        if (envelope.finishedReason === "print_timeout" || !classified) {
          return this.finish({
            output: envelope.response.trim(),
            attempts,
            sessionId: envelope.conversationId ?? conversationId,
            ...continuationOf(conversationId, envelope.conversationId),
            timedOut: envelope.finishedReason === "print_timeout",
            ...(envelope.finishedReason ? { finishedReason: envelope.finishedReason } : {}),
            deniedActions: envelope.deniedActions,
            usage: envelope.usage,
            usageKnown: envelope.usageKnown,
            ...(envelope.structuredOutput !== undefined
              ? { structuredOutput: envelope.structuredOutput }
              : {}),
            numTurns: envelope.numTurns,
            warm: true,
          });
        }
        const failure = new AgyFailure(
          classified?.kind ?? "agy_error",
          classified?.message ?? "The resident agy session did not complete.",
        );
        failure.usage = envelope.usage;
        failure.usageKnown = envelope.usageKnown;
        failure.partialOutput = envelope.response;
        failure.conversationId = envelope.conversationId ?? conversationId;
        failure.finishedReason = envelope.finishedReason;
        failure.numTurns = envelope.numTurns;
        failure.deniedActions = envelope.deniedActions;
        failure.structuredOutput = envelope.structuredOutput;
        await this.warm.invalidate(conversationId);
        throw new NotRepeatedError(failure, "retried");
      } catch (err) {
        if (err instanceof WarmTimeout) {
          this.ledger.record(undefined, err.usage ?? EMPTY_USAGE, Boolean(err.usage));
          return this.finish({
            output: err.text.trim(),
            attempts,
            sessionId: err.conversationId ?? conversationId,
            timedOut: true,
            finishedReason: err.finishedReason ?? "print_timeout",
            deniedActions: err.deniedActions ?? [],
            usage: err.usage ?? EMPTY_USAGE,
            usageKnown: Boolean(err.usage),
            numTurns: err.numTurns ?? 0,
            warm: true,
          });
        }
        if (err instanceof WarmUnavailable) {
          attempts.push(`warm session unavailable (${err.message}); ran a fresh agy process`);
        } else {
          // Post-send stream failures/cancellation carry unknown or observed
          // usage. Envelopes were recorded above; their NotRepeatedError wrapper
          // has no direct usage field, so they are not counted twice here.
          this.recordFailedSpend(undefined, err);
          throw err;
        }
      }
    }

    for (const [i, { model, effort }] of route.candidates.entries()) {
      // A model the caller named is tried whatever its cooldown says: the
      // cooldown may be stale or a false alarm, and the caller asked for it.
      const pinned = i === 0 && req.model !== undefined && req.modelOrigin !== "automatic";
      const cooling = model && !pinned ? await this.coolingFor(model) : undefined;
      if (cooling !== undefined) {
        attempts.push(`${model}: quota cooldown, ${cooling} left`);
        continue;
      }
      try {
        return await this.runOnce(req, prompt, model, effort, attempts, route.note);
      } catch (err) {
        this.recordFailedSpend(model, err);
        const quota =
          err instanceof QuotaError || (err instanceof AgyFailure && err.policy.failover);
        if (!quota || !model) {
          if (
            err instanceof AgyFailure &&
            (err.kind === "network" || err.kind === "invalid_model")
          ) {
            throw new NotRepeatedError(err, "retried");
          }
          throw err;
        }
        // `failover` is granted to quota alone. A quota classified from stderr or
        // the envelope rather than the log is still an exhausted model: record
        // the cooldown, or every later call re-burns it before failing over.
        const reset = err instanceof QuotaError ? err.resetSeconds : undefined;
        this.cooldowns.set(model, reset);
        throw new NotRepeatedError(err as Error, "failed over to the next model");
      }
    }

    throw new Error(
      `All candidate models are quota-exhausted or cooling down:\n` +
        `${attempts.map((a) => `- ${a}`).join("\n")}\n` +
        `Retry after the quota resets, or pass an explicit \`model\`.`,
    );
  }

  /** A failed run still spent tokens; the budget has to see them. */
  private recordFailedSpend(model: string | undefined, err: unknown): void {
    const failure = err as { usage?: AgyUsage; usageKnown?: boolean } | undefined;
    if (failure?.usage || failure?.usageKnown === false) {
      this.ledger.record(model, failure.usage ?? EMPTY_USAGE, failure.usageKnown !== false);
    }
  }

  private async runOnce(
    req: DelegationRequest,
    prompt: string,
    model: string | undefined,
    effort: Effort | undefined,
    attempts: string[],
    note: string | undefined,
  ): Promise<Delegation> {
    // A resident owns a presence lock and an in-memory history. Before a cold
    // continuation, stop it and wait for termination rather than branching history.
    if (req.conversationId) await this.warm.invalidate(req.conversationId);
    this.ledger.assertWithinBudget();
    const result = await runAgy(
      {
        prompt,
        cwd: req.cwd,
        ...(this.dirsFor(req).length ? { dirs: this.dirsFor(req) } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        mode: modeFor(req.tool, req.write),
        ...(req.sandbox !== undefined ? { sandbox: req.sandbox } : {}),
        ...(req.slashCommands !== undefined ? { slashCommands: req.slashCommands } : {}),
        ...(req.jsonSchema ? { jsonSchema: req.jsonSchema } : {}),
        ...(req.conversationId ? { conversationId: req.conversationId } : {}),
        timeoutSec: req.timeoutSec,
        ...(req.signal ? { signal: req.signal } : {}),
        env: this.childEnv(),
        ...(req.onProgress ? { onProgress: req.onProgress } : {}),
        ...(this.confineFor(req) ? { confineTo: this.confineFor(req) } : {}),
      },
      this.cfg,
      this.caps,
      {
        spawn: this.deps.spawn,
        confinement: this.deps.confinement,
        timing: this.deps.timing,
        track: (proc) => {
          this.live.add(proc);
          return () => this.live.delete(proc);
        },
      },
    );

    this.ledger.record(model, result.usage, result.usageKnown);
    return this.finish({
      output: result.output,
      ...(model ? { model } : {}),
      attempts,
      ...(note ? { note } : {}),
      // No fallback to agy's global last-conversation cache: that file is keyed by
      // directory across the whole machine, so it hands back the user's own
      // interactive session, which follow_up would then read and append to.
      // A run that reports no conversation id simply has no resumable session.
      ...(result.conversationId ? { sessionId: result.conversationId } : {}),
      ...continuationOf(req.conversationId, result.conversationId),
      timedOut: result.timedOut,
      ...(result.finishedReason ? { finishedReason: result.finishedReason } : {}),
      deniedActions: result.deniedActions,
      usage: result.usage,
      usageKnown: result.usageKnown,
      ...(result.structuredOutput !== undefined
        ? { structuredOutput: result.structuredOutput }
        : {}),
      numTurns: result.numTurns,
      warm: false,
    });
  }

  /**
   * Fans one prompt out to several models, or several prompts out to the
   * automatic route. Each leg goes through `run`, so the semaphore, cooldowns,
   * budget and depth guard all still apply.
   */
  async runMany(
    req: DelegationRequest,
    legs: { model?: string; prompt?: string; label: string; automatic?: boolean }[],
    /** The caller listed the models itself, rather than taking the default council. */
    opts: { modelsChosen?: boolean } = {},
  ): Promise<{ label: string; delegation?: Delegation; error?: string }[]> {
    // Legs swallow their own errors, so the ask-once gate has to trip before
    // fan-out — unless the caller named the models, which is a choice. The
    // default council also names models, but nobody chose those.
    const chosen = req.model !== undefined || opts.modelsChosen === true;
    if (this.cfg.askModel && !this.prefs.load() && !chosen && !req.conversationId) {
      throw new ModelNotChosenError(await this.defaultChoice(), await this.models.available());
    }

    // Resolve only the selected fan-out mode. A tasks-only call must not depend
    // on council availability, and no explicit council may partially dispatch
    // before a later invalid member/alias is discovered.
    let prepared = legs;
    if (legs.some((leg) => leg.model !== undefined)) {
      const available = await this.models.available();
      if (!available) {
        throw new InvalidRequestError(
          "Cannot verify council membership because agy models could not be read. " +
            "Nothing was dispatched. Check the CLI and authentication, then try again.",
        );
      }
      prepared = [];
      const effective = new Set<string>();
      const unavailable: string[] = [];
      for (const leg of legs) {
        if (!leg.model) {
          prepared.push(leg);
          continue;
        }
        if (leg.automatic && !resolveEntry(leg.model, available)) {
          unavailable.push(leg.label);
          continue;
        }
        const pick = await this.selection(leg.model, req.effort, available);
        const id = pick.model!;
        if (effective.has(id)) {
          if (leg.automatic) continue;
          throw new InvalidRequestError(
            `Council selections resolve to the same model "${id}" more than once. ` +
              "Choose distinct listed variants; nothing was dispatched.",
          );
        }
        effective.add(id);
        prepared.push({ ...leg, model: id });
      }
      if (!prepared.length) {
        throw new InvalidRequestError(
          "None of the default council's models are listed by this agy account. " +
            "Pass explicit available models or use a single-model call; nothing was dispatched.",
        );
      }
      // Missing automatic members are visible without spending a paid leg.
      for (const label of unavailable)
        prepared.push({ label: `${label} (unavailable)`, automatic: true });
    }
    return Promise.all(
      prepared.map(async (leg) => {
        if (leg.automatic && !leg.model)
          return {
            label: leg.label,
            error: "Not offered in the current model inventory; skipped without dispatch.",
          };
        try {
          const {
            tasks: _tasks,
            models: _models,
            ...singleArgs
          } = req.args as Record<string, unknown>;
          const delegation = await this.run({
            ...req,
            ...(leg.model ? { model: leg.model } : {}),
            ...(leg.model
              ? { modelOrigin: leg.automatic ? ("automatic" as const) : ("explicit" as const) }
              : {}),
            // The model is now a canonical fixed variant. Its tier was already
            // reconciled above; a second inherited effort must not re-tier it.
            ...(leg.model ? { effort: undefined } : {}),
            // `!== undefined`, not truthiness: an empty task used to fall back to
            // the joined prompt of every task, running all the others again.
            ...(leg.prompt !== undefined ? { args: { ...singleArgs, prompt: leg.prompt } } : {}),
          });
          return { label: leg.label, delegation };
        } catch (err) {
          return { label: leg.label, error: (err as Error).message };
        }
      }),
    );
  }
}
