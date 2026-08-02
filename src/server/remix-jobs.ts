import type { CarouselPost, ResearchBrief, StoryboardVariant, VisualProfile } from "../shared/types.js";
import { analyzeVisualBatch, generateRemixVariants } from "./ai.js";
import { prepareToneReference, prepareVisualPost } from "./contact-sheet.js";
import { CarouselDatabase } from "./database.js";
import { categoryLabel, mapVisualProfile } from "./patterns.js";
import { fetchTikTokPost } from "./tiktok.js";
import { simplePinterestQuery } from "./storyboard-style.js";

const runningItems = new Set<string>();
const GENERATION_BATCH_SIZE = 4;

export function isRemixRunning(itemId: string): boolean {
  return runningItems.has(itemId);
}

function remixBrief(source: CarouselPost, audience: string, instructions: string): ResearchBrief {
  return {
    topic: source.caption || "Single TikTok carousel remix",
    audience,
    goal: "Understand the exact visual and narrative mechanics of this source so it can be adapted into distinct publishable variants.",
    language: "English",
    include: instructions,
    exclude: "Unrelated formats and unsupported claims",
  };
}

function suggestedFolderName(profile: VisualProfile): string {
  return `${categoryLabel(profile.primaryStructure)} · ${categoryLabel(profile.visualSource)}`;
}

function mapVariants(rawVariants: Awaited<ReturnType<typeof generateRemixVariants>>["variants"], sourceId: string): StoryboardVariant[] {
  return rawVariants.map((variant) => ({
    title: variant.title,
    angle: variant.angle,
    slides: variant.slides.map((slide, index) => ({
      index: index + 1,
      role: slide.role,
      copy: slide.copy,
      visualBrief: slide.visual_brief,
      sourcePostIds: slide.source_post_ids.includes(sourceId) ? [sourceId] : [],
      productSlide: slide.product_slide,
      design: {
        pinterestQuery: slide.product_slide ? "" : simplePinterestQuery(slide.pinterest_query),
        selectedImage: null,
        textPosition: slide.role === "hook" ? "center" : "bottom",
        textAlign: slide.role === "hook" ? "center" : "left",
        overlayStyle: slide.product_slide ? "none" : "scrim",
        textScale: slide.role === "hook" ? 1.15 : 1,
      },
    })),
  }));
}

export function startRemixJob(database: CarouselDatabase, itemId: string): void {
  if (runningItems.has(itemId)) throw new Error("Эта карусель уже обрабатывается в Remix");
  const initial = database.getRemixItem(itemId);
  if (!initial) throw new Error("Remix-проект не найден");
  runningItems.add(itemId);

  void (async () => {
    try {
      let item = database.getRemixItem(itemId)!;
      let source = item.sourcePost;
      if (!source) {
        database.setRemixProgress(itemId, "importing");
        source = await fetchTikTokPost({ url: item.sourceUrl });
        item = database.setRemixSource(itemId, source);
      }
      const reference = await prepareToneReference(source);

      let profile = item.visualProfile;
      if (!profile) {
        database.setRemixProgress(itemId, "analyzing");
        const prepared = await prepareVisualPost(source);
        const analyzed = await analyzeVisualBatch(remixBrief(source, item.appBrief.audience, item.instructions), [prepared]);
        const raw = analyzed.profiles.find((candidate) => candidate.post_id === source!.id);
        if (!raw) throw new Error("AI не вернул разбор исходной карусели");
        profile = mapVisualProfile(raw);
        let folderId = item.folderId;
        if (!folderId && item.autoFolder) folderId = database.createRemixFolder(suggestedFolderName(profile)).id;
        database.setRemixAnalysis(itemId, profile, folderId);
      }

      item = database.getRemixItem(itemId)!;
      database.setRemixProgress(itemId, "generating", item.variants.length);
      while (item.variants.length < item.requestedVariants) {
        const count = Math.min(GENERATION_BATCH_SIZE, item.requestedVariants - item.variants.length);
        const generated = await generateRemixVariants({
          source,
          profile,
          appBrief: item.appBrief,
          includeApp: item.includeApp,
          instructions: item.instructions,
          variantCount: count,
          variantOffset: item.variants.length,
          totalVariants: item.requestedVariants,
          avoid: item.variants.map((variant) => ({ title: variant.title, angle: variant.angle })),
          reference,
        });
        item = database.appendRemixVariants(itemId, mapVariants(generated.variants, source.id));
        database.setRemixProgress(itemId, "generating", item.variants.length);
      }
      database.completeRemixItem(itemId);
    } catch (error) {
      database.failRemixItem(itemId, error instanceof Error ? error.message : String(error));
    } finally {
      runningItems.delete(itemId);
    }
  })();
}
