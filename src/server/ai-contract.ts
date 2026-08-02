import { z } from "zod";

export const AI_PROVIDER = "openai-codex";
export const AI_MODEL = "gpt-5.6-luna";

export const assessmentSchema = z.object({
  id: z.string(),
  status: z.enum(["skip", "maybe", "relevant"]),
  score: z.number().int().min(0).max(100),
  niche_score: z.number().int().min(0).max(100),
  product_score: z.number().int().min(0).max(100),
  app_score: z.number().int().min(0).max(100),
  reason: z.string().min(2).max(180),
});

export const batchSchema = z.object({
  assessments: z.array(assessmentSchema),
});

export type AiAssessment = z.infer<typeof assessmentSchema>;

export interface AiBatchResult {
  assessments: AiAssessment[];
  usage: {
    input: number;
    output: number;
  };
}
