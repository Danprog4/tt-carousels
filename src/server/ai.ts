import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AppBrief, CarouselPlaybook, CarouselPost, ResearchBrief, SessionPost, VisualProfile } from "../shared/types.js";
import { AI_MODEL, batchSchema, type AiBatchResult } from "./ai-contract.js";
import { storyboardBatchSchema } from "./draft-contract.js";
import { playbookBatchSchema } from "./playbook-contract.js";
import { visualBatchSchema, type PreparedVisualPost, type ToneReference } from "./visual-contract.js";

export { AI_MODEL };

function aiNodeExecutable(): string {
  const configured = process.env.PI_NODE_EXECUTABLE;
  if (configured) return configured;
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 22 || (major === 22 && minor >= 19)) return process.execPath;
  const bundled = resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
  if (existsSync(bundled)) return bundled;
  throw new Error("Для AI нужен Node 22.19+. Укажите путь через PI_NODE_EXECUTABLE.");
}

function runAiWorker<T>(workerName: string, payload: unknown, parse: (value: unknown) => T, timeoutMs: number): Promise<T> {
  const projectRoot = process.cwd();
  const nodeExecutable = aiNodeExecutable();
  const tsxCli = resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
  const worker = resolve(projectRoot, `src/server/${workerName}`);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(nodeExecutable, [tsxCli, worker], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`AI не ответил за ${Math.round(timeoutMs / 1000)} секунд`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(detail || `AI-процесс завершился с кодом ${code}`));
        return;
      }
      try {
        resolvePromise(parse(JSON.parse(Buffer.concat(stdout).toString("utf8"))));
      } catch (error) {
        reject(new Error(`Не удалось прочитать ответ AI: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function assessPostBatch(brief: ResearchBrief, posts: SessionPost[]): Promise<AiBatchResult> {
  return runAiWorker("ai-worker.ts", { brief, posts }, (value) => {
    const parsed = batchSchema.parse(value);
    const usage = (value as any).usage;
    return { assessments: parsed.assessments, usage };
  }, 130_000);
}

export function analyzeVisualBatch(brief: ResearchBrief, posts: PreparedVisualPost[]) {
  return runAiWorker("visual-ai-worker.ts", { brief, posts }, (value) => {
    const parsed = visualBatchSchema.parse(value);
    return { profiles: parsed.profiles, usage: (value as any).usage as { input: number; output: number } };
  }, 195_000);
}

export function generatePlaybooks(brief: ResearchBrief, posts: unknown[]) {
  return runAiWorker("playbook-worker.ts", { brief, posts }, (value) => {
    const parsed = playbookBatchSchema.parse(value);
    return { playbooks: parsed.playbooks, usage: (value as any).usage as { input: number; output: number } };
  }, 165_000);
}

export function generateStoryboard(brief: ResearchBrief, playbook: CarouselPlaybook, appBrief: AppBrief, evidence: unknown[], toneReferences: ToneReference[]) {
  return runAiWorker("draft-worker.ts", { brief, playbook, appBrief, evidence, toneReferences }, (value) => {
    const parsed = storyboardBatchSchema.parse(value);
    return { variants: parsed.variants, usage: (value as any).usage as { input: number; output: number } };
  }, 165_000);
}

export function generateRemixVariants(input: {
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
}) {
  return runAiWorker("remix-worker.ts", input, (value) => {
    const parsed = storyboardBatchSchema.parse(value);
    return { variants: parsed.variants, usage: (value as any).usage as { input: number; output: number } };
  }, 195_000);
}
