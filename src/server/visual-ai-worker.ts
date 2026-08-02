import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { z } from "zod";
import type { ResearchBrief } from "../shared/types.js";
import { AI_MODEL, AI_PROVIDER } from "./ai-contract.js";
import { visualBatchSchema, type PreparedVisualPost } from "./visual-contract.js";

interface Input { brief: ResearchBrief; posts: PreparedVisualPost[] }

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function prompt(brief: ResearchBrief, count: number): string {
  return `Analyze exactly ${count} TikTok photo carousels for a content research system.

For every post you receive two images in order: (1) its full-size cover, then (2) a numbered contact sheet containing every slide in order. This is a COARSE visual pass, not exact OCR.

Research topic: ${brief.topic}
Audience: ${brief.audience}
Goal: ${brief.goal}

Classify each carousel on independent controlled axes:
- visual_source: pinterest_like means curated aspirational/editorial imagery commonly associated with Pinterest moodboards; never claim the image literally came from Pinterest. Distinguish UGC/selfie, stock/editorial, AI photoreal, AI illustration, recurring AI mascot/character, app screenshots, meme templates, mixed, and unknown.
- layout_style: the repeated layout system across slides.
- primary_structure: the narrative mechanism, not the topic.
- slide_roles: return one role for every numbered slide, in exact order.
- product pattern: commercial content is valuable. Detect apps, product-as-tip, app demonstrations, mid-carousel inserts, end cards, link-in-bio, and affiliate/ad patterns.

Use low confidence and unknown when visual evidence is insufficient. Do not invent exact text you cannot read. hook_pattern may paraphrase the visible mechanism. rationale must be one concise Russian sentence. Return every post_id exactly once.`;
}

try {
  const input = JSON.parse(await readStdin()) as Input;
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel(AI_PROVIDER, AI_MODEL);
  if (!model || !(await runtime.getAuth(model))) throw new Error("Авторизация OpenAI/Codex для vision-анализа не найдена");
  const sessionId = `carousel-vision-${randomUUID()}`;
  const jsonSchema = z.toJSONSchema(visualBatchSchema, { io: "output" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  try {
    const content: any[] = [];
    for (const post of input.posts) {
      content.push({ type: "text", text: `POST ${post.postId}\nCreator: @${post.creator}\nCaption: ${JSON.stringify(post.caption)}\nSlides: ${post.slideCount}\nMetrics: ${JSON.stringify(post.metrics)}\nImage 1: cover.` });
      content.push({ type: "image", data: post.coverBase64, mimeType: "image/jpeg" });
      content.push({ type: "text", text: `POST ${post.postId} — Image 2: numbered contact sheet, slides 1 through ${post.slideCount}.` });
      content.push({ type: "image", data: post.contactSheetBase64, mimeType: "image/jpeg" });
    }
    const message = await runtime.completeSimple(model, {
      systemPrompt: prompt(input.brief, input.posts.length),
      messages: [{ role: "user", timestamp: Date.now(), content }],
    }, {
      reasoning: "low",
      transport: "sse",
      sessionId,
      maxTokens: 7_000,
      timeoutMs: 180_000,
      maxRetries: 1,
      onPayload: (rawPayload) => {
        const payload = rawPayload as Record<string, any>;
        return { ...payload, text: { ...(payload.text || {}), format: { type: "json_schema", name: "carousel_visual_profiles", strict: true, schema: jsonSchema } } };
      },
    });
    if (message.stopReason === "error") throw new Error(message.errorMessage || "Vision-анализ завершился ошибкой");
    const text = message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
    const result = visualBatchSchema.parse(JSON.parse(text));
    const expected = new Set(input.posts.map((post) => post.postId));
    if (new Set(result.profiles.map((profile) => profile.post_id)).size !== expected.size || result.profiles.some((profile) => !expected.has(profile.post_id))) {
      throw new Error("Vision-анализ вернул неполный набор постов");
    }
    process.stdout.write(JSON.stringify({ profiles: result.profiles, usage: { input: message.usage.input, output: message.usage.output } }));
  } finally {
    closeOpenAICodexWebSocketSessions(sessionId);
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
