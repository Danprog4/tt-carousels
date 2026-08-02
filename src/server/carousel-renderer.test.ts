import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import type { CarouselDraft, StoryboardSlide } from "../shared/types.js";
import { renderCarouselSlide, renderCarouselZip } from "./carousel-renderer.js";

const productSlide: StoryboardSlide = {
  index: 1,
  role: "product",
  copy: "Scan your face with bloatfit and get a personalised daily plan.",
  visualBrief: "Text-only app card",
  sourcePostIds: [],
  productSlide: true,
  design: {
    pinterestQuery: "",
    selectedImage: null,
    textPosition: "center",
    textAlign: "center",
    overlayStyle: "card",
    textScale: 1,
  },
};

const draft: CarouselDraft = {
  id: "draft",
  sessionId: "session",
  analysisRunId: "analysis",
  playbookId: "playbook",
  appBrief: { appName: "bloatfit", audience: "men", promise: "personalised plan", proof: "AI scan", cta: "App Store", visualStyle: "mixed", restrictions: "no medical claims" },
  variants: [1, 2, 3].map((index) => ({ title: `Variant ${index}`, angle: "Native app flow", slides: [productSlide] })),
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

describe("carousel renderer", () => {
  it("renders a text-only app slide as a 1080x1920 PNG", async () => {
    const png = await renderCarouselSlide(productSlide, "bloatfit");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("can render the same slide without any text overlay", async () => {
    const withText = await renderCarouselSlide(productSlide, "bloatfit", true);
    const withoutText = await renderCarouselSlide(productSlide, "bloatfit", false);
    expect(withoutText.subarray(1, 4).toString()).toBe("PNG");
    expect(withoutText.equals(withText)).toBe(false);
  });

  it("exports numbered PNGs and source notes in a ZIP", async () => {
    const archive = unzipSync(new Uint8Array(await renderCarouselZip(draft, 0)));
    expect(Object.keys(archive)).toContain("bloatfit-01.png");
    expect(Object.keys(archive)).toContain("SOURCES.txt");
  });

  it("marks a text-free ZIP export in its source notes", async () => {
    const archive = unzipSync(new Uint8Array(await renderCarouselZip(draft, 0, false)));
    expect(Buffer.from(archive["SOURCES.txt"]).toString()).toContain("Text overlay: not included");
  });
});
