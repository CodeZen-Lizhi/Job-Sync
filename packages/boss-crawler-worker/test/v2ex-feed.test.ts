import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import {
  classifyV2exJobEntry,
  fetchV2exFeedXml,
  htmlToText,
  parseV2exAtomFeed,
  parseV2exJobsPage,
  parseV2exTopicDetailPage,
  prepareV2exFeedEntries,
  runV2exFeedMode,
  type V2exFeedEntry,
} from "../src/v2ex/feed.js";

async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

describe("V2EX feed collector", () => {
  it("parses Atom entries into stable topic keyed jobs", () => {
    const xml = `
      <feed>
        <entry>
          <id>https://www.v2ex.com/t/123456</id>
          <title>【远程】招聘 Go 平台工程师</title>
          <link href="https://www.v2ex.com/t/123456#reply1" rel="alternate" />
          <published>2026-06-15T00:00:00Z</published>
          <updated>2026-06-15T01:00:00Z</updated>
          <author><name>alice</name></author>
          <content type="html"><![CDATA[<p>负责 Kubernetes 平台建设<br/>邮箱 jobs@example.com</p>]]></content>
        </entry>
      </feed>
    `;

    const entries = parseV2exAtomFeed(xml);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.topicId, "123456");
    assert.equal(entries[0]?.url, "https://www.v2ex.com/t/123456");
    assert.equal(entries[0]?.author, "alice");
    assert.match(entries[0]?.contentText ?? "", /Kubernetes 平台建设/);
  });

  it("converts feed html content to readable text", () => {
    assert.equal(
      htmlToText("<p>招聘 Go 后端</p><p>远程 / 全职&nbsp;可投递</p>"),
      "招聘 Go 后端\n远程 / 全职 可投递",
    );
  });

  it("parses V2EX jobs list and topic detail pages", () => {
    const listHtml = `
      <div id="TopicsNode">
        <span class="item_title"><a href="/t/123456#reply2" class="topic-link" id="topic-link-123456">招聘 Go 后端工程师</a></span>
        <span class="topic_info"><strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp; <span title="2026-06-17 12:00:00 +08:00">2 days ago</span></span>
      </div>
    `;
    const entries = parseV2exJobsPage(listHtml);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.topicId, "123456");
    assert.equal(entries[0]?.url, "https://www.v2ex.com/t/123456");
    assert.equal(entries[0]?.author, "alice");
    assert.equal(entries[0]?.published, "2026-06-17T12:00:00 +08:00");

    const detail = parseV2exTopicDetailPage(`
      <small><span title="2026-06-17 12:00:00 +08:00">2 days ago</span></small>
      <div class="topic_content"><div class="markdown_body"><p>远程，全职，投递邮箱 jobs@example.com</p></div></div>
      <div class="reply_content">回复不应进入正文</div>
    `);
    assert.equal(detail.published, "2026-06-17T12:00:00 +08:00");
    assert.match(detail.contentText, /投递邮箱/);
    assert.doesNotMatch(detail.contentText, /回复不应进入正文/);
  });

  it("uses V2EX structured datePublished as published time", () => {
    const listHtml = `
      <script type="application/ld+json">
        ${JSON.stringify({
          mainEntity: {
            itemListElement: [
              {
                url: "https://www.v2ex.com/t/123456",
                item: {
                  "@type": "DiscussionForumPosting",
                  url: "https://www.v2ex.com/t/123456",
                  headline: "招聘 Go 后端工程师",
                  datePublished: "2026-06-10T08:00:00Z",
                  author: { name: "alice" },
                },
              },
            ],
          },
        })}
      </script>
      <div id="TopicsNode">
        <span class="item_title"><a href="/t/123456#reply2" class="topic-link" id="topic-link-123456">招聘 Go 后端工程师</a></span>
        <span class="topic_info"><strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp; <span title="2026-06-17 12:00:00 +08:00">recent reply</span></span>
      </div>
    `;

    const entries = parseV2exJobsPage(listHtml);

    assert.equal(entries[0]?.published, "2026-06-10T08:00:00Z");
    assert.equal(entries[0]?.updated, "2026-06-17T12:00:00 +08:00");

    const detail = parseV2exTopicDetailPage(`
      <script type="application/ld+json">
        ${JSON.stringify({
          "@type": "DiscussionForumPosting",
          url: "https://www.v2ex.com/t/123456",
          headline: "招聘 Go 后端工程师",
          datePublished: "2026-06-10T08:00:00Z",
        })}
      </script>
      <small><span title="2026-06-17 12:00:00 +08:00">recent reply</span></small>
      <div class="topic_content"><div class="markdown_body"><p>远程，全职，投递邮箱 jobs@example.com</p></div></div>
    `);
    assert.equal(detail.published, "2026-06-10T08:00:00Z");
  });

  it("sorts and filters entries by selected feed time", () => {
    const oldBumped: V2exFeedEntry = {
      title: "招聘 Go 后端工程师",
      url: "https://www.v2ex.com/t/100001",
      topicId: "100001",
      published: "2026-06-01T00:00:00Z",
      updated: "2026-06-17T12:00:00Z",
      contentHtml: "",
      contentText: "远程，全职，投递邮箱 jobs@example.com",
    };
    const fresh: V2exFeedEntry = {
      title: "招聘 SRE 平台工程师",
      url: "https://www.v2ex.com/t/100002",
      topicId: "100002",
      published: "2026-06-17T08:00:00Z",
      updated: "2026-06-17T08:30:00Z",
      contentHtml: "",
      contentText: "Kubernetes 平台建设，投递邮箱 sre@example.com",
    };
    const stale: V2exFeedEntry = {
      title: "招聘前端工程师",
      url: "https://www.v2ex.com/t/100003",
      topicId: "100003",
      published: "2026-06-14T00:00:00Z",
      updated: "2026-06-14T01:00:00Z",
      contentHtml: "",
      contentText: "全职，投递邮箱 web@example.com",
    };
    const nowMs = Date.parse("2026-06-18T00:00:00Z");

    const byPublished = prepareV2exFeedEntries([oldBumped, fresh, stale], {
      sortBy: "published_desc",
      recentDays: 2,
      nowMs,
    });
    assert.deepEqual(byPublished.map((entry) => entry.topicId), ["100002"]);

    const byUpdated = prepareV2exFeedEntries([oldBumped, fresh, stale], {
      sortBy: "updated_desc",
      recentDays: 2,
      nowMs,
    });
    assert.deepEqual(byUpdated.map((entry) => entry.topicId), ["100001", "100002"]);
  });

  it("classifies clear hiring posts from positive hiring signals only", () => {
    const hiring: V2exFeedEntry = {
      title: "招聘 Go 后端工程师",
      url: "https://www.v2ex.com/t/123456",
      topicId: "123456",
      author: "alice",
      contentHtml: "<p>远程，全职，薪资 30-50K，投递邮箱 jobs@example.com</p>",
      contentText: "远程，全职，薪资 30-50K，投递邮箱 jobs@example.com",
    };
    const hiringResult = classifyV2exJobEntry(hiring, ["Go"], []);
    assert.equal(hiringResult.isJobPosting, true);
    assert.ok(hiringResult.matched.length > 0);

    const noHiringSignal: V2exFeedEntry = {
      ...hiring,
      title: "面试不出结果是不是挂了",
      topicId: "456789",
      contentText: "想请教大家最近面试流程是不是变慢了",
    };
    const noHiringSignalResult = classifyV2exJobEntry(noHiringSignal, ["Go"], []);
    assert.equal(noHiringSignalResult.isJobPosting, false);
    assert.equal(noHiringSignalResult.hasHiringSignal, false);

    const excludedResult = classifyV2exJobEntry(hiring, ["Go"], ["远程"]);
    assert.equal(excludedResult.isJobPosting, true);
  });

  it("does not treat isolated weak hiring words or search keywords as job posts", () => {
    const salaryDiscussion: V2exFeedEntry = {
      title: "公司要降薪了，要不要拿赔偿走人？",
      url: "https://www.v2ex.com/t/1220440",
      topicId: "1220440",
      author: "bob",
      contentHtml: "",
      contentText: "岗位工资和绩效比例变了，想听听大家建议",
    };
    const salaryResult = classifyV2exJobEntry(salaryDiscussion, [], []);
    assert.equal(salaryResult.isJobPosting, false);
    assert.equal(salaryResult.hasHiringSignal, false);

    const keywordDiscussion: V2exFeedEntry = {
      ...salaryDiscussion,
      title: "Go 学习路线求助",
      topicId: "1220441",
      contentText: "Go 后端还有必要学吗",
    };
    const keywordResult = classifyV2exJobEntry(keywordDiscussion, ["Go"], []);
    assert.equal(keywordResult.isJobPosting, false);
    assert.equal(keywordResult.hasHiringSignal, false);
  });

  it("rejects AI interview tools and project introductions without a real hiring action", () => {
    const interviewTool: V2exFeedEntry = {
      title: "搞了一个 AI 模拟面试，提升自己找工作面试能力，根据简历自动追问和生成面试报告",
      url: "https://www.v2ex.com/t/1225603",
      topicId: "1225603",
      author: "builder",
      contentHtml: "",
      contentText: "产品网址：https://example.com。后续大概率会开源，欢迎体验。支持根据简历和岗位生成面试题，面试结束后生成报告。反馈邮箱 hi@example.com，微信 demo-tool。",
    };

    const result = classifyV2exJobEntry(interviewTool, ["AI"], []);

    assert.equal(result.isJobPosting, false);
    assert.equal(result.hasHiringSignal, false);
  });

  it("rejects personal introductions and project cooperation posts without employment hiring", () => {
    const cooperationPost: V2exFeedEntry = {
      title: "新人自我介绍，寻项目合作 | Linux 资深软件工程师 | AI agent",
      url: "https://www.v2ex.com/t/1223803",
      topicId: "1223803",
      author: "developer",
      contentHtml: "",
      contentText: "熟悉 Linux、Go、AI Agent 和 CI/CD，希望寻找项目合作或兼职合作，可联系微信沟通。",
    };

    const result = classifyV2exJobEntry(cooperationPost, ["Go", "AI Agent"], []);

    assert.equal(result.isJobPosting, false);
    assert.equal(result.hasHiringSignal, false);
    assert.ok(result.nonHiringMatches.some((item) => item === "自我介绍" || item === "寻项目合作"));
  });

  it("rejects negated hiring statements even though the text contains the word hiring", () => {
    const nonHiring: V2exFeedEntry = {
      title: "不是招聘，只是分享一个求职工具",
      url: "https://www.v2ex.com/t/1225604",
      topicId: "1225604",
      author: "builder",
      contentHtml: "",
      contentText: "不招人，产品问题可以发邮箱 hi@example.com 或加微信交流。",
    };

    assert.equal(classifyV2exJobEntry(nonHiring, ["AI"], []).isJobPosting, false);
  });

  it("does not block clear hiring posts only because they mention a boss", () => {
    const hiringWithBoss: V2exFeedEntry = {
      title: "招聘 Go 后端工程师",
      url: "https://www.v2ex.com/t/1220442",
      topicId: "1220442",
      author: "alice",
      contentHtml: "",
      contentText: "远程全职，老板技术背景，投递邮箱 jobs@example.com",
    };
    const result = classifyV2exJobEntry(hiringWithBoss, ["Go"], []);
    assert.equal(result.isJobPosting, true);
    assert.equal(result.hasHiringSignal, true);
  });

  it("supports multiple feed urls and skips empty input", async () => {
    const atomXml = `
      <feed>
        <entry>
          <id>https://www.v2ex.com/t/200001</id>
          <title>招聘 Go 后端工程师</title>
          <link href="https://www.v2ex.com/t/200001" rel="alternate" />
          <author><name>alice</name></author>
          <content type="html"><![CDATA[<p>远程，全职，投递邮箱 jobs@example.com</p>]]></content>
        </entry>
      </feed>
    `;
    const jsonFeed = JSON.stringify({
      items: [
        {
          id: "https://www.v2ex.com/t/200002",
          title: "招聘 SRE 平台工程师",
          url: "https://www.v2ex.com/t/200002",
          content_html: "<p>远程，全职，投递邮箱 sre@example.com</p>",
          date_published: "2026-06-18T00:00:00Z",
          author: { name: "bob" },
        },
      ],
    });
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/feed.xml") {
        res.writeHead(200, { "content-type": "application/atom+xml;charset=UTF-8" });
        res.end(atomXml);
        return;
      }
      if (requestUrl.pathname === "/feed.json") {
        res.writeHead(200, { "content-type": "application/feed+json;charset=UTF-8" });
        res.end(jsonFeed);
        return;
      }
      if (requestUrl.pathname.startsWith("/t/")) {
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        res.end(`<div class="topic_content"><div class="markdown_body"><p>远程，全职，投递邮箱 jobs@example.com</p></div></div>`);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const events: any[] = [];
    const port = await listen(server);
    try {
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: { feed_urls: `http://127.0.0.1:${port}/feed.xml，\n http://127.0.0.1:${port}/feed.json、http://127.0.0.1:${port}/feed.xml` },
            limits: { maxEntries: 10, maxPages: 1 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
        },
      );

      const duplicateEvents: any[] = [];
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: { feed_urls: [`http://127.0.0.1:${port}/feed.xml`, `http://127.0.0.1:${port}/feed.xml`] },
            limits: { maxEntries: 10 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => duplicateEvents.push(event),
        },
      );
      assert.equal(duplicateEvents.filter((event) => event.type === "JOB_NORMALIZED_CAPTURED").length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    assert.equal(events.filter((event) => event.type === "JOB_NORMALIZED_CAPTURED").length, 2);
    assert.ok(events.some((event) => event.type === "LOG" && /多源解析完成/.test(event.payload.message)));

    const emptyEvents: any[] = [];
    await runV2exFeedMode(
      {
        task: {
          keywords: ["Go"],
          filters: { feed_urls: "" },
          limits: {},
        },
      },
      {
        signal: new AbortController().signal,
        emit: (event) => emptyEvents.push(event),
      },
    );
    assert.equal(emptyEvents.some((event) => event.type === "JOB_NORMALIZED_CAPTURED"), false);
    assert.ok(emptyEvents.some((event) => event.type === "LOG" && /未提供任何 URL/.test(event.payload.message)));
  });

  it("fetches feed through proxy environment variables", async () => {
    const xml = `<feed><entry><id>https://www.v2ex.com/t/123456</id><title>招聘 Go</title></entry></feed>`;
    const seenProxyTargets: string[] = [];
    const proxyServer = http.createServer((req, res) => {
      seenProxyTargets.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/atom+xml;charset=UTF-8" });
      res.end(xml);
    });

    const port = await listen(proxyServer);
    try {
      const result = await withEnv(
        {
          HTTP_PROXY: `http://127.0.0.1:${port}`,
          http_proxy: undefined,
          HTTPS_PROXY: undefined,
          https_proxy: undefined,
          ALL_PROXY: undefined,
          all_proxy: undefined,
          NO_PROXY: undefined,
          no_proxy: undefined,
        },
        async () => fetchV2exFeedXml("http://example.invalid/feed.xml", new AbortController().signal),
      );

      assert.equal(result.status, 200);
      assert.equal(result.body, xml);
      assert.deepEqual(seenProxyTargets, ["http://example.invalid/feed.xml"]);
    } finally {
      await new Promise<void>((resolve, reject) => proxyServer.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("retries feed requests and reports the failing page label", async () => {
    const seen: number[] = [];
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      seen.push(Number(requestUrl.searchParams.get("p") ?? "0"));
      if (seen.length < 3) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
      res.end(`
        <div id="TopicsNode">
          <span class="item_title"><a href="/t/123456#reply1" class="topic-link" id="topic-link-123456">招聘 Go 后端工程师</a></span>
          <span class="topic_info"><strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp; <span title="2026-06-17 12:00:00 +08:00">recent reply</span></span>
        </div>
        <div class="topic_content"><div class="markdown_body"><p>远程，全职，投递邮箱 jobs@example.com</p></div></div>
      `);
    });
    const port = await listen(server);
    const events: any[] = [];

    try {
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: { feed_url: `http://127.0.0.1:${port}/go/jobs` },
            limits: { maxPages: 1, maxEntries: 1, delayMs: 0 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    assert.ok(seen.length >= 3);
    assert.ok(events.some((event) => event.type === "LOG" && /V2EX 第 1 页请求失败，准备重试第 1 次/.test(event.payload.message)));
    assert.equal(events.some((event) => event.type === "ERROR"), false);
    assert.ok(events.some((event) => event.type === "JOB_NORMALIZED_CAPTURED"));
  });

  it("emits explicit skip reasons for feed entries that are not collected", async () => {
    const xml = `
      <feed>
        <entry>
          <id>https://www.v2ex.com/t/123456</id>
          <title>招聘 Go 后端工程师</title>
          <link href="https://www.v2ex.com/t/123456" rel="alternate" />
          <author><name>alice</name></author>
          <content type="html"><![CDATA[<p>远程，全职，薪资 30-50K，投递邮箱 jobs@example.com</p>]]></content>
        </entry>
        <entry>
          <id>https://www.v2ex.com/t/456789</id>
          <title>面试不出结果是不是挂了</title>
          <link href="https://www.v2ex.com/t/456789" rel="alternate" />
          <author><name>bob</name></author>
          <content type="html"><![CDATA[<p>想请教大家最近面试流程是不是变慢了</p>]]></content>
        </entry>
      </feed>
    `;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/atom+xml;charset=UTF-8" });
      res.end(xml);
    });
    const events: any[] = [];
    const port = await listen(server);
    try {
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: { feed_url: `http://127.0.0.1:${port}/feed.xml` },
            limits: { maxEntries: 2, maxJobs: 10 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    assert.equal(events.filter((event) => event.type === "JOB_NORMALIZED_CAPTURED").length, 1);
    const skipped = events.find((event) => event.type === "JOB_FILTERED");
    assert.ok(skipped);
    assert.equal(skipped.payload.encrypt_job_id, "v2ex:456789");
    assert.match(skipped.payload.reason.blocked_by[0].reason, /缺少招聘信号词/);
    assert.ok(events.some((event) => event.type === "LOG" && /跳过 V2EX.*缺少招聘信号词/.test(event.payload.message)));
  });

  it("sorts by published time across pages before recent-day and entry limits", async () => {
    const nowMs = Date.now();
    const freshPublished = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const oldPublished = new Date(nowMs - 10 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const recentActivity = new Date(nowMs - 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const pageHtml = (topicId: string, title: string, published: string) => `
      <script type="application/ld+json">
        ${JSON.stringify({
          mainEntity: {
            itemListElement: [
              {
                url: `https://www.v2ex.com/t/${topicId}`,
                item: {
                  "@type": "DiscussionForumPosting",
                  url: `https://www.v2ex.com/t/${topicId}`,
                  headline: title,
                  datePublished: published,
                  author: { name: "alice" },
                },
              },
            ],
          },
        })}
      </script>
      <div id="TopicsNode">
        <span class="item_title"><a href="/t/${topicId}#reply1" class="topic-link" id="topic-link-${topicId}">${title}</a></span>
        <span class="topic_info"><strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp; <span title="${recentActivity}">recent reply</span></span>
      </div>
    `;
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/go/jobs") {
        const page = Number(requestUrl.searchParams.get("p") ?? "1");
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        if (page === 1) {
          res.end(pageHtml("300001", "招聘 Go 后端工程师 旧帖被顶起", oldPublished));
          return;
        }
        if (page === 2) {
          res.end(pageHtml("300002", "招聘 Go 平台工程师 新帖", freshPublished));
          return;
        }
        res.end(`<div id="TopicsNode"></div>`);
        return;
      }
      const topicId = requestUrl.pathname.match(/^\/t\/(\d+)/)?.[1];
      if (topicId) {
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        res.end(`
          <div class="topic_content"><div class="markdown_body"><p>远程，全职，薪资 30-50K，投递邮箱 jobs@example.com</p></div></div>
        `);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const events: any[] = [];
    const port = await listen(server);
    try {
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: {
              feed_url: `http://127.0.0.1:${port}/go/jobs`,
              sort_by: "published_desc",
              recent_days: 3,
            },
            limits: { maxPages: 2, maxEntries: 1 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    const captured = events.filter((event) => event.type === "JOB_NORMALIZED_CAPTURED");
    assert.deepEqual(captured.map((event) => event.payload.encrypt_job_id), ["v2ex:300002"]);
    assert.ok(events.some((event) => event.type === "LOG" && /源 2 条，候选 1 条，排序 发布时间倒序，最近 3 天/.test(event.payload.message)));
  });

  it("collects V2EX jobs across paged list pages instead of stopping at the 50-entry feed", async () => {
    const topicIds = Array.from({ length: 60 }, (_, index) => String(200000 + index));
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/go/jobs") {
        const page = Number(requestUrl.searchParams.get("p") ?? "1");
        const pageIds = topicIds.slice((page - 1) * 20, page * 20);
        const html = pageIds.map((id, index) => `
          <span class="item_title"><a href="/t/${id}#reply1" class="topic-link" id="topic-link-${id}">招聘 Go 后端工程师 ${id}</a></span>
          <span class="topic_info"><strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp; <span title="2026-06-${String(18 - index).padStart(2, "0")} 12:00:00 +08:00">recent</span></span>
        `).join("\n");
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        res.end(`<html><body><div id="TopicsNode">${html}</div></body></html>`);
        return;
      }
      const topicId = requestUrl.pathname.match(/^\/t\/(\d+)/)?.[1];
      if (topicId) {
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        res.end(`
          <small><span title="2026-06-18 12:00:00 +08:00">recent</span></small>
          <div class="topic_content"><div class="markdown_body"><p>远程，全职，薪资 30-50K，投递邮箱 jobs@example.com</p></div></div>
        `);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const events: any[] = [];
    const port = await listen(server);
    try {
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: { feed_url: `http://127.0.0.1:${port}/go/jobs` },
            limits: { maxPages: 3 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    assert.equal(events.filter((event) => event.type === "JOB_NORMALIZED_CAPTURED").length, 60);
    assert.ok(events.some((event) => event.type === "LOG" && /网页分页请求完成：3 页，源 60 条/.test(event.payload.message)));
    assert.ok(events.some((event) => event.type === "LOG" && /采集候选 60 条/.test(event.payload.message)));
  });

  it("emits captured jobs as soon as each V2EX detail is ready", async () => {
    const seenPageRequests: number[] = [];
    const seenDetailRequests: string[] = [];
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/go/jobs") {
        const page = Number(requestUrl.searchParams.get("p") ?? "1");
        seenPageRequests.push(page);
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        res.end(`
          <div id="TopicsNode">
            <span class="item_title"><a href="/t/${300000 + page}#reply1" class="topic-link" id="topic-link-${300000 + page}">招聘 Go 后端工程师 ${page}</a></span>
            <span class="topic_info"><strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp; <span title="2026-06-18 12:00:00 +08:00">recent</span></span>
          </div>
        `);
        return;
      }
      const topicId = requestUrl.pathname.match(/^\/t\/(\d+)/)?.[1];
      if (topicId) {
        seenDetailRequests.push(topicId);
        res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
        res.end(`
          <small><span title="2026-06-18 12:00:00 +08:00">recent</span></small>
          <div class="topic_content"><div class="markdown_body"><p>远程，全职，投递邮箱 jobs@example.com</p></div></div>
        `);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const events: any[] = [];
    const port = await listen(server);
    try {
      await runV2exFeedMode(
        {
          task: {
            keywords: ["Go"],
            filters: { feed_url: `http://127.0.0.1:${port}/go/jobs`, sort_by: "published_desc" },
            limits: { maxPages: 2, delayMs: 0 },
          },
        },
        {
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    assert.deepEqual(seenPageRequests, [1, 2]);
    assert.ok(seenDetailRequests.length >= 1);
    assert.ok(events.some((event) => event.type === "JOB_NORMALIZED_CAPTURED"));
  });

});
