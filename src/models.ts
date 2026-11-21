import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Vocabulary is shared; an effort is usable only when the account lists it. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

/**
 * `agy models`, with stdin closed: agy reads stdin until EOF even in print mode,
 * so an open stdin pipe hangs it forever.
 */
export function listModels(agyPath: string): Promise<string> {
  const promise = execFileAsync(agyPath, ["models"], {
    cwd: process.cwd(),
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  promise.child.stdin?.end();
  return promise.then(({ stdout }) => stdout);
}

/** One row of `agy models`: the id agy prints and the display name it also accepts. */
export interface ModelInfo {
  id: string;
  name: string;
  /** Vendor + variant with the version and effort stripped, e.g. "gemini-flash". */
  family: string;
  /** Version components, most significant first; empty when the name carries none. */
  version: number[];
  /** A recognised effort suffix; legacy Thinking rows remain selectable. */
  effort?: string;
}

const VERSION_TOKEN = /^\d+(?:\.\d+)*$/;

/** Splits "Gemini 4 Neon (High)" into its family, version and effort. */
export function describeModel(id: string, name: string): ModelInfo {
  const paren = /\(([^)]*)\)\s*$/.exec(name);
  const suffix = paren?.[1]?.trim().toLowerCase();
  // Parentheses may name a fixed variant, e.g. Orchestrator (Carbon).
  // Treat only actual effort names and legacy Thinking as tier metadata.
  const effort = isEffort(suffix) || suffix === "thinking" ? suffix : undefined;
  const head = effort && paren ? name.slice(0, paren.index) : name;

  const version: number[] = [];
  const familyWords: string[] = [];
  for (const word of head.trim().split(/\s+/)) {
    if (!word) continue;
    if (VERSION_TOKEN.test(word) && version.length === 0) {
      version.push(...word.split(".").map(Number));
    } else {
      familyWords.push(word.toLowerCase());
    }
  }

  return {
    id,
    name,
    family: familyWords.join("-"),
    version,
    ...(effort ? { effort } : {}),
  };
}

/**
 * Parses `agy models` into rows.
 *
 * The listing is `<id>\t<display name>` per line, preceded by a
 * "Fetching available models..." progress line. The previous parser flattened
 * every column into one list, which let that header through as a model name
 * that passed validation and then failed at agy.
 */
export function parseListing(output: string): ModelInfo[] {
  const rows: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const parts = line.split("\t").map((s) => s.trim().replace(/\s*\(current\)$/, ""));
    if (parts.length < 2) continue; // header and blank lines have no tab
    const [id, name] = parts;
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    rows.push(describeModel(id, name));
  }
  return rows;
}

/** `family@latest[-effort]` or `family@3.7[-effort]`. */
const SELECTOR = /^([a-z0-9-]+)@(latest|\d+(?:\.\d+)*)(?:-(high|medium|low|xhigh|max|thinking))?$/i;

function newerThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Resolves one chain entry to the canonical listed CLI id, or undefined.
 * An entry may be an exact display name, an id, or a family selector.
 */
export function resolveEntry(entry: string, available: ModelInfo[]): string | undefined {
  const exactId = available.find((m) => m.id === entry);
  if (exactId) return exactId.id;
  const exactNames = available.filter((m) => m.name === entry);
  if (exactNames.length === 1) return exactNames[0]!.id;
  if (exactNames.length > 1) return undefined; // A duplicated label is not an identity.

  const sel = SELECTOR.exec(entry);
  if (!sel) return undefined;
  const [, family, versionSpec, effort] = sel;
  const wantVersion =
    versionSpec!.toLowerCase() === "latest" ? null : versionSpec!.split(".").map(Number);

  let best: ModelInfo | undefined;
  for (const m of available) {
    if (m.family !== family!.toLowerCase()) continue;
    if (effort && m.effort !== effort.toLowerCase()) continue;
    if (wantVersion && m.version.join(".") !== wantVersion.join(".")) continue;
    if (
      !best ||
      newerThan(m.version, best.version) ||
      (!newerThan(best.version, m.version) && stableVariantOrder(m, best) < 0)
    )
      best = m;
  }
  return best?.id;
}

/** An untiered selector has a deterministic balanced choice, independent of row order. */
function stableVariantOrder(a: ModelInfo, b: ModelInfo): number {
  const order = ["medium", "high", "low", "xhigh", "max", "thinking", undefined];
  return order.indexOf(a.effort) - order.indexOf(b.effort) || a.id.localeCompare(b.id);
}

/** A model name to pass agy, and the `--effort` to send with it, if any. */
export interface TierPick {
  model: string;
  effort?: Effort;
}

/**
 * Reconciles a requested effort with a model that may carry its own tier.
 *
 * The listed variant is the executable identity. A family policy may choose
 * a sibling at another effort, but only if that sibling is actually listed.
 * Callers must reject a conflicting effort on an explicit fixed variant before
 * calling this helper. Opaque models do not imply support for arbitrary effort.
 */
export function pickTier(
  name: string,
  effort: Effort | undefined,
  available: ModelInfo[],
): TierPick {
  const exactId = available.find((m) => m.id === name);
  const labels = exactId ? [] : available.filter((m) => m.name === name);
  const info = exactId ?? (labels.length === 1 ? labels[0] : undefined);
  if (!info) throw new Error(`Model "${name}" is not in the current agy inventory.`);
  if (!effort || effort === info.effort) return { model: info.id };
  const sibling = available
    .filter(
      (m) =>
        m.family === info.family &&
        m.version.join(".") === info.version.join(".") &&
        m.effort === effort,
    )
    .sort(stableVariantOrder)[0];
  if (sibling) return { model: sibling.id };
  const offered = available
    .filter((m) => m.family === info.family && m.version.join(".") === info.version.join("."))
    .map((m) => m.effort)
    .filter((v): v is string => v !== undefined);
  throw new Error(
    `Model "${info.name}" does not offer effort "${effort}". ` +
      `Available efforts: ${[...new Set(offered)].join(", ") || "fixed; omit effort"}.`,
  );
}

export interface ResolveOptions {
  explicit?: string;
  chain: string[];
  defaultModel?: string;
}

export interface ChainResolution {
  models: (string | undefined)[];
  note?: string;
}

/** Thrown when the listing is readable but nothing in the chain survives it. */
export class ModelSkewError extends Error {
  constructor(chain: string[], available: ModelInfo[]) {
    super(
      `None of this tool's models are offered by agy any more.\n` +
        `Wanted: ${chain.join(", ")}\n` +
        `Available: ${available.map((m) => m.name).join(", ")}\n` +
        `This is a version-skew signal, not a preference — update the tool's chain.`,
    );
    this.name = "ModelSkewError";
  }
}

export class ModelRegistry {
  private listing: ModelInfo[] | null = null;
  private pending: Promise<ModelInfo[] | null> | null = null;
  private generation = 0;
  private freshUntil = 0;

  constructor(
    private fetchListing: () => Promise<string>,
    private readonly cache: { ttlMs?: number; now?: () => number } = {},
  ) {}

  /**
   * Discards the cached listing so the next call re-reads `agy models`.
   *
   * Listings otherwise expire after five minutes. Invalidation also prevents
   * an older in-flight fetch from replacing a newer account inventory.
   */
  invalidate(): void {
    this.listing = null;
    this.pending = null;
    this.freshUntil = 0;
    this.generation++;
  }

  async available(): Promise<ModelInfo[] | null> {
    const now = this.cache.now ?? Date.now;
    if (this.listing && now() < this.freshUntil) return this.listing;
    // Cache the promise so concurrent first calls share one fetch.
    this.pending ??= this.fetchListing()
      .then(parseListing)
      .catch(() => null);
    const pending = this.pending;
    const generation = this.generation;
    const result = await pending;
    // A listing requested before invalidation must not overwrite the fresh one.
    if (generation !== this.generation) return this.available();
    if (this.pending === pending) this.pending = null;
    if (result && result.length) {
      this.listing = result;
      this.freshUntil = now() + (this.cache.ttlMs ?? 300_000);
    } else {
      this.listing = null;
    }
    return result && result.length ? result : null;
  }

  /** Verify effort against the inventory; never invent a tier during an outage. */
  async forEffort(
    name: string | undefined,
    effort: Effort | undefined,
  ): Promise<TierPick | undefined> {
    if (!name) return undefined;
    const available = await this.available();
    if (available === null) {
      if (effort)
        throw new Error("Cannot verify the requested effort because `agy models` is unavailable.");
      return { model: name };
    }
    return pickTier(name, effort, available);
  }

  /**
   * Every viable model in preference order for selection before dispatch.
   * `[undefined]` means "let agy pick", and is only returned when the listing
   * itself could not be read — an unreadable listing is a degraded environment,
   * whereas an empty resolved chain is stale configuration and throws.
   */
  async resolveChain(opts: ResolveOptions): Promise<ChainResolution> {
    const available = await this.available();

    if (opts.explicit) {
      if (available === null) {
        return {
          models: [opts.explicit],
          note: "could not list agy models; passing model through unvalidated",
        };
      }
      const resolved = resolveEntry(opts.explicit, available);
      if (resolved) return { models: [resolved] };
      throw new Error(
        `Model "${opts.explicit}" is not available. Available models:\n` +
          available.map((m) => m.name).join("\n"),
      );
    }

    if (available === null) {
      return {
        models: [undefined],
        note: "could not list agy models; using agy's own default model",
      };
    }

    const wanted = [...opts.chain, ...(opts.defaultModel ? [opts.defaultModel] : [])];
    const models: string[] = [];
    for (const entry of wanted) {
      const name = resolveEntry(entry, available);
      if (name && !models.includes(name)) models.push(name);
    }
    if (models.length === 0) throw new ModelSkewError(wanted, available);
    return { models };
  }
}
