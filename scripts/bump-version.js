import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Increments the patch number of a semver string (x.y.z -> x.y.(z+1)).
 * @param {string} version
 * @returns {string}
 */
export function bumpPatchVersion(version) {
  if (typeof version !== "string") {
    throw new TypeError(`Expected version string, got ${typeof version}`);
  }
  const parts = version.trim().split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Invalid semver version: "${version}"`);
  }
  const [major, minor, patch] = parts.map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Replaces the value of the "version" field in a JSON string while preserving formatting.
 * @param {string} content
 * @param {string} nextVersion
 * @returns {string}
 */
export function updateVersionInContent(content, nextVersion) {
  const versionRegex = /("version"\s*:\s*")([^"]+)(")/;
  if (!versionRegex.test(content)) {
    throw new Error('Could not find "version" field to update');
  }
  return content.replace(versionRegex, `$1${nextVersion}$3`);
}

/**
 * Reads package.json and manifest.json from rootDir, bumps their patch version +0.0.1,
 * and writes the updated contents back to disk.
 * @param {string} [rootDir=process.cwd()]
 * @returns {{ previousVersion: string, nextVersion: string }}
 */
export function bumpFiles(rootDir = process.cwd()) {
  const packagePath = path.join(rootDir, "package.json");
  const manifestPath = path.join(rootDir, "manifest.json");

  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found at: ${packagePath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at: ${manifestPath}`);
  }

  const packageRaw = fs.readFileSync(packagePath, "utf8");
  const manifestRaw = fs.readFileSync(manifestPath, "utf8");

  const pkg = JSON.parse(packageRaw);
  const manifest = JSON.parse(manifestRaw);

  if (!pkg.version) {
    throw new Error("package.json is missing a version field");
  }
  if (!manifest.version) {
    throw new Error("manifest.json is missing a version field");
  }

  const nextVersion = bumpPatchVersion(pkg.version);

  const updatedPackage = updateVersionInContent(packageRaw, nextVersion);
  const updatedManifest = updateVersionInContent(manifestRaw, nextVersion);

  // Validate that updated contents remain valid JSON before writing
  JSON.parse(updatedPackage);
  JSON.parse(updatedManifest);

  fs.writeFileSync(packagePath, updatedPackage, "utf8");
  fs.writeFileSync(manifestPath, updatedManifest, "utf8");

  return {
    previousVersion: pkg.version,
    nextVersion,
  };
}

const isDirectCall =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("bump-version.js"));

if (isDirectCall) {
  try {
    const { previousVersion, nextVersion } = bumpFiles();
    console.log(
      `Bumped version: ${previousVersion} -> ${nextVersion} (package.json, manifest.json)`
    );
  } catch (err) {
    console.error(`Error bumping version: ${err.message}`);
    process.exit(1);
  }
}
