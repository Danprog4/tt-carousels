import type {
  AppBrief,
  AiJobSnapshot,
  AppHealth,
  DecisionStatus,
  ResearchBrief,
  ResearchSession,
  ResearchSessionSummary,
  ResearchProject,
  SessionPost,
  CarouselDraft,
  CarouselProject,
  PatternAnalysisRun,
  PinterestImage,
  RemixFolder,
  RemixItem,
  StoryboardVariant,
} from "../shared/types";

export type RemixItemWithRuntime = RemixItem & { running?: boolean };
export interface CreateRemixInput {
  sourceUrl: string;
  sourcePostId?: string;
  folderId?: string | null;
  autoFolder: boolean;
  requestedVariants: number;
  includeApp: boolean;
  appBrief: AppBrief;
  instructions: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}

export const api = {
  health: () => request<AppHealth>("/api/health"),
  listSessions: () => request<{ sessions: ResearchSessionSummary[] }>("/api/sessions"),
  listProjects: () => request<{ projects: ResearchProject[] }>("/api/projects"),
  listDrafts: () => request<{ drafts: CarouselProject[] }>("/api/drafts"),
  listRemix: () => request<{ folders: RemixFolder[]; items: RemixItemWithRuntime[] }>("/api/remix"),
  createRemixFolder: (name: string) => request<RemixFolder>("/api/remix/folders", {
    method: "POST",
    body: JSON.stringify({ name }),
  }),
  createRemix: (input: CreateRemixInput) => request<RemixItemWithRuntime>("/api/remix/items", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  getRemix: (id: string) => request<RemixItemWithRuntime>(`/api/remix/items/${id}`),
  retryRemix: (id: string) => request<RemixItemWithRuntime>(`/api/remix/items/${id}/retry`, { method: "POST" }),
  saveRemix: (id: string, variants: StoryboardVariant[]) => request<RemixItem>(`/api/remix/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ variants }),
  }),
  moveRemix: (id: string, folderId: string | null) => request<RemixItem>(`/api/remix/items/${id}/folder`, {
    method: "PATCH",
    body: JSON.stringify({ folderId }),
  }),
  getSession: (id: string) => request<ResearchSession & { searchRunning: boolean; aiJob: AiJobSnapshot }>(`/api/sessions/${id}`),
  createSession: (input: { title: string; brief: ResearchBrief; queries: string[]; targetResults: number }) =>
    request<ResearchSession>("/api/sessions", { method: "POST", body: JSON.stringify(input) }),
  createRun: (projectId: string, input: { title?: string; queries: string[]; targetResults: number; excludeSeen: boolean; saveAsDefaults: boolean }) =>
    request<ResearchSession>(`/api/projects/${projectId}/runs`, { method: "POST", body: JSON.stringify(input) }),
  startSearch: (id: string) =>
    request<{ started: true; sessionId: string }>(`/api/sessions/${id}/search`, {
      method: "POST",
    }),
  startAi: (id: string) =>
    request<{ started: true; sessionId: string; job: AiJobSnapshot }>(`/api/sessions/${id}/ai`, {
      method: "POST",
    }),
  setStatus: (sessionId: string, postId: string, status: DecisionStatus | null) =>
    request<SessionPost>(`/api/sessions/${sessionId}/posts/${postId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  setPinned: (sessionId: string, postId: string, pinned: boolean) =>
    request<SessionPost>(`/api/sessions/${sessionId}/posts/${postId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  startPatternAnalysis: (sessionId: string, includeMaybe: boolean) =>
    request<{ started: true; run: PatternAnalysisRun }>(`/api/sessions/${sessionId}/patterns`, {
      method: "POST",
      body: JSON.stringify({ includeMaybe }),
    }),
  createDraft: (sessionId: string, playbookId: string, appBrief: AppBrief) =>
    request<CarouselDraft>(`/api/sessions/${sessionId}/playbooks/${playbookId}/drafts`, {
      method: "POST",
      body: JSON.stringify(appBrief),
    }),
  saveDraft: (sessionId: string, draftId: string, variants: StoryboardVariant[]) =>
    request<CarouselDraft>(`/api/sessions/${sessionId}/drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ variants }),
    }),
  searchPinterest: (query: string, limit = 20, force = false) =>
    request<{ query: string; cached: boolean; results: PinterestImage[] }>("/api/pinterest/search", {
      method: "POST",
      body: JSON.stringify({ query, limit, force }),
    }),
  loadPinterestCache: (queries: string[], limit = 20) =>
    request<{ results: Record<string, PinterestImage[]> }>("/api/pinterest/cache", {
      method: "POST",
      body: JSON.stringify({ queries, limit }),
    }),
  exportDraft: async (sessionId: string, draftId: string, variantIndex: number, includeText = true) => {
    const response = await fetch(`/api/sessions/${sessionId}/drafts/${draftId}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantIndex, includeText }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return response.blob();
  },
  exportRemix: async (itemId: string, variantIndex: number, includeText = true) => {
    const response = await fetch(`/api/remix/items/${itemId}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantIndex, includeText }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return response.blob();
  },
};

export function mediaUrl(source: string): string {
  if (!source) return "";
  if (source.startsWith("/api/")) return source;
  if (source.startsWith("data:")) return source;
  return `/api/media?url=${encodeURIComponent(source)}`;
}
