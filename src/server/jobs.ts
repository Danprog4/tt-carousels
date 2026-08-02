import { CarouselDatabase } from "./database.js";
import { searchTikTokQuery } from "./tiktok.js";
import type { AiJobSnapshot } from "../shared/types.js";
import { isLowTraction, MIN_TRACTION_VIEWS } from "../shared/ranking.js";
import { AI_MODEL, assessPostBatch } from "./ai.js";

const runningJobs = new Set<string>();
const AI_BATCH_SIZE = 20;
const aiJobs = new Map<string, AiJobSnapshot>();

export function isSearchRunning(sessionId: string): boolean {
  return runningJobs.has(sessionId);
}

export function getAiJob(sessionId: string): AiJobSnapshot {
  return aiJobs.get(sessionId) || {
    running: false,
    completed: 0,
    total: 0,
    completedBatches: 0,
    totalBatches: 0,
    model: AI_MODEL,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export function startAiJob(database: CarouselDatabase, sessionId: string): AiJobSnapshot {
  const existing = aiJobs.get(sessionId);
  if (existing?.running) throw new Error("AI уже оценивает эту выборку");
  const session = database.getSession(sessionId);
  if (!session) throw new Error("Исследование не найдено");
  if (isSearchRunning(sessionId)) throw new Error("Дождитесь завершения поиска");
  const pendingPosts = session.posts.filter((post) => post.aiStatus === "pending");
  if (!pendingPosts.length) throw new Error("В этой выборке нет новых каруселей без AI-оценки");
  const lowTractionPosts = pendingPosts.filter((post) => isLowTraction(post.metrics));
  for (const post of lowTractionPosts) {
    database.setAiAssessment(sessionId, post.id, {
      status: "skip",
      score: 0,
      nicheScore: null,
      productScore: null,
      appScore: null,
      reason: `Меньше ${MIN_TRACTION_VIEWS} просмотров — AI-квота не использовалась.`,
    });
  }
  const posts = pendingPosts.filter((post) => !isLowTraction(post.metrics));

  const state: AiJobSnapshot = {
    running: true,
    completed: lowTractionPosts.length,
    total: pendingPosts.length,
    completedBatches: 0,
    totalBatches: Math.ceil(posts.length / AI_BATCH_SIZE),
    model: AI_MODEL,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
  };
  aiJobs.set(sessionId, state);

  if (!posts.length) {
    state.running = false;
    return state;
  }

  void (async () => {
    try {
      for (let offset = 0; offset < posts.length; offset += AI_BATCH_SIZE) {
        const batch = posts.slice(offset, offset + AI_BATCH_SIZE);
        const result = await assessPostBatch(session.brief, batch);
        for (const assessment of result.assessments) {
          database.setAiAssessment(sessionId, assessment.id, {
            status: assessment.status,
            score: assessment.score,
            nicheScore: assessment.niche_score,
            productScore: assessment.product_score,
            appScore: assessment.app_score,
            reason: assessment.reason,
          });
        }
        state.completed += batch.length;
        state.completedBatches += 1;
        state.inputTokens += result.usage.input;
        state.outputTokens += result.usage.output;
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.running = false;
    }
  })();

  return state;
}

export function startSearchJob(database: CarouselDatabase, sessionId: string): void {
  if (runningJobs.has(sessionId)) throw new Error("Поиск для этой сессии уже выполняется");
  const session = database.getSession(sessionId);
  if (!session) throw new Error("Исследование не найдено");
  runningJobs.add(sessionId);
  database.setSearchStarted(sessionId);
  const perQueryLimit = Math.min(250, Math.max(20, Math.ceil((session.targetResults / Math.max(1, session.queries.length)) * 1.45)));

  void (async () => {
    const errors: string[] = [];
    try {
      for (let queryIndex = 0; queryIndex < session.queries.length; queryIndex += 1) {
        const query = session.queries[queryIndex];
        database.setSearchProgress(sessionId, queryIndex, query);
        try {
          const posts = await searchTikTokQuery({ query, limit: perQueryLimit });
          posts.forEach((post, postIndex) => {
            if (session.excludeSeen && database.hasPostInOtherProjectRun(session.projectId, sessionId, post.id)) return;
            database.upsertPost(sessionId, post, query, postIndex + 1);
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${query}: ${message}`);
        }
        database.setSearchProgress(sessionId, queryIndex + 1, null);
        if ((database.getSession(sessionId)?.resultCount || 0) >= session.targetResults) break;
      }
      const fatalError = errors.length === session.queries.length
        ? errors.join("\n")
        : undefined;
      database.setSearchFinished(sessionId, fatalError);
    } catch (error) {
      database.setSearchFinished(sessionId, error instanceof Error ? error.message : String(error));
    } finally {
      runningJobs.delete(sessionId);
    }
  })();
}
