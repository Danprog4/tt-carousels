import { z } from "zod";
import { slideRoleSchema } from "./visual-contract.js";

export const storyboardBatchSchema = z.object({
  variants: z.array(z.object({
    title: z.string().min(3).max(100),
    angle: z.string().min(5).max(240),
    slides: z.array(z.object({
      index: z.number().int().min(1),
      role: slideRoleSchema,
      copy: z.string().min(1).max(600),
      visual_brief: z.string().min(3).max(400),
      pinterest_query: z.string().max(120),
      source_post_ids: z.array(z.string()).max(8),
      product_slide: z.boolean(),
    })).min(4).max(12),
  })).min(1).max(20),
});

export type StoryboardBatch = z.infer<typeof storyboardBatchSchema>;

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function assertRequiredAppIntegration(result: StoryboardBatch, appName: string): void {
  const expectedName = normalized(appName);
  for (const [variantIndex, variant] of result.variants.entries()) {
    const productSlides = variant.slides.filter((slide) => slide.product_slide);
    if (productSlides.length < 1 || productSlides.length > 2) {
      throw new Error(`Вариант ${variantIndex + 1} должен содержать 1–2 нативных слайда приложения`);
    }
    if (productSlides[0].index <= 1) {
      throw new Error(`Вариант ${variantIndex + 1} показывает приложение до смыслового контекста`);
    }
    const variantCopy = normalized(variant.slides.map((slide) => slide.copy).join(" "));
    if (expectedName && !variantCopy.includes(expectedName)) {
      throw new Error(`Вариант ${variantIndex + 1} не называет приложение ${appName}`);
    }
  }
}
