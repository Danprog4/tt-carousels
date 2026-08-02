import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const CACHE_ROOT = resolve(process.cwd(), "data/cache/thumbs");
const SOURCE_ROOT = resolve(process.cwd(), "data/cache/sources");
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const allowedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return ["tiktokcdn", "byteimg", "ibytedtos", "muscdn", "pinimg.com"].some((part) => host.includes(part));
};

async function fetchAllowedImage(sourceUrl: string): Promise<Buffer> {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" || !allowedHost(parsed.hostname)) throw new Error("Этот media host не разрешён");
  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(25_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
      ...(parsed.hostname.endsWith("pinimg.com") ? { referer: "https://www.pinterest.com/" } : {}),
    },
  });
  if (!response.ok) throw new Error(`Image CDN вернул HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error("Изображение превышает лимит 20 MB");
  const source = Buffer.from(await response.arrayBuffer());
  if (source.byteLength > MAX_SOURCE_BYTES) throw new Error("Изображение превышает лимит 20 MB");
  return source;
}

export async function getCachedSourceImage(sourceUrl: string): Promise<Buffer> {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" || !allowedHost(parsed.hostname)) throw new Error("Этот media host не разрешён");
  mkdirSync(SOURCE_ROOT, { recursive: true });
  const hash = createHash("sha256").update(sourceUrl).digest("hex");
  const path = resolve(SOURCE_ROOT, `${hash}.image`);
  if (existsSync(path)) return readFile(path);
  const source = await fetchAllowedImage(sourceUrl);
  await writeFile(path, source);
  return source;
}

export async function getCachedThumbnail(sourceUrl: string): Promise<Buffer> {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" || !allowedHost(parsed.hostname)) {
    throw new Error("Этот media host не разрешён");
  }
  mkdirSync(CACHE_ROOT, { recursive: true });
  const hash = createHash("sha256").update(sourceUrl).digest("hex");
  const path = resolve(CACHE_ROOT, `${hash}.webp`);
  if (existsSync(path)) return readFile(path);
  const source = await fetchAllowedImage(sourceUrl);
  const thumbnail = await sharp(source)
    .rotate()
    .resize({ width: 640, height: 1_138, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 3 })
    .toBuffer();
  await writeFile(path, thumbnail);
  return thumbnail;
}
