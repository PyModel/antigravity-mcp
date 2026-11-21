import { execFileSync } from "node:child_process";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** Standalone relay capability parser; ids are opaque and come only from agy models. */
export function parseModels(output) {
  const seen = new Set();
  const models = [];
  for (const line of output.split("\n")) {
    const [id, name] = line
      .split("\t")
      .map((column) => column.trim().replace(/\s*\(current\)$/, ""));
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const suffix = /\(([^)]*)\)\s*$/.exec(name);
    const tier = suffix?.[1].trim().toLowerCase();
    const effort = EFFORTS.includes(tier) || tier === "thinking" ? tier : null;
    const head = effort ? name.slice(0, suffix.index).trim() : name;
    const words = head.split(/\s+/);
    const versionIndex = words.findIndex((word) => /^\d+(?:\.\d+)*$/.test(word));
    const version = versionIndex < 0 ? [] : words.splice(versionIndex, 1)[0].split(".").map(Number);
    models.push({ id, name, effort, family: words.join("-").toLowerCase(), version });
  }
  return models;
}

export function resolveModel(requestedModel, requestedEffort, models) {
  if (!requestedModel) {
    if (requestedEffort)
      throw new Error("--effort requires --model; the inherited model is unknown");
    return { model: null, effort: null };
  }
  const exact = models.find((model) => model.id === requestedModel);
  const labels = models.filter((model) => model.name === requestedModel);
  const fixed = exact || (labels.length === 1 ? labels[0] : null);
  if (fixed) {
    if (requestedEffort && fixed.effort !== requestedEffort) {
      throw new Error(
        `--model "${requestedModel}" fixes its listed variant; --effort "${requestedEffort}" conflicts. ` +
          "Select the desired listed variant or use a family selector.",
      );
    }
    return { model: fixed.id, effort: fixed.effort };
  }
  if (labels.length > 1)
    throw new Error(`ambiguous model label "${requestedModel}"; use its listed ID`);
  const selector =
    /^([a-z0-9-]+)@(latest|\d+(?:\.\d+)*)(?:-(low|medium|high|xhigh|max|thinking))?$/i.exec(
      requestedModel,
    );
  if (!selector) throw new Error(`model "${requestedModel}" is not in the current agy inventory`);
  const [, family, version, selectorEffort] = selector;
  if (requestedEffort && selectorEffort && requestedEffort !== selectorEffort.toLowerCase()) {
    throw new Error("--effort conflicts with the effort in --model's family selector");
  }
  const effort = requestedEffort || selectorEffort?.toLowerCase();
  const order = ["medium", "high", "low", "xhigh", "max", "thinking", null];
  const candidates = models
    .filter(
      (model) =>
        model.family === family.toLowerCase() &&
        (version.toLowerCase() === "latest" || model.version.join(".") === version) &&
        (!effort || model.effort === effort),
    )
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
        const difference = (b.version[i] || 0) - (a.version[i] || 0);
        if (difference) return difference;
      }
      return order.indexOf(a.effort) - order.indexOf(b.effort) || a.id.localeCompare(b.id);
    });
  const selected = candidates[0];
  if (!selected)
    throw new Error(
      `no listed variant satisfies "${requestedModel}"${effort ? ` at effort "${effort}"` : ""}`,
    );
  return { model: selected.id, effort: selected.effort };
}

export function selectModel(opts, timeoutMs) {
  if (!opts.model && !opts.effort) return { model: null, effort: null };
  const listing = execFileSync("agy", ["models"], {
    cwd: opts.cd,
    timeout: Math.min(timeoutMs, 10_000),
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
  const models = parseModels(listing.toString());
  if (!models.length)
    throw new Error("agy models returned no readable inventory; no task was dispatched");
  return resolveModel(opts.model, opts.effort, models);
}
