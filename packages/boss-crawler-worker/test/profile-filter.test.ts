import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateBossProfileFilter,
  hasBossProfileFilter,
  normalizeBossProfileFilter,
} from "../src/boss/profileFilter.js";

describe("Boss profile filter", () => {
  it("normalizes local-only filter dimensions without hard-blocking list items in the worker", () => {
    const filter = normalizeBossProfileFilter({
      profile: {
        communicationStatuses: ["未打招呼", "已拒绝"],
        recentDays: "7",
      },
    });

    assert.deepEqual(filter.communicationStatuses, ["not_contacted", "rejected"]);
    assert.equal(filter.recentDays, 7);
    assert.equal(hasBossProfileFilter(filter), true);

    const result = evaluateBossProfileFilter(
      {
        securityId: "boss-go-sre-001",
        jobName: "Go SRE 工程师",
        cityName: "北京",
        salaryDesc: "35-55K",
        experienceName: "3-5年",
        degreeName: "本科",
      },
      filter,
    );

    assert.equal(result.eligible, true);
    assert.deepEqual(result.blocked_by, []);
  });

  it("keeps Boss list items inside Boss-only source filters and blocks non-Boss source filters", () => {
    const listItem = {
      securityId: "boss-go-sre-001",
      jobName: "Go SRE 工程师",
      cityName: "北京",
      salaryDesc: "35-55K",
      experienceName: "3-5年",
      degreeName: "本科",
    };

    const bossOnly = normalizeBossProfileFilter({
      profile: { sourcePlatforms: ["boss"] },
    });
    const bossResult = evaluateBossProfileFilter(listItem, bossOnly);

    assert.equal(bossResult.eligible, true);
    assert.deepEqual(bossResult.blocked_by, []);

    const liepinOnly = normalizeBossProfileFilter({
      profile: { sourcePlatforms: ["liepin"] },
    });
    const blockedResult = evaluateBossProfileFilter(listItem, liepinOnly);

    assert.equal(blockedResult.eligible, false);
    assert.ok(blockedResult.blocked_by.some((hit) => hit.rule_type === "source_platform"));
    assert.match(blockedResult.blocked_by[0]?.reason ?? "", /Boss 列表项来源不在允许平台内/);
  });

  it("filters Boss list items by recruiter active status when the payload exposes it", () => {
    const activeItem = {
      securityId: "boss-go-sre-001",
      jobName: "Go SRE 工程师",
      cityName: "北京",
      salaryDesc: "35-55K",
      experienceName: "3-5年",
      degreeName: "本科",
      bossInfo: { activeTimeDesc: "今日活跃" },
    };
    const staleItem = {
      ...activeItem,
      securityId: "boss-go-sre-002",
      bossInfo: { activeTimeDesc: "半年前活跃" },
    };

    const requiredRecent = normalizeBossProfileFilter({
      profile: { requiredBossActiveStatuses: ["今日活跃", "刚刚活跃"] },
    });
    const excludedStale = normalizeBossProfileFilter({
      profile: { excludedBossActiveStatuses: ["半年前活跃"] },
    });

    assert.equal(evaluateBossProfileFilter(activeItem, requiredRecent).eligible, true);

    const requiredResult = evaluateBossProfileFilter(staleItem, requiredRecent);
    assert.equal(requiredResult.eligible, false);
    assert.ok(requiredResult.blocked_by.some((hit) => hit.rule_type === "required_boss_active_status"));

    const excludedResult = evaluateBossProfileFilter(staleItem, excludedStale);
    assert.equal(excludedResult.eligible, false);
    assert.ok(excludedResult.blocked_by.some((hit) => hit.rule_type === "excluded_boss_active_status"));
  });
});
