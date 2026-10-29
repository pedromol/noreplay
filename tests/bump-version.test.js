import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bumpPatchVersion,
  updateVersionInContent,
  bumpFiles,
} from "../scripts/bump-version.js";

test("bumpPatchVersion increments the patch segment by +0.0.1", () => {
  assert.equal(bumpPatchVersion("0.1.13"), "0.1.14");
  assert.equal(bumpPatchVersion("0.1.9"), "0.1.10");
  assert.equal(bumpPatchVersion("1.0.0"), "1.0.1");
  assert.equal(bumpPatchVersion("2.15.99"), "2.15.100");
});

test("bumpPatchVersion throws on invalid versions", () => {
  assert.throws(() => bumpPatchVersion(""), /Invalid semver/);
  assert.throws(() => bumpPatchVersion("1.0"), /Invalid semver/);
  assert.throws(() => bumpPatchVersion("v1.0.0"), /Invalid semver/);
  assert.throws(() => bumpPatchVersion("1.0.0-beta"), /Invalid semver/);
  assert.throws(() => bumpPatchVersion(null), /Expected version string/);
});

test("updateVersionInContent replaces version while preserving indentation and other fields", () => {
  const sample = `{
  "name": "sample",
  "version": "0.1.13",
  "permissions": ["storage", "tabs"]
}
`;
  const updated = updateVersionInContent(sample, "0.1.14");
  assert.equal(
    updated,
    `{
  "name": "sample",
  "version": "0.1.14",
  "permissions": ["storage", "tabs"]
}
`
  );
  assert.deepEqual(JSON.parse(updated), {
    name: "sample",
    version: "0.1.14",
    permissions: ["storage", "tabs"],
  });
});

test("updateVersionInContent throws if version field is absent", () => {
  assert.throws(
    () => updateVersionInContent('{"name": "foo"}', "1.0.0"),
    /Could not find "version" field/
  );
});

test("bumpFiles updates both package.json and manifest.json +0.0.1", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "noreplay-bump-test-"));

  try {
    const pkgPath = path.join(tempDir, "package.json");
    const manifestPath = path.join(tempDir, "manifest.json");

    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ name: "noreplay", version: "0.1.13" }, null, 2) + "\n"
    );
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        { manifest_version: 3, name: "NoReplay", version: "0.1.13" },
        null,
        2
      ) + "\n"
    );

    const result = bumpFiles(tempDir);
    assert.deepEqual(result, {
      previousVersion: "0.1.13",
      nextVersion: "0.1.14",
    });

    const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assert.equal(updatedPkg.version, "0.1.14");
    assert.equal(updatedManifest.version, "0.1.14");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bumpFiles throws if package.json or manifest.json is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "noreplay-bump-missing-"));

  try {
    assert.throws(() => bumpFiles(tempDir), /package\.json not found/);
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"version": "1.0.0"}');
    assert.throws(() => bumpFiles(tempDir), /manifest\.json not found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
