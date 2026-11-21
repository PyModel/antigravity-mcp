import { afterEach, describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configDir, legacyConfigDir, FilePreferenceStore } from "../src/preferences.js";

describe("FilePreferenceStore", () => {
  const dirs: string[] = [];
  const dir = () => {
    const value = mkdtempSync(path.join(tmpdir(), "agy-prefs-"));
    dirs.push(value);
    return value;
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const value of dirs.splice(0)) rmSync(value, { recursive: true, force: true });
  });

  it("round-trips the choice through disk", () => {
    const store = new FilePreferenceStore(dir());
    expect(store.load()).toBeNull();
    store.save({ model: "gemini-4-neon-high", effort: "high", setAt: "2026-11-21T00:00:00Z" });
    expect(new FilePreferenceStore(path.dirname(fileOf(store))).load()).toEqual({
      model: "gemini-4-neon-high",
      effort: "high",
      setAt: "2026-11-21T00:00:00Z",
    });
  });

  it("treats a corrupt or model-less file as no choice", () => {
    const d = dir();
    writeFileSync(path.join(d, "preferences.json"), "{not json");
    expect(new FilePreferenceStore(d).load()).toBeNull();
    writeFileSync(path.join(d, "preferences.json"), JSON.stringify({ effort: "high" }));
    expect(new FilePreferenceStore(d).load()).toBeNull();
  });

  it("drops an effort it does not recognise rather than passing it to agy", () => {
    const d = dir();
    writeFileSync(
      path.join(d, "preferences.json"),
      JSON.stringify({ model: "M", effort: "unsupported" }),
    );
    expect(new FilePreferenceStore(d).load()).toEqual({ model: "M", setAt: "" });
  });

  it("lives under XDG_CONFIG_HOME when set", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x" })).toBe(path.join("/x", "antigravity-mcp"));
    expect(configDir({})).toContain(path.join(".config", "antigravity-mcp"));
    expect(legacyConfigDir({ XDG_CONFIG_HOME: "/x" })).toBe(path.join("/x", "claude-agy-mcp"));
  });

  it("reads an old choice without moving it and writes future choices only to the new path", () => {
    vi.stubEnv("XDG_CONFIG_HOME", dir());
    const oldChoice = { model: "Gemini 4 Neon (High)", setAt: "2026-11-20T00:00:00Z" };
    const newChoice = { model: "gemini-4-carbon-high", setAt: "2026-11-21T00:00:00Z" };
    new FilePreferenceStore(legacyConfigDir()).save(oldChoice);
    const oldFile = path.join(legacyConfigDir(), "preferences.json");
    const oldContents = readFileSync(oldFile, "utf8");
    const store = new FilePreferenceStore();
    expect(store.load()).toEqual(oldChoice);
    expect(existsSync(configDir())).toBe(false);

    store.save(newChoice);
    expect(new FilePreferenceStore().load()).toEqual(newChoice);
    expect(readFileSync(oldFile, "utf8")).toBe(oldContents);
  });

  it("keeps an explicit clear across restarts without resurrecting the old choice", () => {
    const current = dir();
    const legacy = dir();
    const oldChoice = { model: "gemini-4-neon-high", setAt: "old" };
    new FilePreferenceStore(legacy).save(oldChoice);
    const store = new FilePreferenceStore(current, legacy);
    expect(store.load()).toEqual(oldChoice);
    store.save(null);
    expect(new FilePreferenceStore(current, legacy).load()).toBeNull();
    expect(JSON.parse(readFileSync(path.join(current, "preferences.json"), "utf8"))).toEqual({});
    expect(new FilePreferenceStore(legacy).load()).toEqual(oldChoice);
  });

  it.each(["{not json", '{"effort":"high"}'])(
    "does not fall back to an old choice when the new file contains %s",
    (contents) => {
      const current = dir();
      const legacy = dir();
      new FilePreferenceStore(legacy).save({ model: "gemini-4-neon-high", setAt: "old" });
      writeFileSync(path.join(current, "preferences.json"), contents);
      expect(new FilePreferenceStore(current, legacy).load()).toBeNull();
    },
  );

  it("does not fall back when the new preference path cannot be read as a file", () => {
    const current = dir();
    const legacy = dir();
    new FilePreferenceStore(legacy).save({ model: "gemini-4-neon-high", setAt: "old" });
    mkdirSync(path.join(current, "preferences.json"));
    expect(new FilePreferenceStore(current, legacy).load()).toBeNull();
  });

  it("keeps explicitly supplied directories independent of the machine's old choice", () => {
    vi.stubEnv("XDG_CONFIG_HOME", dir());
    new FilePreferenceStore(legacyConfigDir()).save({ model: "gemini-4-neon-high", setAt: "old" });
    expect(new FilePreferenceStore(dir()).load()).toBeNull();
  });
});

function fileOf(store: FilePreferenceStore): string {
  return (store as unknown as { file: string }).file;
}
