import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// @earendil-works/pi-coding-agent 0.83.0 pins minimatch 10.2.5, which pulls
// brace-expansion 5.0.7 (GHSA-mh99-v99m-4gvg). npm currently records our
// override but may still install the pinned nested copies. Remove only those
// exact stale packages so Node resolves the patched direct dependencies.
const projectRoot = process.cwd();
const piNodeModules = resolve(projectRoot, "node_modules/@earendil-works/pi-coding-agent/node_modules");
const patchedPackages = [
  { name: "minimatch", minimum: [10, 2, 6] },
  { name: "brace-expansion", minimum: [5, 0, 9] },
];

function versionAtLeast(version, minimum) {
  const current = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] || 0) > minimum[index]) return true;
    if ((current[index] || 0) < minimum[index]) return false;
  }
  return true;
}

for (const requirement of patchedPackages) {
  const rootManifest = resolve(projectRoot, `node_modules/${requirement.name}/package.json`);
  if (!existsSync(rootManifest)) throw new Error(`Missing patched dependency: ${requirement.name}`);
  const rootVersion = JSON.parse(readFileSync(rootManifest, "utf8")).version;
  if (!versionAtLeast(rootVersion, requirement.minimum)) {
    throw new Error(`Patched ${requirement.name} is too old: ${rootVersion}`);
  }

  const nestedRoot = resolve(piNodeModules, requirement.name);
  const nestedManifest = resolve(nestedRoot, "package.json");
  if (!existsSync(nestedManifest)) continue;
  const nestedVersion = JSON.parse(readFileSync(nestedManifest, "utf8")).version;
  if (!versionAtLeast(nestedVersion, requirement.minimum)) {
    rmSync(nestedRoot, { recursive: true, force: true });
    process.stdout.write(`[carousel-lab] replaced Pi ${requirement.name} ${nestedVersion} with ${rootVersion}\n`);
  }
}
