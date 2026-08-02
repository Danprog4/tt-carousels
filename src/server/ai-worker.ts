import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { z } from "zod";
import type { ResearchBrief, SessionPost } from "../shared/types.js";
import { AI_MODEL, AI_PROVIDER, batchSchema, type AiBatchResult } from "./ai-contract.js";

interface WorkerInput {
  brief: ResearchBrief;
  posts: SessionPost[];
}

function compactPost(post: SessionPost) {
  return {
    id: post.id,
    creator: `@${post.author.username}`,
    caption: post.caption || "",
    matched_queries: post.searchQueries,
    best_search_rank: post.bestSearchRank,
    slide_count: post.slides.length,
    metrics: {
      views: post.metrics.views ?? null,
      likes: post.metrics.likes ?? null,
      comments: post.metrics.comments ?? null,
      shares: post.metrics.shares ?? null,
      saves: post.metrics.saves ?? null,
    },
  };
}

function systemPrompt(brief: ResearchBrief, count: number): string {
  return `You are a fast first-pass classifier for TikTok PHOTO CAROUSEL research.

You receive metadata for exactly ${count} already-confirmed photo carousels. You do NOT see their images in this pass. Judge only from caption, search-query matches, creator name, slide count, rank, and metrics. Never claim that you saw slide contents.

Research brief:
- Topic: ${brief.topic}
- Audience: ${brief.audience || "not specified"}
- Commercial goal: ${brief.goal || "find repeatable carousel patterns and native product funnels"}
- Include: ${brief.include || "not specified"}
- Exclude: ${brief.exclude || "not specified"}

Important product angle:
- Ads, products, apps, App Store mentions, affiliate content, link-in-bio funnels, and native product recommendations are POSITIVE signals.
- A strong niche match without a product is still useful content evidence.
- An adjacent-niche carousel with a very clear product/app funnel may also be useful as a structural reference.
- High views are evidence of performance, not proof of relevance.

Score every item:
- niche_score: topical and audience fit.
- product_score: evidence of any commercial/product funnel.
- app_score: evidence of an app, AI tool, tracker, scanner, App Store product, or app-like digital product.
- score: overall research usefulness, including how reusable the angle appears.

Status guide:
- relevant: strong topic match, or a useful adjacent example with a clear commercial/app funnel.
- maybe: ambiguous caption, partial match, or potentially useful structure that needs visual checking.
- skip: clearly unrelated or near-zero evidence for this brief.

Be conservative about skip when the caption is sparse: use maybe if the search match suggests possible relevance. Return every input id exactly once. Write reason in concise Russian (maximum one short sentence), based only on metadata.`;
}

async function assessPostBatch(brief: ResearchBrief, posts: SessionPost[]): Promise<AiBatchResult> {
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel(AI_PROVIDER, AI_MODEL);
  if (!model) throw new Error(`Модель ${AI_MODEL} не найдена в Pi`);
  if (!(await runtime.getAuth(model))) {
    throw new Error("Авторизация OpenAI/Codex не найдена. Запустите npm run ai:login и войдите через /login.");
  }

  const sessionId = `carousel-rank-${randomUUID()}`;
  const jsonSchema = z.toJSONSchema(batchSchema, { io: "output" }) as Record<string, unknown>;
  delete jsonSchema.$schema;

  try {
    const message = await runtime.completeSimple(model, {
      systemPrompt: systemPrompt(brief, posts.length),
      messages: [{
        role: "user",
        timestamp: Date.now(),
        content: [{ type: "text", text: JSON.stringify({ carousels: posts.map(compactPost) }) }],
      }],
    }, {
      reasoning: "low",
      transport: "sse",
      sessionId,
      maxTokens: 5_000,
      timeoutMs: 120_000,
      maxRetries: 1,
      onPayload: (rawPayload) => {
        const payload = rawPayload as Record<string, any>;
        return {
          ...payload,
          text: {
            ...(payload.text || {}),
            format: {
              type: "json_schema",
              name: "carousel_relevance_batch",
              strict: true,
              schema: jsonSchema,
            },
          },
        };
      },
    });

    if (message.stopReason === "error") {
      throw new Error(message.errorMessage || "AI-классификация завершилась ошибкой");
    }
    const text = message.content
      .filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
    const parsed = batchSchema.parse(JSON.parse(text));
    const expectedIds = new Set(posts.map((post) => post.id));
    const returnedIds = new Set(parsed.assessments.map((assessment) => assessment.id));
    if (returnedIds.size !== parsed.assessments.length || returnedIds.size !== expectedIds.size) {
      throw new Error("AI вернул неполный или повторяющийся список оценок");
    }
    for (const id of returnedIds) {
      if (!expectedIds.has(id)) throw new Error(`AI вернул неизвестную карусель: ${id}`);
    }

    return {
      assessments: parsed.assessments,
      usage: { input: message.usage.input, output: message.usage.output },
    };
  } finally {
    closeOpenAICodexWebSocketSessions(sessionId);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const input = JSON.parse(await readStdin()) as WorkerInput;
  const result = input.posts.length
    ? await assessPostBatch(input.brief, input.posts)
    : { assessments: [], usage: { input: 0, output: 0 } };
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
