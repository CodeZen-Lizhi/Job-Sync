import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import {
  classifyV2exJobEntry,
  fetchV2exFeedXml,
  htmlToText,
  parseV2exAtomFeed,
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

  it("classifies clear hiring posts and blocks discussion or excluded terms", () => {
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

    const discussion: V2exFeedEntry = {
      ...hiring,
      title: "面试不出结果是不是挂了",
      topicId: "456789",
      contentText: "想请教大家最近面试流程是不是变慢了",
    };
    const discussionResult = classifyV2exJobEntry(discussion, ["Go"], []);
    assert.equal(discussionResult.isJobPosting, false);
    assert.ok(discussionResult.blocked.some((term) => term === "面试"));

    const excludedResult = classifyV2exJobEntry(hiring, ["Go"], ["远程"]);
    assert.equal(excludedResult.isJobPosting, false);
    assert.ok(excludedResult.blocked.some((term) => term === "远程"));
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
});
