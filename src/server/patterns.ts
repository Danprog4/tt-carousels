import { randomUUID } from "node:crypto";
import type {
  CarouselPlaybook,
  CategorySummary,
  ContentStructure,
  ProductPattern,
  SessionPost,
  VisualProfile,
  VisualSource,
} from "../shared/types.js";
import type { GeneratedPlaybook } from "./playbook-contract.js";

const labels: Record<string, string> = {
  pinterest_like: "Pinterest-like",
  ugc_selfie: "UGC / selfie",
  stock_editorial: "Stock / editorial",
  ai_photoreal: "AI photoreal",
  ai_illustration: "AI illustration",
  ai_mascot: "AI mascot",
  app_screenshots: "App screenshots",
  meme_template: "Meme template",
  mixed: "Mixed",
  unknown: "Не определено",
  tips_list: "Список советов",
  mistakes_fixes: "Ошибки → исправления",
  routine: "Routine",
  tutorial: "Tutorial",
  before_after: "Before / after",
  story: "Story",
  ranking: "Ranking",
  myths_facts: "Мифы → факты",
  problem_solution: "Проблема → решение",
  product_demo: "Product demo",
  other: "Другая структура",
  none: "Без продукта",
  product_as_tip: "Продукт как совет",
  mid_carousel_insert: "Вставка в середине",
  app_demo: "Демонстрация приложения",
  dedicated_end_card: "Финальный product card",
  link_in_bio: "Link in bio",
  affiliate_ad: "Affiliate / ad",
};

export function categoryLabel(value: string): string {
  return labels[value] || value.replaceAll("_", " ");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stats(posts: SessionPost[]) {
  const views = posts.map((post) => post.metrics.views || 0).filter((value) => value > 0);
  const saveRates = posts
    .filter((post) => (post.metrics.views || 0) > 0)
    .map((post) => ((post.metrics.saves || 0) / (post.metrics.views || 1)) * 100);
  return {
    creatorCount: new Set(posts.map((post) => post.author.username)).size,
    medianViews: Math.round(median(views)),
    medianSaveRate: Number(median(saveRates).toFixed(2)),
  };
}

function dominant<T extends string>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || fallback;
}

export function buildCategorySummaries(posts: SessionPost[]): CategorySummary[] {
  const groups = new Map<string, { axis: CategorySummary["axis"]; value: string; posts: SessionPost[] }>();
  for (const post of posts) {
    const profile = post.visualProfile;
    if (!profile) continue;
    const values: Array<[CategorySummary["axis"], string]> = [
      ["visual_source", profile.visualSource],
      ["structure", profile.primaryStructure],
      ["product_pattern", profile.product.pattern],
    ];
    for (const [axis, value] of values) {
      const key = `${axis}:${value}`;
      const group = groups.get(key) || { axis, value, posts: [] };
      group.posts.push(post);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      axis: group.axis,
      value: group.value,
      label: categoryLabel(group.value),
      postIds: group.posts.map((post) => post.id),
      postCount: group.posts.length,
      ...stats(group.posts),
    }))
    .sort((left, right) => right.postCount - left.postCount || right.medianViews - left.medianViews);
}

export function compactPatternEvidence(posts: SessionPost[]) {
  return posts.filter((post) => post.visualProfile).map((post) => ({
    post_id: post.id,
    creator: post.author.username,
    caption: post.caption,
    metrics: post.metrics,
    ai_scores: { overall: post.aiScore, product: post.aiProductScore, app: post.aiAppScore },
    pinned: post.pinned,
    visual_profile: post.visualProfile,
  }));
}

export function enrichPlaybooks(generated: GeneratedPlaybook[], posts: SessionPost[]): CarouselPlaybook[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const enriched: CarouselPlaybook[] = [];
  for (const playbook of generated) {
    const postIds = [...new Set(playbook.post_ids)].filter((id) => byId.has(id));
    const members = postIds.map((id) => byId.get(id)!);
    if (!members.length) continue;
    const computed = stats(members);
    const profiles = members.map((post) => post.visualProfile).filter((profile): profile is VisualProfile => Boolean(profile));
    const observedVisualSource = dominant(profiles.map((profile) => profile.visualSource), playbook.visual_source as VisualSource);
    const observedStructure = dominant(profiles.map((profile) => profile.primaryStructure), playbook.structure as ContentStructure);
    const observedProductPattern = dominant(profiles.map((profile) => profile.product.pattern), playbook.product_pattern as ProductPattern);
    enriched.push({
      id: String(randomUUID()),
      title: playbook.title,
      summary: playbook.summary,
      visualSource: observedVisualSource,
      structure: observedStructure,
      productPattern: observedProductPattern,
      postIds,
      sampleCount: members.length,
      creatorCount: computed.creatorCount,
      medianViews: computed.medianViews,
      medianSaveRate: computed.medianSaveRate,
      hookTemplates: playbook.hook_templates,
      slideFlow: playbook.slide_flow.map((slide) => ({
        role: slide.role,
        label: slide.label,
        copyFormula: slide.copy_formula,
        visualDirection: slide.visual_direction,
        productSlot: slide.product_slot,
      })),
      whyItWorks: playbook.why_it_works,
      confidence: playbook.confidence,
      singleCreator: computed.creatorCount === 1,
    });
  }
  return enriched;
}

export function mapVisualProfile(raw: {
  visual_source: VisualSource;
  layout_style: VisualProfile["layoutStyle"];
  primary_structure: ContentStructure;
  secondary_structures: ContentStructure[];
  slide_roles: Array<{ index: number; role: VisualProfile["slideRoles"][number]["role"]; confidence: number }>;
  hook_pattern: string;
  visual_notes: string;
  product: { present: boolean; pattern: ProductPattern; product_name: string | null; first_slide: number | null; confidence: number };
  cta_pattern: string | null;
  confidence: number;
  deep_analysis_recommended: boolean;
  rationale: string;
}): VisualProfile {
  return {
    visualSource: raw.visual_source,
    layoutStyle: raw.layout_style,
    primaryStructure: raw.primary_structure,
    secondaryStructures: raw.secondary_structures,
    slideRoles: raw.slide_roles,
    hookPattern: raw.hook_pattern,
    visualNotes: raw.visual_notes,
    product: {
      present: raw.product.present,
      pattern: raw.product.pattern,
      productName: raw.product.product_name,
      firstSlide: raw.product.first_slide,
      confidence: raw.product.confidence,
    },
    ctaPattern: raw.cta_pattern,
    confidence: raw.confidence,
    deepAnalysisRecommended: raw.deep_analysis_recommended,
    rationale: raw.rationale,
  };
}
