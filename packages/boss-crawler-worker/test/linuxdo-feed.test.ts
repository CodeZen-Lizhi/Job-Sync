import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import {
  buildLinuxDoNormalizedPayload,
  checkLinuxDoBrowserApiReadiness,
  classifyLinuxDoTopic,
  fetchLinuxDoCategoryEntries,
  fetchLinuxDoTopicDetail,
  isLinuxDoCloudflareChallengeText,
  linuxDoHtmlToText,
  parseLinuxDoCategoryJson,
  parseLinuxDoCategoryPage,
  parseLinuxDoTopicJson,
  type LinuxDoTopicEntry,
} from "../src/linuxdo/feed.js";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

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

  it("treats browser-context Discourse JSON as LinuxDo API readiness", async () => {
    const page = {
      evaluate: async () => ({
        status: 200,
        json: { topic_list: { topics: [] } },
        text: "{\"topic_list\":{\"topics\":[]}}",
        contentType: "application/json",
      }),
    };

    const readiness = await checkLinuxDoBrowserApiReadiness(page as any, "https://linux.do/c/job/27", 100);

    assert.equal(readiness.ready, true);
    assert.equal(readiness.blocked, false);
    assert.equal(readiness.status, 200);
  });

  it("keeps Cloudflare-blocked browser-context API reads in blocked state", async () => {
    const page = {
      evaluate: async () => ({
        status: 403,
        json: null,
        text: "<html><title>Verify you are human</title><body>Cloudflare</body></html>",
        contentType: "text/html",
      }),
    };

    const readiness = await checkLinuxDoBrowserApiReadiness(page as any, "https://linux.do/c/job/27", 100);

    assert.equal(readiness.ready, false);
    assert.equal(readiness.blocked, true);
    assert.equal(readiness.status, 403);
    assert.match(readiness.message, /完成验证/);
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

    const interviewTool: LinuxDoTopicEntry = {
      topicId: "3",
      title: "开源一个 AI 模拟面试工具",
      url: "https://linux.do/t/3",
      contentText: "根据简历和岗位生成面试题，面试结束后生成报告，欢迎大家体验项目。",
    };
    assert.equal(classifyLinuxDoTopic(interviewTool, ["AI"]).isJobPosting, false);
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

  it("fetches category and topic data through direct Discourse API requests", async () => {
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
      requests.push(`${req.method ?? "GET"} ${req.url ?? ""} ${req.headers.cookie ?? ""}`);
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/c/job/27.json") {
        assert.match(req.headers.cookie ?? "", /_t=linuxdo-token/);
        res.writeHead(200, { "content-type": "application/json;charset=UTF-8" });
        res.end(JSON.stringify({
          users: [{ id: 7, username: "alice" }],
          topic_list: {
            topics: [
              {
                id: 1220440,
                title: "招聘 Go 后端工程师",
                slug: "go-backend",
                created_at: "2026-06-22T08:00:00.000Z",
                bumped_at: "2026-06-22T09:00:00.000Z",
                excerpt: "<p>远程，全职，投递邮箱 jobs@example.com</p>",
                posters: [{ user_id: 7 }],
              },
            ],
          },
        }));
        return;
      }
      if (requestUrl.pathname === "/t/1220440.json") {
        assert.match(req.headers.cookie ?? "", /_t=linuxdo-token/);
        res.writeHead(200, { "content-type": "application/json;charset=UTF-8" });
        res.end(JSON.stringify({
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
        }));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const port = await listen(server);
    const signal = new AbortController().signal;
    try {
      const category = await fetchLinuxDoCategoryEntries(
        `http://127.0.0.1:${port}/c/job/27`,
        1,
        signal,
        { cookieHeader: "_t=linuxdo-token" },
      );
      assert.equal(category.blocked, false);
      assert.equal(category.entries.length, 1);
      assert.equal(category.entries[0]?.author, "alice");

      const detail = await fetchLinuxDoTopicDetail(
        {
          topicId: "1220440",
          title: "招聘 Go 后端工程师",
          url: `http://127.0.0.1:${port}/t/1220440`,
          author: "alice",
        },
        signal,
        { cookieHeader: "_t=linuxdo-token" },
      );
      assert.equal(detail.detailStatus, "ok");
      assert.match(detail.contentText ?? "", /Kubernetes 平台建设/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    assert.deepEqual(requests.map((line) => line.split(" ")[1]), ["/c/job/27.json", "/t/1220440.json"]);
  });
});
