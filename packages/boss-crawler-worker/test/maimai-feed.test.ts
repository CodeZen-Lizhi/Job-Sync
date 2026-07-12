import assert from "node:assert/strict";
import * as http from "node:http";
import { describe, it } from "node:test";

import {
  buildMaimaiNormalizedPayload,
  classifyMaimaiArticle,
  extractMaimaiArticleId,
  fetchMaimaiPage,
  parseMaimaiArticleLinks,
  parseMaimaiArticlePage,
  runMaimaiMode,
  splitMaimaiUrls,
  type MaimaiArticle,
} from "../src/maimai/feed.js";
import type { EventOut } from "../src/protocol.js";

describe("Maimai feed collector", () => {
  it("extracts stable article ids from common detail URLs", () => {
    assert.equal(
      extractMaimaiArticleId("https://maimai.cn/article/detail?efid=encoded&fid=feed-123"),
      "feed-123",
    );
    assert.equal(
      extractMaimaiArticleId("https://maimai.cn/article/detail?efid=encoded"),
      "encoded",
    );
    assert.match(
      extractMaimaiArticleId("https://maimai.cn/article/detail?foo=bar"),
      /^url:[0-9a-f]{16}$/,
    );
    assert.equal(extractMaimaiArticleId("https://example.com/article/detail?fid=feed-123"), "");
  });

  it("splits and normalizes maimai URL input", () => {
    const urls = splitMaimaiUrls(`
      https://maimai.cn/article/detail?fid=1
      https://maimai.cn/article/detail?fid=1，https://www.maimai.cn/article/detail?fid=2、https://example.com/nope
    `);

    assert.deepEqual(urls, [
      "https://maimai.cn/article/detail?fid=1",
      "https://www.maimai.cn/article/detail?fid=2",
    ]);
  });

  it("discovers article links from list/search HTML", () => {
    const links = parseMaimaiArticleLinks(`
      <a href="/article/detail?fid=100&efid=aaa">内推岗位</a>
      <a href="https://maimai.cn/article/detail?efid=bbb">招聘文章</a>
      <a href="https://example.com/article/detail?fid=bad">外部链接</a>
    `);

    assert.equal(links.length, 2);
    assert.equal(links[0], "https://maimai.cn/article/detail?fid=100&efid=aaa");
    assert.equal(links[1], "https://maimai.cn/article/detail?efid=bbb");
  });

  it("follows maimai login redirects before blocked-page classification", async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/search")) {
        res.writeHead(302, { location: "/platform/login?to=%2Fsearch" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>请登录后查看</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetchMaimaiPage(
        `http://127.0.0.1:${address.port}/search`,
        new AbortController().signal,
        "脉脉测试页",
      );

      assert.equal(response.status, 200);
      assert.equal(response.redirected, true);
      assert.match(response.finalUrl, /\/platform\/login/);
      assert.match(response.body, /请登录后查看/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("parses readable article pages and rejects blocked pages", () => {
    const article = parseMaimaiArticlePage(`
      <html>
        <head>
          <meta property="og:title" content="招聘 Go 平台工程师 - 脉脉" />
          <meta name="author" content="Alice" />
          <meta property="article:published_time" content="2026-07-01T10:00:00+08:00" />
        </head>
        <body>
          <article><p>团队急招 Go 后端，Kubernetes 平台方向，薪资 30-50K，投递邮箱 jobs@example.com。</p></article>
        </body>
      </html>
    `, "https://maimai.cn/article/detail?fid=job-1");

    assert.ok(article);
    assert.equal(article?.articleId, "job-1");
    assert.equal(article?.title, "招聘 Go 平台工程师");
    assert.equal(article?.author, "Alice");
    assert.match(article?.contentText ?? "", /投递邮箱/);

    assert.equal(
      parseMaimaiArticlePage("<html><body>请登录后查看，安全验证</body></html>", "https://maimai.cn/article/detail?fid=blocked"),
      null,
    );
  });

  it("classifies only articles with positive hiring or referral signals", () => {
    const hiring: MaimaiArticle = {
      articleId: "job-1",
      title: "内推 Go 平台工程师",
      url: "https://maimai.cn/article/detail?fid=job-1",
      author: "Alice",
      contentHtml: "",
      contentText: "社招 HC，base 北京，薪资 30-50K，简历投递 jobs@example.com。",
    };
    const hiringResult = classifyMaimaiArticle(hiring, ["Go"]);
    assert.equal(hiringResult.isJobPosting, true);
    assert.ok(hiringResult.strongMatches.includes("内推"));

    const discussion: MaimaiArticle = {
      ...hiring,
      articleId: "discussion-1",
      title: "Go 学习路线求建议",
      url: "https://maimai.cn/article/detail?fid=discussion-1",
      contentText: "最近想学习 Go 和 Kubernetes，不知道怎么入门。",
    };
    const discussionResult = classifyMaimaiArticle(discussion, ["Go", "Kubernetes"]);
    assert.equal(discussionResult.isJobPosting, false);
    assert.equal(discussionResult.hasHiringSignal, false);
    assert.ok(discussionResult.keywordMatches.includes("Go"));

    const interviewTool: MaimaiArticle = {
      ...hiring,
      articleId: "tool-1",
      title: "AI 模拟面试产品介绍",
      url: "https://maimai.cn/article/detail?fid=tool-1",
      contentText: "根据简历和岗位生成面试题，支持面试报告和求职训练，欢迎注册体验。",
    };
    assert.equal(classifyMaimaiArticle(interviewTool, ["AI"]).isJobPosting, false);
  });

  it("builds normalized payload using the maimai article contract", () => {
    const article = {
      articleId: "job-1",
      title: "招聘 Go 平台工程师",
      url: "https://maimai.cn/article/detail?fid=job-1",
      author: "Alice",
      published: "2026-07-01T02:00:00.000Z",
      contentHtml: "",
      contentText: "急招 Go 后端，投递邮箱 jobs@example.com。",
      detailStatus: "ok",
    } as const;
    const classification = classifyMaimaiArticle(article, ["Go"]);

    const payload = buildMaimaiNormalizedPayload(article, classification, "Go", { feed_urls: [article.url] });

    assert.equal(payload.encrypt_job_id, "maimai:article:job-1");
    assert.equal(payload.source_platform, "maimai");
    assert.equal(payload.source_url, article.url);
    assert.equal(payload.dedup_key, "article:job-1");
    assert.match(payload.jd_text ?? "", /缺失字段说明/);
    assert.equal(payload.raw_payload.detail_status, "ok");
  });

  it("logs and skips empty URL input without emitting fake jobs", async () => {
    const events: EventOut[] = [];
    await runMaimaiMode(
      { task: { keywords: ["Go"], filters: { feed_urls: [] }, limits: {}, source_platform: "maimai" } },
      { signal: new AbortController().signal, emit: (event) => events.push(event) },
    );

    assert.ok(events.some((event) => event.type === "LOG" && /未提供任何公开文章/.test(event.payload.message)));
    assert.equal(events.some((event) => event.type === "JOB_NORMALIZED_CAPTURED"), false);
  });
});
