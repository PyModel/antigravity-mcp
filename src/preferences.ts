import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { isEffort, type Effort } from "./models.js";
import { LEGACY_SERVER_NAME, SERVER_NAME } from "./identity.js";

export type { Effort } from "./models.js";

/** The model and tier the user chose once for this machine. */
export interface ModelPreference {
  /** A canonical agy model ID. Legacy display-name choices remain readable. */
  model: string;
  effort?: Effort;
  /** ISO timestamp of when it was chosen. */
  setAt: string;
}

export interface PreferenceStore {
  load(): ModelPreference | null;
  save(pref: ModelPreference | null): void;
}

/** `$XDG_CONFIG_HOME/antigravity-mcp`, or `~/.config/antigravity-mcp`. */
export function configDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), SERVER_NAME);
}

export function legacyConfigDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), LEGACY_SERVER_NAME);
}

/**
 * The preference on disk, shared by every MCP client on the machine.
 *
 * "Ask once, then that's it" only holds if the answer outlives the process
 * that asked. Writes go to a temp file and are renamed into place, so a
 * concurrent reader never sees a half-written file.
 *
 * The old product's choice is read only while the new file is absent. Saving
 * a choice or clearing it writes the new file; an explicit clear is an empty
 * object, so an old choice cannot reappear after restarting. No legacy file
 * is moved, overwritten or removed. An explicitly supplied directory is
 * isolated unless the caller also supplies a legacy directory.
 */
export class FilePreferenceStore implements PreferenceStore {
  private readonly file: string;
  private readonly legacyFile?: string;

  constructor(dir?: string, legacyDir?: string) {
    this.file = path.join(dir ?? configDir(), "preferences.json");
    const previousDir = legacyDir ?? (dir === undefined ? legacyConfigDir() : undefined);
    if (previousDir !== undefined) this.legacyFile = path.join(previousDir, "preferences.json");
  }

  load(): ModelPreference | null {
    let contents: string;
    try {
      contents = readFileSync(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || !this.legacyFile) return null;
      try {
        contents = readFileSync(this.legacyFile, "utf8");
      } catch {
        return null;
      }
    }
    try {
      const raw: unknown = JSON.parse(contents);
      if (typeof raw !== "object" || raw === null) return null;
      const o = raw as Record<string, unknown>;
      if (typeof o.model !== "string" || !o.model.trim()) return null;
      return {
        model: o.model,
        ...(isEffort(o.effort) ? { effort: o.effort } : {}),
        setAt: typeof o.setAt === "string" ? o.setAt : "",
      };
    } catch {
      return null;
    }
  }

  save(pref: ModelPreference | null): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    // Unique per write: two saves in one process shared a temp name and could
    // rename each other's half-written file into place.
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(pref ?? {}, null, 2), "utf8");
      renameSync(tmp, this.file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }
}

export class MemoryPreferenceStore implements PreferenceStore {
  private pref: ModelPreference | null = null;
  load(): ModelPreference | null {
    return this.pref ? { ...this.pref } : null;
  }
  save(pref: ModelPreference | null): void {
    this.pref = pref ? { ...pref } : null;
  }
}
