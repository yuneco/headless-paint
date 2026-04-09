import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const publicPackageDir = path.join(repoRoot, "packages", "headless-paint");
const publicPackageJsonPath = path.join(publicPackageDir, "package.json");
const distDir = path.join(publicPackageDir, "dist");

const packageJson = JSON.parse(await readFile(publicPackageJsonPath, "utf8"));

const exportTargets = new Set();
for (const exportValue of Object.values(packageJson.exports ?? {})) {
  if (typeof exportValue === "string") {
    exportTargets.add(exportValue);
    continue;
  }

  if (exportValue && typeof exportValue === "object") {
    for (const target of Object.values(exportValue)) {
      if (typeof target === "string") {
        exportTargets.add(target);
      }
    }
  }
}

const failures = [];

for (const relativeTarget of exportTargets) {
  const absoluteTarget = path.join(publicPackageDir, relativeTarget);
  try {
    const targetStat = await stat(absoluteTarget);
    if (!targetStat.isFile()) {
      failures.push(`export target is not a file: ${relativeTarget}`);
    }
  } catch {
    failures.push(`missing export target: ${relativeTarget}`);
  }
}

const forbiddenPatterns = [
  {
    pattern:
      /@headless-paint\/(?:core|react|engine|input|stroke)(?:\/|["'])?/g,
    reason: "internal workspace package reference",
  },
  {
    pattern:
      /\.\.\/\.\.\/(?:core|react|engine|input|stroke)\/src\/[^\s"']+/g,
    reason: "source file reference outside dist",
  },
];

for (const fileName of await readdir(distDir)) {
  if (!fileName.endsWith(".d.ts")) continue;

  const absolutePath = path.join(distDir, fileName);
  const content = await readFile(absolutePath, "utf8");

  for (const { pattern, reason } of forbiddenPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      failures.push(`${path.relative(repoRoot, absolutePath)}: ${reason}: ${match[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Publish artifact verification failed.");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Publish artifact verification passed.");
