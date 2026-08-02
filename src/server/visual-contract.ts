import { z } from "zod";

export const visualSourceSchema = z.enum(["pinterest_like", "ugc_selfie", "stock_editorial", "ai_photoreal", "ai_illustration", "ai_mascot", "app_screenshots", "meme_template", "mixed", "unknown"]);
export const layoutStyleSchema = z.enum(["single_image_text", "collage", "card_template", "screenshot_stack", "before_after", "illustrated_sequence", "mixed"]);
export const contentStructureSchema = z.enum(["tips_list", "mistakes_fixes", "routine", "tutorial", "before_after", "story", "ranking", "myths_facts", "problem_solution", "product_demo", "other"]);
export const slideRoleSchema = z.enum(["hook", "setup", "problem", "proof", "tip", "transition", "product", "cta", "ending", "other"]);
export const productPatternSchema = z.enum(["none", "product_as_tip", "mid_carousel_insert", "app_demo", "dedicated_end_card", "link_in_bio", "affiliate_ad", "unknown"]);

export const visualProfileResultSchema = z.object({
  post_id: z.string(),
  visual_source: visualSourceSchema,
  layout_style: layoutStyleSchema,
  primary_structure: contentStructureSchema,
  secondary_structures: z.array(contentStructureSchema).max(3),
  slide_roles: z.array(z.object({
    index: z.number().int().min(1),
    role: slideRoleSchema,
    confidence: z.number().min(0).max(1),
  })),
  hook_pattern: z.string().max(240),
  visual_notes: z.string().max(300),
  product: z.object({
    present: z.boolean(),
    pattern: productPatternSchema,
    product_name: z.string().nullable(),
    first_slide: z.number().int().min(1).nullable(),
    confidence: z.number().min(0).max(1),
  }),
  cta_pattern: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  deep_analysis_recommended: z.boolean(),
  rationale: z.string().max(240),
});

export const visualBatchSchema = z.object({
  profiles: z.array(visualProfileResultSchema),
});

export type VisualProfileResult = z.infer<typeof visualProfileResultSchema>;

export interface PreparedVisualPost {
  postId: string;
  creator: string;
  caption: string;
  slideCount: number;
  metrics: Record<string, number | null>;
  coverBase64: string;
  contactSheetBase64: string;
}

export interface ToneReference {
  postId: string;
  creator: string;
  caption: string;
  slidesBase64: string[];
}
