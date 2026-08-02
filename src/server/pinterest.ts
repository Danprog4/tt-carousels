import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import type { PinterestImage } from "../shared/types.js";

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";

export function normalizePinterestQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function backgroundPage<T>(endpoint: string, run: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome открыт, но CDP-контекст не найден");
  const cdp = await browser.newBrowserCDPSession();
  const created = context.waitForEvent("page", { timeout: 15_000 });
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", background: true, focus: false });
  const page = await created;
  try {
    return await run(page);
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }
}

async function visiblePins(page: Page, query: string): Promise<PinterestImage[]> {
  const raw = await page.locator('a[href*="/pin/"] img[src*="pinimg.com"]').evaluateAll((images) => images.map((node) => {
    const image = node as HTMLImageElement;
    const anchor = image.closest('a[href*="/pin/"]') as HTMLAnchorElement | null;
    const candidates = (image.getAttribute("srcset") || "")
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter((entry) => entry.startsWith("https://i.pinimg.com/"));
    const source = image.currentSrc || image.src || candidates[0] || "";
    const preview = candidates.find((entry) => entry.includes("/736x/")) || candidates.at(-1) || source;
    const original = candidates.find((entry) => entry.includes("/originals/")) || source.replace(/\/(236x|474x|736x)\//, "/originals/");
    return {
      pinUrl: anchor?.href || "",
      imageUrl: original,
      previewUrl: preview,
      alt: image.alt || "",
      width: image.naturalWidth || null,
      height: image.naturalHeight || null,
    };
  }));
  return raw
    .filter((item) => item.pinUrl && item.imageUrl.startsWith("https://i.pinimg.com/"))
    .map((item) => ({
      id: createHash("sha1").update(`${item.pinUrl}|${item.imageUrl}`).digest("hex").slice(0, 18),
      query,
      ...item,
    }));
}

export async function searchPinterest(input: {
  query: string;
  limit?: number;
  endpoint?: string;
}): Promise<PinterestImage[]> {
  const query = normalizePinterestQuery(input.query);
  if (query.length < 2) throw new Error("Pinterest query слишком короткий");
  const limit = Math.min(40, Math.max(5, input.limit || 20));
  const endpoint = input.endpoint || process.env.CHROME_CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT;

  return backgroundPage(endpoint, async (page) => {
    await page.goto(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2_800);
    const collected = new Map<string, PinterestImage>();
    const rounds = Math.min(16, Math.max(4, Math.ceil(limit / 5) + 2));
    for (let round = 0; round < rounds && collected.size < limit; round += 1) {
      for (const item of await visiblePins(page, query)) collected.set(item.imageUrl, item);
      if (collected.size >= limit) break;
      await page.mouse.wheel(0, 1_500);
      await page.waitForTimeout(650);
    }
    if (!collected.size) {
      const loginRequired = await page.getByText(/log in|sign up/i).count();
      if (loginRequired) throw new Error("Pinterest требует входа в исследовательском Chrome");
      throw new Error("Pinterest не вернул изображения для этого запроса");
    }
    return [...collected.values()]
      .sort((left, right) => {
        const leftPortrait = (left.height || 0) > (left.width || 0) ? 1 : 0;
        const rightPortrait = (right.height || 0) > (right.width || 0) ? 1 : 0;
        return rightPortrait - leftPortrait;
      })
      .slice(0, limit);
  });
}
