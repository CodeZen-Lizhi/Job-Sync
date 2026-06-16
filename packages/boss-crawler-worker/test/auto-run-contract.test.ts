import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

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
});
