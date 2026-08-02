import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiStatus,
  AiJobSnapshot,
  AppBrief,
  AppHealth,
  CarouselDraft,
  CarouselPost,
  CarouselProject,
  CarouselPlaybook,
  DecisionStatus,
  PinterestImage,
  PlaybookSlide,
  ResearchBrief,
  ResearchProject,
  ResearchSession,
  ResearchSessionSummary,
  RemixFolder,
  RemixItem,
  SessionPost,
  StoryboardVariant,
} from "../shared/types";
import { api, mediaUrl } from "./api";
import { comparePostsForReview, isLowTraction, MIN_TRACTION_VIEWS } from "../shared/ranking";

type SessionDetail = ResearchSession & { searchRunning?: boolean; aiJob?: AiJobSnapshot };

const bucketMeta: Record<AiStatus, { title: string; hint: string }> = {
  skip: { title: "AI пропустил", hint: "Сначала — пограничные результаты, где вероятна ошибка оценки." },
  maybe: { title: "Нужно проверить", hint: "Недостаточно сигнала для уверенного решения." },
  relevant: { title: "Релевантно", hint: "Сильное совпадение с темой или продуктовой воронкой." },
  pending: { title: "Без оценки", hint: "Новые результаты до запуска дешёвой AI-классификации." },
};

type DisplayBucket = AiStatus | "low_traction";

const displayBucketMeta: Record<DisplayBucket, { title: string; hint: string }> = {
  ...bucketMeta,
  low_traction: {
    title: "Мало данных",
    hint: `Меньше ${MIN_TRACTION_VIEWS.toLocaleString("ru")} просмотров — оставлены внизу только для ручной проверки.`,
  },
};

const statusLabels: Record<DecisionStatus, string> = {
  skip: "Мимо",
  maybe: "Возможно",
  relevant: "Оставить",
};

function formatMetric(value?: number): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortDate(value?: string): string {
  if (!value) return "дата неизвестна";
  return new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(value));
}

interface StoredStoryboardWorkspace {
  variants: StoryboardVariant[];
  active: number;
  activeSlide: number;
  resultsByQuery: Record<string, PinterestImage[]>;
  savedAt: string;
}

function storyboardStorageKey(draftId: string): string {
  return `carousel-lab:storyboard:${draftId}`;
}

function loadStoryboardWorkspace(draft: Pick<CarouselDraft, "id" | "variants" | "updatedAt">): StoredStoryboardWorkspace & { recoveredVariants: boolean } {
  const fallback = { variants: draft.variants, active: 0, activeSlide: 0, resultsByQuery: {}, savedAt: draft.updatedAt, recoveredVariants: false };
  try {
    const raw = window.localStorage.getItem(storyboardStorageKey(draft.id));
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<StoredStoryboardWorkspace>;
    const active = Math.max(0, Math.min(Math.max(0, draft.variants.length - 1), Number(stored.active) || 0));
    const activeSlide = Math.max(0, Number(stored.activeSlide) || 0);
    const resultsByQuery = stored.resultsByQuery && typeof stored.resultsByQuery === "object" ? stored.resultsByQuery : {};
    const localIsNewer = typeof stored.savedAt === "string" && Date.parse(stored.savedAt) > Date.parse(draft.updatedAt);
    const recoveredVariants = localIsNewer && Array.isArray(stored.variants) && stored.variants.length > 0;
    return {
      variants: recoveredVariants ? stored.variants! : draft.variants,
      active,
      activeSlide,
      resultsByQuery,
      savedAt: typeof stored.savedAt === "string" ? stored.savedAt : draft.updatedAt,
      recoveredVariants,
    };
  } catch {
    return fallback;
  }
}

type EditableStoryboard = CarouselDraft | RemixItem;

function isRemixStoryboard(draft: EditableStoryboard): draft is RemixItem {
  return "sourceUrl" in draft;
}

function Icon({ name }: { name: "search" | "plus" | "external" | "close" | "spark" | "pin" | "arrow" | "layers" | "folder" | "chevron" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    pin: <><path d="m8 3 8 8-2 2 3 3-1 1-3-3-2 2-8-8 2-1 2-4Z" /><path d="m9 15-5 5" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    folder: <><path d="M3 7h7l2 2h9v10H3Z" /><path d="M3 7V5h7l2 2" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function App() {
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [researchProjects, setResearchProjects] = useState<ResearchProject[]>([]);
  const [carouselProjects, setCarouselProjects] = useState<CarouselProject[]>([]);
  const [remixItems, setRemixItems] = useState<RemixItem[]>([]);
  const [remixFolders, setRemixFolders] = useState<RemixFolder[]>([]);
  const [selectedRemixFolder, setSelectedRemixFolder] = useState<string | "all">("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [activePost, setActivePost] = useState<SessionPost | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"research" | "patterns">("research");
  const [workspaceSection, setWorkspaceSection] = useState<"research" | "carousels" | "remix">("research");
  const [draftingPlaybook, setDraftingPlaybook] = useState<CarouselPlaybook | null>(null);
  const [runProject, setRunProject] = useState<ResearchProject | null>(null);
  const [activeDraft, setActiveDraft] = useState<EditableStoryboard | null>(null);
  const [remixSetupSource, setRemixSetupSource] = useState<{ sourceUrl: string; sourcePostId?: string } | null>(null);
  const [newRemixFolderOpen, setNewRemixFolderOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const sessions = useMemo(() => researchProjects.flatMap((project) => project.runs), [researchProjects]);

  const refreshSessions = useCallback(async () => {
    const result = await api.listProjects();
    setResearchProjects(result.projects);
    return result.projects.flatMap((project) => project.runs);
  }, []);

  const refreshCarouselProjects = useCallback(async () => {
    const result = await api.listDrafts();
    setCarouselProjects(result.drafts);
    return result.drafts;
  }, []);

  const refreshRemix = useCallback(async () => {
    const result = await api.listRemix();
    setRemixItems(result.items);
    setRemixFolders(result.folders);
    return result;
  }, []);

  const refreshSession = useCallback(async (id: string, quiet = false) => {
    try {
      const detail = await api.getSession(id);
      setSession(detail);
      if (!quiet) setError(null);
      return detail;
    } catch (requestError) {
      if (!quiet) setError(requestError instanceof Error ? requestError.message : String(requestError));
      return null;
    }
  }, []);

  useEffect(() => {
    void Promise.all([api.health(), refreshSessions(), refreshCarouselProjects(), refreshRemix()])
      .then(([appHealth, existingSessions]) => {
        setHealth(appHealth);
        const firstId = existingSessions[0]?.id || null;
        if (firstId) {
          setSelectedSessionId(firstId);
          if (existingSessions[0]?.projectId) setExpandedProjects(new Set([existingSessions[0].projectId]));
        }
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)))
      .finally(() => setLoading(false));
  }, [refreshCarouselProjects, refreshRemix, refreshSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSession(null);
      return;
    }
    void refreshSession(selectedSessionId);
    setWorkspaceMode("research");
    const projectId = sessions.find((item) => item.id === selectedSessionId)?.projectId;
    if (projectId) setExpandedProjects((current) => new Set(current).add(projectId));
  }, [refreshSession, selectedSessionId, sessions]);

  useEffect(() => {
    const patternRunning = session?.analysis?.status === "queued" || session?.analysis?.status === "running";
    if (!selectedSessionId || (!session?.searchRunning && !session?.aiJob?.running && !patternRunning)) return;
    const timer = window.setInterval(() => {
      void refreshSession(selectedSessionId, true).then((updated) => {
        const updatedPatternRunning = updated?.analysis?.status === "queued" || updated?.analysis?.status === "running";
        if (!updated?.searchRunning && !updated?.aiJob?.running && !updatedPatternRunning) void refreshSessions();
      });
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [refreshSession, refreshSessions, selectedSessionId, session?.searchRunning, session?.aiJob?.running, session?.analysis?.status]);

  useEffect(() => {
    const hasActiveRemix = remixItems.some((item) => ["queued", "importing", "analyzing", "generating"].includes(item.status));
    if (!hasActiveRemix) return;
    const timer = window.setInterval(() => { void refreshRemix(); }, 1_800);
    return () => window.clearInterval(timer);
  }, [refreshRemix, remixItems]);

  async function handleCreated(created: ResearchSession) {
    await refreshSessions();
    setSelectedSessionId(created.id);
    setExpandedProjects((current) => new Set(current).add(created.projectId));
    setWorkspaceSection("research");
    setNewResearchOpen(false);
  }

  async function handleStartSearch() {
    if (!session) return;
    try {
      setError(null);
      await api.startSearch(session.id);
      await refreshSession(session.id);
      await refreshSessions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function handleCreateRun(project: ResearchProject, input: { title?: string; queries: string[]; targetResults: number; excludeSeen: boolean; saveAsDefaults: boolean }) {
    const created = await api.createRun(project.id, input);
    await refreshSessions();
    setExpandedProjects((current) => new Set(current).add(project.id));
    setSelectedSessionId(created.id);
    setWorkspaceSection("research");
    setRunProject(null);
    try {
      await api.startSearch(created.id);
      await refreshSession(created.id);
    } catch (requestError) {
      setError(`Проход создан, но поиск не запустился: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
    }
  }

  async function handleStartAi() {
    if (!session) return;
    try {
      setError(null);
      await api.startAi(session.id);
      await refreshSession(session.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function handleStatus(post: SessionPost, status: DecisionStatus | null) {
    if (!session) return;
    const previous = session;
    const optimisticPost = { ...post, humanStatus: status, finalStatus: status || post.aiStatus };
    setSession({ ...session, posts: session.posts.map((item) => item.id === post.id ? optimisticPost : item) });
    if (activePost?.id === post.id) setActivePost(optimisticPost);
    try {
      await api.setStatus(session.id, post.id, status);
    } catch (requestError) {
      setSession(previous);
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function handlePin(post: SessionPost, pinned: boolean) {
    if (!session) return;
    const previous = session;
    const optimisticPost = { ...post, pinned };
    setSession({ ...session, posts: session.posts.map((item) => item.id === post.id ? optimisticPost : item) });
    if (activePost?.id === post.id) setActivePost(optimisticPost);
    try {
      await api.setPinned(session.id, post.id, pinned);
    } catch (requestError) {
      setSession(previous);
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function handleStartPatterns(includeMaybe: boolean) {
    if (!session) return;
    try {
      setError(null);
      await api.startPatternAnalysis(session.id, includeMaybe);
      setWorkspaceMode("patterns");
      await refreshSession(session.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      throw requestError;
    }
  }

  function openRemixSetup(source?: CarouselPost) {
    setRemixSetupSource({ sourceUrl: source?.url || "", ...(source ? { sourcePostId: source.id } : {}) });
  }

  async function handleRetryRemix(item: RemixItem) {
    try {
      setError(null);
      await api.retryRemix(item.id);
      await refreshRemix();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function handleMoveRemix(item: RemixItem, folderId: string | null) {
    try {
      await api.moveRemix(item.id, folderId);
      await refreshRemix();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => { setWorkspaceSection("research"); setSelectedSessionId(sessions[0]?.id || null); }}>
          <span className="wordmark-mark">C/L</span>
          <span><strong>Carousel Lab</strong><small>TikTok evidence workspace</small></span>
        </button>
        <div className="topbar-actions">
          <div className={`connection ${health?.chrome.connected ? "is-online" : "is-offline"}`}>
            <span className="connection-dot" />
            <span>{health?.chrome.connected ? "Chrome подключён" : "Chrome не подключён"}</span>
          </div>
          <button className={`button button-primary ${workspaceSection === "remix" ? "button-remix" : ""}`} onClick={() => workspaceSection === "remix" ? openRemixSetup() : setNewResearchOpen(true)}>
            <Icon name="plus" /> {workspaceSection === "remix" ? "Новый Remix" : "Новое исследование"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="session-rail">
          <button className={`library-link ${workspaceSection === "carousels" ? "is-active" : ""}`} onClick={() => setWorkspaceSection("carousels")}>
            <span className="library-link-icon"><Icon name="layers" /></span>
            <span><strong>Мои карусели</strong><small>{carouselProjects.length ? `${carouselProjects.length} сохранено` : "Пока пусто"}</small></span>
            <b>{carouselProjects.length}</b>
          </button>
          <button className={`library-link remix-link ${workspaceSection === "remix" ? "is-active" : ""}`} onClick={() => setWorkspaceSection("remix")}>
            <span className="library-link-icon"><Icon name="spark" /></span>
            <span><strong>Remix</strong><small>{remixItems.length ? `${remixItems.length} исходников` : "Из одной — в варианты"}</small></span>
            <b>{remixItems.length}</b>
          </button>
          {workspaceSection === "remix" ? <>
            <div className="rail-label rail-label-with-action"><span>Папки</span><button onClick={() => setNewRemixFolderOpen(true)} aria-label="Создать папку"><Icon name="plus" /></button></div>
            <nav className="remix-folder-tree" aria-label="Папки Remix">
              <button className={selectedRemixFolder === "all" ? "is-active" : ""} onClick={() => setSelectedRemixFolder("all")}><Icon name="layers" /><span><strong>Все карусели</strong><small>{remixItems.length} исходников</small></span></button>
              {remixFolders.map((folder) => <button key={folder.id} className={selectedRemixFolder === folder.id ? "is-active" : ""} onClick={() => setSelectedRemixFolder(folder.id)}><Icon name="folder" /><span><strong>{folder.name}</strong><small>{folder.itemCount} каруселей</small></span></button>)}
              <button className="remix-folder-create" onClick={() => setNewRemixFolderOpen(true)}><Icon name="plus" /><span><strong>Новая папка</strong><small>для нового формата</small></span></button>
            </nav>
          </> : <>
          <div className="rail-label">Исследования</div>
          <nav className="research-tree" aria-label="Исследования и проходы">
            {researchProjects.map((project) => {
              const expanded = expandedProjects.has(project.id);
              return <div className={`research-node ${expanded ? "is-expanded" : ""}`} key={project.id}>
                <div className="research-folder-row">
                  <button className="research-folder" onClick={() => setExpandedProjects((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })} aria-expanded={expanded}>
                    <span className="folder-chevron"><Icon name="chevron" /></span><Icon name="folder" />
                    <span><strong>{project.title}</strong><small>{project.runs.length} {project.runs.length === 1 ? "проход" : "прохода"}</small></span>
                  </button>
                  <button className="new-run-button" onClick={() => setRunProject(project)} aria-label={`Новый проход: ${project.title}`} title="Новый проход"><Icon name="plus" /></button>
                </div>
                {expanded && <div className="run-list">{project.runs.map((item) => <button key={item.id} title={item.title} className={`run-link ${workspaceSection === "research" && selectedSessionId === item.id ? "is-active" : ""}`} onClick={() => { setWorkspaceSection("research"); setSelectedSessionId(item.id); }}><span className="run-branch" /><span><strong>Проход {String(item.runNumber).padStart(2, "0")}</strong><small><i className={`status-pin status-${item.status}`} />{item.resultCount} / {item.targetResults} · {shortDate(item.createdAt)}</small></span></button>)}</div>}
              </div>;
            })}
          </nav>
          </>}
          <div className="rail-footnote">
            <span>Локальное хранилище</span>
            <strong>Ничего не публикуется</strong>
          </div>
        </aside>

        <main className="main-stage">
          {error && <div className="error-banner"><strong>Нужна проверка</strong><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть"><Icon name="close" /></button></div>}
          {loading ? <LoadingState /> : workspaceSection === "remix" ? (
            <RemixWorkspace
              items={remixItems}
              folders={remixFolders}
              selectedFolder={selectedRemixFolder}
              onNew={(sourceUrl) => setRemixSetupSource({ sourceUrl: sourceUrl || "" })}
              onOpen={setActiveDraft}
              onRetry={handleRetryRemix}
              onMove={handleMoveRemix}
              onCreateFolder={() => setNewRemixFolderOpen(true)}
            />
          ) : workspaceSection === "carousels" ? (
            <CarouselLibrary projects={carouselProjects} onOpenDraft={setActiveDraft} onOpenResearch={(sessionId) => { setSelectedSessionId(sessionId); setWorkspaceSection("research"); }} />
          ) : session ? (
            <ResearchView
              session={session}
              project={researchProjects.find((project) => project.id === session.projectId) || null}
              onStartSearch={handleStartSearch}
              onStartAi={handleStartAi}
              onOpenPost={setActivePost}
              onStatus={handleStatus}
              onPin={handlePin}
              mode={workspaceMode}
              onModeChange={setWorkspaceMode}
              onStartPatterns={handleStartPatterns}
              onGenerate={setDraftingPlaybook}
              onOpenDraft={setActiveDraft}
              onOpenProjects={() => setWorkspaceSection("carousels")}
              onRemix={openRemixSetup}
            />
          ) : (
            <EmptyState onCreate={() => setNewResearchOpen(true)} />
          )}
        </main>
      </div>

      {newResearchOpen && <NewResearchModal onClose={() => setNewResearchOpen(false)} onCreated={handleCreated} />}
      {activePost && <PostModal post={activePost} onClose={() => setActivePost(null)} onStatus={handleStatus} onPin={handlePin} onRemix={openRemixSetup} />}
      {draftingPlaybook && session && (
        <GenerateDraftModal
          session={session}
          playbook={draftingPlaybook}
          onClose={() => setDraftingPlaybook(null)}
          onCreated={(draft) => {
            setDraftingPlaybook(null);
            setActiveDraft(draft);
            void refreshSession(session.id, true);
            void refreshCarouselProjects();
          }}
        />
      )}
      {runProject && <NewRunModal project={runProject} onClose={() => setRunProject(null)} onCreate={(input) => handleCreateRun(runProject, input)} />}
      {remixSetupSource && <RemixSetupModal source={remixSetupSource} folders={remixFolders} onClose={() => setRemixSetupSource(null)} onCreated={() => { setRemixSetupSource(null); setWorkspaceSection("remix"); setSelectedRemixFolder("all"); void refreshRemix(); }} />}
      {newRemixFolderOpen && <NewRemixFolderModal onClose={() => setNewRemixFolderOpen(false)} onCreated={() => { setNewRemixFolderOpen(false); void refreshRemix(); }} />}
      {activeDraft && <StoryboardModal draft={activeDraft} onClose={() => {
        const closing = activeDraft;
        setActiveDraft(null);
        if (isRemixStoryboard(closing)) void refreshRemix();
        else {
          void refreshCarouselProjects();
          if (session?.id === closing.sessionId) void refreshSession(closing.sessionId, true);
        }
      }} />}
    </div>
  );
}

const remixStatusCopy: Record<RemixItem["status"], { label: string; detail: string }> = {
  queued: { label: "В очереди", detail: "Задача сохранена и скоро начнётся" },
  importing: { label: "Забираю исходник", detail: "Читаю слайды и метаданные TikTok" },
  analyzing: { label: "Разбираю механику", detail: "AI определяет hook, ритм и визуальный формат" },
  generating: { label: "Создаю варианты", detail: "Готовые варианты сохраняются пакетами" },
  ready: { label: "Готово", detail: "Можно открыть редактор" },
  failed: { label: "Нужна проверка", detail: "Можно продолжить с сохранённого места" },
  interrupted: { label: "Остановлено", detail: "Можно продолжить с сохранённого места" },
};

function remixProgress(item: RemixItem): number {
  if (item.status === "ready") return 100;
  if (item.status === "queued") return 4;
  if (item.status === "importing") return 14;
  if (item.status === "analyzing") return 34;
  if (item.status === "generating") return 42 + Math.round((item.completedVariants / Math.max(1, item.requestedVariants)) * 56);
  return Math.round((item.completedVariants / Math.max(1, item.requestedVariants)) * 100);
}

function RemixWorkspace({
  items,
  folders,
  selectedFolder,
  onNew,
  onOpen,
  onRetry,
  onMove,
  onCreateFolder,
}: {
  items: RemixItem[];
  folders: RemixFolder[];
  selectedFolder: string | "all";
  onNew: (sourceUrl?: string) => void;
  onOpen: (item: RemixItem) => void;
  onRetry: (item: RemixItem) => void;
  onMove: (item: RemixItem, folderId: string | null) => void;
  onCreateFolder: () => void;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const visibleItems = selectedFolder === "all" ? items : items.filter((item) => item.folderId === selectedFolder);
  const selectedFolderName = selectedFolder === "all" ? "Все карусели" : folders.find((folder) => folder.id === selectedFolder)?.name || "Папка";
  const activeCount = items.filter((item) => ["queued", "importing", "analyzing", "generating"].includes(item.status)).length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (sourceUrl.trim()) onNew(sourceUrl.trim());
  }
  return (
    <section className="remix-workspace">
      <header className="remix-hero">
        <div className="remix-hero-copy">
          <span className="eyebrow">Single-source studio</span>
          <h1>Одна карусель.<br /><em>Столько версий, сколько нужно.</em></h1>
          <p>Вставьте TikTok-ссылку, выберите количество и правила. Разбор и генерация продолжатся в фоне — готовый проект останется в истории.</p>
          <form className="remix-url-bar" onSubmit={prepare}>
            <span className="remix-url-mark">t</span>
            <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://www.tiktok.com/@creator/photo/…" aria-label="Ссылка на TikTok-карусель" required />
            <button className="button button-remix button-large">Настроить <Icon name="arrow" /></button>
          </form>
          <div className="remix-flow-note"><span>1 · ссылка</span><i /><span>2 · форма</span><i /><span>3 · фон</span><i /><span>4 · редактор</span></div>
        </div>
        <div className="remix-source-ribbon" aria-hidden="true">
          {["Hook", "Shift", "Proof", "Routine", "App", "CTA"].map((label, index) => <span key={label} style={{ "--ribbon-index": index } as React.CSSProperties}><i>{String(index + 1).padStart(2, "0")}</i><b>{label}</b></span>)}
          <strong>× 10</strong>
        </div>
      </header>

      <div className="remix-history-head">
        <div><span className="eyebrow">История Remix</span><h2>{selectedFolderName}</h2></div>
        <div className="remix-history-stats"><span><strong>{readyCount}</strong> готово</span>{activeCount > 0 && <span className="is-live"><i /><strong>{activeCount}</strong> в фоне</span>}<button className="button button-quiet" onClick={onCreateFolder}><Icon name="folder" /> Новая папка</button></div>
      </div>

      {!visibleItems.length ? <div className="remix-empty">
        <div className="remix-empty-stack"><span /><span /><span /></div>
        <h3>{items.length ? "В этой папке пока пусто" : "Первый исходник начнёт вашу библиотеку"}</h3>
        <p>Карусель появится здесь сразу после отправки формы. Страницу можно не держать открытой.</p>
        <button className="button button-remix" onClick={() => onNew()}><Icon name="plus" /> Добавить карусель</button>
      </div> : <div className="remix-grid">
        {visibleItems.map((item) => {
          const cover = item.sourcePost?.slides[0]?.imageUrl;
          const folder = folders.find((candidate) => candidate.id === item.folderId);
          const status = remixStatusCopy[item.status];
          const canOpen = item.status === "ready" && item.variants.length > 0;
          return <article className={`remix-item status-${item.status}`} key={item.id}>
            <button className="remix-item-cover" onClick={() => canOpen && onOpen(item)} disabled={!canOpen} aria-label={canOpen ? "Открыть варианты в редакторе" : status.label}>
              {cover ? <img src={mediaUrl(cover)} alt="" loading="lazy" /> : <div className="remix-import-placeholder"><i /><span>Импорт TikTok</span></div>}
              <span className="remix-variant-count"><strong>{item.completedVariants}</strong> / {item.requestedVariants}</span>
              {canOpen && <span className="remix-open-cue">Открыть editor <Icon name="arrow" /></span>}
            </button>
            <div className="remix-item-copy">
              <div className="remix-item-kicker"><span>@{item.sourcePost?.author.username || "tiktok"}</span><time>{shortDate(item.updatedAt)}</time></div>
              <h3>{item.sourcePost?.caption || "Новая TikTok-карусель"}</h3>
              <div className="remix-job-state"><span><i className={item.status === "ready" ? "is-ready" : item.status === "failed" || item.status === "interrupted" ? "is-error" : "is-running"} /><strong>{status.label}</strong></span><small>{item.status === "generating" ? `${item.completedVariants} из ${item.requestedVariants} вариантов` : item.error || status.detail}</small></div>
              <div className="remix-progress"><i style={{ width: `${remixProgress(item)}%` }} /></div>
            </div>
            <footer>
              <select value={item.folderId || ""} onChange={(event) => void onMove(item, event.target.value || null)} aria-label="Папка карусели"><option value="">Без папки</option>{folders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>
              {item.status === "failed" || item.status === "interrupted" ? <button className="button button-quiet" onClick={() => void onRetry(item)}>Продолжить</button> : canOpen ? <button className="button button-remix" onClick={() => onOpen(item)}>Редактировать</button> : <span>{folder?.name || (item.autoFolder ? "Папка определится автоматически" : "Без папки")}</span>}
            </footer>
          </article>;
        })}
      </div>}
    </section>
  );
}

function RemixSetupModal({ source, folders, onClose, onCreated }: { source: { sourceUrl: string; sourcePostId?: string }; folders: RemixFolder[]; onClose: () => void; onCreated: (item: RemixItem) => void }) {
  const [sourceUrl, setSourceUrl] = useState(source.sourceUrl);
  const [variantCount, setVariantCount] = useState(10);
  const [folderChoice, setFolderChoice] = useState("auto");
  const [includeApp, setIncludeApp] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [appBrief, setAppBrief] = useState<AppBrief>({
    appName: "bloatfit",
    audience: "Men who want a sharper, less puffy face",
    promise: "Get a personalised face-debloating plan based on your AI face scan and daily habits.",
    proof: "AI face scan, personalised daily plan, habit tracking, progress tracking and daily recommendations.",
    cta: "Download bloatfit on the App Store and get your personalised plan.",
    visualStyle: "Match the source carousel while keeping every execution distinct",
    restrictions: "No medical claims, diagnosis, guaranteed results or unrealistic time-based promises.",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateBrief = (key: keyof AppBrief, value: string) => setAppBrief((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const item = await api.createRemix({
        sourceUrl: sourceUrl.trim(),
        ...(source.sourcePostId ? { sourcePostId: source.sourcePostId } : {}),
        folderId: folderChoice === "auto" || folderChoice === "none" ? null : folderChoice,
        autoFolder: folderChoice === "auto",
        requestedVariants: variantCount,
        includeApp,
        appBrief,
        instructions,
      });
      onCreated(item);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setSaving(false);
    }
  }
  return <div className="modal-backdrop remix-setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
    <form className="remix-setup-modal" onSubmit={submit}>
      <header><div><span className="eyebrow">Новый Remix</span><h2>Настройте варианты до запуска</h2><p>После отправки всё продолжится в фоне и сохранится в истории.</p></div><button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Закрыть"><Icon name="close" /></button></header>
      <div className="remix-setup-body">
        <label className="field remix-source-field"><span>Ссылка на исходную TikTok-карусель</span><div><i>t</i><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} required readOnly={Boolean(source.sourcePostId)} /></div></label>
        <fieldset className="remix-count-picker"><legend>Сколько вариантов создать</legend><div>{[3, 5, 10, 15].map((count) => <button type="button" key={count} className={variantCount === count ? "is-active" : ""} onClick={() => setVariantCount(count)}><strong>{count}</strong><small>{count === 10 ? "оптимально" : "вариантов"}</small></button>)}<label><input type="number" min="1" max="20" value={variantCount} onChange={(event) => setVariantCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /><small>своё</small></label></div><p>Длина и порядок слайдов могут отличаться — AI сохраняет механику, а не копирует текст.</p></fieldset>
        <div className="remix-setup-row">
          <label className="field"><span>Папка / формат</span><select value={folderChoice} onChange={(event) => setFolderChoice(event.target.value)}><option value="auto">Предложить автоматически</option><option value="none">Пока без папки</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><small>Автопапка появится после визуального разбора.</small></label>
          <label className="remix-app-toggle"><input type="checkbox" checked={includeApp} onChange={(event) => setIncludeApp(event.target.checked)} /><span><i /><strong>Добавлять приложение</strong><small>Включено по умолчанию · нативная вставка в каждом варианте</small></span></label>
        </div>
        {includeApp && <div className="remix-app-fields">
          <div className="remix-app-fields-head"><Icon name="spark" /><span><strong>Интеграция приложения</strong><small>AI сам выберет естественный переход после полезного контекста.</small></span></div>
          <label className="field"><span>Название</span><input value={appBrief.appName} onChange={(event) => updateBrief("appName", event.target.value)} required /></label>
          <label className="field"><span>Аудитория</span><input value={appBrief.audience} onChange={(event) => updateBrief("audience", event.target.value)} required /></label>
          <label className="field field-wide"><span>Что приложение даёт</span><textarea rows={2} value={appBrief.promise} onChange={(event) => updateBrief("promise", event.target.value)} required /></label>
          <label className="field"><span>Механизм / proof</span><textarea rows={2} value={appBrief.proof} onChange={(event) => updateBrief("proof", event.target.value)} /></label>
          <label className="field"><span>CTA</span><textarea rows={2} value={appBrief.cta} onChange={(event) => updateBrief("cta", event.target.value)} required /></label>
        </div>}
        <label className="field remix-instructions"><span>Дополнительные правила <small>необязательно</small></span><textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Например: больше личного тона, без before/after, все hooks до 8 слов…" /></label>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <footer><span><i /><strong>Фоновый режим</strong><small>Можно сразу вернуться к исследованиям</small></span><div><button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>Отмена</button><button className="button button-remix button-large" disabled={saving || !sourceUrl.trim()}>{saving ? "Сохраняю задачу…" : <>Запустить {variantCount} вариантов <Icon name="arrow" /></>}</button></div></footer>
    </form>
  </div>;
}

function NewRemixFolderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (folder: RemixFolder) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
    <form className="folder-modal" onSubmit={(event) => { event.preventDefault(); setSaving(true); setError(null); void api.createRemixFolder(name).then(onCreated).catch((requestError) => { setSaving(false); setError(requestError instanceof Error ? requestError.message : String(requestError)); }); }}>
      <header><div><span className="eyebrow">Новая категория</span><h2>Создать папку формата</h2></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close" /></button></header>
      <label className="field"><span>Название</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Routine · UGC" required /></label>
      {error && <div className="inline-error">{error}</div>}
      <footer><button type="button" className="button button-quiet" onClick={onClose}>Отмена</button><button className="button button-remix" disabled={saving || !name.trim()}>{saving ? "Создаю…" : "Создать папку"}</button></footer>
    </form>
  </div>;
}

function CarouselLibrary({ projects, onOpenDraft, onOpenResearch }: { projects: CarouselProject[]; onOpenDraft: (draft: CarouselDraft) => void; onOpenResearch: (sessionId: string) => void }) {
  const selectedImages = projects.reduce((total, project) => total + project.variants.flatMap((variant) => variant.slides).filter((slide) => slide.design.selectedImage).length, 0);
  return (
    <section className="carousel-library">
      <header className="library-head">
        <div>
          <span className="eyebrow">Production shelf</span>
          <h1>Мои карусели</h1>
          <p>Все созданные storyboard сохраняются здесь — можно вернуться к тексту, визуалам и экспорту в любой момент.</p>
        </div>
        {projects.length > 0 && <dl><div><dt>Проектов</dt><dd>{projects.length}</dd></div><div><dt>Вариантов</dt><dd>{projects.length * 3}</dd></div><div><dt>Выбрано фото</dt><dd>{selectedImages}</dd></div></dl>}
      </header>
      {!projects.length ? (
        <div className="library-empty">
          <div className="library-empty-mark"><Icon name="layers" /></div>
          <span className="eyebrow">Здесь появятся результаты</span>
          <h2>Сначала создайте storyboard из рабочего playbook</h2>
          <p>После «Получить 3 storyboard» проект автоматически сохранится в этом разделе.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project) => {
            const slideCount = project.variants[0]?.slides.length || 0;
            const completedImages = project.variants.flatMap((variant) => variant.slides).filter((slide) => !slide.productSlide && slide.design.selectedImage).length;
            const neededImages = project.variants.flatMap((variant) => variant.slides).filter((slide) => !slide.productSlide).length;
            return (
              <article className="project-card" key={project.id}>
                <button className="project-preview" onClick={() => onOpenDraft(project)} aria-label={`Редактировать ${project.appBrief.appName}`}>
                  {project.variants.map((variant, variantIndex) => {
                    const cover = variant.slides.find((slide) => !slide.productSlide && slide.design.selectedImage)?.design.selectedImage;
                    return <span key={`${project.id}-${variantIndex}`} className={cover ? "has-image" : ""}>{cover ? <img src={mediaUrl(cover.previewUrl)} alt="" loading="lazy" /> : <><i>0{variantIndex + 1}</i><small>{variant.title}</small></>}</span>;
                  })}
                </button>
                <div className="project-copy">
                  <div className="project-kicker"><span>{project.appBrief.appName}</span><time dateTime={project.updatedAt}>обновлено {shortDate(project.updatedAt)}</time></div>
                  <h2>{project.playbookTitle}</h2>
                  <p>{project.variants[0]?.angle || project.appBrief.promise}</p>
                  <div className="project-progress"><span><b style={{ width: `${neededImages ? Math.round((completedImages / neededImages) * 100) : 100}%` }} /></span><small>{completedImages} из {neededImages} визуалов · {slideCount} слайдов в варианте</small></div>
                </div>
                <footer>
                  <button className="project-source" onClick={() => onOpenResearch(project.sessionId)}>{project.sessionTitle}</button>
                  <button className="button button-primary" onClick={() => onOpenDraft(project)}>Продолжить редактирование <Icon name="arrow" /></button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NewRunModal({ project, onClose, onCreate }: { project: ResearchProject; onClose: () => void; onCreate: (input: { title?: string; queries: string[]; targetResults: number; excludeSeen: boolean; saveAsDefaults: boolean }) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [targetResults, setTargetResults] = useState(project.defaultTarget > 100 ? project.defaultTarget : 500);
  const [queriesText, setQueriesText] = useState(project.defaultQueries.join("\n"));
  const [excludeSeen, setExcludeSeen] = useState(true);
  const [saveAsDefaults, setSaveAsDefaults] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queries = [...new Set(queriesText.split("\n").map((query) => query.trim()).filter(Boolean))];
  const recommendedQueries = Math.max(3, Math.ceil(targetResults / 35));
  const perQueryLimit = Math.min(1_000, Math.max(20, Math.ceil((targetResults / Math.max(1, queries.length)) * 2.2)));
  const queryCoverageLow = queries.length < recommendedQueries;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !creating) onClose(); }}>
      <section className="run-modal" role="dialog" aria-modal="true" aria-label={`Новый проход: ${project.title}`}>
        <header>
          <div><span className="eyebrow">{project.title} / новый проход</span><h2>Собрать следующую выборку</h2><p>Каждый поисковый запрос станет отдельным батчем. Результаты сохранятся отдельно от прошлых проходов.</p></div>
          <button className="icon-button" onClick={onClose} disabled={creating} aria-label="Закрыть"><Icon name="close" /></button>
        </header>
        <div className="run-form">
          <label className="field run-title-field"><span>Название прохода <small>необязательно</small></span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Например: competitor sweep · ${new Intl.DateTimeFormat("ru", { month: "short", year: "numeric" }).format(new Date())}`} /></label>
          <fieldset className="target-picker"><legend>Сколько уникальных каруселей собрать</legend><div>{[100, 300, 500, 1_000, 2_500].map((value) => <button key={value} className={targetResults === value ? "is-active" : ""} onClick={() => setTargetResults(value)}>{value.toLocaleString("ru")}</button>)}<label><input type="number" min="25" max="10000" step="25" value={targetResults} onChange={(event) => setTargetResults(Math.max(25, Math.min(10_000, Number(event.target.value) || 25)))} /><span>своя цель</span></label></div></fieldset>
          <label className="field run-query-field"><span>Поисковые запросы <small>по одному на строку · {queries.length} батчей</small></span><textarea rows={9} value={queriesText} onChange={(event) => setQueriesText(event.target.value)} /></label>
          <div className={`batch-plan ${queryCoverageLow ? "has-warning" : ""}`}>
            <div><span>Цель</span><strong>{targetResults.toLocaleString("ru")}</strong><small>уникальных результатов</small></div>
            <div><span>Батчи</span><strong>{queries.length}</strong><small>по одному запросу</small></div>
            <div><span>Глубина</span><strong>до {perQueryLimit}</strong><small>на запрос, автоматически</small></div>
            <p>{queryCoverageLow ? `Для цели ${targetResults.toLocaleString("ru")} лучше использовать хотя бы ${recommendedQueries} разных запросов — иначе TikTok может исчерпать выдачу раньше.` : "Запросы выполняются последовательно в одной фоновой вкладке. Проход остановится, когда достигнет цели."}</p>
          </div>
          <div className="run-options">
            <label><input type="checkbox" checked={excludeSeen} onChange={(event) => setExcludeSeen(event.target.checked)} /><span><strong>Не брать найденное в прошлых проходах</strong><small>Экономит ручную проверку и AI-оценку; включено по умолчанию.</small></span></label>
            <label><input type="checkbox" checked={saveAsDefaults} onChange={(event) => setSaveAsDefaults(event.target.checked)} /><span><strong>Запомнить цель и запросы</strong><small>Следующий проход этой ниши начнётся с этих настроек.</small></span></label>
          </div>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <footer><button className="button button-quiet" onClick={onClose} disabled={creating}>Отмена</button><button className="button button-primary button-large" disabled={creating || !queries.length || targetResults < 25} onClick={() => {
          setCreating(true); setError(null);
          void onCreate({ title: title.trim() || undefined, queries, targetResults, excludeSeen, saveAsDefaults }).catch((requestError) => { setCreating(false); setError(requestError instanceof Error ? requestError.message : String(requestError)); });
        }}>{creating ? "Создаю проход…" : <>Создать и запустить <Icon name="arrow" /></>}</button></footer>
      </section>
    </div>
  );
}

function ResearchView({
  session,
  project,
  onStartSearch,
  onStartAi,
  onOpenPost,
  onStatus,
  onPin,
  mode,
  onModeChange,
  onStartPatterns,
  onGenerate,
  onOpenDraft,
  onOpenProjects,
  onRemix,
}: {
  session: SessionDetail;
  project: ResearchProject | null;
  onStartSearch: () => void;
  onStartAi: () => void;
  onOpenPost: (post: SessionPost) => void;
  onStatus: (post: SessionPost, status: DecisionStatus | null) => void;
  onPin: (post: SessionPost, pinned: boolean) => void;
  mode: "research" | "patterns";
  onModeChange: (mode: "research" | "patterns") => void;
  onStartPatterns: (includeMaybe: boolean) => Promise<void>;
  onGenerate: (playbook: CarouselPlaybook) => void;
  onOpenDraft: (draft: CarouselDraft) => void;
  onOpenProjects: () => void;
  onRemix: (post: CarouselPost) => void;
}) {
  const [showOnlyOverrides, setShowOnlyOverrides] = useState(false);
  const [analysisSetupOpen, setAnalysisSetupOpen] = useState(false);
  const posts = useMemo(() => showOnlyOverrides ? session.posts.filter((post) => post.humanStatus) : session.posts, [session.posts, showOnlyOverrides]);
  const buckets = useMemo(() => {
    const grouped: Record<DisplayBucket, SessionPost[]> = { skip: [], maybe: [], relevant: [], pending: [], low_traction: [] };
    posts.forEach((post) => {
      const bucket = isLowTraction(post.metrics) ? "low_traction" : post.finalStatus;
      grouped[bucket].push(post);
    });
    (Object.keys(grouped) as DisplayBucket[]).forEach((key) => {
      grouped[key].sort(comparePostsForReview);
    });
    return grouped;
  }, [posts]);
  const reviewed = session.posts.filter((post) => post.humanStatus).length;
  const aiReviewed = session.posts.filter((post) => post.aiStatus !== "pending").length;
  const aiRunning = Boolean(session.aiJob?.running);
  const aiProgress = session.aiJob?.total ? Math.round((session.aiJob.completed / session.aiJob.total) * 100) : 0;
  const progress = session.totalQueries ? Math.round((session.completedQueries / session.totalQueries) * 100) : 0;
  const resultProgress = Math.min(100, Math.round((session.resultCount / session.targetResults) * 100));
  const searchLabel = session.status === "complete" ? "Готово" : session.status === "partial" ? "Недобор" : "Не запущено";
  const searchBarProgress = session.status === "complete" ? 100 : session.status === "partial" ? resultProgress : progress;

  return (
    <>
      <section className="research-head">
        <div className="research-title-block">
          <span className="eyebrow">{project?.title || "Исследование"} · проход {String(session.runNumber).padStart(2, "0")} · {mode === "research" ? "выборка" : "pattern laboratory"}</span>
          <h1>{session.title}</h1>
          <p>{session.brief.topic} · {session.brief.audience || "аудитория не указана"}</p>
        </div>
        <div className="research-actions">
          {mode === "research" ? <>
            <button className="button button-quiet" onClick={() => setShowOnlyOverrides((value) => !value)} aria-pressed={showOnlyOverrides}>
              {showOnlyOverrides ? "Показать всё" : `Мои решения · ${reviewed}`}
            </button>
            <button className="button button-ai" disabled={session.searchRunning || aiRunning || !session.posts.length || aiReviewed === session.posts.length} onClick={onStartAi}>
              <Icon name="spark" /> {aiRunning ? `AI · ${aiProgress}%` : aiReviewed === session.posts.length ? "AI готов" : `Оценить AI · ${session.posts.length - aiReviewed}`}
            </button>
            <button
              className="button button-quiet"
              disabled={!session.posts.length || aiRunning || session.searchRunning}
              onClick={() => session.analysis ? onModeChange("patterns") : setAnalysisSetupOpen(true)}
            >
              {session.analysis?.status === "complete"
                ? `Паттерны · ${session.analysis.playbooks.length}`
                : session.analysis?.status === "running" || session.analysis?.status === "queued"
                  ? `Анализ · ${session.analysis.total ? Math.round((session.analysis.completed / session.analysis.total) * 100) : 0}%`
                  : session.analysis?.status === "failed"
                    ? "Открыть анализ"
                    : "Далее"} <Icon name="arrow" />
            </button>
            <button className="button button-primary" disabled={session.searchRunning || !session.queries.length} onClick={onStartSearch}>
              <Icon name="search" /> {session.searchRunning ? "Идёт поиск…" : session.resultCount ? "Обновить поиск" : "Запустить поиск"}
            </button>
          </> : <>
            <button className="button button-quiet" onClick={() => onModeChange("research")}>← К выборке</button>
            {session.analysis?.status === "complete" && <button className="button button-ai" onClick={() => setAnalysisSetupOpen(true)}><Icon name="spark" /> Пересобрать</button>}
          </>}
        </div>
      </section>

      {mode === "patterns" ? (
        <PatternWorkspace session={session} onStart={() => setAnalysisSetupOpen(true)} onOpenPost={onOpenPost} onGenerate={onGenerate} onOpenDraft={onOpenDraft} onOpenProjects={onOpenProjects} />
      ) : <>

      <section className="research-meter" aria-label="Прогресс исследования">
        <div><strong>{session.resultCount} / {session.targetResults}</strong><span>собрано к цели прохода</span></div>
        <div><strong>{session.queries.length}</strong><span>поисковых запросов</span></div>
        <div><strong>{reviewed}</strong><span>вручную · AI {aiReviewed}</span></div>
        <div className="meter-progress">
          <span><strong>{aiRunning ? `AI ${aiProgress}%` : session.searchRunning ? `${progress}%` : searchLabel}</strong><small>{aiRunning ? `${session.aiJob?.completed || 0} из ${session.aiJob?.total || 0} · только текст` : session.status === "partial" ? `TikTok исчерпал ${session.totalQueries} запросов` : session.currentQuery || "поиск TikTok"}</small></span>
          <i><b style={{ width: `${aiRunning ? aiProgress : searchBarProgress}%` }} /></i>
        </div>
      </section>

      {session.status === "partial" && <div className="inline-note inline-note-warning">Собрано {session.resultCount} из {session.targetResults}. Добавьте больше разных нативных запросов и запустите поиск снова.</div>}
      {session.aiJob?.error && <div className="inline-note inline-note-error">AI остановился: {session.aiJob.error}</div>}

      {!session.posts.length ? (
        <section className="session-empty">
          <div className="session-empty-mark"><Icon name="search" /></div>
          <span className="eyebrow">Поиск ещё не запускался</span>
          <h2>{session.queries.length} запросов готовы к работе</h2>
          <p>{session.queries.slice(0, 4).join(" · ")}{session.queries.length > 4 ? " …" : ""}</p>
          {!session.searchRunning && <button className="button button-primary" onClick={onStartSearch}><Icon name="search" /> Собрать результаты</button>}
        </section>
      ) : (
        <div className="bucket-stack">
          {(["skip", "maybe", "relevant", "pending", "low_traction"] as DisplayBucket[]).map((status) => (
            <Bucket key={status} status={status} posts={buckets[status]} onOpenPost={onOpenPost} onStatus={onStatus} onPin={onPin} onRemix={onRemix} />
          ))}
        </div>
      )}
      </>}

      {analysisSetupOpen && (
        <AnalysisSetupModal
          session={session}
          onClose={() => setAnalysisSetupOpen(false)}
          onStart={async (includeMaybe) => {
            await onStartPatterns(includeMaybe);
            setAnalysisSetupOpen(false);
          }}
        />
      )}
    </>
  );
}

function Bucket({
  status,
  posts,
  onOpenPost,
  onStatus,
  onPin,
  onRemix,
}: {
  status: DisplayBucket;
  posts: SessionPost[];
  onOpenPost: (post: SessionPost) => void;
  onStatus: (post: SessionPost, status: DecisionStatus | null) => void;
  onPin: (post: SessionPost, pinned: boolean) => void;
  onRemix: (post: CarouselPost) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!posts.length) return null;
  return (
    <section className={`bucket bucket-${status}`}>
      <button className="bucket-heading" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
        <span className="bucket-index">{String(posts.length).padStart(2, "0")}</span>
        <span><strong>{displayBucketMeta[status].title}</strong><small>{displayBucketMeta[status].hint}</small></span>
        <span className="bucket-toggle">{collapsed ? "Показать" : "Свернуть"}</span>
      </button>
      {!collapsed && (
        <div className="post-grid">
          {posts.map((post) => <PostCard key={post.id} post={post} onOpen={() => onOpenPost(post)} onStatus={onStatus} onPin={onPin} onRemix={onRemix} />)}
        </div>
      )}
    </section>
  );
}

function PostCard({ post, onOpen, onStatus, onPin, onRemix }: { post: SessionPost; onOpen: () => void; onStatus: (post: SessionPost, status: DecisionStatus | null) => void; onPin: (post: SessionPost, pinned: boolean) => void; onRemix: (post: CarouselPost) => void }) {
  const cover = post.slides[0]?.imageUrl;
  return (
    <article className={`post-card decision-${post.finalStatus}`}>
      <button className={`pin-button ${post.pinned ? "is-pinned" : ""}`} onClick={() => onPin(post, !post.pinned)} aria-label={post.pinned ? "Убрать из важных референсов" : "Сделать важным референсом"} title="Важный референс">
        <Icon name="pin" />
      </button>
      <button className="remix-card-button" onClick={() => onRemix(post)} aria-label="Создать варианты этой карусели" title="Создать варианты"><Icon name="spark" /><span>Remix</span></button>
      <button className="cover-button" onClick={onOpen} aria-label={`Открыть карусель ${post.author.username}`}>
        {cover ? <img src={mediaUrl(cover)} loading="lazy" alt="" /> : <span className="image-missing">Нет обложки</span>}
        <span className="slide-count">{post.slides.length} слайдов</span>
        {post.humanStatus && <span className="human-mark">Вы изменили</span>}
      </button>
      <div className="card-copy">
        <div className="creator-row"><strong>@{post.author.username}</strong><span>{shortDate(post.createdAt)}</span></div>
        <p>{post.caption || "Без подписи"}</p>
        <div className="metric-row">
          <span><strong>{formatMetric(post.metrics.views)}</strong> views</span>
          <span><strong>{formatMetric(post.metrics.saves)}</strong> saves</span>
          <span><strong>{formatMetric(post.metrics.shares)}</strong> shares</span>
        </div>
        {post.aiReason && <div className="ai-reason"><Icon name="spark" /><span>{post.aiReason}</span></div>}
      </div>
      <div className="decision-strip" aria-label="Ручная оценка">
        {(["skip", "maybe", "relevant"] as DecisionStatus[]).map((status) => (
          <button
            key={status}
            className={post.humanStatus === status ? "is-selected" : ""}
            onClick={() => onStatus(post, post.humanStatus === status ? null : status)}
            title={statusLabels[status]}
          >
            {status === "skip" ? "×" : status === "maybe" ? "?" : "✓"}
          </button>
        ))}
      </div>
    </article>
  );
}

function PostModal({ post, onClose, onStatus, onPin, onRemix }: { post: SessionPost; onClose: () => void; onStatus: (post: SessionPost, status: DecisionStatus | null) => void; onPin: (post: SessionPost, pinned: boolean) => void; onRemix: (post: CarouselPost) => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="post-modal" role="dialog" aria-modal="true" aria-label="Просмотр карусели">
        <header className="post-modal-head">
          <div><span className="eyebrow">@{post.author.username}</span><h2>{post.caption || "Карусель без подписи"}</h2></div>
          <div className="modal-actions">
            <button className="button button-remix" onClick={() => { onClose(); onRemix(post); }}><Icon name="spark" /> Создать варианты</button>
            <button className={`button button-quiet ${post.pinned ? "is-pinned" : ""}`} onClick={() => onPin(post, !post.pinned)}><Icon name="pin" /> {post.pinned ? "Важный референс" : "Закрепить"}</button>
            <a className="button button-quiet" href={post.url} target="_blank" rel="noreferrer"><Icon name="external" /> TikTok</a>
            <button className="icon-button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
          </div>
        </header>
        <div className="filmstrip">
          {post.slides.map((slide) => (
            <figure key={slide.index}>
              <img src={mediaUrl(slide.imageUrl)} loading="lazy" alt={`Слайд ${slide.index}`} />
              <figcaption>{String(slide.index).padStart(2, "0")}</figcaption>
            </figure>
          ))}
        </div>
        <footer className="post-modal-foot">
          <div className="metric-row modal-metrics">
            <span><strong>{formatMetric(post.metrics.views)}</strong> views</span>
            <span><strong>{formatMetric(post.metrics.likes)}</strong> likes</span>
            <span><strong>{formatMetric(post.metrics.saves)}</strong> saves</span>
            <span><strong>{formatMetric(post.metrics.comments)}</strong> comments</span>
          </div>
          <div className="modal-decision">
            <span>Моё решение</span>
            {(["skip", "maybe", "relevant"] as DecisionStatus[]).map((status) => (
              <button key={status} className={`button status-button status-button-${status} ${post.humanStatus === status ? "is-selected" : ""}`} onClick={() => onStatus(post, post.humanStatus === status ? null : status)}>
                {statusLabels[status]}
              </button>
            ))}
          </div>
        </footer>
      </section>
    </div>
  );
}

function includedByDefault(post: SessionPost): boolean {
  if (post.pinned) return true;
  if (post.humanStatus) return post.humanStatus === "relevant";
  return !isLowTraction(post.metrics) && post.aiStatus === "relevant";
}

function AnalysisSetupModal({ session, onClose, onStart }: { session: SessionDetail; onClose: () => void; onStart: (includeMaybe: boolean) => Promise<void> }) {
  const [includeMaybe, setIncludeMaybe] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const automatic = session.posts.filter(includedByDefault);
  const optionalMaybe = session.posts.filter((post) => !post.humanStatus && !post.pinned && !isLowTraction(post.metrics) && post.aiStatus === "maybe");
  const lowTraction = session.posts.filter((post) => isLowTraction(post.metrics) && !post.pinned && post.humanStatus !== "relevant");
  const manualAdds = automatic.filter((post) => post.humanStatus === "relevant" || post.pinned).length;
  const total = automatic.length + (includeMaybe ? optionalMaybe.length : 0);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !starting) onClose(); }}>
      <section className="analysis-setup-modal" role="dialog" aria-modal="true" aria-label="Подготовить анализ паттернов">
        <header>
          <div><span className="eyebrow">Следующий этап</span><h2>Найти работающие паттерны</h2></div>
          <button className="icon-button" onClick={onClose} disabled={starting} aria-label="Закрыть"><Icon name="close" /></button>
        </header>
        <div className="analysis-receipt">
          <div className="receipt-total"><strong>{total}</strong><span>каруселей войдут в визуальный анализ</span></div>
          <dl>
            <div><dt>AI выбрал автоматически</dt><dd>{automatic.length - manualAdds}</dd></div>
            <div><dt>Ручные ✓ и pin</dt><dd>{manualAdds}</dd></div>
            <div><dt>«Возможно» вне анализа</dt><dd>{optionalMaybe.length}</dd></div>
            <div><dt>Меньше {formatMetric(MIN_TRACTION_VIEWS)} views</dt><dd>{lowTraction.length}</dd></div>
          </dl>
          <label className="include-toggle">
            <input type="checkbox" checked={includeMaybe} onChange={(event) => setIncludeMaybe(event.target.checked)} />
            <span><strong>Также включить AI «Возможно»</strong><small>Добавит {optionalMaybe.length} каруселей и увеличит vision-анализ.</small></span>
          </label>
          <p className="analysis-cost-note"><Icon name="spark" /> Сначала создаются компактные contact sheets. Полный OCR на этом шаге не запускается.</p>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <footer>
          <button className="button button-quiet" onClick={onClose} disabled={starting}>Вернуться к выборке</button>
          <button className="button button-primary button-large" disabled={starting || total === 0} onClick={() => {
            setStarting(true);
            setError(null);
            void onStart(includeMaybe).catch((requestError) => {
              setStarting(false);
              setError(requestError instanceof Error ? requestError.message : String(requestError));
            });
          }}>{starting ? "Запускаю…" : <>Анализировать {total} <Icon name="arrow" /></>}</button>
        </footer>
      </section>
    </div>
  );
}

const stageCopy = {
  preparing: ["Готовим доказательства", "Проверяем кэш изображений и фиксируем выбранный корпус."],
  visual_analysis: ["Читаем визуальную грамматику", "Определяем стили, структуру и продуктовые слайды по contact sheets."],
  clustering: ["Собираем категории", "Считаем повторяемость, авторов и медианные метрики."],
  playbooks: ["Строим playbooks", "Превращаем повторяющиеся комбинации в готовые slide-by-slide flows."],
  complete: ["Паттерны готовы", "Доказательства связаны с категориями и сценариями."],
} as const;

function humanizeTag(value: string): string {
  return value.replaceAll("_", " ");
}

function withRequiredProductSlot(slides: PlaybookSlide[]): PlaybookSlide[] {
  if (slides.some((slide) => slide.productSlot)) return slides;
  const appSlide: PlaybookSlide = {
    role: "product",
    label: "Нативная связка с приложением",
    copyFormula: "AI свяжет предыдущую проблему или совет с конкретной пользой приложения",
    visualDirection: "Реальный экран приложения или аккуратный mockup в визуальном языке карусели",
    productSlot: true,
  };
  const ctaIndex = slides.findIndex((slide) => slide.role === "cta" || slide.role === "ending");
  const insertionIndex = ctaIndex > 1 ? ctaIndex : Math.max(2, Math.min(slides.length, Math.ceil(slides.length * 0.7)));
  return [...slides.slice(0, insertionIndex), appSlide, ...slides.slice(insertionIndex)];
}

function PatternWorkspace({ session, onStart, onOpenPost, onGenerate, onOpenDraft, onOpenProjects }: { session: SessionDetail; onStart: () => void; onOpenPost: (post: SessionPost) => void; onGenerate: (playbook: CarouselPlaybook) => void; onOpenDraft: (draft: CarouselDraft) => void; onOpenProjects: () => void }) {
  const run = session.analysis;
  if (!run) {
    return (
      <section className="pattern-empty">
        <div className="pattern-orbit"><Icon name="layers" /></div>
        <span className="eyebrow">Из выдачи — в систему</span>
        <h2>Категории должны приводить к готовому сценарию</h2>
        <p>Carousel Lab разберёт визуальный источник, структуру и продуктовую механику, затем соберёт их в доказательные playbooks.</p>
        <button className="button button-primary button-large" onClick={onStart}>Найти паттерны <Icon name="arrow" /></button>
      </section>
    );
  }

  if (run.status === "queued" || run.status === "running") {
    const progress = run.total ? Math.round((run.completed / run.total) * 100) : 0;
    const [title, description] = stageCopy[run.stage];
    const stages = ["preparing", "visual_analysis", "clustering", "playbooks", "complete"] as const;
    const activeIndex = stages.indexOf(run.stage);
    return (
      <section className="pattern-progress">
        <div className="progress-monogram"><span>{progress}</span><small>%</small></div>
        <div className="progress-copy"><span className="eyebrow">Анализ выполняется в фоне</span><h2>{title}</h2><p>{description}</p></div>
        <ol className="stage-track">
          {stages.map((stage, index) => <li key={stage} className={index < activeIndex ? "is-done" : index === activeIndex ? "is-active" : ""}><i /> <span>{stageCopy[stage][0]}</span></li>)}
        </ol>
        <div className="evidence-counter"><strong>{run.completed} / {run.total}</strong><span>каруселей подготовлено</span></div>
      </section>
    );
  }

  if (run.status === "failed" || run.status === "interrupted") {
    return (
      <section className="pattern-empty pattern-failed">
        <span className="eyebrow">Анализ остановлен</span><h2>Сохранённые профили не потеряны</h2><p>{run.error || "Запустите анализ повторно — уже готовые карусели будут взяты из кэша."}</p>
        <button className="button button-primary" onClick={onStart}>Попробовать снова</button>
      </section>
    );
  }

  const axes = [
    ["visual_source", "Визуальный язык"],
    ["structure", "Контентная структура"],
    ["product_pattern", "Продуктовая механика"],
  ] as const;
  return (
    <div className="pattern-results">
      <section className="evidence-ledger">
        <div><span className="eyebrow">Evidence ledger</span><h2>{run.playbooks.length} рабочих playbooks</h2><p>Каждый сценарий связан с реальными постами, креаторами и медианными метриками.</p></div>
        <dl><div><dt>Проанализировано</dt><dd>{run.total}</dd></div><div><dt>Категорий</dt><dd>{run.categories.length}</dd></div><div className="ledger-project-link"><dt>Мои карусели</dt><dd><button onClick={onOpenProjects}>{session.drafts.length}<Icon name="arrow" /></button></dd></div></dl>
      </section>

      <section className="category-matrix">
        {axes.map(([axis, title]) => {
          const items = run.categories.filter((category) => category.axis === axis).slice(0, 6);
          return <div className="category-column" key={axis}><header><span>{title}</span><small>{items.length} сигналов</small></header>{items.map((category) => <div className="category-row" key={`${axis}-${category.value}`}><span><strong>{category.label}</strong><small>{category.creatorCount} creators · median {formatMetric(category.medianViews)}</small></span><b>{category.postCount}</b></div>)}</div>;
        })}
      </section>

      <div className="playbook-intro"><span className="eyebrow">Из повторений — в производство</span><h2>Предлагаемые flows</h2><p>Структура, визуальный язык и продуктовая вставка собраны в один применимый рецепт.</p></div>
      <section className="playbook-grid">
        {run.playbooks.map((playbook) => {
          const references = playbook.postIds.map((id) => session.posts.find((post) => post.id === id)).filter((post): post is SessionPost => Boolean(post));
          const productionFlow = withRequiredProductSlot(playbook.slideFlow);
          const drafts = session.drafts.filter((draft) => draft.playbookId === playbook.id);
          return (
            <article className="playbook-card" key={playbook.id}>
              <header>
                <div className="playbook-tags"><span>{humanizeTag(playbook.visualSource)}</span><span>{humanizeTag(playbook.structure)}</span><span>{humanizeTag(playbook.productPattern)}</span></div>
                <h3>{playbook.title}</h3><p>{playbook.summary}</p>
              </header>
              <div className="playbook-stats"><span><strong>{playbook.sampleCount}</strong> posts</span><span><strong>{playbook.creatorCount}</strong> creators</span><span><strong>{formatMetric(playbook.medianViews)}</strong> median views</span><span><strong>{playbook.medianSaveRate}%</strong> save rate</span></div>
              {playbook.singleCreator && <div className="single-creator-note">Паттерн пока подтверждён одним креатором</div>}
              <ol className="flow-line">
                {productionFlow.map((slide, index) => <li key={`${playbook.id}-${index}`} className={slide.productSlot ? "is-product" : ""}><i>{index + 1}</i><span><strong>{slide.label}</strong><small>{slide.copyFormula}</small></span></li>)}
              </ol>
              <div className="reference-strip">
                {references.slice(0, 5).map((post) => <button key={post.id} onClick={() => onOpenPost(post)} title={`@${post.author.username}`}>{post.slides[0] && <img src={mediaUrl(post.slides[0].imageUrl)} alt="" loading="lazy" />}</button>)}
                <span>{references.length} real refs</span>
              </div>
              <footer><p>{playbook.whyItWorks}</p><div className="playbook-actions">{drafts.length > 0 && <button className="button button-quiet" onClick={() => onOpenDraft(drafts[0])}>Редактировать · {drafts.length}</button>}<button className="button button-primary" onClick={() => onGenerate(playbook)}>Создать карусель <Icon name="arrow" /></button></div></footer>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function GenerateDraftModal({ session, playbook, onClose, onCreated }: { session: SessionDetail; playbook: CarouselPlaybook; onClose: () => void; onCreated: (draft: CarouselDraft) => void }) {
  const [form, setForm] = useState<AppBrief>({
    appName: "bloatfit",
    audience: session.brief.audience,
    promise: "Get a personalised face-debloating plan based on your AI face scan and daily habits.",
    proof: "AI face scan, personalised daily plan, habit tracking, progress tracking and daily recommendations.",
    cta: "Download bloatfit on the App Store and get your personalised plan.",
    visualStyle: humanizeTag(playbook.visualSource),
    restrictions: "No medical claims, diagnosis, guaranteed results or unrealistic time-based promises.",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof AppBrief, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !loading) onClose(); }}>
      <section className="draft-setup-modal" role="dialog" aria-modal="true" aria-label="Создать карусель">
        <header><div><span className="eyebrow">Playbook → storyboard</span><h2>{playbook.title}</h2></div><button className="icon-button" onClick={onClose} disabled={loading} aria-label="Закрыть"><Icon name="close" /></button></header>
        <div className="draft-form-grid">
          <label className="field"><span>Название приложения</span><input value={form.appName} onChange={(event) => update("appName", event.target.value)} /></label>
          <label className="field"><span>Аудитория</span><input value={form.audience} onChange={(event) => update("audience", event.target.value)} /></label>
          <label className="field field-wide"><span>Что приложение помогает получить</span><textarea rows={3} value={form.promise} onChange={(event) => update("promise", event.target.value)} /></label>
          <label className="field"><span>Proof или механизм</span><textarea rows={3} value={form.proof} onChange={(event) => update("proof", event.target.value)} /></label>
          <label className="field"><span>CTA</span><textarea rows={3} value={form.cta} onChange={(event) => update("cta", event.target.value)} /></label>
          <label className="field"><span>Визуальный стиль</span><input value={form.visualStyle} onChange={(event) => update("visualStyle", event.target.value)} /></label>
          <label className="field"><span>Нельзя обещать / ограничения</span><input value={form.restrictions} onChange={(event) => update("restrictions", event.target.value)} /></label>
        </div>
        <div className="draft-product-rule"><Icon name="spark" /><span><strong>Приложение войдёт во все три варианта.</strong> AI сам выберет смысловой переход и 1–2 нативных app-слайда, даже если в референсах рекламы не было.</span></div>
        {loading && <div className="draft-loading"><i /><span>Создаю три варианта и связываю с референсами…</span></div>}
        {error && <div className="inline-error">{error}</div>}
        <footer><button className="button button-quiet" onClick={onClose} disabled={loading}>Отмена</button><button className="button button-primary button-large" disabled={loading || form.appName.trim().length < 2 || form.promise.trim().length < 3} onClick={() => {
          setLoading(true); setError(null);
          void api.createDraft(session.id, playbook.id, form).then(onCreated).catch((requestError) => { setLoading(false); setError(requestError instanceof Error ? requestError.message : String(requestError)); });
        }}>{loading ? "Генерирую…" : <>Получить 3 storyboard <Icon name="arrow" /></>}</button></footer>
      </section>
    </div>
  );
}

function StoryboardModal({ draft, onClose }: { draft: EditableStoryboard; onClose: () => void }) {
  const initialWorkspace = useMemo(() => loadStoryboardWorkspace(draft), [draft.id]);
  const [variants, setVariants] = useState(initialWorkspace.variants);
  const [active, setActive] = useState(initialWorkspace.active);
  const [activeSlide, setActiveSlide] = useState(initialWorkspace.activeSlide);
  const [resultsByQuery, setResultsByQuery] = useState<Record<string, PinterestImage[]>>(initialWorkspace.resultsByQuery);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"with-text" | "without-text" | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoPinterest, setAutoPinterest] = useState({ running: false, completed: 0, total: 0, failed: 0 });
  const [saveState, setSaveState] = useState<"saved" | "local" | "saving" | "error">(initialWorkspace.recoveredVariants ? "local" : "saved");
  const [error, setError] = useState<string | null>(null);
  const variantsRef = useRef(variants);
  const resultsRef = useRef(resultsByQuery);
  const pinterestInFlight = useRef(new Map<string, Promise<PinterestImage[]>>());
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveAttempt = useRef(0);
  const autosaveReady = useRef(false);
  const activeVariantIndex = Math.min(active, Math.max(0, variants.length - 1));
  const variant = variants[activeVariantIndex];
  const safeActiveSlide = Math.min(activeSlide, Math.max(0, variant.slides.length - 1));
  const slide = variant.slides[safeActiveSlide] || variant.slides[0];
  const queryKey = slide.design.pinterestQuery.trim().toLocaleLowerCase();
  const pinterestResults = resultsByQuery[queryKey] || [];
  const missingImages = variant.slides.filter((item) => !item.productSlide && !item.design.selectedImage).length;
  useEffect(() => { variantsRef.current = variants; }, [variants]);
  useEffect(() => { resultsRef.current = resultsByQuery; }, [resultsByQuery]);
  const updateSlide = (update: Partial<typeof slide>) => {
    setSaveState("local");
    setVariants((current) => current.map((item, variantIndex) => variantIndex !== activeVariantIndex ? item : {
      ...item,
      slides: item.slides.map((candidate, slideIndex) => slideIndex === safeActiveSlide ? { ...candidate, ...update } : candidate),
    }));
  };
  const updateDesign = (update: Partial<typeof slide.design>) => updateSlide({ design: { ...slide.design, ...update } });
  const persistVariants = useCallback((nextVariants: StoryboardVariant[]) => {
    const attempt = ++saveAttempt.current;
    const payload = JSON.stringify(nextVariants);
    setSaving(true);
    setSaveState("saving");
    const queued: Promise<unknown> = saveQueue.current.catch(() => undefined).then(async () => {
      if (isRemixStoryboard(draft)) return api.saveRemix(draft.id, nextVariants);
      return api.saveDraft(draft.sessionId, draft.id, nextVariants);
    });
    saveQueue.current = queued.then(() => undefined, () => undefined);
    return queued.then((updated) => {
      if (JSON.stringify(variantsRef.current) === payload) setSaveState("saved");
      return updated;
    }).catch((saveError) => {
      if (JSON.stringify(variantsRef.current) === payload) setSaveState("error");
      setError(`Правки сохранены локально, но база пока не обновилась: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
      throw saveError;
    }).finally(() => {
      if (saveAttempt.current === attempt) setSaving(false);
    });
  }, [draft]);
  useEffect(() => {
    try {
      const workspace: StoredStoryboardWorkspace = {
        variants,
        active,
        activeSlide: safeActiveSlide,
        resultsByQuery,
        savedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(storyboardStorageKey(draft.id), JSON.stringify(workspace));
    } catch {
      // SQLite autosave remains active if the browser storage quota is unavailable.
    }
  }, [active, draft.id, resultsByQuery, safeActiveSlide, variants]);
  useEffect(() => {
    if (!autosaveReady.current) {
      autosaveReady.current = true;
      if (!initialWorkspace.recoveredVariants) return;
    }
    const snapshot = variants;
    const timer = window.setTimeout(() => { void persistVariants(snapshot).catch(() => undefined); }, 400);
    return () => window.clearTimeout(timer);
  }, [initialWorkspace.recoveredVariants, persistVariants, variants]);
  useEffect(() => {
    let cancelled = false;
    const queries = [...new Set(variantsRef.current.flatMap((item) => item.slides)
      .filter((item) => !item.productSlide)
      .map((item) => item.design.pinterestQuery.trim())
      .filter((query) => query.length >= 2))];
    if (!queries.length) return;
    void api.loadPinterestCache(queries).then((response) => {
      if (cancelled) return;
      setResultsByQuery((current) => {
        const next = { ...response.results, ...current };
        resultsRef.current = next;
        return next;
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [draft.id]);
  useEffect(() => {
    if (queryKey.length < 2 || resultsRef.current[queryKey]?.length) return;
    let cancelled = false;
    const query = slide.design.pinterestQuery.trim();
    const timer = window.setTimeout(() => {
      void api.loadPinterestCache([query]).then((response) => {
        if (cancelled || !response.results[queryKey]?.length) return;
        setResultsByQuery((current) => {
          const next = { ...current, [queryKey]: response.results[queryKey] };
          resultsRef.current = next;
          return next;
        });
      }).catch(() => undefined);
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [queryKey, slide.design.pinterestQuery]);
  const loadPinterestQuery = useCallback(async (query: string, force = false) => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length < 2) return [];
    if (!force && resultsRef.current[normalized]?.length) return resultsRef.current[normalized];
    const pending = pinterestInFlight.current.get(normalized);
    if (pending) return pending;
    const task = (async () => {
      const response = await api.searchPinterest(query.trim(), 20, force);
      setResultsByQuery((current) => {
        const next = { ...current, [response.query]: response.results };
        resultsRef.current = next;
        return next;
      });
      return response.results;
    })().finally(() => {
      pinterestInFlight.current.delete(normalized);
    });
    pinterestInFlight.current.set(normalized, task);
    return task;
  }, []);
  const searchImages = async (force = false) => {
    const query = slide.design.pinterestQuery.trim();
    if (query.length < 2) return;
    setSearching(true); setError(null);
    try {
      await loadPinterestQuery(query, force);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setSearching(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const queryMap = new Map<string, string>();
      variantsRef.current.flatMap((item) => item.slides)
        .filter((item) => !item.productSlide)
        .map((item) => item.design.pinterestQuery.trim())
        .filter((query) => query.length >= 2)
        .forEach((query) => queryMap.set(query.toLocaleLowerCase(), query));
      const queries = [...queryMap.values()];
      if (!queries.length || cancelled) return;
      setAutoPinterest({ running: true, completed: 0, total: queries.length, failed: 0 });
      void (async () => {
        let completed = 0;
        let failed = 0;
        for (const query of queries) {
          if (cancelled) return;
          try {
            await loadPinterestQuery(query);
          } catch {
            failed += 1;
          }
          completed += 1;
          if (!cancelled) setAutoPinterest({ running: completed < queries.length, completed, total: queries.length, failed });
        }
      })();
    }, 5_000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadPinterestQuery]);
  const copyText = async () => {
    setError(null);
    try {
      const text = variant.slides.map((item) => item.copy.trim()).filter(Boolean).join("\n\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Не удалось скопировать текст");
    }
  };
  const exportZip = async (includeText: boolean) => {
    setExporting(includeText ? "with-text" : "without-text"); setError(null);
    try {
      await persistVariants(variantsRef.current);
      const blob = isRemixStoryboard(draft)
        ? await api.exportRemix(draft.id, activeVariantIndex, includeText)
        : await api.exportDraft(draft.sessionId, draft.id, activeVariantIndex, includeText);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${draft.appBrief.appName.toLocaleLowerCase()}-carousel${includeText ? "" : "-no-text"}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExporting(null);
    }
  };
  return (
    <div className="modal-backdrop storyboard-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="storyboard-modal" role="dialog" aria-modal="true" aria-label="Storyboard editor">
        <header><div><span className="eyebrow">{isRemixStoryboard(draft) ? "Remix production desk" : "Pinterest production desk"}</span><h2>{draft.appBrief.appName}</h2></div><div className="modal-actions">{autoPinterest.total > 0 && <span className={`auto-pinterest-state ${autoPinterest.running ? "is-running" : autoPinterest.failed === autoPinterest.total ? "is-failed" : "is-ready"}`}><i />{autoPinterest.running ? `Pinterest ${autoPinterest.completed}/${autoPinterest.total}` : autoPinterest.failed ? `Pinterest готов · ${autoPinterest.total - autoPinterest.failed}/${autoPinterest.total}` : `Pinterest готов · ${autoPinterest.total}`}</span>}<span className={`save-state is-${saveState}`}>{saveState === "saving" ? "Сохраняю…" : saveState === "error" ? "Сохранено локально" : saveState === "local" ? "Сохранено локально" : `Сохранено автоматически · ${missingImages} без фото`}</span><button className="button button-quiet" onClick={() => void copyText()}>{copied ? "Скопировано ✓" : "Копировать текст"}</button><button className="button button-quiet" onClick={() => void exportZip(false)} disabled={saving || Boolean(exporting)}>{exporting === "without-text" ? "Рендерю…" : "ZIP без текста"}</button><button className="button button-primary" onClick={() => void exportZip(true)} disabled={saving || Boolean(exporting)}>{exporting === "with-text" ? "Рендерю…" : "ZIP с текстом"}</button><button className="icon-button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button></div></header>
        {isRemixStoryboard(draft) && draft.sourcePost && <div className="source-reference-ribbon"><div><span className="eyebrow">Исходник всегда рядом</span><strong>@{draft.sourcePost.author.username}</strong><a href={draft.sourceUrl} target="_blank" rel="noreferrer"><Icon name="external" /> TikTok</a></div><div>{draft.sourcePost.slides.map((sourceSlide) => <figure key={sourceSlide.index}><img src={mediaUrl(sourceSlide.imageUrl)} alt={`Исходный слайд ${sourceSlide.index}`} /><figcaption>{String(sourceSlide.index).padStart(2, "0")}</figcaption></figure>)}</div></div>}
        <nav className="variant-tabs" aria-label="Варианты storyboard">{variants.map((item, index) => <button key={`${index}-${item.title}`} className={activeVariantIndex === index ? "is-active" : ""} onClick={() => { setActive(index); setActiveSlide(0); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong><small>{item.angle}</small></button>)}</nav>
        {error && <div className="studio-error">{error}</div>}
        <div className="production-studio">
          <aside className="slide-rail" aria-label="Слайды">
            <header><strong>{variant.slides.length} слайдов</strong><small>выберите для редактирования</small></header>
            {variant.slides.map((item, index) => <button key={item.index} className={`${index === safeActiveSlide ? "is-active" : ""} ${item.productSlide ? "is-product" : ""}`} onClick={() => setActiveSlide(index)}><i>{String(item.index).padStart(2, "0")}</i><span className="rail-thumb">{item.design.selectedImage && !item.productSlide ? <img src={mediaUrl(item.design.selectedImage.previewUrl)} alt="" /> : <b>{item.productSlide ? "APP" : "—"}</b>}</span><span><strong>{item.role}</strong><small>{item.copy}</small></span></button>)}
          </aside>
          <section className="canvas-panel">
            <div className={`live-slide position-${slide.design.textPosition} align-${slide.design.textAlign} overlay-${slide.design.overlayStyle} ${slide.productSlide ? "is-product" : ""}`}>
              {slide.design.selectedImage && !slide.productSlide && <img src={mediaUrl(slide.design.selectedImage.previewUrl)} alt={slide.design.selectedImage.alt} />}
              <div className="live-slide-bg" />
              <div className="live-slide-copy" style={{ fontSize: `${Math.round(25 * slide.design.textScale)}px` }}><p>{slide.copy}</p></div>
            </div>
            <div className="canvas-controls">
              <label><span>Позиция</span><div>{(["top", "center", "bottom"] as const).map((value) => <button key={value} className={slide.design.textPosition === value ? "is-active" : ""} onClick={() => updateDesign({ textPosition: value })}>{value}</button>)}</div></label>
              <label><span>Выравнивание</span><div>{(["left", "center"] as const).map((value) => <button key={value} className={slide.design.textAlign === value ? "is-active" : ""} onClick={() => updateDesign({ textAlign: value })}>{value}</button>)}</div></label>
              <label><span>Подложка</span><div>{(["scrim", "card", "none"] as const).map((value) => <button key={value} className={slide.design.overlayStyle === value ? "is-active" : ""} onClick={() => updateDesign({ overlayStyle: value })}>{value}</button>)}</div></label>
              <label className="scale-control"><span>Размер текста · {Math.round(slide.design.textScale * 100)}%</span><input type="range" min="0.7" max="1.5" step="0.05" value={slide.design.textScale} onChange={(event) => updateDesign({ textScale: Number(event.target.value) })} /></label>
            </div>
          </section>
          <aside className="asset-panel">
            <label className="field"><span>Текст слайда</span><textarea rows={5} value={slide.copy} onChange={(event) => updateSlide({ copy: event.target.value })} aria-label={`Текст слайда ${slide.index}`} /></label>
            <label className="field visual-note"><span>Visual direction</span><textarea rows={2} value={slide.visualBrief} onChange={(event) => updateSlide({ visualBrief: event.target.value })} /></label>
            {slide.productSlide ? <div className="app-placeholder-note"><strong>Текстовый app-слайд</strong><p>Сейчас используется фирменная карточка bloatfit. Позже сюда добавятся загруженные вами референсы и реальные экраны приложения.</p></div> : <>
              <div className="pinterest-query"><label><span>Pinterest query</span><input value={slide.design.pinterestQuery} onChange={(event) => updateDesign({ pinterestQuery: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") void searchImages(); }} /></label><button className="button button-ai" onClick={() => void searchImages()} disabled={searching || queryKey.length < 2}>{searching ? "Ищу…" : "Найти"}</button></div>
              <div className="asset-result-head"><span>{pinterestResults.length ? `${pinterestResults.length} кандидатов` : "Картинки ещё не загружены"}</span>{pinterestResults.length > 0 && <button onClick={() => void searchImages(true)} disabled={searching}>Обновить</button>}</div>
              {!pinterestResults.length && <button className="asset-empty" onClick={() => void searchImages()} disabled={searching || queryKey.length < 2}><Icon name="search" /><strong>Найти визуалы</strong><small>Загрузим только компактные Pinterest-превью</small></button>}
              <div className="pinterest-grid">{pinterestResults.map((image) => <div className={`pin-candidate ${slide.design.selectedImage?.id === image.id ? "is-selected" : ""}`} key={image.id}><button onClick={() => updateDesign({ selectedImage: image })} aria-label="Выбрать Pinterest изображение"><img src={mediaUrl(image.previewUrl)} alt={image.alt} loading="lazy" /><i>✓</i></button><a href={image.pinUrl} target="_blank" rel="noreferrer" title="Открыть исходный pin"><Icon name="external" /></a></div>)}</div>
              {slide.design.selectedImage && <button className="remove-image" onClick={() => updateDesign({ selectedImage: null })}>Убрать выбранное изображение</button>}
            </>}
            <div className="rights-note">Pinterest используется для поиска. Перед публикацией проверьте права на изображение — ссылка на pin попадёт в SOURCES.txt.</div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function NewResearchModal({ onClose, onCreated }: { onClose: () => void; onCreated: (session: ResearchSession) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "Men’s face debloat",
    topic: "Face debloating and reducing facial puffiness for men",
    audience: "Men 18–35 who want a sharper, less puffy face",
    goal: "Find creators and carousel structures that naturally lead into an App Store product",
    language: "English",
    include: "Routines, mistakes, before/after, product or app integrations, link-in-bio funnels",
    exclude: "Unrelated photo dumps",
    targetResults: "100",
    queries: "debloat face men\npuffy face men\nreduce facial bloating\nmorning depuff routine men\nwhy your face looks puffy\nface bloating mistakes\njawline routine men\ndebloat routine\ndepuff face for men",
  });

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const brief: ResearchBrief = {
        topic: form.topic,
        audience: form.audience,
        goal: form.goal,
        language: form.language,
        include: form.include,
        exclude: form.exclude,
      };
      const created = await api.createSession({
        title: form.title,
        brief,
        queries: form.queries.split("\n").map((query) => query.trim()).filter(Boolean),
        targetResults: Math.max(25, Math.min(10_000, Number(form.targetResults) || 100)),
      });
      onCreated(created);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form className="research-modal" onSubmit={submit}>
        <header><div><span className="eyebrow">Новая ниша или приложение</span><h2>Создайте исследование и первый тестовый проход</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button></header>
        <div className="form-grid">
          <label className="field field-wide"><span>Название папки исследования</span><input value={form.title} onChange={(event) => update("title", event.target.value)} required /></label>
          <label className="field field-wide"><span>Тема</span><textarea rows={2} value={form.topic} onChange={(event) => update("topic", event.target.value)} required /></label>
          <label className="field"><span>Аудитория</span><textarea rows={3} value={form.audience} onChange={(event) => update("audience", event.target.value)} /></label>
          <label className="field"><span>Цель исследования</span><textarea rows={3} value={form.goal} onChange={(event) => update("goal", event.target.value)} /></label>
          <label className="field"><span>Включать</span><textarea rows={3} value={form.include} onChange={(event) => update("include", event.target.value)} /></label>
          <label className="field"><span>Исключать</span><textarea rows={3} value={form.exclude} onChange={(event) => update("exclude", event.target.value)} /></label>
          <label className="field"><span>Язык контента</span><input value={form.language} onChange={(event) => update("language", event.target.value)} /></label>
          <label className="field"><span>Первый тестовый проход</span><input type="number" min="25" max="10000" step="25" value={form.targetResults} onChange={(event) => update("targetResults", event.target.value)} /><small>Для новой ниши разумно начать с 50–100 результатов.</small></label>
          <label className="field field-wide"><span>Поисковые запросы — по одному на строку</span><textarea className="query-input" rows={8} value={form.queries} onChange={(event) => update("queries", event.target.value)} required /><small>{form.queries.split("\n").filter(Boolean).length} поисковых батчей · общая цель {Number(form.targetResults || 100).toLocaleString("ru")} уникальных результатов</small></label>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <footer><button type="button" className="button button-quiet" onClick={onClose}>Отмена</button><button className="button button-primary" disabled={saving}>{saving ? "Сохраняю…" : "Создать исследование"}</button></footer>
      </form>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="landing-empty">
      <div className="landing-copy">
        <span className="eyebrow">Локальная TikTok-разведка</span>
        <h1><span>500 результатов.</span> Один быстрый проход.</h1>
        <p>Собирайте карусели через собственный Chrome, проверяйте решения AI и сохраняйте только полезные структуры контента и продуктовых воронок.</p>
        <button className="button button-primary button-large" onClick={onCreate}><Icon name="plus" /> Создать первое исследование</button>
      </div>
      <div className="landing-board" aria-hidden="true">
        {["skip", "maybe", "relevant", "relevant", "maybe"].map((status, index) => <div key={index} className={`ghost-card ghost-${status}`}><i /><span>{index + 1}</span><b /></div>)}
      </div>
    </section>
  );
}

function LoadingState() {
  return <div className="loading-state"><i /><span>Открываю локальную базу…</span></div>;
}
