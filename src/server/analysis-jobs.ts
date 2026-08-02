import type { AppBrief, CarouselDraft, PatternAnalysisRun, SessionPost, StoryboardVariant } from "../shared/types.js";
import { isLowTraction } from "../shared/ranking.js";
import { analyzeVisualBatch, generatePlaybooks, generateStoryboard } from "./ai.js";
import { prepareVisualPost } from "./contact-sheet.js";
import { CarouselDatabase } from "./database.js";
import { buildCategorySummaries, compactPatternEvidence, enrichPlaybooks, mapVisualProfile } from "./patterns.js";

const VISUAL_BATCH_SIZE = 4;
const runningSessions = new Set<string>();

function selectedForAnalysis(post: SessionPost, includeMaybe: boolean): boolean {
  if (post.pinned) return true;
  if (post.humanStatus) return post.humanStatus === "relevant";
  if (isLowTraction(post.metrics)) return false;
  if (post.aiStatus === "relevant") return true;
  return includeMaybe && post.aiStatus === "maybe";
}

export function startPatternAnalysis(database: CarouselDatabase, sessionId: string, includeMaybe: boolean): PatternAnalysisRun {
  if (runningSessions.has(sessionId)) throw new Error("Поиск паттернов уже выполняется");
  const session = database.getSession(sessionId);
  if (!session) throw new Error("Исследование не найдено");
  const selected = session.posts.filter((post) => selectedForAnalysis(post, includeMaybe));
  if (!selected.length) throw new Error("Нет каруселей для анализа. Оставьте хотя бы один релевантный результат.");
  const run = database.createPatternRun(sessionId, includeMaybe, selected.map((post) => post.id));
  runningSessions.add(sessionId);

  void (async () => {
    let completed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      database.setPatternProgress(run.id, { status: "running", stage: "preparing", completed, inputTokens, outputTokens });
      const fresh: SessionPost[] = [];
      for (const post of selected) {
        if (post.visualStatus === "complete" && post.visualProfile) completed += 1;
        else fresh.push(post);
      }
      database.setPatternProgress(run.id, { status: "running", stage: "visual_analysis", completed, inputTokens, outputTokens });

      for (let offset = 0; offset < fresh.length; offset += VISUAL_BATCH_SIZE) {
        const batch = fresh.slice(offset, offset + VISUAL_BATCH_SIZE);
        const prepared = [];
        for (const post of batch) {
          try {
            prepared.push(await prepareVisualPost(post));
          } catch {
            database.setVisualFailure(sessionId, post.id);
            completed += 1;
          }
        }
        if (prepared.length) {
          const result = await analyzeVisualBatch(session.brief, prepared);
          inputTokens += result.usage.input;
          outputTokens += result.usage.output;
          for (const raw of result.profiles) {
            database.setVisualProfile(sessionId, raw.post_id, mapVisualProfile(raw));
            completed += 1;
          }
        }
        database.setPatternProgress(run.id, { status: "running", stage: "visual_analysis", completed, inputTokens, outputTokens });
      }

      database.setPatternProgress(run.id, { status: "running", stage: "clustering", completed, inputTokens, outputTokens });
      const refreshed = database.getSession(sessionId)!;
      const analyzed = refreshed.posts.filter((post) => run.selectedPostIds.includes(post.id) && post.visualProfile);
      if (!analyzed.length) throw new Error("Не удалось подготовить изображения выбранных каруселей");
      const categories = buildCategorySummaries(analyzed);

      database.setPatternProgress(run.id, { status: "running", stage: "playbooks", completed, inputTokens, outputTokens });
      const generated = await generatePlaybooks(session.brief, compactPatternEvidence(analyzed));
      inputTokens += generated.usage.input;
      outputTokens += generated.usage.output;
      const playbooks = enrichPlaybooks(generated.playbooks, analyzed);
      if (!playbooks.length) throw new Error("AI не смог собрать доказательный playbook");
      database.completePatternRun(run.id, categories, playbooks, inputTokens, outputTokens);
    } catch (error) {
      database.failPatternRun(run.id, error instanceof Error ? error.message : String(error));
    } finally {
      runningSessions.delete(sessionId);
    }
  })();

  return run;
}

export async function createStoryboardDraft(database: CarouselDatabase, input: {
  sessionId: string;
  playbookId: string;
  appBrief: AppBrief;
}): Promise<CarouselDraft> {
  const session = database.getSession(input.sessionId);
  if (!session) throw new Error("Исследование не найдено");
  const analysis = session.analysis;
  if (!analysis || analysis.status !== "complete") throw new Error("Сначала завершите поиск паттернов");
  const playbook = analysis.playbooks.find((item) => item.id === input.playbookId);
  if (!playbook) throw new Error("Playbook не найден");
  const evidencePosts = session.posts.filter((post) => playbook.postIds.includes(post.id));
  const result = await generateStoryboard(session.brief, playbook, input.appBrief, compactPatternEvidence(evidencePosts));
  const knownIds = new Set(evidencePosts.map((post) => post.id));
  const variants: StoryboardVariant[] = result.variants.map((variant) => ({
    title: variant.title,
    angle: variant.angle,
    slides: variant.slides.map((slide, index) => ({
      index: index + 1,
      role: slide.role,
      copy: slide.copy,
      visualBrief: slide.visual_brief,
      sourcePostIds: slide.source_post_ids.filter((id) => knownIds.has(id)),
      productSlide: slide.product_slide,
      design: {
        pinterestQuery: slide.product_slide ? "" : slide.pinterest_query,
        selectedImage: null,
        textPosition: slide.role === "hook" ? "center" : "bottom",
        textAlign: slide.role === "hook" ? "center" : "left",
        overlayStyle: slide.product_slide ? "none" : "scrim",
        textScale: slide.role === "hook" ? 1.15 : 1,
      },
    })),
  }));
  return database.createDraft({
    sessionId: input.sessionId,
    analysisRunId: analysis.id,
    playbookId: playbook.id,
    appBrief: input.appBrief,
    variants,
  });
}
