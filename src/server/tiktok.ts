import { chromium, type Page } from "playwright-core";
import type { CarouselMetrics, CarouselPost } from "../shared/types.js";

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
type Obj = Record<string, any>;

const objectOf = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const arrayOf = (value: unknown): any[] => Array.isArray(value) ? value : [];
const numberOf = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined;
};
const isoDate = (value: unknown): string | undefined => {
  const timestamp = numberOf(value);
  return timestamp === undefined ? undefined : new Date(timestamp * 1000).toISOString();
};
const firstUrl = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  return arrayOf(objectOf(value).urlList).find((candidate) => typeof candidate === "string");
};

function metricsFrom(item: Obj): CarouselMetrics {
  const stats = { ...objectOf(item.stats), ...objectOf(item.statsV2) };
  return Object.fromEntries(Object.entries({
    views: numberOf(stats.playCount),
    likes: numberOf(stats.diggCount),
    comments: numberOf(stats.commentCount),
    shares: numberOf(stats.shareCount),
    saves: numberOf(stats.collectCount),
    reposts: numberOf(stats.repostCount),
  }).filter(([, value]) => value !== undefined));
}

function normalizePost(item: Obj): CarouselPost | null {
  const images = arrayOf(objectOf(item.imagePost).images);
  const author = objectOf(item.author);
  if (!item.id || !author.uniqueId || item.privateItem || author.privateAccount || images.length === 0) return null;
  const slides = images.map((image, index) => {
    const imageObject = objectOf(image);
    return {
      index: index + 1,
      imageUrl: firstUrl(imageObject.imageURL) || firstUrl(imageObject.imageUrl) || "",
      ...(numberOf(imageObject.imageWidth) !== undefined ? { width: numberOf(imageObject.imageWidth) } : {}),
      ...(numberOf(imageObject.imageHeight) !== undefined ? { height: numberOf(imageObject.imageHeight) } : {}),
    };
  }).filter((slide) => Boolean(slide.imageUrl));
  if (!slides.length) return null;
  const username = String(author.uniqueId);
  return {
    id: String(item.id),
    url: `https://www.tiktok.com/@${encodeURIComponent(username)}/photo/${item.id}`,
    author: {
      username,
      ...(author.nickname ? { displayName: String(author.nickname) } : {}),
    },
    caption: String(item.desc || ""),
    ...(isoDate(item.createTime) ? { createdAt: isoDate(item.createTime) } : {}),
    slides,
    sound: Object.fromEntries(Object.entries({
      id: objectOf(item.music).id,
      title: objectOf(item.music).title,
      author: objectOf(item.music).authorName,
    }).filter(([, value]) => value !== undefined)),
    metrics: metricsFrom(item),
  };
}

const responseItems = (body: Obj): any[] => {
  if (arrayOf(body.item_list).length) return arrayOf(body.item_list);
  if (arrayOf(body.itemList).length) return arrayOf(body.itemList);
  return arrayOf(body.data).map((entry) => objectOf(entry).item);
};

async function backgroundPage<T>(endpoint: string, run: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome открыт, но CDP-контекст не найден");
  const cdp = await browser.newBrowserCDPSession();
  const created = context.waitForEvent("page", { timeout: 15_000 });
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
    background: true,
    focus: false,
  });
  const page = await created;
  try {
    return await run(page);
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }
}

async function captureSearchBodies(query: string, limit: number, endpoint: string): Promise<Obj[]> {
  return backgroundPage(endpoint, async (page) => {
    const bodies: Obj[] = [];
    const pending = new Set<Promise<void>>();
    page.on("response", (response) => {
      let pathname = "";
      try {
        pathname = new URL(response.url()).pathname;
      } catch {
        return;
      }
      if (pathname !== "/api/search/photo/full/") return;
      const task = response.json()
        .then((body) => void bodies.push(objectOf(body)))
        .catch(() => undefined)
        .finally(() => pending.delete(task));
      pending.add(task);
    });
    await page.goto(`https://www.tiktok.com/search/photo?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2_500);
    const rounds = Math.min(24, Math.max(2, Math.ceil(limit / 12) + 1));
    for (let index = 0; index < rounds; index += 1) {
      await page.mouse.wheel(0, 1_600);
      await page.waitForTimeout(750);
    }
    await Promise.allSettled([...pending]);
    return bodies;
  });
}

export async function checkChrome(endpoint = process.env.CHROME_CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT) {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = objectOf(await response.json());
    return {
      connected: true as const,
      endpoint,
      browser: String(data.Browser || "Chrome"),
    };
  } catch (error) {
    return {
      connected: false as const,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function searchTikTokQuery(input: {
  query: string;
  limit: number;
  endpoint?: string;
}): Promise<CarouselPost[]> {
  const endpoint = input.endpoint || process.env.CHROME_CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT;
  const bodies = await captureSearchBodies(input.query, input.limit, endpoint);
  const seen = new Set<string>();
  const posts = bodies
    .flatMap(responseItems)
    .map((item) => normalizePost(objectOf(item)))
    .filter((post): post is CarouselPost => Boolean(post))
    .filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  return posts.slice(0, input.limit);
}
