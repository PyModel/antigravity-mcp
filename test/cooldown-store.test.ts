import { afterEach, describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { cacheDir, legacyCacheDir, FileCooldownStore } from "../src/cooldown-store.js";
import { CooldownRegistry } from "../src/quota.js";

function scratch(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cooldowns-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("cacheDir", () => {
  it("honours XDG_CACHE_HOME, falling back to ~/.cache", () => {
    expect(cacheDir({ XDG_CACHE_HOME: "/x" })).toBe("/x/antigravity-mcp");
    expect(cacheDir({})).toMatch(/\.cache\/antigravity-mcp$/);
    expect(legacyCacheDir({ XDG_CACHE_HOME: "/x" })).toBe("/x/claude-agy-mcp");
  });
});

describe("FileCooldownStore", () => {
  it("reads back what another process wrote", () => {
    const { dir, cleanup } = scratch();
    try {
      new FileCooldownStore(dir).save({ Flash: 123 }, 0);
      expect(new FileCooldownStore(dir).load()).toEqual({ Flash: 123 });
    } finally {
      cleanup();
    }
  });

  it("leaves no temp file behind", () => {
    const { dir, cleanup } = scratch();
    try {
      new FileCooldownStore(dir).save({ Flash: 1 }, 0);
      expect(readdirSync(dir)).toEqual(["cooldowns.d"]);
      expect(readdirSync(path.join(dir, "cooldowns.d"))).toHaveLength(1);
      expect(readdirSync(path.join(dir, "cooldowns.d"))[0]).toMatch(/\.json$/);
    } finally {
      cleanup();
    }
  });

  it("treats a corrupt or missing file as empty rather than crashing", () => {
    const { dir, cleanup } = scratch();
    try {
      expect(new FileCooldownStore(dir).load()).toEqual({});
      writeFileSync(path.join(dir, "cooldowns.json"), "not json at all");
      expect(new FileCooldownStore(dir).load()).toEqual({});
    } finally {
      cleanup();
    }
  });

  it("drops entries that are not timestamps", () => {
    const { dir, cleanup } = scratch();
    try {
      writeFileSync(path.join(dir, "cooldowns.json"), '{"Flash":123,"Bad":"soon"}');
      expect(new FileCooldownStore(dir).load()).toEqual({ Flash: 123 });
    } finally {
      cleanup();
    }
  });

  it("degrades quietly when the cache dir cannot be written", () => {
    // A regular file in the directory's place: mkdir fails with ENOTDIR on
    // every platform. (Not /proc/...: on Linux mkdir there reports ENOENT with
    // the parent present, which sends Node's recursive mkdir into a loop.)
    const { dir, cleanup } = scratch();
    try {
      writeFileSync(path.join(dir, "file"), "");
      const store = new FileCooldownStore(path.join(dir, "file", "nope"));
      expect(() => store.save({ A: 1 }, 0)).not.toThrow();
      expect(store.load()).toEqual({ A: 1 }); // still honoured in this process
    } finally {
      cleanup();
    }
  });
});

describe("FileCooldownStore product migration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("merges both snapshot and record formats across both names, retaining the longest expiry", () => {
    const { dir, cleanup } = scratch();
    try {
      const current = path.join(dir, "antigravity-mcp");
      const legacy = path.join(dir, "claude-agy-mcp");
      const old = new FileCooldownStore(legacy);
      old.save({ shared: 100, oldRecord: 110 }, 0);
      writeFileSync(path.join(legacy, "cooldowns.json"), '{"shared":300,"oldSnapshot":120}');
      new FileCooldownStore(current).save({ shared: 200, newRecord: 210 }, 0);
      writeFileSync(path.join(current, "cooldowns.json"), '{"shared":250,"newSnapshot":220}');

      const migrated = new FileCooldownStore(current, legacy);
      expect(migrated.load()).toEqual({
        shared: 300,
        oldRecord: 110,
        oldSnapshot: 120,
        newRecord: 210,
        newSnapshot: 220,
      });
      old.save({ shared: 400 }, 0);
      expect(migrated.load().shared).toBe(400);
      new FileCooldownStore(current).save({ shared: 500 }, 0);
      expect(migrated.load().shared).toBe(500);
    } finally {
      cleanup();
    }
  });

  it("reads the old default cache without migrating files and confines writes and cleanup to the new cache", () => {
    const { dir, cleanup } = scratch();
    try {
      vi.stubEnv("XDG_CACHE_HOME", dir);
      new FileCooldownStore(legacyCacheDir()).save({ expired: 50, oldActive: 300 }, 0);
      const oldRecords = path.join(legacyCacheDir(), "cooldowns.d");
      const before = readdirSync(oldRecords)
        .sort()
        .map((file) => [file, readFileSync(path.join(oldRecords, file), "utf8")]);
      const migrated = new FileCooldownStore();
      expect(migrated.load()).toEqual({ expired: 50, oldActive: 300 });
      expect(existsSync(cacheDir())).toBe(false);

      migrated.save({ currentExpired: 50 }, 0);
      migrated.save({ newActive: 400 }, 100);
      expect(new FileCooldownStore(cacheDir()).load()).toEqual({ newActive: 400 });
      expect(new FileCooldownStore().load()).toEqual({
        expired: 50,
        oldActive: 300,
        newActive: 400,
      });
      expect(
        readdirSync(oldRecords)
          .sort()
          .map((file) => [file, readFileSync(path.join(oldRecords, file), "utf8")]),
      ).toEqual(before);
    } finally {
      cleanup();
    }
  });

  it("does not read the machine's legacy cache for an explicitly supplied directory", () => {
    const { dir, cleanup } = scratch();
    try {
      vi.stubEnv("XDG_CACHE_HOME", dir);
      new FileCooldownStore(legacyCacheDir()).save({ oldActive: 300 }, 0);
      expect(new FileCooldownStore(path.join(dir, "isolated")).load()).toEqual({});
    } finally {
      cleanup();
    }
  });
});

describe("FileCooldownStore across writers", () => {
  it("preserves concurrent process updates, including the longest expiry for a shared model", async () => {
    const { dir, cleanup } = scratch();
    try {
      const entry = path.join(dir, "store.mjs");
      await build({
        entryPoints: [fileURLToPath(new URL("../src/cooldown-store.ts", import.meta.url))],
        outfile: entry,
        bundle: true,
        platform: "node",
        format: "esm",
        logLevel: "silent",
      });
      const workers = 6;
      await Promise.all(
        Array.from({ length: workers }, (_, worker) =>
          promisify(execFile)(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `
          import { FileCooldownStore } from ${JSON.stringify(pathToFileURL(entry).href)};
          const store = new FileCooldownStore(${JSON.stringify(dir)});
          for (let step = 1; step <= 20; step++) {
            store.save({ [${JSON.stringify(`writer-${worker}`)}]: step * 100, shared: (${worker} + 1) * 1000 }, 0);
          }
        `,
            ],
            { timeout: 15_000 },
          ),
        ),
      );
      const stored = new FileCooldownStore(dir).load();
      for (let worker = 0; worker < workers; worker++)
        expect(stored[`writer-${worker}`]).toBe(2000);
      expect(stored.shared).toBe(6000);
    } finally {
      cleanup();
    }
  });

  it("merges with what another process wrote instead of overwriting it", () => {
    const { dir, cleanup } = scratch();
    try {
      const a = new FileCooldownStore(dir);
      const b = new FileCooldownStore(dir);
      a.save({ Flash: 100 }, 0);
      b.save({ Pro: 200 }, 0);
      expect(new FileCooldownStore(dir).load()).toEqual({ Flash: 100, Pro: 200 });
      a.save({ Flash: 300 }, 0); // a longer lockout for the same model wins
      b.save({ Flash: 150, Pro: 200 }, 0);
      expect(new FileCooldownStore(dir).load()).toEqual({ Flash: 300, Pro: 200 });
    } finally {
      cleanup();
    }
  });
});

describe("CooldownRegistry over a file store", () => {
  it("survives a restart: a second registry sees the first one's cooldown", () => {
    const { dir, cleanup } = scratch();
    try {
      let now = 1_000_000;
      const store = new FileCooldownStore(dir);
      new CooldownRegistry(store, () => now).set("Flash", 3600);

      const afterRestart = new CooldownRegistry(new FileCooldownStore(dir), () => now);
      expect(afterRestart.cooling("Flash")).toBe(true);
      expect(afterRestart.describe("Flash")).toBe("1h");

      now += 3_601_000;
      expect(afterRestart.cooling("Flash")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("forgets expired entries instead of growing the file forever", () => {
    const { dir, cleanup } = scratch();
    try {
      let now = 0;
      const reg = new CooldownRegistry(new FileCooldownStore(dir), () => now);
      // Durations sit above the registry's one-minute floor.
      reg.set("Old", 60);
      now = 120_000;
      reg.set("New", 60);
      expect(new FileCooldownStore(dir).load()).toEqual({ New: 180_000 });
    } finally {
      cleanup();
    }
  });

  it("lists active cooldowns longest-first for the status tool", () => {
    const reg = new CooldownRegistry(undefined, () => 0);
    reg.set("Short", 60);
    reg.set("Long", 3600);
    expect(reg.active()).toEqual([
      { model: "Long", secondsLeft: 3600 },
      { model: "Short", secondsLeft: 60 },
    ]);
  });
});
