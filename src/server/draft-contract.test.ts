import { describe, expect, it } from "vitest";
import { assertRequiredAppIntegration, type StoryboardBatch } from "./draft-contract.js";

function batch(productSlide: boolean, productCopy = "Use Ascend AI for a personal daily plan"): StoryboardBatch {
  return {
    variants: [1, 2, 3].map((number) => ({
      title: `Variant ${number}`,
      angle: "A native problem-to-solution angle",
      slides: [
        { index: 1, role: "hook", copy: "Why your face still looks puffy", visual_brief: "Лицензированное фото", pinterest_query: "puffy face man morning", source_post_ids: [], product_slide: false },
        { index: 2, role: "tip", copy: "Track the habits that cause it", visual_brief: "Графическая карточка", pinterest_query: "healthy male habits aesthetic", source_post_ids: [], product_slide: false },
        { index: 3, role: "product", copy: productCopy, visual_brief: "Реальный экран приложения", pinterest_query: "", source_post_ids: [], product_slide: productSlide },
        { index: 4, role: "cta", copy: "Find Ascend AI in the App Store", visual_brief: "Логотип и App Store CTA", pinterest_query: "app store phone mockup", source_post_ids: [], product_slide: false },
      ],
    })),
  };
}

describe("required app integration", () => {
  it("accepts a named app insertion after useful context", () => {
    expect(() => assertRequiredAppIntegration(batch(true), "Ascend AI")).not.toThrow();
  });

  it("rejects variants without a marked app slide", () => {
    expect(() => assertRequiredAppIntegration(batch(false), "Ascend AI")).toThrow(/1–2 нативных/);
  });

  it("rejects variants that never name the advertised app", () => {
    const result = batch(true, "Use the app for a personal daily plan");
    result.variants.forEach((variant) => { variant.slides[3].copy = "Find it in the App Store"; });
    expect(() => assertRequiredAppIntegration(result, "Ascend AI")).toThrow(/не называет приложение/);
  });
});
