import { describe, it, expect } from "vitest";
import { writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseListing,
  pickTier,
  describeModel,
  resolveEntry,
  ModelRegistry,
  ModelSkewError,
  listModels,
} from "../src/models.js";
import { LISTING } from "./support.js";
import { GEMINI4_LISTING } from "./gemini4-fixture.js";

describe("parseListing", () => {
  it("returns one row per tab-separated line, keeping id and display name apart", () => {
    expect(parseListing("gemini-3.7-flash-high\tGemini 3.7 Flash (High)\n")).toEqual([
      {
        id: "gemini-3.7-flash-high",
        name: "Gemini 3.7 Flash (High)",
        family: "gemini-flash",
        version: [3, 7],
        effort: "high",
      },
    ]);
  });

  it("drops the 'Fetching available models...' progress line agy prints first", () => {
    const raw = "Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n";
    expect(parseListing(raw).map((m) => m.name)).toEqual(["Gemini 3.8 Flash (Low)"]);
  });

  it("strips a trailing ' (current)' marker", () => {
    const raw = "claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking) (current)\n";
    expect(parseListing(raw)[0]!.name).toBe("Claude Opus 4.6 (Thinking)");
  });
});

describe("describeModel", () => {
  it("splits a versioned name into family, version and effort", () => {
    expect(describeModel("x", "Gemini 3.1 Pro (High)")).toMatchObject({
      family: "gemini-pro",
      version: [3, 1],
      effort: "high",
    });
  });

  it("keeps a size token in the family when it is not a version", () => {
    expect(describeModel("x", "GPT-OSS 120B (Medium)")).toMatchObject({
      family: "gpt-oss-120b",
      version: [],
      effort: "medium",
    });
  });
});

describe("resolveEntry", () => {
  const available = parseListing(LISTING);

  it("accepts an exact display name", () => {
    expect(resolveEntry("Gemini 3.1 Pro (High)", available)).toBe("gemini-3.1-pro-high");
  });

  it("preserves a canonical id for execution", () => {
    expect(resolveEntry("gemini-3.7-flash-high", available)).toBe("gemini-3.7-flash-high");
  });

  it("resolves a family selector to the newest version at that effort", () => {
    expect(resolveEntry("gemini-flash@latest-high", available)).toBe("gemini-3.8-flash-high");
  });

  it("resolves a pinned version selector", () => {
    expect(resolveEntry("gemini-flash@3.7-medium", available)).toBe("gemini-3.7-flash-medium");
  });

  it("returns undefined for a family that is not offered", () => {
    expect(resolveEntry("llama@latest", available)).toBeUndefined();
  });
});

describe("ModelRegistry.resolveChain", () => {
  const registry = (out: string | Error) =>
    new ModelRegistry(async () => {
      if (out instanceof Error) throw out;
      return out;
    });

  it("returns every resolvable chain entry in order, then defaultModel", async () => {
    const r = await registry(LISTING).resolveChain({
      chain: ["Gemini 9.9 Ultra", "gemini-flash@latest-medium", "Gemini 3.1 Pro (High)"],
      defaultModel: "Gemini 3.7 Flash (High)",
    });
    expect(r.models).toEqual([
      "gemini-3.8-flash-medium",
      "gemini-3.1-pro-high",
      "gemini-3.7-flash-high",
    ]);
  });

  it("does not repeat a model that the chain and the default both name", async () => {
    const r = await registry(LISTING).resolveChain({
      chain: ["gemini-flash@latest-high"],
      defaultModel: "Gemini 3.8 Flash (High)",
    });
    expect(r.models).toEqual(["gemini-3.8-flash-high"]);
  });

  it("uses an explicit model when it resolves", async () => {
    const r = await registry(LISTING).resolveChain({
      explicit: "Gemini 3.1 Pro (High)",
      chain: ["gemini-flash@latest-high"],
    });
    expect(r.models).toEqual(["gemini-3.1-pro-high"]);
  });

  it("throws on an explicit model the listing does not offer, showing the options", async () => {
    await expect(registry(LISTING).resolveChain({ explicit: "Nope", chain: [] })).rejects.toThrow(
      /Gemini 3\.8 Flash \(High\)/,
    );
  });

  it("throws ModelSkewError rather than silently using agy's default when nothing resolves", async () => {
    await expect(
      registry(LISTING).resolveChain({ chain: ["Gemini 9.9 Ultra"], defaultModel: "Also Gone" }),
    ).rejects.toThrow(ModelSkewError);
  });

  it("degrades to agy's own default only when the listing itself is unreadable", async () => {
    const reg = registry(new Error("boom"));
    const a = await reg.resolveChain({ explicit: "Whatever", chain: [] });
    expect(a.models).toEqual(["Whatever"]);
    expect(a.note).toMatch(/could not list/i);
    const b = await reg.resolveChain({ chain: ["Gemini 3.7 Flash (High)"] });
    expect(b.models).toEqual([undefined]);
    expect(b.note).toMatch(/could not list/i);
  });

  it("treats an unparseable listing as unreadable rather than as zero models", async () => {
    const r = await registry("some new format with no tabs\n").resolveChain({
      chain: ["Gemini 3.7 Flash (High)"],
    });
    expect(r.models).toEqual([undefined]);
    expect(r.note).toMatch(/could not list/i);
  });

  it("fetches the listing only once under concurrent calls", async () => {
    let calls = 0;
    const reg = new ModelRegistry(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return LISTING;
    });
    const [a, b] = await Promise.all([
      reg.resolveChain({ chain: ["Gemini 3.7 Flash (High)"] }),
      reg.resolveChain({ chain: ["Gemini 3.1 Pro (High)"] }),
    ]);
    expect(calls).toBe(1);
    expect(a.models).toEqual(["gemini-3.7-flash-high"]);
    expect(b.models).toEqual(["gemini-3.1-pro-high"]);
  });

  it("retries the listing after a transient failure instead of caching null forever", async () => {
    let calls = 0;
    const reg = new ModelRegistry(async () => {
      if (++calls === 1) throw new Error("transient");
      return LISTING;
    });
    expect((await reg.resolveChain({ chain: ["Gemini 3.1 Pro (High)"] })).models).toEqual([
      undefined,
    ]);
    expect((await reg.resolveChain({ chain: ["Gemini 3.1 Pro (High)"] })).models).toEqual([
      "gemini-3.1-pro-high",
    ]);
  });
});

describe("listModels", () => {
  it("closes stdin so agy exits instead of waiting on EOF", async () => {
    // A stub that reads stdin to EOF first: it only prints if stdin was closed.
    const stub = path.join(tmpdir(), `agy-stub-${process.pid}.sh`);
    writeFileSync(
      stub,
      '#!/bin/sh\ncat >/dev/null\nprintf "gemini-3.7-flash-high\\tGemini 3.7 Flash (High)\\n"\n',
    );
    chmodSync(stub, 0o755);
    try {
      expect(parseListing(await listModels(stub)).map((m) => m.name)).toEqual([
        "Gemini 3.7 Flash (High)",
      ]);
    } finally {
      rmSync(stub, { force: true });
    }
  });
});

describe("pickTier", () => {
  const listing = parseListing(LISTING);

  it("gives exact IDs precedence over colliding labels on every selection step", () => {
    const opaque = parseListing("first\tsecond\nsecond\tCustom B\n");
    expect(resolveEntry("second", opaque)).toBe("second");
    expect(pickTier("second", undefined, opaque)).toEqual({ model: "second" });
    const ambiguous = parseListing("first\tShared\nsecond\tShared\n");
    expect(() => pickTier("Shared", undefined, ambiguous)).toThrow(/not in the current/);
  });

  it("uses a tiered model as-is and sends no --effort when the tiers agree or none is asked", () => {
    expect(pickTier("Gemini 3.8 Flash (High)", undefined, listing)).toEqual({
      model: "gemini-3.8-flash-high",
    });
    expect(pickTier("Gemini 3.8 Flash (High)", "high", listing)).toEqual({
      model: "gemini-3.8-flash-high",
    });
  });

  it("selects the sibling at the asked tier within the same family and version", () => {
    expect(pickTier("Gemini 3.8 Flash (High)", "medium", listing)).toEqual({
      model: "gemini-3.8-flash-medium",
    });
    expect(pickTier("Gemini 3.1 Pro (High)", "low", listing)).toEqual({
      model: "gemini-3.1-pro-low",
    });
  });

  it("rejects an unavailable tier instead of silently retaining another effort", () => {
    expect(() => pickTier("Gemini 3.8 Flash (High)", "low", listing)).toThrow(
      /does not offer effort/,
    );
  });

  it("keeps opaque models selectable without assuming effort support", () => {
    const untiered = parseListing("gpt-oss-120b\tGPT-OSS 120B\n");
    expect(() => pickTier("GPT-OSS 120B", "low", untiered)).toThrow(/fixed; omit effort/);
    expect(pickTier("GPT-OSS 120B", undefined, untiered)).toEqual({ model: "gpt-oss-120b" });
  });
});

describe("version ordering (test-gap: fixtures could not distinguish it)", () => {
  // Every model in the shared LISTING fixture (3.8/3.7/3.1/4.6) sorts the same
  // way lexically and numerically, so a lexical implementation passed the whole
  // suite. 3.10 vs 3.8 is the pair that tells them apart.
  const listing =
    "Fetching available models...\n" +
    "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n" +
    "gemini-3.10-flash-high\tGemini 3.10 Flash (High)\n" +
    "gemini-3.9-flash-high\tGemini 3.9 Flash (High)\n";

  it("treats 3.10 as newer than 3.9 and 3.8, not as the string '3.1'", async () => {
    const reg = new ModelRegistry(async () => listing);
    const r = await reg.resolveChain({
      chain: ["gemini-flash@latest-high"],
      defaultModel: "Gemini 3.8 Flash (High)",
    });
    expect(r.models[0]).toBe("gemini-3.10-flash-high");
  });
});

describe("current account inventory contract", () => {
  const inventory = parseListing(GEMINI4_LISTING);

  it("keeps all 14 supplied Gemini 4 variants and three opaque Orchestrators selectable", () => {
    expect(inventory).toHaveLength(17);
    for (const model of inventory) {
      expect(resolveEntry(model.id, inventory)).toBe(model.id);
      expect(resolveEntry(model.name, inventory)).toBe(model.id);
    }
    expect(inventory.find((model) => model.id === "gemini-pro-orchestrator")).toMatchObject({
      name: "Orchestrator (Carbon)",
    });
    expect(
      inventory.find((model) => model.id === "gemini-pro-orchestrator")?.effort,
    ).toBeUndefined();
  });

  it("resolves xhigh only where the account actually offers it", () => {
    expect(resolveEntry("gemini-neon@latest-xhigh", inventory)).toBe("gemini-4-neon-xhigh");
    expect(resolveEntry("gemini-hydrogen@4-xhigh", inventory)).toBe("gemini-4-hydrogen-xhigh");
    expect(resolveEntry("gemini-carbon@latest-xhigh", inventory)).toBeUndefined();
    expect(() => pickTier("gemini-4-carbon-high", "xhigh", inventory)).toThrow(/does not offer/);
  });

  it("recognises max vocabulary without inventing a max variant", () => {
    expect(resolveEntry("gemini-neon@latest-max", inventory)).toBeUndefined();
    const future = parseListing(GEMINI4_LISTING + "gemini-4-neon-max\tGemini 4 Neon (Max)\n");
    expect(resolveEntry("gemini-neon@latest-max", future)).toBe("gemini-4-neon-max");
  });

  it("selects a deterministic untiered policy independent of listing order", () => {
    expect(resolveEntry("gemini-neon@latest", inventory)).toBe("gemini-4-neon-medium");
    expect(resolveEntry("gemini-neon@latest", [...inventory].reverse())).toBe(
      "gemini-4-neon-medium",
    );
  });

  it("does not guess from an ambiguous display label or malformed selector", () => {
    const duplicate = parseListing(
      "first\tShared label\nsecond\tShared label\nfirst\tShared label\n",
    );
    expect(duplicate).toHaveLength(2);
    expect(resolveEntry("Shared label", duplicate)).toBeUndefined();
    expect(resolveEntry("first", duplicate)).toBe("first");
    for (const malformed of ["gemini-neon@4..0", "gemini-neon@.4", "gemini-neon@4."]) {
      expect(resolveEntry(malformed, inventory)).toBeUndefined();
    }
  });
});

describe("inventory refresh", () => {
  it("refreshes a successful listing after its TTL so account changes become visible", async () => {
    let now = 0;
    let calls = 0;
    const registry = new ModelRegistry(async () => (++calls === 1 ? LISTING : GEMINI4_LISTING), {
      ttlMs: 100,
      now: () => now,
    });
    const first = await registry.available();
    now = 99;
    expect(await registry.available()).toBe(first);
    expect(calls).toBe(1);
    now = 100;
    expect((await registry.available())?.[0]?.id).toBe("gemini-4-neon-low");
    expect(calls).toBe(2);
  });

  it("does not let an older in-flight listing overwrite one fetched after invalidation", async () => {
    let releaseOld!: (listing: string) => void;
    let calls = 0;
    const registry = new ModelRegistry(() => {
      if (++calls === 1)
        return new Promise((resolve) => {
          releaseOld = resolve;
        });
      return Promise.resolve(GEMINI4_LISTING);
    });
    const old = registry.available();
    registry.invalidate();
    const fresh = await registry.available();
    releaseOld(LISTING);
    expect(await old).toEqual(fresh);
    expect(await registry.available()).toEqual(fresh);
    expect(calls).toBe(2);
  });
});
