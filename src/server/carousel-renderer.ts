import sharp from "sharp";
import { strToU8, zipSync } from "fflate";
import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import type { AppBrief, StoryboardSlide, StoryboardVariant } from "../shared/types.js";
import { getCachedSourceImage } from "./media-cache.js";

const WIDTH = 1_080;
const HEIGHT = 1_920;
const TIKTOK_SANS_PATH = fileURLToPath(new URL("../../assets/fonts/TikTokSans.ttf", import.meta.url));

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  })[character] || character);
}

function wrapText(value: string, maxCharacters: number): string[] {
  const paragraphs = value.trim().split(/\n+/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxCharacters && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 11);
}

function textOverlay(slide: StoryboardSlide): Buffer {
  const fontSize = Math.max(48, Math.min(102, Math.round(72 * slide.design.textScale)));
  const lineHeight = Math.round(fontSize * 1.08);
  const maxCharacters = Math.max(13, Math.min(28, Math.floor(850 / (fontSize * 0.56))));
  const lines = wrapText(slide.copy, maxCharacters);
  const boxHeight = Math.max(190, lines.length * lineHeight + 100);
  const boxY = slide.design.textPosition === "top"
    ? 175
    : slide.design.textPosition === "center"
      ? Math.round((HEIGHT - boxHeight) / 2)
      : HEIGHT - boxHeight - 175;
  const centered = slide.design.textAlign === "center";
  const textX = centered ? WIDTH / 2 : 90;
  const anchor = centered ? "middle" : "start";
  const card = slide.design.overlayStyle === "card";
  const textColor = card ? "#14201a" : "#ffffff";
  const background = card
    ? `<rect x="70" y="${boxY}" width="940" height="${boxHeight}" rx="34" fill="#f7f8f5" fill-opacity="0.95"/>`
    : slide.design.overlayStyle === "scrim"
      ? `<rect width="1080" height="1920" fill="url(#scrim)"/>`
      : "";
  const tspans = lines.map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("");
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07100b" stop-opacity="0.16"/><stop offset="0.42" stop-color="#07100b" stop-opacity="0.28"/><stop offset="1" stop-color="#07100b" stop-opacity="0.84"/></linearGradient></defs>
    ${background}
    <text x="${textX}" y="${boxY + 68}" text-anchor="${anchor}" font-family="TikTok Sans" font-size="${fontSize}" font-weight="800" letter-spacing="0" fill="${textColor}" stroke="${card ? "none" : "#000000"}" stroke-opacity="0.72" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${tspans}</text>
  </svg>`;
  return Buffer.from(new Resvg(svg, {
    font: {
      fontFiles: [TIKTOK_SANS_PATH],
      loadSystemFonts: false,
      defaultFontFamily: "TikTok Sans",
    },
  }).render().asPng());
}

function appBackground(): Buffer {
  return Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="app" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#13231b"/><stop offset="0.58" stop-color="#1d3427"/><stop offset="1" stop-color="#6d55c5"/></linearGradient>
      <radialGradient id="orb"><stop stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#app)"/>
    <circle cx="860" cy="330" r="430" fill="url(#orb)"/>
    <circle cx="190" cy="1590" r="500" fill="url(#orb)" opacity="0.45"/>
  </svg>`);
}

export async function renderCarouselSlide(slide: StoryboardSlide, _appName: string, includeText = true): Promise<Buffer> {
  let base: ReturnType<typeof sharp>;
  if (slide.productSlide || !slide.design.selectedImage) {
    base = sharp(appBackground());
  } else {
    const selected = slide.design.selectedImage;
    let normalized: Buffer | null = null;
    for (const sourceUrl of [...new Set([selected.imageUrl, selected.previewUrl])]) {
      try {
        const source = await getCachedSourceImage(sourceUrl);
        normalized = await sharp(source).rotate().resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" }).png().toBuffer();
        break;
      } catch {
        // Pinterest originals may occasionally be HEIF despite a .jpg suffix; the 736x preview is a stable fallback.
      }
    }
    if (!normalized) throw new Error(`Не удалось подготовить Pinterest-изображение для слайда ${slide.index}`);
    base = sharp(normalized);
  }
  if (!includeText) return base.png({ compressionLevel: 8 }).toBuffer();
  return base.composite([{ input: textOverlay(slide), top: 0, left: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

export async function renderCarouselZip(draft: { appBrief: AppBrief; variants: StoryboardVariant[] }, variantIndex: number, includeText = true): Promise<Buffer> {
  const variant = draft.variants[variantIndex];
  if (!variant) throw new Error("Вариант storyboard не найден");
  const files: Record<string, Uint8Array> = {};
  const sources: string[] = [`${draft.appBrief.appName} · ${variant.title}`, ""];
  for (const slide of variant.slides) {
    const filename = `${draft.appBrief.appName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "carousel"}-${String(slide.index).padStart(2, "0")}.png`;
    files[filename] = new Uint8Array(await renderCarouselSlide(slide, draft.appBrief.appName, includeText));
    if (slide.design.selectedImage) sources.push(`Slide ${slide.index}: ${slide.design.selectedImage.pinUrl} · query: ${slide.design.pinterestQuery}`);
  }
  sources.push("", `Text overlay: ${includeText ? "included (TikTok Sans)" : "not included"}`);
  sources.push("Pinterest links are sourcing references. Verify reuse rights before publishing.");
  files["SOURCES.txt"] = strToU8(sources.join("\n"));
  return Buffer.from(zipSync(files, { level: 0 }));
}
