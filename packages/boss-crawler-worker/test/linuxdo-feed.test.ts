import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLinuxDoNormalizedPayload,
  classifyLinuxDoTopic,
  isLinuxDoCloudflareChallengeText,
  linuxDoHtmlToText,
  parseLinuxDoCategoryJson,
  parseLinuxDoCategoryPage,
  parseLinuxDoTopicJson,
  type LinuxDoTopicEntry,
} from "../src/linuxdo/feed.js";

describe("LinuxDo feed collector", () => {
  it("parses Discourse category JSON topics", () => {
    const entries = parseLinuxDoCategoryJson({
      users: [{ id: 7, username: "alice" }],
      topic_list: {
        topics: [
          {
            id: 1220440,
            title: "招聘 Go 后端工程师",
            fancy_title: "招聘 Go 后端工程师",
            slug: "go-backend",
            created_at: "2026-06-22T08:00:00.000Z",
            bumped_at: "2026-06-22T09:00:00.000Z",
            excerpt: "<p>远程，全职，投递邮箱 jobs@example.com</p>",
            posters: [{ user_id: 7 }],
          },
        ],
      },
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.topicId, "1220440");
    assert.equal(entries[0]?.url, "https://linux.do/t/go-backend/1220440");
    assert.equal(entries[0]?.author, "alice");
    assert.match(entries[0]?.excerptText ?? "", /投递邮箱/);
  });

  it("parses Discourse topic JSON first post detail", () => {
    const detail = parseLinuxDoTopicJson(
      {
        id: 1220440,
        title: "招聘 Go 后端工程师",
        post_stream: {
          posts: [
            {
              username: "alice",
              created_at: "2026-06-22T08:00:00.000Z",
              cooked: "<p>负责 Kubernetes 平台建设<br>远程全职</p>",
            },
          ],
        },
      },
      {
        topicId: "1220440",
        title: "旧标题",
        url: "https://linux.do/t/1220440",
      },
    );

    assert.ok(detail);
    assert.equal(detail?.detailStatus, "ok");
    assert.equal(detail?.author, "alice");
    assert.match(detail?.contentText ?? "", /Kubernetes 平台建设/);
  });

  it("parses category HTML links as title-level entries", () => {
    const entries = parseLinuxDoCategoryPage(`
      <a class="title raw-link raw-topic-link" href="/t/go-backend/1220440">招聘 Go 后端工程师</a>
      <span data-user-card="alice"></span>
      <time datetime="2026-06-22T08:00:00.000Z"></time>
    `);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.topicId, "1220440");
    assert.equal(entries[0]?.title, "招聘 Go 后端工程师");
    assert.equal(entries[0]?.url, "https://linux.do/t/1220440");
  });

  it("detects Cloudflare challenge text", () => {
    assert.equal(isLinuxDoCloudflareChallengeText("<title>Just a moment...</title><script>_cf_chl_opt={}</script>"), true);
    assert.equal(isLinuxDoCloudflareChallengeText("<html><body>正常帖子列表</body></html>"), false);
  });

  it("classifies hiring topics without treating keywords alone as success", () => {
    const hiring: LinuxDoTopicEntry = {
      topicId: "1",
      title: "招聘 Go 后端工程师",
      url: "https://linux.do/t/1",
      contentText: "远程，全职，薪资 30-50K，投递邮箱 jobs@example.com",
    };
    assert.equal(classifyLinuxDoTopic(hiring, ["Go"]).isJobPosting, true);

    const discussion: LinuxDoTopicEntry = {
      topicId: "2",
      title: "Go 学习路线求助",
      url: "https://linux.do/t/2",
      contentText: "大家觉得 Go 后端还有必要学吗",
    };
    assert.equal(classifyLinuxDoTopic(discussion, ["Go"]).isJobPosting, false);
  });

  it("builds normalized payload for title-level fallback jobs", () => {
    const entry: LinuxDoTopicEntry = {
      topicId: "1220440",
      title: "招聘 Go 后端工程师",
      url: "https://linux.do/t/1220440",
      author: "alice",
      detailStatus: "blocked",
      detailError: "HTTP 403",
    };
    const payload = buildLinuxDoNormalizedPayload(entry, { keywords: ["Go"], filters: { category_url: "https://linux.do/c/job/27" } });

    assert.equal(payload.encrypt_job_id, "linuxdo:1220440");
    assert.equal(payload.source_platform, "linuxdo");
    assert.equal(payload.source_url, "https://linux.do/t/1220440");
    assert.equal(payload.dedup_key, "1220440");
    assert.equal(payload.brand_name, "LinuxDo");
    assert.match(payload.jd_text ?? "", /详情暂未抓取/);
    assert.equal((payload.raw_payload as any).detail_status, "blocked");
  });

  it("converts cooked html to readable text", () => {
    assert.equal(linuxDoHtmlToText("<p>招聘 Go 后端</p><p>远程&nbsp;/ 全职</p>"), "招聘 Go 后端\n远程 / 全职");
  });
});
