import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { z } from "zod";
import type { ResearchBrief } from "../shared/types.js";
import { AI_MODEL, AI_PROVIDER } from "./ai-contract.js";
import { playbookBatchSchema } from "./playbook-contract.js";
import { NATIVE_TIKTOK_COPY_RULES } from "./storyboard-style.js";

interface Input { brief: ResearchBrief; posts: unknown[] }
async function readStdin() { const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString("utf8"); }

try {
  const input = JSON.parse(await readStdin()) as Input;
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel(AI_PROVIDER, AI_MODEL);
  if (!model || !(await runtime.getAuth(model))) throw new Error("Авторизация OpenAI/Codex для playbooks не найдена");
  const sessionId = `carousel-playbooks-${randomUUID()}`;
  const jsonSchema = z.toJSONSchema(playbookBatchSchema, { io: "output" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  try {
    const message = await runtime.completeSimple(model, {
      systemPrompt: `Turn real TikTok carousel evidence into 4–8 reusable content playbooks for this brief:\nTopic: ${input.brief.topic}\nAudience: ${input.brief.audience}\nCommercial goal: ${input.brief.goal}\n\nEach input contains a real post id, creator, metrics and a coarse visual profile. Group repeated combinations of narrative structure, visual language and product integration. Prefer patterns supported by multiple posts and multiple creators. Repeated posts from one creator may form a useful single-creator pattern but must not be presented as broad market evidence. Use only provided post ids. The returned visual_source, structure and product_pattern must describe the majority of the listed evidence posts. Every slide_flow must contain exactly one proposed native app opportunity with product_slot=true, even when the evidence has product_pattern=none; this is a production recommendation and must not change the observed product_pattern. Place it only after the flow has established a relevant pain, mechanism or useful advice.\n\nTreat creator language as evidence too. hook_templates must preserve the observed simplicity, bluntness, POV and internet rhythm without copying exact wording. Do not turn casual hooks into marketing headlines, magazine language, or self-help copy. Keep copy_formula plain and short. App opportunities should sound like the same creator continuing the post, not a brand taking over. Write title, summary, labels, directions and why_it_works in concise Russian. Product/app integrations are positive evidence.\n\nThe following copy rules apply to every hook template and slide formula you propose:\n${NATIVE_TIKTOK_COPY_RULES}`,
      messages: [{ role: "user", timestamp: Date.now(), content: [{ type: "text", text: JSON.stringify({ evidence: input.posts }) }] }],
    }, {
      reasoning: "low", transport: "sse", sessionId, maxTokens: 8_000, timeoutMs: 150_000, maxRetries: 1,
      onPayload: (rawPayload) => {
        const payload = rawPayload as Record<string, any>;
        return { ...payload, text: { ...(payload.text || {}), format: { type: "json_schema", name: "carousel_playbooks", strict: true, schema: jsonSchema } } };
      },
    });
    if (message.stopReason === "error") throw new Error(message.errorMessage || "Не удалось собрать playbooks");
    const text = message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
    const result = playbookBatchSchema.parse(JSON.parse(text));
    process.stdout.write(JSON.stringify({ playbooks: result.playbooks, usage: { input: message.usage.input, output: message.usage.output } }));
  } finally { closeOpenAICodexWebSocketSessions(sessionId); }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
