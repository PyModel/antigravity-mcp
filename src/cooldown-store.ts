import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { CooldownStore } from "./quota.js";

/** `$XDG_CACHE_HOME/claude-agy-mcp`, or `~/.cache/claude-agy-mcp`. */
export function cacheDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "claude-agy-mcp");
}

function parse(raw: string): Record<string, number> {
  const v: unknown = JSON.parse(raw);
  if (typeof v !== "object" || v === null) return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter(
      (e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]),
    ),
  );
}

/** Both sets of cooldowns, keeping the later expiry where they disagree. */
function merge(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [model, until] of Object.entries(b)) {
    if (until > (out[model] ?? 0)) out[model] = until;
  }
  return out;
}

/**
 * Cooldowns on disk, shared by every MCP client on the machine.
 *
 * A `Resets in 96h53m25s` lockout has to outlive the process that discovered it;
 * in memory it evaporated on restart and each client re-burned a call to learn
 * the same thing.
 *
 * Each model/expiry pair has its own immutable record. Concurrent writers
 * cannot replace each other's snapshots: load takes the maximum expiry across
 * records. A temporary file is atomically renamed only to an identical record
 * key, and cleanup removes expired records only. The older cooldowns.json is
 * still read for compatibility, but is never rewritten by this implementation.
 * An unwritable cache degrades to in-process cooldowns.
 */
export class FileCooldownStore implements CooldownStore {
  private readonly legacyFile: string;
  private readonly recordsDir: string;
  private own: Record<string, number> = {};

  constructor(dir: string = cacheDir()) {
    this.legacyFile = path.join(dir, "cooldowns.json");
    this.recordsDir = path.join(dir, "cooldowns.d");
  }

  private read(file: string): Record<string, number> {
    try {
      return parse(readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  private records(): string[] {
    try {
      return readdirSync(this.recordsDir).filter((file) =>
        /^[a-f0-9]{64}\.[\d.e+-]+\.json$/.test(file),
      );
    } catch {
      return [];
    }
  }

  private fromDisk(): Record<string, number> {
    let entries = this.read(this.legacyFile);
    for (const file of this.records())
      entries = merge(entries, this.read(path.join(this.recordsDir, file)));
    return entries;
  }

  load(): Record<string, number> {
    return merge(this.fromDisk(), this.own);
  }

  save(entries: Record<string, number>, now: number): void {
    this.own = merge(this.own, entries);
    for (const [model, until] of Object.entries(this.own)) {
      if (!Number.isFinite(until) || until <= now) delete this.own[model];
    }
    try {
      mkdirSync(this.recordsDir, { recursive: true, mode: 0o700 });
    } catch {
      return; // A read-only cache dir degrades to in-process cooldowns; not fatal.
    }
    for (const [model, until] of Object.entries(this.own)) this.write(model, until);
    for (const file of this.records()) {
      const fullPath = path.join(this.recordsDir, file);
      const stored = Object.values(this.read(fullPath));
      if (stored.length && stored.every((until) => until <= now)) {
        try {
          rmSync(fullPath, { force: true });
        } catch {
          /* Best-effort expiration only. */
        }
      }
    }
  }

  private write(model: string, until: number): void {
    const key = createHash("sha256").update(model).digest("hex");
    const file = path.join(this.recordsDir, `${key}.${until}.json`);
    if (existsSync(file)) return;
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ [model]: until }), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      renameSync(tmp, file);
    } catch {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* Keep the in-process entry. */
      }
    }
  }
}
