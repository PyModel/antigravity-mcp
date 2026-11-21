import { afterEach, describe, expect, it, vi } from "vitest";
import { Delegator } from "../src/delegation.js";
import { ModelRegistry, parseListing } from "../src/models.js";
import { MemoryPreferenceStore } from "../src/preferences.js";
import { createToolHandler } from "../src/server.js";
import { BudgetExceededError, BudgetUsageUnknownError, UsageLedger } from "../src/usage.js";
import { EMPTY_USAGE } from "../src/envelope.js";
import { CooldownRegistry, MemoryCooldownStore } from "../src/quota.js";
import { GEMINI4_LISTING } from "./gemini4-fixture.js";
import {
  envelopeJson,
  fakeAgy,
  fullCaps,
  LISTING,
  makeDelegator,
  testConfig,
  toolNamed,
  valueOf,
} from "./support.js";

const live: Delegator[] = [];
afterEach(() => {
  for (const d of live.splice(0)) d.shutdown();
  vi.restoreAllMocks();
});
const request = (over: Record<string, unknown> = {}) => ({
  tool: toolNamed("delegate"),
  args: { prompt: "Inspect the fixture" },
  cwd: "/repo",
  timeoutSec: 30,
  ...over,
});
const textOf = (response: { content: { text: string }[] }) =>
  response.content.map((c) => c.text).join("\n");

describe("current model selection and stored choices", () => {
  it.each(parseListing(GEMINI4_LISTING).map((m) => [m.id, m.name]))(
    "dispatches listed %s as its canonical CLI ID",
    async (id, label) => {
      const permitted = new Set(parseListing(GEMINI4_LISTING).map((m) => m.id));
      const agy = fakeAgy((args) =>
        permitted.has(valueOf(args, "--model") ?? "")
          ? { answer: "verified fixture answer" }
          : { envelope: { status: "ERROR", error: "invalid model selection" }, exitCode: 1 },
      );
      const { cfg, delegator } = makeDelegator({
        spawn: agy.spawn,
        listing: async () => GEMINI4_LISTING,
      });
      live.push(delegator);
      // Legacy/display-name input stays supported, but argv and persistence use IDs.
      const response = await createToolHandler(
        toolNamed("delegate"),
        cfg,
        delegator,
      )({ prompt: "Inspect", model: label });
      expect(response.isError).toBeUndefined();
      expect(valueOf(agy.runs[0]!, "--model")).toBe(id);
      expect(agy.runs[0]).not.toContain("--effort");
      await delegator.setPreference(label, undefined);
      expect(delegator.status().preference?.model).toBe(id);
    },
  );

  it("honors a fixed explicit variant without inheriting another saved model's effort", async () => {
    const agy = fakeAgy({ answer: "ok" });
    const { delegator } = makeDelegator({ spawn: agy.spawn, listing: async () => GEMINI4_LISTING });
    live.push(delegator);
    await delegator.setPreference("gemini-4-carbon-high", undefined);
    await delegator.run(request({ model: "gemini-4-neon-medium" }));
    expect(valueOf(agy.runs[0]!, "--model")).toBe("gemini-4-neon-medium");
    await expect(
      delegator.run(request({ model: "gemini-4-neon-high", effort: "medium" })),
    ).rejects.toThrow(/conflicts/);
    expect(agy.runs).toHaveLength(1);
  });

  it("selects only listed family tiers and refuses an unsupported max", async () => {
    const agy = fakeAgy({ answer: "ok" });
    const { delegator } = makeDelegator({ spawn: agy.spawn, listing: async () => GEMINI4_LISTING });
    live.push(delegator);
    await delegator.run(request({ model: "gemini-neon@latest", effort: "xhigh" }));
    expect(valueOf(agy.runs[0]!, "--model")).toBe("gemini-4-neon-xhigh");
    await expect(
      delegator.run(request({ model: "gemini-neon@latest", effort: "max" })),
    ).rejects.toThrow();
    await expect(
      delegator.run(request({ model: "gemini-carbon@latest", effort: "xhigh" })),
    ).rejects.toThrow();
    expect(agy.runs).toHaveLength(1);
  });

  it("retains a vanished legacy pin and refuses silently replacing it", async () => {
    const preferences = new MemoryPreferenceStore();
    preferences.save({ model: "Gemini 3.1 Pro (High)", effort: "high", setAt: "legacy" });
    const agy = fakeAgy({ answer: "must not run" });
    const d = new Delegator(
      testConfig,
      new ModelRegistry(async () => GEMINI4_LISTING),
      fullCaps,
      { preferences, spawn: agy.spawn },
      {},
    );
    live.push(d);
    await expect(d.run(request())).rejects.toThrow(/Saved model.*cannot be verified/);
    expect(d.status().preference).toEqual({
      model: "Gemini 3.1 Pro (High)",
      effort: "high",
      setAt: "legacy",
    });
    expect(agy.runs).toHaveLength(0);
  });

  it("keeps a valid saved pin usable when an unrelated fallback is not listed", async () => {
    const agy = fakeAgy({ answer: "ok" });
    const { delegator } = makeDelegator({
      spawn: agy.spawn,
      listing: async () => GEMINI4_LISTING,
      cfg: { defaultModel: "gemini-flash@latest-high" },
    });
    live.push(delegator);
    await delegator.setPreference("gemini-4-neon-medium", undefined);
    const result = await delegator.run(request());
    expect(result.model).toBe("gemini-4-neon-medium");
    expect(valueOf(agy.runs[0]!, "--model")).toBe("gemini-4-neon-medium");
  });

  it("keeps a valid tool policy usable when its unused last-resort default is absent", async () => {
    const agy = fakeAgy({ answer: "ok" });
    const { delegator } = makeDelegator({
      spawn: agy.spawn,
      cfg: { defaultModel: "unavailable-last-resort" },
    });
    live.push(delegator);
    expect((await delegator.run(request())).model).toBe("gemini-3.8-flash-high");
    await expect(delegator.setPreference(undefined, undefined)).rejects.toThrow(
      /AGY_DEFAULT_MODEL.*unavailable/,
    );
    expect(agy.runs).toHaveLength(1);
  });

  it("refuses effort-only follow-ups rather than losing the requested change", async () => {
    const agy = fakeAgy({ answer: "must not run" });
    const { delegator } = makeDelegator({ spawn: agy.spawn });
    live.push(delegator);
    await expect(
      delegator.run({
        ...request(),
        tool: toolNamed("follow_up"),
        args: { session_id: "old", question: "Continue" },
        conversationId: "old",
        effort: "high",
      }),
    ).rejects.toThrow(/effort-only/);
    expect(agy.runs).toHaveLength(0);
  });

  it("accepts the same proposed default through a form or a bare setter", async () => {
    const options = {
      cfg: { askModel: true, defaultModel: "gemini-neon@latest" },
      listing: async () => GEMINI4_LISTING,
    };
    const a = makeDelegator(options);
    live.push(a.delegator);
    const b = makeDelegator({ ...options, spawn: fakeAgy({ answer: "ok" }).spawn });
    live.push(b.delegator);
    const pref = await a.delegator.setPreference(undefined, undefined);
    const forms: unknown[] = [];
    const handler = createToolHandler(
      toolNamed("delegate"),
      b.cfg,
      b.delegator,
      () => async (form) => {
        forms.push(form);
        return { action: "accept", content: {} };
      },
    );
    expect((await handler({ prompt: "Inspect" })).isError).toBeUndefined();
    expect(b.delegator.status().preference?.model).toBe(pref.model);
    expect(b.delegator.status().preference?.effort).toBe(pref.effort);
    expect(JSON.stringify(forms)).not.toContain('"default":"high"');
  });
});

describe("fan-out resolves only its requested mode", () => {
  it("runs task legs with a custom-only model and no council lookup dependency", async () => {
    const agy = fakeAgy({ answer: "done" });
    const { cfg, delegator } = makeDelegator({
      spawn: agy.spawn,
      listing: async () => "custom-a\tCustom A\n",
    });
    live.push(delegator);
    const result = await createToolHandler(
      toolNamed("delegate_many"),
      cfg,
      delegator,
    )({ tasks: ["Inspect A", "Inspect B"], model: "custom-a" });
    expect(result.isError).toBeUndefined();
    expect(agy.runs).toHaveLength(2);
    expect(agy.runs.map((a) => valueOf(a, "--model"))).toEqual(["custom-a", "custom-a"]);
  });

  it("uses a singular model as one leg, not permission for the default council", async () => {
    const agy = fakeAgy({ answer: "done" });
    const { cfg, delegator } = makeDelegator({
      spawn: agy.spawn,
      cfg: { askModel: true },
      listing: async () => "custom-a\tCustom A\n",
    });
    live.push(delegator);
    const handler = createToolHandler(toolNamed("delegate_many"), cfg, delegator);
    expect((await handler({ prompt: "Inspect", model: "custom-a" })).isError).toBeUndefined();
    expect(agy.runs).toHaveLength(1);
    expect(
      (await handler({ prompt: "Inspect", model: "custom-a", models: ["custom-a"] })).isError,
    ).toBe(true);
    expect(agy.runs).toHaveLength(1);
  });

  it("prevalidates all members and rejects duplicate effective aliases with zero paid legs", async () => {
    for (const models of [
      ["gemini-4-neon-medium", "Gemini 4 Neon (Medium)"],
      ["gemini-4-neon-medium", "missing"],
    ]) {
      const agy = fakeAgy({ answer: "must not run" });
      const { cfg, delegator } = makeDelegator({
        spawn: agy.spawn,
        listing: async () => GEMINI4_LISTING,
      });
      live.push(delegator);
      const response = await createToolHandler(
        toolNamed("delegate_many"),
        cfg,
        delegator,
      )({ prompt: "Inspect", models });
      expect(response.isError).toBe(true);
      expect(agy.runs).toHaveLength(0);
    }
  });

  it("refuses a council or selector when discovery is unavailable", async () => {
    const agy = fakeAgy({ answer: "must not run" });
    const { cfg, delegator } = makeDelegator({
      spawn: agy.spawn,
      listing: async () => {
        throw new Error("offline");
      },
    });
    live.push(delegator);
    expect(
      (await createToolHandler(toolNamed("delegate_many"), cfg, delegator)({ prompt: "Inspect" }))
        .isError,
    ).toBe(true);
    expect(
      (
        await createToolHandler(
          toolNamed("delegate"),
          cfg,
          delegator,
        )({ prompt: "Inspect", model: "gemini-neon@latest" })
      ).isError,
    ).toBe(true);
    expect(agy.runs).toHaveLength(0);
  });

  it("honors cooldowns for automatic council members and exposes omitted inventory members", async () => {
    const agy = fakeAgy((args) =>
      valueOf(args, "--model") === "gemini-3.8-flash-high"
        ? { envelope: { status: "ERROR", error: "RESOURCE_EXHAUSTED" }, exitCode: 1 }
        : { answer: "ok" },
    );
    const listing = LISTING.split("\n")
      .filter((l) => !l.includes("pro-"))
      .join("\n");
    const { cfg, delegator } = makeDelegator({ spawn: agy.spawn, listing: async () => listing });
    live.push(delegator);
    await expect(delegator.run(request({ model: "gemini-3.8-flash-high" }))).rejects.toThrow();
    const result = await createToolHandler(
      toolNamed("delegate_many"),
      cfg,
      delegator,
    )({ prompt: "Independent question" });
    expect(result.isError).toBeUndefined();
    expect(agy.runs.map((a) => valueOf(a, "--model"))).toEqual([
      "gemini-3.8-flash-high",
      "claude-opus-4-6-thinking",
    ]);
    expect(textOf(result)).toContain("unavailable");
    expect(textOf(result)).toContain("cooldown");
  });

  it("honors the longest legacy display-label cooldown while an explicit ID can override it", async () => {
    const store = new MemoryCooldownStore();
    store.save({
      "Gemini 3.8 Flash (High)": 600_000,
      "gemini-3.8-flash-high": 120_000,
    });
    const cooldowns = new CooldownRegistry(store, () => 0);
    const agy = fakeAgy({ answer: "ok" });
    const delegator = new Delegator(
      testConfig,
      new ModelRegistry(async () => LISTING),
      fullCaps,
      { cooldowns, spawn: agy.spawn },
      {},
    );
    live.push(delegator);
    const result = await delegator.run(request());
    expect(result.model).toBe("gemini-3.1-pro-low");
    expect(result.attempts).toEqual(["gemini-3.8-flash-high: quota cooldown, 10m left"]);
    await delegator.run(request({ model: "gemini-3.8-flash-high" }));
    expect(valueOf(agy.runs[1]!, "--model")).toBe("gemini-3.8-flash-high");
    const council = await createToolHandler(
      toolNamed("delegate_many"),
      testConfig,
      delegator,
    )({
      prompt: "Independent question",
    });
    expect(textOf(council)).toContain("quota cooldown, 10m left");
    expect(
      agy.runs.slice(2).some((args) => valueOf(args, "--model") === "gemini-3.8-flash-high"),
    ).toBe(false);
  });
});

describe("egress, failure accounting and replay safety", () => {
  const marker = "sk-inertTestMarker000000000000000000";
  it.each([false, true])(
    "redacts every serialized fan-out response, partial failure=%s",
    async (partial) => {
      const agy = fakeAgy((args) =>
        partial && valueOf(args, "--model") === "gemini-3.8-flash-high"
          ? {
              envelope: {
                response: "ok",
                denied: [{ action: "command", display_name: marker }],
                structuredOutput: { credential: marker },
              },
            }
          : { envelope: { status: "ERROR", error: `failure ${marker}` }, exitCode: 1 },
      );
      const { cfg, delegator } = makeDelegator({ spawn: agy.spawn });
      live.push(delegator);
      const result = await createToolHandler(
        toolNamed("delegate_many"),
        cfg,
        delegator,
      )({ prompt: "Inspect", models: ["gemini-3.8-flash-high", "gemini-3.1-pro-high"] });
      expect(JSON.stringify(result)).not.toContain(marker);
    },
  );

  it("redacts denied-action and structured metadata at the final response boundary", async () => {
    const agy = fakeAgy({
      envelope: {
        response: "ok",
        denied: [{ action: marker, display_name: marker }],
        structuredOutput: { value: marker, [marker]: "credential-shaped key" },
      },
    });
    const { cfg, delegator } = makeDelegator({ spawn: agy.spawn });
    live.push(delegator);
    const result = await createToolHandler(
      toolNamed("delegate"),
      cfg,
      delegator,
    )({ prompt: "Inspect", schema: '{"type":"object"}' });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.structuredContent?.timed_out).toBe(false);
  });

  it("keeps quota partial context while redacting every response field", async () => {
    const agy = fakeAgy({
      envelope: {
        status: "ERROR",
        response: `partial observation ${marker}`,
        error: "RESOURCE_EXHAUSTED",
        conversationId: "quota-session",
        structuredOutput: { observation: marker },
        totalTokens: 23,
      },
      exitCode: 1,
      log: "RESOURCE_EXHAUSTED (code 429). Resets in 2m",
    });
    const { cfg, delegator } = makeDelegator({ spawn: agy.spawn });
    live.push(delegator);
    const result = await createToolHandler(
      toolNamed("delegate"),
      cfg,
      delegator,
    )({
      prompt: "Inspect",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("partial observation");
    expect(result.structuredContent?.session_id).toBe("quota-session");
    expect(result.structuredContent?.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(delegator.status().spent).toBe(23);
    expect(agy.runs).toHaveLength(1);
  });

  it("redacts before capping partial failure text while preserving recovery metadata", async () => {
    const agy = fakeAgy({
      envelope: {
        status: "ERROR",
        response: "x".repeat(54) + " " + marker + " " + "y".repeat(3000),
        error: "Interrupted after a partial response",
        conversationId: "recoverable-session",
      },
      exitCode: 1,
    });
    const { cfg, delegator } = makeDelegator({ spawn: agy.spawn, cfg: { maxOutputChars: 120 } });
    live.push(delegator);
    const result = await createToolHandler(
      toolNamed("delegate"),
      cfg,
      delegator,
    )({ prompt: "Inspect" });
    expect(result.isError).toBe(true);
    expect(textOf(result).length).toBeLessThan(1100);
    expect(textOf(result)).toContain("untrusted partial output ends");
    expect(textOf(result)).not.toContain("sk-inert");
    expect(result.structuredContent?.session_id).toBe("recoverable-session");
    expect(result.structuredContent?.partial_truncated_from).toBeGreaterThan(3000);
  });

  it("redacts provider step-type metadata in progress notifications", async () => {
    const agy = fakeAgy({
      stdout: [
        JSON.stringify({
          event: "step_update",
          step_update: { step_index: 1, step_type: marker, text_delta: "working" },
        }),
        JSON.stringify({ event: "result", result: JSON.parse(envelopeJson({ response: "done" })) }),
        "",
      ].join("\n"),
    });
    const { cfg, delegator } = makeDelegator({ spawn: agy.spawn });
    live.push(delegator);
    const notifications: unknown[] = [];
    await createToolHandler(
      toolNamed("delegate"),
      cfg,
      delegator,
    )(
      { prompt: "Inspect" },
      {
        _meta: { progressToken: "safe-token" },
        sendNotification: async (message) => {
          notifications.push(message);
        },
      },
    );
    expect(notifications.length).toBeGreaterThan(0);
    expect(JSON.stringify(notifications)).not.toContain(marker);
  });

  it.each(["connection reset", "RESOURCE_EXHAUSTED", "invalid model selection"])(
    "does not replay a dispatched %s even with a clean tree",
    async (error) => {
      const agy = fakeAgy({ envelope: { status: "ERROR", error, totalTokens: 100 }, exitCode: 1 });
      const { delegator } = makeDelegator({
        spawn: agy.spawn,
        cfg: { budgetTokens: 50 },
        snapshot: async () => ({ method: "scan", digest: "unchanged" }),
      });
      live.push(delegator);
      await expect(delegator.run(request({ write: true }))).rejects.toThrow(
        /Not (retried|failed over)/,
      );
      expect(agy.runs).toHaveLength(1);
      expect(delegator.status().spent).toBe(100);
      await expect(delegator.run(request())).rejects.toThrow(BudgetExceededError);
      expect(agy.runs).toHaveLength(1);
    },
  );

  it("accounts for a failed warm result and preserves its failure without a cold replay", async () => {
    let emit: (s: string) => void = () => {};
    const spawnSession = () => ({
      write: () =>
        queueMicrotask(() =>
          emit(
            JSON.stringify({
              event: "result",
              result: JSON.parse(
                envelopeJson({ status: "ERROR", error: "UNAUTHENTICATED", totalTokens: 100 }),
              ),
            }) + "\n",
          ),
        ),
      onData: (cb: (s: string) => void) => {
        emit = cb;
      },
      onExit: () => {},
      kill: () => {},
    });
    const agy = fakeAgy({ answer: "must not run" });
    const { delegator } = makeDelegator({
      spawn: agy.spawn,
      spawnSession,
      cfg: { warmSessions: true, budgetTokens: 50 },
    });
    live.push(delegator);
    await expect(
      delegator.run({
        ...request(),
        tool: toolNamed("follow_up"),
        args: { session_id: "old", question: "Continue" },
        conversationId: "old",
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    expect(agy.runs).toHaveLength(0);
    expect(delegator.status().spent).toBe(100);
  });

  it("never presents missing usage as a measured free run under a budget", () => {
    const ledger = new UsageLedger(50);
    ledger.record(undefined, EMPTY_USAGE, false);
    expect(ledger.rows()[0]?.unknownRuns).toBe(1);
    expect(() => ledger.assertWithinBudget()).toThrow(BudgetUsageUnknownError);
  });

  it("accounts for an unstructured failed run as unknown spending", async () => {
    const agy = fakeAgy({ stdout: "", stderr: "connection reset", exitCode: 1 });
    const { delegator } = makeDelegator({ spawn: agy.spawn, cfg: { budgetTokens: 50 } });
    live.push(delegator);
    await expect(delegator.run(request())).rejects.toThrow(/connection reset/);
    expect(delegator.status().usage[0]?.unknownRuns).toBe(1);
    await expect(delegator.run(request())).rejects.toThrow(BudgetUsageUnknownError);
    expect(agy.runs).toHaveLength(1);
  });

  it("emits monotonically increasing MCP progress across repeated warm step zero", async () => {
    let emit: (s: string) => void = () => {};
    const spawnSession = () => ({
      write: () =>
        queueMicrotask(() =>
          emit(
            [
              JSON.stringify({
                event: "step_update",
                step_update: { step_index: 7, text_delta: "one" },
              }),
              JSON.stringify({
                event: "step_update",
                step_update: { step_index: 0, text_delta: "two" },
              }),
              JSON.stringify({
                event: "result",
                result: JSON.parse(envelopeJson({ response: "done" })),
              }),
              "",
            ].join("\n"),
          ),
        ),
      onData: (cb: (s: string) => void) => {
        emit = cb;
      },
      onExit: () => {},
      kill: () => {},
    });
    const { cfg, delegator } = makeDelegator({ spawnSession, cfg: { warmSessions: true } });
    live.push(delegator);
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1100));
    const progress: number[] = [];
    await createToolHandler(
      toolNamed("follow_up"),
      cfg,
      delegator,
    )(
      { session_id: "old", question: "Continue" },
      {
        _meta: { progressToken: "test" },
        sendNotification: async (message) => {
          if (message.method === "notifications/progress") progress.push(message.params.progress);
        },
      },
    );
    expect(progress).toEqual([1, 2]);
  });
});
