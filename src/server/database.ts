import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  AppBrief,
  AiStatus,
  CarouselDraft,
  CarouselProject,
  CarouselPlaybook,
  CarouselPost,
  CategorySummary,
  DecisionStatus,
  PatternAnalysisRun,
  PatternRunStage,
  PatternRunStatus,
  PinterestImage,
  ResearchBrief,
  ResearchProject,
  ResearchSession,
  ResearchSessionSummary,
  SessionPost,
  SessionStatus,
  StoryboardVariant,
  VisualAnalysisStatus,
  VisualProfile,
} from "../shared/types.js";

const DEFAULT_DATABASE_PATH = resolve(process.cwd(), "data/carousel-lab.sqlite");

interface SessionRow {
  id: string;
  project_id: string | null;
  run_number: number | null;
  title: string;
  brief_json: string;
  queries_json: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  error: string | null;
  completed_queries: number;
  total_queries: number;
  current_query: string | null;
  target_results: number | null;
  exclude_seen: number | null;
}

interface ResearchProjectRow {
  id: string;
  title: string;
  brief_json: string;
  default_queries_json: string;
  default_target: number;
  created_at: string;
  updated_at: string;
}

interface SessionPostRow {
  id: string;
  url: string;
  author_username: string;
  author_display_name: string | null;
  caption: string;
  post_created_at: string | null;
  slides_json: string;
  sound_json: string;
  metrics_json: string;
  search_queries_json: string;
  best_search_rank: number;
  ai_status: AiStatus;
  ai_score: number | null;
  ai_niche_score: number | null;
  ai_product_score: number | null;
  ai_app_score: number | null;
  ai_reason: string | null;
  human_status: DecisionStatus | null;
  pinned: number;
  visual_status: VisualAnalysisStatus;
  visual_profile_json: string | null;
}

interface AnalysisRunRow {
  id: string;
  session_id: string;
  status: PatternRunStatus;
  stage: PatternRunStage;
  include_maybe: number;
  selected_post_ids_json: string;
  completed: number;
  total: number;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  categories_json: string;
  playbooks_json: string;
  created_at: string;
  updated_at: string;
}

interface DraftRow {
  id: string;
  session_id: string;
  analysis_run_id: string;
  playbook_id: string;
  app_brief_json: string;
  variants_json: string;
  created_at: string;
  updated_at: string | null;
}

interface DraftProjectRow extends DraftRow {
  session_title: string;
  playbooks_json: string;
}

interface PinterestCacheRow {
  query: string;
  results_json: string;
  created_at: string;
}

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class CarouselDatabase {
  readonly path: string;
  private readonly db: Database.Database;

  constructor(databasePath = process.env.CAROUSEL_DB_PATH || DEFAULT_DATABASE_PATH) {
    this.path = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        run_number INTEGER,
        title TEXT NOT NULL,
        brief_json TEXT NOT NULL,
        queries_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT,
        completed_queries INTEGER NOT NULL DEFAULT 0,
        total_queries INTEGER NOT NULL DEFAULT 0,
        current_query TEXT,
        target_results INTEGER NOT NULL DEFAULT 100,
        exclude_seen INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS research_projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        brief_json TEXT NOT NULL,
        default_queries_json TEXT NOT NULL,
        default_target INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        author_username TEXT NOT NULL,
        author_display_name TEXT,
        caption TEXT NOT NULL,
        post_created_at TEXT,
        slides_json TEXT NOT NULL,
        sound_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_posts (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        search_queries_json TEXT NOT NULL DEFAULT '[]',
        best_search_rank INTEGER NOT NULL,
        ai_status TEXT NOT NULL DEFAULT 'pending',
        ai_score REAL,
        ai_niche_score REAL,
        ai_product_score REAL,
        ai_app_score REAL,
        ai_reason TEXT,
        human_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, post_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_posts_session ON session_posts(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_posts_ai_status ON session_posts(session_id, ai_status);
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_username);

      CREATE TABLE IF NOT EXISTS analysis_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT NOT NULL DEFAULT 'preparing',
        include_maybe INTEGER NOT NULL DEFAULT 0,
        selected_post_ids_json TEXT NOT NULL DEFAULT '[]',
        completed INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        categories_json TEXT NOT NULL DEFAULT '[]',
        playbooks_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS carousel_drafts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
        playbook_id TEXT NOT NULL,
        app_brief_json TEXT NOT NULL,
        variants_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pinterest_search_cache (
        query TEXT PRIMARY KEY,
        results_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_runs_session ON analysis_runs(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_carousel_drafts_session ON carousel_drafts(session_id, created_at DESC);
    `);
    this.ensureColumn("session_posts", "pinned", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("session_posts", "visual_status", "TEXT NOT NULL DEFAULT 'pending'");
    this.ensureColumn("session_posts", "visual_profile_json", "TEXT");
    this.ensureColumn("carousel_drafts", "updated_at", "TEXT");
    this.ensureColumn("sessions", "project_id", "TEXT");
    this.ensureColumn("sessions", "run_number", "INTEGER");
    this.ensureColumn("sessions", "target_results", "INTEGER NOT NULL DEFAULT 100");
    this.ensureColumn("sessions", "exclude_seen", "INTEGER NOT NULL DEFAULT 0");
    this.db.prepare("UPDATE carousel_drafts SET updated_at = created_at WHERE updated_at IS NULL").run();
    this.migrateLegacyProjects();
  }

  private migrateLegacyProjects(): void {
    const sessions = this.db.prepare("SELECT * FROM sessions WHERE project_id IS NULL ORDER BY created_at ASC").all() as SessionRow[];
    if (!sessions.length) return;
    const grouped = new Map<string, SessionRow[]>();
    for (const session of sessions) {
      const brief = parseJson<ResearchBrief>(session.brief_json, { topic: session.title, audience: "", goal: "", language: "English", include: "", exclude: "" });
      const key = brief.topic.trim().toLocaleLowerCase() || session.title.trim().toLocaleLowerCase();
      grouped.set(key, [...(grouped.get(key) || []), session]);
    }
    const transaction = this.db.transaction(() => {
      for (const group of grouped.values()) {
        const latest = group[group.length - 1];
        const projectId = randomUUID();
        const brief = parseJson<ResearchBrief>(latest.brief_json, { topic: latest.title, audience: "", goal: "", language: "English", include: "", exclude: "" });
        const queries = [...new Set(group.flatMap((session) => parseJson<string[]>(session.queries_json, [])))];
        const title = latest.title.replace(/\s*[·—-]\s*(test|demo|run|pass|проход).*$/i, "").trim() || brief.topic;
        const createdAt = group[0].created_at;
        const updatedAt = latest.updated_at;
        const resultCounts = group.map((session) => Number((this.db.prepare("SELECT COUNT(*) AS count FROM session_posts WHERE session_id = ?").get(session.id) as { count: number }).count));
        const defaultTarget = Math.max(100, ...resultCounts);
        this.db.prepare(`
          INSERT INTO research_projects (id, title, brief_json, default_queries_json, default_target, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(projectId, title, latest.brief_json, JSON.stringify(queries), defaultTarget, createdAt, updatedAt);
        group.forEach((session, index) => {
          this.db.prepare(`
            UPDATE sessions SET project_id = ?, run_number = ?, target_results = ?, exclude_seen = 0 WHERE id = ?
          `).run(projectId, index + 1, Math.max(50, resultCounts[index]), session.id);
        });
      }
    });
    transaction();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  recoverInterruptedSessions(): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE sessions
      SET status = 'interrupted', current_query = NULL, updated_at = ?
      WHERE status = 'searching'
    `).run(now);
    this.db.prepare(`
      UPDATE analysis_runs
      SET status = 'interrupted', error = 'Анализ был остановлен вместе с приложением', updated_at = ?
      WHERE status IN ('queued', 'running')
    `).run(now);
  }

  createSession(input: { title: string; brief: ResearchBrief; queries: string[]; targetResults?: number }): ResearchSession {
    const projectId = randomUUID();
    const now = new Date().toISOString();
    const queries = [...new Set(input.queries.map((query) => query.trim()).filter(Boolean))];
    const targetResults = input.targetResults || 100;
    this.db.prepare(`
      INSERT INTO research_projects (id, title, brief_json, default_queries_json, default_target, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, input.title.trim(), JSON.stringify(input.brief), JSON.stringify(queries), targetResults, now, now);
    return this.createRun(projectId, { title: "Проход 01", queries, targetResults, excludeSeen: false });
  }

  createRun(projectId: string, input: { title?: string; queries: string[]; targetResults: number; excludeSeen: boolean; saveAsDefaults?: boolean }): ResearchSession {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Исследование не найдено");
    const id = randomUUID();
    const now = new Date().toISOString();
    const queries = [...new Set(input.queries.map((query) => query.trim()).filter(Boolean))];
    const runNumberRow = this.db.prepare("SELECT COALESCE(MAX(run_number), 0) + 1 AS next FROM sessions WHERE project_id = ?").get(projectId) as { next: number };
    const runNumber = runNumberRow.next;
    const title = input.title?.trim() || `Проход ${String(runNumber).padStart(2, "0")} · цель ${input.targetResults}`;
    this.db.prepare(`
      INSERT INTO sessions (
        id, project_id, run_number, title, brief_json, queries_json, status, created_at, updated_at,
        completed_queries, total_queries, target_results, exclude_seen
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?, ?)
    `).run(id, projectId, runNumber, title, JSON.stringify(project.brief), JSON.stringify(queries), now, now, queries.length, input.targetResults, input.excludeSeen ? 1 : 0);
    if (input.saveAsDefaults) {
      this.db.prepare(`
        UPDATE research_projects SET default_queries_json = ?, default_target = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(queries), input.targetResults, now, projectId);
    } else {
      this.db.prepare("UPDATE research_projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    }
    return this.getSession(id)!;
  }

  listSessions(): ResearchSessionSummary[] {
    const rows = this.db.prepare(`
      SELECT s.*, COUNT(sp.post_id) AS result_count
      FROM sessions s
      LEFT JOIN session_posts sp ON sp.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all() as Array<SessionRow & { result_count: number }>;
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id || "",
      runNumber: row.run_number || 1,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resultCount: row.result_count,
      completedQueries: row.completed_queries,
      totalQueries: row.total_queries,
      currentQuery: row.current_query,
      targetResults: row.target_results || 100,
      excludeSeen: Boolean(row.exclude_seen),
    }));
  }

  listProjects(): ResearchProject[] {
    const rows = this.db.prepare("SELECT * FROM research_projects ORDER BY updated_at DESC").all() as ResearchProjectRow[];
    const sessions = this.listSessions();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      brief: parseJson<ResearchBrief>(row.brief_json, { topic: "", audience: "", goal: "", language: "English", include: "", exclude: "" }),
      defaultQueries: parseJson<string[]>(row.default_queries_json, []),
      defaultTarget: row.default_target,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      runs: sessions.filter((session) => session.projectId === row.id).sort((a, b) => b.runNumber - a.runNumber),
    }));
  }

  getProject(projectId: string): ResearchProject | null {
    return this.listProjects().find((project) => project.id === projectId) || null;
  }

  getSession(id: string): ResearchSession | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    if (!row) return null;
    const postRows = this.db.prepare(`
      SELECT p.*, sp.search_queries_json, sp.best_search_rank, sp.ai_status,
             sp.ai_score, sp.ai_niche_score, sp.ai_product_score, sp.ai_app_score,
             sp.ai_reason, sp.human_status, sp.pinned, sp.visual_status,
             sp.visual_profile_json
      FROM session_posts sp
      JOIN posts p ON p.id = sp.post_id
      WHERE sp.session_id = ?
      ORDER BY sp.best_search_rank ASC, p.id ASC
    `).all(id) as SessionPostRow[];
    const posts = postRows.map((postRow) => this.mapSessionPost(postRow));
    return {
      id: row.id,
      projectId: row.project_id || "",
      runNumber: row.run_number || 1,
      title: row.title,
      brief: parseJson<ResearchBrief>(row.brief_json, {
        topic: "",
        audience: "",
        goal: "",
        language: "",
        include: "",
        exclude: "",
      }),
      queries: parseJson<string[]>(row.queries_json, []),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error,
      completedQueries: row.completed_queries,
      totalQueries: row.total_queries,
      currentQuery: row.current_query,
      targetResults: row.target_results || 100,
      excludeSeen: Boolean(row.exclude_seen),
      resultCount: posts.length,
      posts,
      analysis: this.getLatestPatternRun(id),
      drafts: this.listDrafts(id),
    };
  }

  setSearchStarted(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) throw new Error("Research session not found");
    this.db.prepare(`
      UPDATE sessions
      SET status = 'searching', error = NULL, completed_queries = 0,
          total_queries = ?, current_query = NULL, updated_at = ?
      WHERE id = ?
    `).run(session.queries.length, new Date().toISOString(), sessionId);
  }

  setSearchProgress(sessionId: string, completedQueries: number, currentQuery: string | null): void {
    this.db.prepare(`
      UPDATE sessions
      SET completed_queries = ?, current_query = ?, updated_at = ?
      WHERE id = ?
    `).run(completedQueries, currentQuery, new Date().toISOString(), sessionId);
  }

  setSearchFinished(sessionId: string, error?: string): void {
    this.db.prepare(`
      UPDATE sessions
      SET status = ?, error = ?, current_query = NULL, updated_at = ?
      WHERE id = ?
    `).run(error ? "failed" : "complete", error || null, new Date().toISOString(), sessionId);
  }

  upsertPost(sessionId: string, post: CarouselPost, query: string, rank: number): void {
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO posts (
          id, url, author_username, author_display_name, caption, post_created_at,
          slides_json, sound_json, metrics_json, first_seen_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          url = excluded.url,
          author_username = excluded.author_username,
          author_display_name = excluded.author_display_name,
          caption = excluded.caption,
          post_created_at = excluded.post_created_at,
          slides_json = excluded.slides_json,
          sound_json = excluded.sound_json,
          metrics_json = excluded.metrics_json,
          updated_at = excluded.updated_at
      `).run(
        post.id,
        post.url,
        post.author.username,
        post.author.displayName || null,
        post.caption,
        post.createdAt || null,
        JSON.stringify(post.slides),
        JSON.stringify(post.sound || {}),
        JSON.stringify(post.metrics),
        now,
        now,
      );

      const existing = this.db.prepare(`
        SELECT search_queries_json, best_search_rank
        FROM session_posts WHERE session_id = ? AND post_id = ?
      `).get(sessionId, post.id) as { search_queries_json: string; best_search_rank: number } | undefined;
      const searchQueries = existing
        ? [...new Set([...parseJson<string[]>(existing.search_queries_json, []), query])]
        : [query];
      const bestRank = existing ? Math.min(existing.best_search_rank, rank) : rank;
      this.db.prepare(`
        INSERT INTO session_posts (
          session_id, post_id, search_queries_json, best_search_rank, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, post_id) DO UPDATE SET
          search_queries_json = excluded.search_queries_json,
          best_search_rank = excluded.best_search_rank,
          updated_at = excluded.updated_at
      `).run(sessionId, post.id, JSON.stringify(searchQueries), bestRank, now, now);
    });
    transaction();
  }

  hasPostInOtherProjectRun(projectId: string, sessionId: string, postId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1
      FROM session_posts sp
      JOIN sessions s ON s.id = sp.session_id
      WHERE s.project_id = ? AND s.id != ? AND sp.post_id = ?
      LIMIT 1
    `).get(projectId, sessionId, postId);
    return Boolean(row);
  }

  setHumanStatus(sessionId: string, postId: string, status: DecisionStatus | null): SessionPost | null {
    this.db.prepare(`
      UPDATE session_posts SET human_status = ?, updated_at = ?
      WHERE session_id = ? AND post_id = ?
    `).run(status, new Date().toISOString(), sessionId, postId);
    return this.getSession(sessionId)?.posts.find((post) => post.id === postId) || null;
  }

  setPinned(sessionId: string, postId: string, pinned: boolean): SessionPost | null {
    this.db.prepare(`
      UPDATE session_posts SET pinned = ?, updated_at = ?
      WHERE session_id = ? AND post_id = ?
    `).run(pinned ? 1 : 0, new Date().toISOString(), sessionId, postId);
    return this.getSession(sessionId)?.posts.find((post) => post.id === postId) || null;
  }

  setAiAssessment(sessionId: string, postId: string, assessment: {
    status: AiStatus;
    score?: number | null;
    nicheScore?: number | null;
    productScore?: number | null;
    appScore?: number | null;
    reason?: string | null;
  }): void {
    this.db.prepare(`
      UPDATE session_posts
      SET ai_status = ?, ai_score = ?, ai_niche_score = ?, ai_product_score = ?,
          ai_app_score = ?, ai_reason = ?, updated_at = ?
      WHERE session_id = ? AND post_id = ?
    `).run(
      assessment.status,
      assessment.score ?? null,
      assessment.nicheScore ?? null,
      assessment.productScore ?? null,
      assessment.appScore ?? null,
      assessment.reason ?? null,
      new Date().toISOString(),
      sessionId,
      postId,
    );
  }

  setVisualProfile(sessionId: string, postId: string, profile: VisualProfile): void {
    this.db.prepare(`
      UPDATE session_posts
      SET visual_status = 'complete', visual_profile_json = ?, updated_at = ?
      WHERE session_id = ? AND post_id = ?
    `).run(JSON.stringify(profile), new Date().toISOString(), sessionId, postId);
  }

  setVisualFailure(sessionId: string, postId: string): void {
    this.db.prepare(`
      UPDATE session_posts SET visual_status = 'failed', updated_at = ?
      WHERE session_id = ? AND post_id = ?
    `).run(new Date().toISOString(), sessionId, postId);
  }

  createPatternRun(sessionId: string, includeMaybe: boolean, selectedPostIds: string[]): PatternAnalysisRun {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO analysis_runs (
        id, session_id, status, stage, include_maybe, selected_post_ids_json,
        completed, total, created_at, updated_at
      ) VALUES (?, ?, 'queued', 'preparing', ?, ?, 0, ?, ?, ?)
    `).run(id, sessionId, includeMaybe ? 1 : 0, JSON.stringify(selectedPostIds), selectedPostIds.length, now, now);
    return this.getPatternRun(id)!;
  }

  getPatternRun(runId: string): PatternAnalysisRun | null {
    const row = this.db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(runId) as AnalysisRunRow | undefined;
    return row ? this.mapPatternRun(row) : null;
  }

  getLatestPatternRun(sessionId: string): PatternAnalysisRun | null {
    const row = this.db.prepare(`
      SELECT * FROM analysis_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(sessionId) as AnalysisRunRow | undefined;
    return row ? this.mapPatternRun(row) : null;
  }

  setPatternProgress(runId: string, input: {
    status: PatternRunStatus;
    stage: PatternRunStage;
    completed: number;
    inputTokens: number;
    outputTokens: number;
  }): void {
    this.db.prepare(`
      UPDATE analysis_runs
      SET status = ?, stage = ?, completed = ?, input_tokens = ?, output_tokens = ?,
          error = NULL, updated_at = ?
      WHERE id = ?
    `).run(input.status, input.stage, input.completed, input.inputTokens, input.outputTokens, new Date().toISOString(), runId);
  }

  completePatternRun(runId: string, categories: CategorySummary[], playbooks: CarouselPlaybook[], inputTokens: number, outputTokens: number): void {
    this.db.prepare(`
      UPDATE analysis_runs
      SET status = 'complete', stage = 'complete', completed = total, error = NULL,
          categories_json = ?, playbooks_json = ?, input_tokens = ?, output_tokens = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(categories), JSON.stringify(playbooks), inputTokens, outputTokens, new Date().toISOString(), runId);
  }

  failPatternRun(runId: string, error: string): void {
    this.db.prepare(`
      UPDATE analysis_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?
    `).run(error, new Date().toISOString(), runId);
  }

  createDraft(input: {
    sessionId: string;
    analysisRunId: string;
    playbookId: string;
    appBrief: AppBrief;
    variants: StoryboardVariant[];
  }): CarouselDraft {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO carousel_drafts (
        id, session_id, analysis_run_id, playbook_id, app_brief_json, variants_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sessionId, input.analysisRunId, input.playbookId, JSON.stringify(input.appBrief), JSON.stringify(input.variants), now, now);
    return {
      id,
      sessionId: input.sessionId,
      analysisRunId: input.analysisRunId,
      playbookId: input.playbookId,
      appBrief: input.appBrief,
      variants: input.variants,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateDraftVariants(sessionId: string, draftId: string, variants: StoryboardVariant[]): CarouselDraft | null {
    const result = this.db.prepare(`
      UPDATE carousel_drafts SET variants_json = ?, updated_at = ? WHERE id = ? AND session_id = ?
    `).run(JSON.stringify(variants), new Date().toISOString(), draftId, sessionId);
    return result.changes ? this.getDraft(sessionId, draftId) : null;
  }

  getDraft(sessionId: string, draftId: string): CarouselDraft | null {
    const row = this.db.prepare(`
      SELECT * FROM carousel_drafts WHERE id = ? AND session_id = ?
    `).get(draftId, sessionId) as DraftRow | undefined;
    return row ? this.mapDraft(row) : null;
  }

  getPinterestCache(query: string, maxAgeMs = 7 * 24 * 60 * 60 * 1_000): PinterestImage[] | null {
    const row = this.db.prepare("SELECT * FROM pinterest_search_cache WHERE query = ?").get(query) as PinterestCacheRow | undefined;
    if (!row || Date.now() - new Date(row.created_at).getTime() > maxAgeMs) return null;
    return parseJson<PinterestImage[]>(row.results_json, []);
  }

  setPinterestCache(query: string, results: PinterestImage[]): void {
    this.db.prepare(`
      INSERT INTO pinterest_search_cache (query, results_json, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(query) DO UPDATE SET results_json = excluded.results_json, created_at = excluded.created_at
    `).run(query, JSON.stringify(results), new Date().toISOString());
  }

  listDrafts(sessionId: string): CarouselDraft[] {
    const rows = this.db.prepare(`
      SELECT * FROM carousel_drafts WHERE session_id = ? ORDER BY created_at DESC
    `).all(sessionId) as DraftRow[];
    return rows.map((row) => this.mapDraft(row));
  }

  listAllDrafts(): CarouselProject[] {
    const rows = this.db.prepare(`
      SELECT d.*, rp.title AS session_title, ar.playbooks_json
      FROM carousel_drafts d
      JOIN sessions s ON s.id = d.session_id
      JOIN research_projects rp ON rp.id = s.project_id
      JOIN analysis_runs ar ON ar.id = d.analysis_run_id
      ORDER BY COALESCE(d.updated_at, d.created_at) DESC
    `).all() as DraftProjectRow[];
    return rows.map((row) => {
      const draft = this.mapDraft(row);
      const playbook = parseJson<CarouselPlaybook[]>(row.playbooks_json, []).find((item) => item.id === row.playbook_id);
      return {
        ...draft,
        sessionTitle: row.session_title,
        playbookTitle: playbook?.title || "Сохранённый playbook",
      };
    });
  }

  private mapDraft(row: DraftRow): CarouselDraft {
    const variants = parseJson<StoryboardVariant[]>(row.variants_json, []).map((variant) => ({
      ...variant,
      slides: variant.slides.map((slide) => ({
        ...slide,
        design: {
          pinterestQuery: slide.design?.pinterestQuery || "",
          selectedImage: slide.design?.selectedImage || null,
          textPosition: slide.design?.textPosition || (slide.role === "hook" ? "center" : "bottom"),
          textAlign: slide.design?.textAlign || (slide.role === "hook" ? "center" : "left"),
          overlayStyle: slide.design?.overlayStyle || (slide.productSlide ? "card" : "scrim"),
          textScale: slide.design?.textScale || (slide.role === "hook" ? 1.15 : 1),
        },
      })),
    }));
    return {
      id: row.id,
      sessionId: row.session_id,
      analysisRunId: row.analysis_run_id,
      playbookId: row.playbook_id,
      appBrief: parseJson<AppBrief>(row.app_brief_json, { appName: "", audience: "", promise: "", proof: "", cta: "", visualStyle: "", restrictions: "" }),
      variants,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    };
  }

  private mapSessionPost(row: SessionPostRow): SessionPost {
    const humanStatus = row.human_status;
    const aiStatus = row.ai_status;
    return {
      id: row.id,
      url: row.url,
      author: {
        username: row.author_username,
        ...(row.author_display_name ? { displayName: row.author_display_name } : {}),
      },
      caption: row.caption,
      ...(row.post_created_at ? { createdAt: row.post_created_at } : {}),
      slides: parseJson(row.slides_json, []),
      sound: parseJson(row.sound_json, {}),
      metrics: parseJson(row.metrics_json, {}),
      searchQueries: parseJson(row.search_queries_json, []),
      bestSearchRank: row.best_search_rank,
      aiStatus,
      aiScore: row.ai_score,
      aiNicheScore: row.ai_niche_score,
      aiProductScore: row.ai_product_score,
      aiAppScore: row.ai_app_score,
      aiReason: row.ai_reason,
      humanStatus,
      finalStatus: humanStatus || aiStatus,
      pinned: Boolean(row.pinned),
      visualStatus: row.visual_status || "pending",
      visualProfile: row.visual_profile_json ? parseJson<VisualProfile | null>(row.visual_profile_json, null) : null,
    };
  }

  private mapPatternRun(row: AnalysisRunRow): PatternAnalysisRun {
    return {
      id: row.id,
      sessionId: row.session_id,
      status: row.status,
      stage: row.stage,
      includeMaybe: Boolean(row.include_maybe),
      selectedPostIds: parseJson<string[]>(row.selected_post_ids_json, []),
      completed: row.completed,
      total: row.total,
      error: row.error,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      categories: parseJson<CategorySummary[]>(row.categories_json, []),
      playbooks: parseJson<CarouselPlaybook[]>(row.playbooks_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
