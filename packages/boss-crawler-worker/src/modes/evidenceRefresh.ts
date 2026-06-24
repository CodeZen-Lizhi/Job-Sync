import type { z } from "zod";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import { URLS } from "../boss/selectors.js";
import type { RefreshJobEvidencePayloadSchema } from "../protocol.js";
import {
  buildJobDetailBody,
  buildJobDetailUrl,
  closeBrowserRespectingHumanVerification,
  createHumanVerificationTracker,
  fetchJsonFromPage,
  readApiCode,
  readApiMessage,
  requestBossJsonWithRiskRecovery,
  safeError,
  setLocalStorage,
  waitUntilBossLoginReady,
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
  baseCtx: ModeContext,
): Promise<void> {
  const verificationTracker = createHumanVerificationTracker(baseCtx);
  const ctx = verificationTracker.ctx;
  const { browser, page } = await launchBrowser({
    headless: false,
    user_data_dir: payload.user_data_dir,
    stealth: false,
    preserve_on_disconnect: true,
  });
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

    await page.goto(URLS.USER, { waitUntil: "domcontentloaded" });
    if (!await waitUntilBossLoginReady(page, ctx, "Boss 登录态已就绪，开始补充岗位证据。")) return;

    await page.goto(URLS.GEEK_JOBS, { waitUntil: "domcontentloaded" });
    await waitUntilNoRiskUrl(page, ctx);
    if (ctx.signal.aborted) return;

    const lid = pickLid(payload);
    const detailUrl = buildJobDetailUrl(payload.encrypt_job_id, lid);
    const detailBody = buildJobDetailBody(payload.encrypt_job_id, lid);
    let detailRaw: any | null = null;

    const detailResGet = await requestBossJsonWithRiskRecovery(page, ctx, "job/detail", () =>
      fetchJsonFromPage(page, detailUrl, { method: "GET", timeoutMs: 60_000 }),
    );
    if (!detailResGet) return;
    if (detailResGet.json && typeof detailResGet.json === "object" && readApiCode(detailResGet.json) === 0) {
      detailRaw = detailResGet.json;
    } else {
      const detailResPost = await requestBossJsonWithRiskRecovery(page, ctx, "job/detail", () =>
        fetchJsonFromPage(page, detailUrl, {
          method: "POST",
          body: detailBody,
          timeoutMs: 60_000,
        }),
      );
      if (!detailResPost) return;
      detailRaw = detailResPost.json;
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
    await closeBrowserRespectingHumanVerification(browser, ctx, verificationTracker, "Boss 证据补充");
    ctx.emit({ type: "FINISHED" });
  }
}
