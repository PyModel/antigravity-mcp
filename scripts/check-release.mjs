import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const lock = read("package-lock.json");
const manifest = read("server.json");
assert.equal(lock.name, pkg.name, "lockfile name must match package.json");
assert.equal(lock.packages?.[""]?.name, pkg.name, "lock root package name must match package.json");
assert.equal(manifest.name, pkg.mcpName, "MCP registry name must match package.json mcpName");
const primaryBin = pkg.name.split("/").at(-1);
assert.equal(
  pkg.bin?.[primaryBin],
  "dist/index.js",
  "primary executable must match the package name",
);
for (const [name, version] of Object.entries({
  "lock root": lock.version,
  "lock package": lock.packages?.[""]?.version,
  "MCP registry": manifest.version,
  "MCP npm package": manifest.packages?.find((item) => item.identifier === pkg.name)?.version,
})) {
  assert.equal(version, pkg.version, `${name} version must match package.json`);
}
console.log(`Release metadata agrees on ${pkg.name}@${pkg.version}`);
