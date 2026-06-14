import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickBossJobIdFromListItem } from "../src/boss/parser.js";

describe("Boss parser", () => {
  it("extracts job-list ids from Boss security and encrypt id fields", () => {
    assert.equal(pickBossJobIdFromListItem({ securityId: " sec-1 " }), "sec-1");
    assert.equal(pickBossJobIdFromListItem({ security_id: "sec-2" }), "sec-2");
    assert.equal(pickBossJobIdFromListItem({ jobInfo: { securityId: "sec-3" } }), "sec-3");
    assert.equal(pickBossJobIdFromListItem({ encryptJobId: "encrypt-4" }), "encrypt-4");
    assert.equal(pickBossJobIdFromListItem({ jobInfo: { encrypt_job_id: "encrypt-5" } }), "encrypt-5");
    assert.equal(pickBossJobIdFromListItem({ jobInfo: { securityId: "" } }), null);
  });
});
