import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_ENTRIES = 20_000;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_MS = 10_000;

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function git(cwd, args, timeout = 2000) {
  return execFileSync("git", args, {
    cwd,
    timeout,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Watch the entire repository when cwd is nested, plus every explicit extra root. */
export function workspaceRoots(dirs) {
  const roots = [];
  for (const dir of dirs) {
    const actual = realpathSync.native(dir);
    let root = actual;
    try {
      root = realpathSync.native(git(actual, ["rev-parse", "--show-toplevel"]).toString().trim());
    } catch {
      // A plain directory is still observable, including its ignored/untracked files.
    }
    if (!roots.some((existing) => inside(existing, root))) {
      for (let i = roots.length - 1; i >= 0; i--) if (inside(root, roots[i])) roots.splice(i, 1);
      roots.push(root);
    }
  }
  return roots.sort();
}

/**
 * A bounded content snapshot, never a sandbox. Null means coverage is unknown.
 * Hash all regular files, including ignored files; do not infer equality from
 * unchanged git status, file size, or a collapsed dependency directory.
 */
export function workspaceSnapshot(roots, excludedPaths = []) {
  const started = Date.now();
  const hash = createHash("sha256");
  const exclusions = excludedPaths.map((file) => resolve(file));
  let entries = 0;
  let bytes = 0;
  const checkBudget = () => {
    if (entries > MAX_ENTRIES || bytes > MAX_BYTES || Date.now() - started > MAX_MS) {
      throw new Error("snapshot limit exceeded (20,000 entries, 128 MiB, or 10 seconds)");
    }
  };
  const add = (value) => hash.update(String(value)).update("\0");
  const snapshotGit = (cwd, args) => {
    checkBudget();
    return git(cwd, args, Math.max(1, Math.min(2000, MAX_MS - (Date.now() - started))));
  };
  const visit = (file) => {
    if (exclusions.some((excluded) => inside(excluded, file))) return;
    entries++;
    checkBudget();
    const stat = lstatSync(file, { bigint: true });
    add(file);
    add(stat.mode);
    if (stat.isSymbolicLink()) {
      add("symlink");
      const target = readlinkSync(file);
      add(target);
      const resolved = realpathSync.native(resolve(dirname(file), target));
      if (!roots.some((root) => inside(root, resolved))) {
        throw new Error(`symlink target is outside the watched roots: ${file}`);
      }
      return;
    }
    if (stat.isDirectory()) {
      add("directory");
      if (existsSync(join(file, ".git"))) {
        // .git administrative data is excluded from traversal. HEAD and the
        // staged index are included explicitly so staging/committing is visible.
        add("git-index");
        hash.update(snapshotGit(file, ["ls-files", "--stage", "-z"]));
        add("git-head");
        try {
          hash.update(snapshotGit(file, ["rev-parse", "--verify", "--quiet", "HEAD"]));
        } catch (error) {
          if (error.status !== 1) throw error;
          add("unborn");
        }
        // Capture the branch identity as well as its commit; detached HEAD is valid.
        try {
          hash.update(snapshotGit(file, ["symbolic-ref", "--quiet", "HEAD"]));
        } catch (error) {
          if (error.status !== 1) throw error;
          add("detached");
        }
      }
      const names = readdirSync(file).sort();
      for (const name of names) {
        if (name !== ".git") visit(join(file, name));
      }
      checkBudget();
      if (readdirSync(file).sort().join("\0") !== names.join("\0")) {
        throw new Error(`directory changed during snapshot: ${file}`);
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`unsupported filesystem entry: ${file}`);
    bytes += Number(stat.size);
    checkBudget();
    add("file");
    add(stat.size);
    add(stat.mtimeNs);
    add(stat.ctimeNs);
    hash.update(readFileSync(file));
    const after = lstatSync(file, { bigint: true });
    if (
      stat.ino !== after.ino ||
      stat.mode !== after.mode ||
      stat.size !== after.size ||
      stat.mtimeNs !== after.mtimeNs ||
      stat.ctimeNs !== after.ctimeNs
    )
      throw new Error(`file changed during snapshot: ${file}`);
  };
  try {
    for (const root of roots) visit(root);
    checkBudget();
    return { digest: hash.digest("hex"), roots, reason: null };
  } catch (error) {
    return { digest: null, roots, reason: error.message };
  }
}

export function touchedFilesByRoot(roots) {
  return roots.map((root) => {
    try {
      const files = git(root, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"])
        .toString()
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean);
      return { root, files };
    } catch {
      return { root, files: null };
    }
  });
}
