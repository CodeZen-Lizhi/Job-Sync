import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { buildJobListBody, normalizeFilterVariants } from "../src/modes/auto/shared.js";

const workerRoot = process.cwd();

function readWorkerFile(path: string): string {
  return readFileSync(resolve(workerRoot, path), "utf8");
}

describe("Boss auto collection contract", () => {
  it("keeps JOB_LIST_CAPTURED as the full raw list even when profile filter gates detail capture", () => {
    const source = readWorkerFile("src/modes/auto/run.ts");

    assert.doesNotMatch(source, /withFilteredJobListRaw/);
    assert.match(source, /raw:\s*jobListRaw/);
    assert.match(source, /jobsToCapture\s*=\s*eligibleJobs/);
    assert.match(source, /type:\s*"JOB_FILTERED"/);
  });

  it("expands Boss multi-city filters into sequential job-list variants", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");
    const sharedSource = readWorkerFile("src/modes/auto/shared.ts");

    assert.match(sharedSource, /export function normalizeFilterVariants/);
    assert.match(sharedSource, /return cities\.map\(\(city\) => \(\{ \.\.\.base, city \}\)\)/);
    assert.match(runSource, /const filterVariants = normalizeFilterVariants/);
    assert.match(runSource, /for \(const \[variantIndex, apiFilters\] of filterVariants\.entries\(\)\)/);
    assert.match(runSource, /if \(filterVariants\.length > 1\) log\(`开始 \$\{variantLabel\}`\)/);
  });

  it("builds one Boss job-list request body per selected city code", () => {
    const warnings: string[] = [];
    const variants = normalizeFilterVariants(
      { city: ["101010100", "101020100"], salary: "405", experience: "104", degree: "203" },
      (message) => warnings.push(message),
    );

    assert.deepEqual(
      variants.map((variant) => variant.city),
      ["101010100", "101020100"],
    );
    assert.equal(warnings.length, 0);

    const bodies = variants.map((variant) => new URLSearchParams(buildJobListBody("Go", 1, 15, variant)));
    assert.deepEqual(
      bodies.map((body) => body.get("city")),
      ["101010100", "101020100"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("query")),
      ["Go", "Go"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("salary")),
      ["405", "405"],
    );
  });
});
