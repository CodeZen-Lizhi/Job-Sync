import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBossChatStatusItems } from "../src/boss/chat.js";

describe("Boss chat status parser", () => {
  it("maps Boss chat read and delivered labels to local communication statuses", () => {
    const items = parseBossChatStatusItems({
      zpData: {
        list: [
          {
            jobInfo: { encryptJobId: "job-read" },
            bossInfo: { name: "苏先生" },
            companyInfo: { brandName: "艾捷智" },
            positionInfo: { positionName: "AI工程师" },
            messageStatusText: "[已读]",
            lastMessageText: "这是我的资料，希望有机会加入贵团队，谢谢",
          },
          {
            jobInfo: { securityId: "job-delivered" },
            bossName: "陈大我",
            brandName: "云享智慧",
            jobName: "Java工程师",
            statusText: "[送达]",
            lastMsg: "这是我的资料，希望有机会加入贵团队，谢谢",
          },
        ],
      },
    });

    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => [item.encrypt_job_id, item.communication_status]),
      [
        ["job-read", "read_no_reply"],
        ["job-delivered", "greeted_unread"],
      ],
    );
  });

  it("promotes replied and rejected conversations when chat evidence exists", () => {
    const items = parseBossChatStatusItems({
      zpData: {
        list: [
          {
            encryptJobId: "job-replied",
            hasReply: true,
            messageStatusText: "[已读]",
            lastMessageText: "您好，可以发一份您的详细简历沟通一下吗？",
          },
          {
            encryptJobId: "job-rejected",
            messageStatusText: "[已读]",
            lastMessageText: "不考虑",
          },
          {
            jobInfo: { encryptJobId: "job-info-only" },
          },
        ],
      },
    });

    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => [item.encrypt_job_id, item.communication_status]),
      [
        ["job-replied", "replied"],
        ["job-rejected", "rejected"],
      ],
    );
  });
});
