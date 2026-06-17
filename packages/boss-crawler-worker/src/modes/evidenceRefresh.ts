import type { z } from "zod";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import { URLS } from "../boss/selectors.js";
import type { RefreshJobEvidencePayloadSchema } from "../protocol.js";
import {
  buildJobDetailBody,
  buildJobDetailUrl,
  fetchJsonFromPage,
  isAbnormalAccess,
  readApiCode,
  readApiMessage,
  safeError,
  setLocalStorage,
  waitUntilApiOk,
  waitUntilNoRiskUrl,
} from "./auto/shared.js";
import type { ModeContext } from "./auto/types.js";

type RefreshJobEvidencePayload = z.infer<typeof RefreshJobEvidencePayloadSchema>;

function pickText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function pickLid(payload: RefreshJobEvidencePayload): string | undefined {
  const fromUrl = (() => {
    const sourceUrl = pickText(payload.source_url);
    if (!sourceUrl) return undefined;
    try {
      const parsed = new URL(sourceUrl);
      return pickText(parsed.searchParams.get("lid") ?? undefined);
    } catch {
      return undefined;
    }
  })();
  if (fromUrl) return fromUrl;

  const raw = payload.raw_payload;
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  return pickText(obj.lid) ?? pickText(obj.jobInfo && typeof obj.jobInfo === "object" ? (obj.jobInfo as Record<string, unknown>).lid : undefined);
}

export async function runRefreshJobEvidenceMode(
  payload: RefreshJobEvidencePayload,
  ctx: ModeContext,
): Promise<void> {
  const { browser, page } = await launchBrowser({ headless: false });
  try {
    await blockNavigation(page, { allow_domain_suffixes: ["zhipin.com"] });

    const cookies = payload.session.cookies;
    if (Array.isArray(cookies) && cookies.length > 0) {
      await page.setCookie(...(cookies as any[]));
    }

    await page.goto(URLS.DESKTOP, { waitUntil: "domcontentloaded" });
    const localStorage = payload.session.local_storage;
    if (localStorage && typeof localStorage === "object") {
      await setLocalStorage(page, localStorage as Record<string, string>);
    }

    await page.goto(URLS.GEEK_JOBS, { waitUntil: "domcontentloaded" });
    await waitUntilNoRiskUrl(page, ctx);
    if (ctx.signal.aborted) return;

    const lid = pickLid(payload);
    const detailUrl = buildJobDetailUrl(payload.encrypt_job_id, lid);
    const detailBody = buildJobDetailBody(payload.encrypt_job_id, lid);
    let detailRaw: any | null = null;

    const detailResGet = await fetchJsonFromPage(page, detailUrl, { method: "GET", timeoutMs: 60_000 });
    if (detailResGet.json && typeof detailResGet.json === "object" && readApiCode(detailResGet.json) === 0) {
      detailRaw = detailResGet.json;
    } else {
      const detailResPost = await fetchJsonFromPage(page, detailUrl, {
        method: "POST",
        body: detailBody,
        timeoutMs: 60_000,
      });
      detailRaw = detailResPost.json;
      if (detailRaw && typeof detailRaw === "object" && readApiCode(detailRaw) !== 0 && isAbnormalAccess(detailRaw)) {
        const msg = readApiMessage(detailRaw);
        ctx.emit({
          type: "LOGIN_STATUS",
          payload: {
            status: "captcha",
            message: `job/detail 接口返回访问异常：${msg || "code=37"}。请在浏览器窗口完成人机验证后自动重试。`,
          },
        });
        const recovered = await waitUntilApiOk(page, ctx, "job/detail", () =>
          fetchJsonFromPage(page, detailUrl, { method: "POST", body: detailBody, timeoutMs: 60_000 }),
        );
        if (!recovered) return;
        detailRaw = recovered.json;
      }
    }

    if (!detailRaw || typeof detailRaw !== "object") {
      ctx.emit({
        type: "ERROR",
        payload: { message: "job/detail 接口未返回有效 JSON，无法补充岗位证据。" },
      });
      return;
    }

    if (readApiCode(detailRaw) !== 0) {
      ctx.emit({
        type: "ERROR",
        payload: {
          message: `job/detail 接口返回异常：code=${String(readApiCode(detailRaw))} message=${readApiMessage(detailRaw)}`,
        },
      });
      return;
    }

    ctx.emit({
      type: "JOB_DETAIL_CAPTURED",
      payload: { encrypt_job_id: payload.encrypt_job_id, zp_data: detailRaw?.zpData ?? detailRaw },
    });
  } catch (err) {
    ctx.emit({ type: "ERROR", payload: safeError(err) });
  } finally {
    await browser.close().catch(() => undefined);
    ctx.emit({ type: "FINISHED" });
  }
}
