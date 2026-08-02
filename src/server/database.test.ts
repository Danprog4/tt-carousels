import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CarouselPost, PinterestImage, ResearchBrief, StoryboardVariant } from "../shared/types.js";
import { CarouselDatabase } from "./database.js";

const temporaryDirectories: string[] = [];

function databaseForTest(): CarouselDatabase {
  const directory = mkdtempSync(resolve(tmpdir(), "carousel-lab-test-"));
  temporaryDirectories.push(directory);
  return new CarouselDatabase(resolve(directory, "test.sqlite"));
}

const brief: ResearchBrief = {
  topic: "face debloat",
  audience: "men",
  goal: "find product funnels",
  language: "English",
  include: "apps",
  exclude: "",
};

const post: CarouselPost = {
  id: "post-1",
  url: "https://www.tiktok.com/@creator/photo/1",
  author: { username: "creator" },
  caption: "Three reasons your face looks puffy",
  slides: [
    { index: 1, imageUrl: "https://p16-sign.tiktokcdn.com/one.jpg" },
    { index: 2, imageUrl: "https://p16-sign.tiktokcdn.com/two.jpg" },
  ],
  metrics: { views: 120_000, saves: 4_200 },
};

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("CarouselDatabase", () => {
  it("deduplicates a post across multiple search queries", () => {
    const database = databaseForTest();
    const session = database.createSession({ title: "Research", brief, queries: ["face debloat", "puffy face"] });
    database.upsertPost(session.id, post, "face debloat", 8);
    database.upsertPost(session.id, post, "puffy face", 3);

    const stored = database.getSession(session.id)!;
    expect(stored.posts).toHaveLength(1);
    expect(stored.posts[0].searchQueries).toEqual(["face debloat", "puffy face"]);
    expect(stored.posts[0].bestSearchRank).toBe(3);
  });

  it("keeps AI assessment and human override separate", () => {
    const database = databaseForTest();
    const session = database.createSession({ title: "Research", brief, queries: ["face debloat"] });
    database.upsertPost(session.id, post, "face debloat", 1);
    database.setAiAssessment(session.id, post.id, { status: "skip", score: 48, reason: "Borderline match" });

    const manuallyKept = database.setHumanStatus(session.id, post.id, "relevant")!;
    expect(manuallyKept.aiStatus).toBe("skip");
    expect(manuallyKept.humanStatus).toBe("relevant");
    expect(manuallyKept.finalStatus).toBe("relevant");

    const reset = database.setHumanStatus(session.id, post.id, null)!;
    expect(reset.finalStatus).toBe("skip");
  });

  it("persists pins, visual profiles and pattern-run progress", () => {
    const database = databaseForTest();
    const session = database.createSession({ title: "Research", brief, queries: ["face debloat"] });
    database.upsertPost(session.id, post, "face debloat", 1);
    database.setPinned(session.id, post.id, true);
    database.setVisualProfile(session.id, post.id, {
      visualSource: "pinterest_like",
      layoutStyle: "single_image_text",
      primaryStructure: "tips_list",
      secondaryStructures: [],
      slideRoles: [{ index: 1, role: "hook", confidence: 0.9 }, { index: 2, role: "tip", confidence: 0.8 }],
      hookPattern: "Three reasons",
      visualNotes: "Curated lifestyle photos",
      product: { present: false, pattern: "none", productName: null, firstSlide: null, confidence: 0.9 },
      ctaPattern: null,
      confidence: 0.87,
      deepAnalysisRecommended: false,
      rationale: "Repeated visual system",
    });
    const run = database.createPatternRun(session.id, false, [post.id]);
    database.setPatternProgress(run.id, { status: "running", stage: "visual_analysis", completed: 1, inputTokens: 120, outputTokens: 30 });
    database.completePatternRun(run.id, [], [], 120, 30);

    const stored = database.getSession(session.id)!;
    expect(stored.posts[0].pinned).toBe(true);
    expect(stored.posts[0].visualProfile?.visualSource).toBe("pinterest_like");
    expect(stored.analysis?.status).toBe("complete");
    expect(stored.analysis?.inputTokens).toBe(120);
  });

  it("lists saved carousel projects across research sessions", () => {
    const database = databaseForTest();
    const session = database.createSession({ title: "Debloat research", brief, queries: ["face debloat"] });
    const run = database.createPatternRun(session.id, false, []);
    database.completePatternRun(run.id, [], [], 0, 0);
    const draft = database.createDraft({
      sessionId: session.id,
      analysisRunId: run.id,
      playbookId: "playbook-1",
      appBrief: { appName: "bloatfit", audience: "men", promise: "personal plan", proof: "AI scan", cta: "App Store", visualStyle: "UGC", restrictions: "" },
      variants: [],
    });

    const projects = database.listAllDrafts();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: draft.id, sessionTitle: "Debloat research", playbookTitle: "Сохранённый playbook" });
    expect(projects[0].updatedAt).toBe(draft.updatedAt);
  });

  it("keeps Pinterest candidates available for reopening the editor", () => {
    const database = databaseForTest();
    const image: PinterestImage = {
      id: "pin-1",
      query: "young man morning portrait",
      pinUrl: "https://www.pinterest.com/pin/1/",
      imageUrl: "https://i.pinimg.com/originals/example.jpg",
      previewUrl: "https://i.pinimg.com/736x/example.jpg",
      alt: "Morning portrait",
      width: 736,
      height: 1104,
    };
    database.setPinterestCache(image.query, [image]);

    expect(database.getPinterestCache(image.query, Number.POSITIVE_INFINITY)).toEqual([image]);
  });

  it("creates numbered runs with inherited research settings", () => {
    const database = databaseForTest();
    const first = database.createSession({ title: "Face debloat", brief, queries: ["puffy face"], targetResults: 100 });
    const project = database.listProjects()[0];
    const second = database.createRun(project.id, {
      queries: ["puffy face men", "morning depuff"],
      targetResults: 500,
      excludeSeen: true,
      saveAsDefaults: true,
    });

    const updated = database.getProject(project.id)!;
    expect(first.runNumber).toBe(1);
    expect(second).toMatchObject({ runNumber: 2, targetResults: 500, excludeSeen: true });
    expect(second.brief).toEqual(brief);
    expect(updated.defaultQueries).toEqual(["puffy face men", "morning depuff"]);
    expect(updated.defaultTarget).toBe(500);
    expect(updated.runs.map((run) => run.runNumber)).toEqual([2, 1]);
  });

  it("does not mark an exhausted search as complete when it missed the target", () => {
    const database = databaseForTest();
    const session = database.createSession({ title: "Research", brief, queries: ["face debloat"], targetResults: 100 });

    database.setSearchFinished(session.id, undefined, true);

    expect(database.getSession(session.id)?.status).toBe("partial");
  });

  it("persists Remix history, folders and an arbitrary number of variants", () => {
    const database = databaseForTest();
    database.upsertSourcePost(post);
    const folder = database.createRemixFolder("Routine · UGC");
    const item = database.createRemixItem({
      sourceUrl: post.url,
      sourcePostId: post.id,
      folderId: folder.id,
      autoFolder: false,
      requestedVariants: 10,
      includeApp: true,
      appBrief: { appName: "bloatfit", audience: "men", promise: "personal plan", proof: "AI scan", cta: "App Store", visualStyle: "UGC", restrictions: "" },
      instructions: "Short hooks",
    });
    const variant: StoryboardVariant = {
      title: "Morning reset",
      angle: "A short routine",
      slides: [{
        index: 1,
        role: "hook",
        copy: "Your morning face needs this",
        visualBrief: "Selfie in soft daylight",
        sourcePostIds: [post.id],
        productSlide: false,
        design: { pinterestQuery: "man morning selfie", selectedImage: null, textPosition: "center", textAlign: "center", overlayStyle: "scrim", textScale: 1.15 },
      }],
    };
    database.updateRemixVariants(item.id, Array.from({ length: 10 }, (_, index) => ({ ...variant, title: `${variant.title} ${index + 1}` })));

    expect(database.listRemixFolders()[0]).toMatchObject({ id: folder.id, itemCount: 1 });
    expect(database.getRemixItem(item.id)).toMatchObject({ requestedVariants: 10, completedVariants: 10, sourcePost: { id: post.id } });
    expect(database.getRemixItem(item.id)?.variants).toHaveLength(10);
    expect(database.moveRemixItem(item.id, null)?.folderId).toBeNull();
  });
});
