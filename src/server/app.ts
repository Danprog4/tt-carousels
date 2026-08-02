import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { PinterestImage } from "../shared/types.js";
import { CarouselDatabase } from "./database.js";
import { getCachedThumbnail } from "./media-cache.js";
import { getAiJob, isSearchRunning, startAiJob, startSearchJob } from "./jobs.js";
import { checkChrome } from "./tiktok.js";
import { createStoryboardDraft, startPatternAnalysis } from "./analysis-jobs.js";
import { normalizePinterestQuery, searchPinterest } from "./pinterest.js";
import { renderCarouselZip } from "./carousel-renderer.js";
import { isRemixRunning, startRemixJob } from "./remix-jobs.js";

const briefSchema = z.object({
  topic: z.string().trim().min(2).max(300),
  audience: z.string().trim().max(300).default(""),
  goal: z.string().trim().max(600).default(""),
  language: z.string().trim().max(80).default("English"),
  include: z.string().trim().max(800).default(""),
  exclude: z.string().trim().max(800).default(""),
});

const createSessionSchema = z.object({
  title: z.string().trim().min(2).max(120),
  brief: briefSchema,
  queries: z.array(z.string().trim().min(2).max(160)).min(1).max(300),
  targetResults: z.number().int().min(25).max(10_000).default(100),
});

const createRunSchema = z.object({
  title: z.string().trim().max(120).optional(),
  queries: z.array(z.string().trim().min(2).max(160)).min(1).max(300),
  targetResults: z.number().int().min(25).max(10_000),
  excludeSeen: z.boolean().default(true),
  saveAsDefaults: z.boolean().default(true),
});

const statusSchema = z.object({
  status: z.enum(["skip", "maybe", "relevant"]).nullable(),
});

const pinSchema = z.object({ pinned: z.boolean() });
const patternStartSchema = z.object({ includeMaybe: z.boolean().default(false) });
const appBriefSchema = z.object({
  appName: z.string().trim().min(2).max(100),
  audience: z.string().trim().min(2).max(300),
  promise: z.string().trim().min(3).max(500),
  proof: z.string().trim().max(500).default(""),
  cta: z.string().trim().min(2).max(240),
  visualStyle: z.string().trim().max(240).default("Follow the selected playbook"),
  restrictions: z.string().trim().max(500).default(""),
});
const pinterestImageSchema = z.object({
  id: z.string().min(3).max(100),
  query: z.string().max(120),
  pinUrl: z.string().url(),
  imageUrl: z.string().url(),
  previewUrl: z.string().url(),
  alt: z.string().max(500),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
const storyboardVariantsSchema = z.object({
  variants: z.array(z.object({
    title: z.string().min(1).max(100),
    angle: z.string().min(1).max(300),
    slides: z.array(z.object({
      index: z.number().int().min(1),
      role: z.enum(["hook", "setup", "problem", "proof", "tip", "transition", "product", "cta", "ending", "other"]),
      copy: z.string().min(1).max(600),
      visualBrief: z.string().max(500),
      sourcePostIds: z.array(z.string()).max(12),
      productSlide: z.boolean(),
      design: z.object({
        pinterestQuery: z.string().max(120),
        selectedImage: pinterestImageSchema.nullable(),
        textPosition: z.enum(["top", "center", "bottom"]),
        textAlign: z.enum(["left", "center"]),
        overlayStyle: z.enum(["scrim", "card", "none"]),
        textScale: z.number().min(0.7).max(1.5),
      }),
    })).min(1).max(15),
  })).min(1).max(20),
});
const remixCreateSchema = z.object({
  sourceUrl: z.string().url(),
  sourcePostId: z.string().min(1).optional(),
  folderId: z.string().uuid().nullable().optional(),
  autoFolder: z.boolean().default(true),
  requestedVariants: z.number().int().min(1).max(20),
  includeApp: z.boolean().default(true),
  appBrief: appBriefSchema,
  instructions: z.string().trim().max(1_000).default(""),
});
const remixFolderSchema = z.object({ name: z.string().trim().min(1).max(80) });
const remixMoveSchema = z.object({ folderId: z.string().uuid().nullable() });
const pinterestSearchSchema = z.object({
  query: z.string().trim().min(2).max(120),
  limit: z.number().int().min(5).max(40).default(20),
  force: z.boolean().default(false),
});
const pinterestCacheSchema = z.object({
  queries: z.array(z.string().trim().min(2).max(120)).max(60),
  limit: z.number().int().min(5).max(40).default(20),
});

export function createApp(database: CarouselDatabase) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_request, response) => {
    response.json({ ok: true, chrome: await checkChrome(), databasePath: database.path });
  });

  app.get("/api/sessions", (_request, response) => {
    response.json({ sessions: database.listSessions() });
  });

  app.get("/api/projects", (_request, response) => {
    response.json({ projects: database.listProjects() });
  });

  app.get("/api/drafts", (_request, response) => {
    response.json({ drafts: database.listAllDrafts() });
  });

  app.get("/api/remix", (_request, response) => {
    response.json({
      folders: database.listRemixFolders(),
      items: database.listRemixItems().map((item) => ({ ...item, running: isRemixRunning(item.id) })),
    });
  });

  app.post("/api/remix/folders", (request, response) => {
    const { name } = remixFolderSchema.parse(request.body);
    response.status(201).json(database.createRemixFolder(name));
  });

  app.post("/api/remix/items", async (request, response) => {
    const input = remixCreateSchema.parse(request.body);
    const sourcePost = input.sourcePostId ? database.getPost(input.sourcePostId) : null;
    if (input.sourcePostId && !sourcePost) return response.status(404).json({ error: "Исходная карусель не найдена" });
    if (!sourcePost) {
      const health = await checkChrome();
      if (!health.connected) return response.status(409).json({ error: "Для импорта ссылки подключите исследовательский Chrome" });
    }
    const item = database.createRemixItem({
      ...input,
      sourceUrl: sourcePost?.url || input.sourceUrl,
    });
    startRemixJob(database, item.id);
    return response.status(202).json({ ...item, running: true });
  });

  app.get("/api/remix/items/:itemId", (request, response) => {
    const item = database.getRemixItem(request.params.itemId);
    if (!item) return response.status(404).json({ error: "Remix-проект не найден" });
    return response.json({ ...item, running: isRemixRunning(item.id) });
  });

  app.post("/api/remix/items/:itemId/retry", (request, response) => {
    const item = database.getRemixItem(request.params.itemId);
    if (!item) return response.status(404).json({ error: "Remix-проект не найден" });
    if (isRemixRunning(item.id)) return response.status(409).json({ error: "Обработка уже идёт" });
    const queued = database.queueRemixItem(item.id)!;
    startRemixJob(database, item.id);
    return response.status(202).json({ ...queued, running: true });
  });

  app.patch("/api/remix/items/:itemId", (request, response) => {
    const { variants } = storyboardVariantsSchema.parse(request.body);
    const item = database.updateRemixVariants(request.params.itemId, variants);
    if (!item) return response.status(404).json({ error: "Remix-проект не найден" });
    return response.json(item);
  });

  app.patch("/api/remix/items/:itemId/folder", (request, response) => {
    const { folderId } = remixMoveSchema.parse(request.body);
    const item = database.moveRemixItem(request.params.itemId, folderId);
    if (!item) return response.status(404).json({ error: "Remix-проект не найден" });
    return response.json(item);
  });

  app.post("/api/sessions", (request, response) => {
    const input = createSessionSchema.parse(request.body);
    response.status(201).json(database.createSession(input));
  });

  app.post("/api/projects/:projectId/runs", (request, response) => {
    const input = createRunSchema.parse(request.body);
    const run = database.createRun(request.params.projectId, input);
    return response.status(201).json(run);
  });

  app.get("/api/sessions/:sessionId", (request, response) => {
    const session = database.getSession(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Исследование не найдено" });
    return response.json({
      ...session,
      searchRunning: isSearchRunning(session.id),
      aiJob: getAiJob(session.id),
    });
  });

  app.post("/api/sessions/:sessionId/search", async (request, response) => {
    const session = database.getSession(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Исследование не найдено" });
    const health = await checkChrome();
    if (!health.connected) {
      return response.status(409).json({
        error: "Исследовательский Chrome пока не подключён",
        detail: "Сначала запустите отдельный Chrome с remote debugging на порту 9222.",
      });
    }
    startSearchJob(database, session.id);
    return response.status(202).json({ started: true, sessionId: session.id });
  });

  app.patch("/api/sessions/:sessionId/posts/:postId/status", (request, response) => {
    const { status } = statusSchema.parse(request.body);
    const post = database.setHumanStatus(request.params.sessionId, request.params.postId, status);
    if (!post) return response.status(404).json({ error: "Карусель не найдена" });
    return response.json(post);
  });

  app.patch("/api/sessions/:sessionId/posts/:postId/pin", (request, response) => {
    const { pinned } = pinSchema.parse(request.body);
    const post = database.setPinned(request.params.sessionId, request.params.postId, pinned);
    if (!post) return response.status(404).json({ error: "Карусель не найдена" });
    return response.json(post);
  });

  app.post("/api/sessions/:sessionId/ai", (request, response) => {
    const session = database.getSession(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Исследование не найдено" });
    const job = startAiJob(database, session.id);
    return response.status(202).json({ started: true, sessionId: session.id, job });
  });

  app.post("/api/sessions/:sessionId/patterns", (request, response) => {
    const session = database.getSession(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Исследование не найдено" });
    const { includeMaybe } = patternStartSchema.parse(request.body || {});
    const run = startPatternAnalysis(database, session.id, includeMaybe);
    return response.status(202).json({ started: true, run });
  });

  app.post("/api/sessions/:sessionId/playbooks/:playbookId/drafts", async (request, response) => {
    const appBrief = appBriefSchema.parse(request.body);
    const draft = await createStoryboardDraft(database, {
      sessionId: request.params.sessionId,
      playbookId: request.params.playbookId,
      appBrief,
    });
    return response.status(201).json(draft);
  });

  app.patch("/api/sessions/:sessionId/drafts/:draftId", (request, response) => {
    const { variants } = storyboardVariantsSchema.parse(request.body);
    const draft = database.updateDraftVariants(request.params.sessionId, request.params.draftId, variants);
    if (!draft) return response.status(404).json({ error: "Storyboard не найден" });
    return response.json(draft);
  });

  app.post("/api/pinterest/search", async (request, response) => {
    const input = pinterestSearchSchema.parse(request.body);
    const query = normalizePinterestQuery(input.query);
    const cached = input.force ? null : database.getPinterestCache(query);
    if (cached?.length) return response.json({ query, cached: true, results: cached.slice(0, input.limit) });
    const health = await checkChrome();
    if (!health.connected) return response.status(409).json({ error: "Исследовательский Chrome пока не подключён" });
    const results = await searchPinterest({ query, limit: input.limit });
    database.setPinterestCache(query, results);
    return response.json({ query, cached: false, results });
  });

  app.post("/api/pinterest/cache", (request, response) => {
    const input = pinterestCacheSchema.parse(request.body);
    const queries = [...new Set(input.queries.map(normalizePinterestQuery))];
    const results: Record<string, PinterestImage[]> = {};
    for (const query of queries) {
      const cached = database.getPinterestCache(query, Number.POSITIVE_INFINITY);
      if (cached?.length) results[query] = cached.slice(0, input.limit);
    }
    return response.json({ results });
  });

  app.post("/api/sessions/:sessionId/drafts/:draftId/export", async (request, response) => {
    const { variantIndex, includeText } = z.object({
      variantIndex: z.number().int().min(0).max(19),
      includeText: z.boolean().default(true),
    }).parse(request.body);
    const draft = database.getDraft(request.params.sessionId, request.params.draftId);
    if (!draft) return response.status(404).json({ error: "Storyboard не найден" });
    const archive = await renderCarouselZip(draft, variantIndex, includeText);
    const filename = `${draft.appBrief.appName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "carousel"}-carousel${includeText ? "" : "-no-text"}.zip`;
    response.setHeader("content-type", "application/zip");
    response.setHeader("content-disposition", `attachment; filename="${filename}"`);
    response.send(archive);
  });

  app.post("/api/remix/items/:itemId/export", async (request, response) => {
    const item = database.getRemixItem(request.params.itemId);
    if (!item) return response.status(404).json({ error: "Remix-проект не найден" });
    const { variantIndex, includeText } = z.object({
      variantIndex: z.number().int().min(0).max(19),
      includeText: z.boolean().default(true),
    }).parse(request.body);
    const archive = await renderCarouselZip(item, variantIndex, includeText);
    const filename = `${item.appBrief.appName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "remix"}-remix${includeText ? "" : "-no-text"}.zip`;
    response.setHeader("content-type", "application/zip");
    response.setHeader("content-disposition", `attachment; filename="${filename}"`);
    response.send(archive);
  });

  app.get("/api/media", async (request, response) => {
    const sourceUrl = z.string().url().parse(request.query.url);
    const image = await getCachedThumbnail(sourceUrl);
    response.setHeader("content-type", "image/webp");
    response.setHeader("cache-control", "public, max-age=31536000, immutable");
    response.send(image);
  });

  app.get("/api/demo-image/:seed", (request, response) => {
    const slide = Number(request.query.slide || 1);
    const seed = request.params.seed.replace(/[^a-z0-9-]/gi, "").slice(0, 30);
    const hue = (seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) * 13 + slide * 29) % 360;
    const labels = ["WHY YOUR FACE", "STILL LOOKS PUFFY", "THE MORNING FIX", "TRACK THE HABIT", "SAVE THIS ROUTINE"];
    const label = labels[(slide - 1) % labels.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 46% 30%)"/><stop offset="1" stop-color="hsl(${(hue + 54) % 360} 52% 66%)"/></linearGradient></defs><rect width="720" height="1280" fill="url(#g)"/><circle cx="520" cy="330" r="230" fill="rgba(255,255,255,.12)"/><rect x="52" y="850" width="616" height="250" rx="18" fill="rgba(245,247,244,.9)"/><text x="86" y="930" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#14201a">${label}</text><text x="86" y="990" font-family="Arial, sans-serif" font-size="25" fill="#14201a">Slide ${slide} · ${seed}</text><text x="86" y="1060" font-family="Arial, sans-serif" font-size="21" fill="#425148">Research preview</text></svg>`;
    response.type("image/svg+xml").send(svg);
  });

  const clientRoot = resolve(process.cwd(), "dist/client");
  if (existsSync(clientRoot)) {
    app.use(express.static(clientRoot));
    app.get("/*splat", (_request, response) => response.sendFile(resolve(clientRoot, "index.html")));
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error ? error.message : String(error);
    response.status(error instanceof z.ZodError ? 400 : 500).json({ error: message });
  });
  return app;
}
