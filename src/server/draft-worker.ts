import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { z } from "zod";
import type { AppBrief, CarouselPlaybook, ResearchBrief } from "../shared/types.js";
import { AI_MODEL, AI_PROVIDER } from "./ai-contract.js";
import { assertRequiredAppIntegration, storyboardBatchSchema } from "./draft-contract.js";

interface Input { brief: ResearchBrief; playbook: CarouselPlaybook; appBrief: AppBrief; evidence: unknown[] }
async function readStdin() { const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString("utf8"); }

try {
  const input = JSON.parse(await readStdin()) as Input;
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel(AI_PROVIDER, AI_MODEL);
  if (!model || !(await runtime.getAuth(model))) throw new Error("Авторизация OpenAI/Codex для storyboard не найдена");
  const sessionId = `carousel-draft-${randomUUID()}`;
  const jsonSchema = z.toJSONSchema(storyboardBatchSchema, { io: "output" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  try {
    const message = await runtime.completeSimple(model, {
      systemPrompt: `Create exactly three editable TikTok carousel storyboard variants based on a real evidence-backed playbook. Preserve the proven slide mechanics but do not copy source text or imagery.

NON-NEGOTIABLE COMMERCIAL RULES FOR EVERY VARIANT:
- The supplied app must always be advertised, even when the source playbook and evidence contain no product.
- Use 1–2 slides with product_slide=true. Never put the first product slide at slide 1: establish the pain, mechanism or useful advice first.
- Name the supplied app explicitly in the on-slide copy and end with the supplied App Store CTA.
- Choose the insertion point from the meaning of the story. The preceding slide must create a real need that the app solves; the app slide must explain the relevant mechanism or benefit from appBrief, then the carousel may continue delivering value.
- The app should feel like one concrete, useful next step inside the advice—not an unrelated sponsor card. Do not hide or omit the commercial intent.
- For a playbook with no observed product, invent only the transition and product integration; keep the evidence-backed hook and narrative mechanics intact.

Each variant must have sequential slide indices starting at 1 and cite only provided source post ids. Write final on-slide copy in English unless the research brief explicitly asks for another language. Keep copy concise enough for a mobile carousel. Write visual_brief in Russian. Every visual_brief must state the asset approach: original/licensed photo, AI-generated image, app screenshot/mockup, or graphic card. Product slides should call for real app screenshots/logo when available and must not invent interface details.

For every non-product slide, provide pinterest_query: a concrete 3–8 word English Pinterest image search query describing the visible subject, gender and aesthetic—not the abstract lesson or on-slide copy. Avoid words like TikTok, carousel, slide or text. For product slides return an empty pinterest_query because they use the app asset/template.

Variant 1: safe evidence adaptation with the app as a useful tip.
Variant 2: mid-carousel app workflow connected to the strongest pain point.
Variant 3: fresh angle where personalization by the app is the payoff of the same proven structure.`,
      messages: [{ role: "user", timestamp: Date.now(), content: [{ type: "text", text: JSON.stringify(input) }] }],
    }, {
      reasoning: "low", transport: "sse", sessionId, maxTokens: 9_000, timeoutMs: 150_000, maxRetries: 1,
      onPayload: (rawPayload) => {
        const payload = rawPayload as Record<string, any>;
        return { ...payload, text: { ...(payload.text || {}), format: { type: "json_schema", name: "carousel_storyboards", strict: true, schema: jsonSchema } } };
      },
    });
    if (message.stopReason === "error") throw new Error(message.errorMessage || "Не удалось создать storyboard");
    const text = message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
    const result = storyboardBatchSchema.parse(JSON.parse(text));
    assertRequiredAppIntegration(result, input.appBrief.appName);
    process.stdout.write(JSON.stringify({ variants: result.variants, usage: { input: message.usage.input, output: message.usage.output } }));
  } finally { closeOpenAICodexWebSocketSessions(sessionId); }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
