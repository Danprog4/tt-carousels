import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { z } from "zod";
import type { AppBrief, CarouselPost, VisualProfile } from "../shared/types.js";
import { AI_MODEL, AI_PROVIDER } from "./ai-contract.js";
import { assertRequiredAppIntegration, storyboardBatchSchema } from "./draft-contract.js";
import { NATIVE_TIKTOK_COPY_RULES, nativeCopyIssues, SIMPLE_PINTEREST_QUERY_RULES } from "./storyboard-style.js";
import type { ToneReference } from "./visual-contract.js";

interface Input {
  source: CarouselPost;
  profile: VisualProfile;
  appBrief: AppBrief;
  includeApp: boolean;
  instructions: string;
  variantCount: number;
  variantOffset: number;
  totalVariants: number;
  avoid: Array<{ title: string; angle: string }>;
  reference: ToneReference;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const input = JSON.parse(await readStdin()) as Input;
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel(AI_PROVIDER, AI_MODEL);
  if (!model || !(await runtime.getAuth(model))) throw new Error("Авторизация OpenAI/Codex для Remix не найдена");
  const sessionId = `carousel-remix-${randomUUID()}`;
  const jsonSchema = z.toJSONSchema(storyboardBatchSchema, { io: "output" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const commercialRules = input.includeApp
    ? `Every variant must contain 1–2 slides with product_slide=true after useful context. Name ${input.appBrief.appName} explicitly. Treat appBrief as facts, not finished copy: explain the useful part and rewrite the CTA in the source's casual voice. The app slide must sound like the same creator, not a brand interruption.`
    : "Do not advertise an app. Every slide must have product_slide=false.";
  try {
    const { reference, ...request } = input;
    const content: any[] = [{ type: "text", text: JSON.stringify(request) }];
    content.push({ type: "text", text: `ORIGINAL CAROUSEL ${reference.postId} by @${reference.creator}. Caption: ${JSON.stringify(reference.caption)}. The next ${reference.slidesBase64.length} images are every original slide in exact order. Read the visible text across ALL of them before writing.` });
    reference.slidesBase64.forEach((data, index) => {
      content.push({ type: "text", text: `Original slide ${index + 1}.` });
      content.push({ type: "image", data, mimeType: "image/jpeg" });
    });
    const systemPrompt = `Create exactly ${input.variantCount} DISTINCT, editable TikTok photo-carousel variants from one analyzed source carousel. These are variants ${input.variantOffset + 1}–${input.variantOffset + input.variantCount} of ${input.totalVariants} total.

First read every supplied original slide in order. The complete carousel—not only the caption or first slide—is your tone reference. Infer its casing, slang level, punctuation, POV, sentence length, bluntness, rhythm, and the way each slide makes the next swipe feel natural.

Preserve the source's strongest hook mechanism, pacing, voice, and swipe logic, but never copy exact sentences or imagery. You may change slide count, order and framing when that creates a stronger native post. Each variant must feel like a separate publishable execution, not a synonym swap.

${NATIVE_TIKTOK_COPY_RULES}

The title and angle are internal editor labels. The slide copy itself is what a real person would actually post.

${commercialRules}

Use 4–12 sequential slides. Use the language visible in the original unless the user's instructions explicitly request another language. Write visual_brief in Russian and state a concrete asset approach. Cite only the supplied source post id.

${SIMPLE_PINTEREST_QUERY_RULES}

Avoid invented statistics, medical claims, and repeated angles. Previously generated titles/angles are supplied so this batch can differ from them. Follow the user's extra instructions when compatible with these rules.`;
    const complete = (feedback = "") => runtime.completeSimple(model, {
      systemPrompt: `${systemPrompt}${feedback ? `\n\nQUALITY GATE FEEDBACK — REGENERATE THIS BATCH FROM SCRATCH:\n${feedback}` : ""}`,
      messages: [{ role: "user", timestamp: Date.now(), content }],
    }, {
      reasoning: "low",
      transport: "sse",
      sessionId,
      maxTokens: Math.min(16_000, 3_000 + input.variantCount * 2_400),
      timeoutMs: 180_000,
      maxRetries: 1,
      onPayload: (rawPayload) => {
        const payload = rawPayload as Record<string, any>;
        return { ...payload, text: { ...(payload.text || {}), format: { type: "json_schema", name: "carousel_remix_variants", strict: true, schema: jsonSchema } } };
      },
    });
    let message = await complete();
    if (message.stopReason === "error") throw new Error(message.errorMessage || "Не удалось создать Remix-варианты");
    let text = message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
    let result = storyboardBatchSchema.parse(JSON.parse(text));
    let issues = nativeCopyIssues(result, `${input.profile.hookPattern} ${input.source.caption}`);
    if (issues.length) {
      message = await complete(issues.map((issue) => `- ${issue}`).join("\n"));
      if (message.stopReason === "error") throw new Error(message.errorMessage || "Не удалось переписать Remix нативно");
      text = message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
      result = storyboardBatchSchema.parse(JSON.parse(text));
      issues = nativeCopyIssues(result, `${input.profile.hookPattern} ${input.source.caption}`);
      if (issues.length) throw new Error(`Текст не прошёл TikTok quality gate: ${issues[0]}`);
    }
    if (result.variants.length !== input.variantCount) throw new Error(`AI вернул ${result.variants.length} вариантов вместо ${input.variantCount}`);
    if (input.includeApp) assertRequiredAppIntegration(result, input.appBrief.appName);
    if (!input.includeApp && result.variants.some((variant) => variant.slides.some((slide) => slide.product_slide))) {
      throw new Error("AI добавил приложение, хотя интеграция отключена");
    }
    process.stdout.write(JSON.stringify({ variants: result.variants, usage: { input: message.usage.input, output: message.usage.output } }));
  } finally {
    closeOpenAICodexWebSocketSessions(sessionId);
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
