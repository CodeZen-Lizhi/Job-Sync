import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import {
  classifyV2exJobEntry,
  fetchV2exFeedXml,
  htmlToText,
  parseV2exAtomFeed,
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
});
