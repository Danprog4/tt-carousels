import { z } from "zod";
import { contentStructureSchema, productPatternSchema, slideRoleSchema, visualSourceSchema } from "./visual-contract.js";

export const generatedPlaybookSchema = z.object({
  title: z.string().min(3).max(100),
  summary: z.string().min(10).max(320),
  visual_source: visualSourceSchema,
  structure: contentStructureSchema,
  product_pattern: productPatternSchema,
  post_ids: z.array(z.string()).min(1).max(30),
  hook_templates: z.array(z.string().max(180)).min(2).max(5),
  slide_flow: z.array(z.object({
    role: slideRoleSchema,
    label: z.string().max(80),
    copy_formula: z.string().max(240),
    visual_direction: z.string().max(240),
    product_slot: z.boolean(),
  })).min(4).max(12),
  why_it_works: z.string().min(10).max(400),
  confidence: z.number().min(0).max(1),
});

export const playbookBatchSchema = z.object({
  playbooks: z.array(generatedPlaybookSchema).min(1).max(8),
});

export type GeneratedPlaybook = z.infer<typeof generatedPlaybookSchema>;
