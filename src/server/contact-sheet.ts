import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { SessionPost } from "../shared/types.js";
import type { PreparedVisualPost } from "./visual-contract.js";
import { getCachedThumbnail } from "./media-cache.js";

const SHEET_CACHE = resolve(process.cwd(), "data/cache/contact-sheets");
const TILE_WIDTH = 190;
const TILE_HEIGHT = 338;
const GAP = 10;
const COLUMNS = 4;

async function loadSlide(post: SessionPost, index: number): Promise<Buffer> {
  const slide = post.slides[index];
  if (!slide) throw new Error(`Слайд ${index + 1} не найден`);
  if (slide.imageUrl.startsWith("https://")) return getCachedThumbnail(slide.imageUrl);
  throw new Error(`Визуальный анализ пока не поддерживает источник ${slide.imageUrl.slice(0, 30)}`);
}

async function numberedTile(source: Buffer, index: number): Promise<Buffer> {
  const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT}">
    <rect x="8" y="8" width="38" height="30" rx="7" fill="rgba(18,28,23,.88)"/>
    <text x="27" y="29" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="white">${index}</text>
  </svg>`);
  return sharp(source)
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover", position: "center" })
    .composite([{ input: badge, top: 0, left: 0 }])
    .jpeg({ quality: 76, progressive: true })
    .toBuffer();
}

export async function prepareVisualPost(post: SessionPost): Promise<PreparedVisualPost> {
  if (!post.slides.length) throw new Error(`У @${post.author.username} нет доступных слайдов`);
  mkdirSync(SHEET_CACHE, { recursive: true });
  const fingerprint = createHash("sha256")
    .update(post.id)
    .update(post.slides.map((slide) => slide.imageUrl).join("|"))
    .digest("hex");
  const sheetPath = resolve(SHEET_CACHE, `${fingerprint}.jpg`);

  const coverSource = await loadSlide(post, 0);
  const cover = await sharp(coverSource)
    .resize({ width: 640, height: 1_138, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();

  let contactSheet: Buffer;
  if (existsSync(sheetPath)) {
    contactSheet = await readFile(sheetPath);
  } else {
    const tiles: Buffer[] = [];
    for (let index = 0; index < post.slides.length; index += 1) {
      tiles.push(await numberedTile(await loadSlide(post, index), index + 1));
    }
    const rows = Math.ceil(tiles.length / COLUMNS);
    const width = COLUMNS * TILE_WIDTH + (COLUMNS + 1) * GAP;
    const height = rows * TILE_HEIGHT + (rows + 1) * GAP;
    contactSheet = await sharp({
      create: { width, height, channels: 3, background: "#e9ece8" },
    })
      .composite(tiles.map((input, index) => ({
        input,
        left: GAP + (index % COLUMNS) * (TILE_WIDTH + GAP),
        top: GAP + Math.floor(index / COLUMNS) * (TILE_HEIGHT + GAP),
      })))
      .jpeg({ quality: 78, progressive: true })
      .toBuffer();
    await writeFile(sheetPath, contactSheet);
  }

  return {
    postId: post.id,
    creator: post.author.username,
    caption: post.caption,
    slideCount: post.slides.length,
    metrics: {
      views: post.metrics.views ?? null,
      likes: post.metrics.likes ?? null,
      saves: post.metrics.saves ?? null,
      shares: post.metrics.shares ?? null,
    },
    coverBase64: cover.toString("base64"),
    contactSheetBase64: contactSheet.toString("base64"),
  };
}
