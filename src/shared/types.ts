export type DecisionStatus = "skip" | "maybe" | "relevant";
export type HumanStatus = DecisionStatus | null;
export type AiStatus = DecisionStatus | "pending";
export type SessionStatus = "draft" | "searching" | "complete" | "partial" | "failed" | "interrupted";
export type VisualSource = "pinterest_like" | "ugc_selfie" | "stock_editorial" | "ai_photoreal" | "ai_illustration" | "ai_mascot" | "app_screenshots" | "meme_template" | "mixed" | "unknown";
export type LayoutStyle = "single_image_text" | "collage" | "card_template" | "screenshot_stack" | "before_after" | "illustrated_sequence" | "mixed";
export type ContentStructure = "tips_list" | "mistakes_fixes" | "routine" | "tutorial" | "before_after" | "story" | "ranking" | "myths_facts" | "problem_solution" | "product_demo" | "other";
export type SlideRole = "hook" | "setup" | "problem" | "proof" | "tip" | "transition" | "product" | "cta" | "ending" | "other";
export type ProductPattern = "none" | "product_as_tip" | "mid_carousel_insert" | "app_demo" | "dedicated_end_card" | "link_in_bio" | "affiliate_ad" | "unknown";
export type VisualAnalysisStatus = "pending" | "complete" | "failed";
export type PatternRunStatus = "queued" | "running" | "complete" | "failed" | "interrupted";
export type PatternRunStage = "preparing" | "visual_analysis" | "clustering" | "playbooks" | "complete";
export type SlideTextPosition = "top" | "center" | "bottom";
export type SlideTextAlign = "left" | "center";
export type SlideOverlayStyle = "scrim" | "card" | "none";

export interface PinterestImage {
  id: string;
  query: string;
  pinUrl: string;
  imageUrl: string;
  previewUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface SlideDesign {
  pinterestQuery: string;
  selectedImage: PinterestImage | null;
  textPosition: SlideTextPosition;
  textAlign: SlideTextAlign;
  overlayStyle: SlideOverlayStyle;
  textScale: number;
}

export interface ResearchBrief {
  topic: string;
  audience: string;
  goal: string;
  language: string;
  include: string;
  exclude: string;
}

export interface CarouselSlide {
  index: number;
  imageUrl: string;
  width?: number;
  height?: number;
}

export interface CarouselMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reposts?: number;
}

export interface CarouselPost {
  id: string;
  url: string;
  author: {
    username: string;
    displayName?: string;
  };
  caption: string;
  createdAt?: string;
  slides: CarouselSlide[];
  sound?: {
    id?: string;
    title?: string;
    author?: string;
  };
  metrics: CarouselMetrics;
}

export interface SessionPost extends CarouselPost {
  searchQueries: string[];
  bestSearchRank: number;
  aiStatus: AiStatus;
  aiScore: number | null;
  aiNicheScore: number | null;
  aiProductScore: number | null;
  aiAppScore: number | null;
  aiReason: string | null;
  humanStatus: HumanStatus;
  finalStatus: AiStatus;
  pinned: boolean;
  visualStatus: VisualAnalysisStatus;
  visualProfile: VisualProfile | null;
}

export interface VisualProfile {
  visualSource: VisualSource;
  layoutStyle: LayoutStyle;
  primaryStructure: ContentStructure;
  secondaryStructures: ContentStructure[];
  slideRoles: Array<{ index: number; role: SlideRole; confidence: number }>;
  hookPattern: string;
  visualNotes: string;
  product: {
    present: boolean;
    pattern: ProductPattern;
    productName: string | null;
    firstSlide: number | null;
    confidence: number;
  };
  ctaPattern: string | null;
  confidence: number;
  deepAnalysisRecommended: boolean;
  rationale: string;
}

export interface CategorySummary {
  axis: "visual_source" | "structure" | "product_pattern";
  value: string;
  label: string;
  postIds: string[];
  postCount: number;
  creatorCount: number;
  medianViews: number;
  medianSaveRate: number;
}

export interface PlaybookSlide {
  role: SlideRole;
  label: string;
  copyFormula: string;
  visualDirection: string;
  productSlot: boolean;
}

export interface CarouselPlaybook {
  id: string;
  title: string;
  summary: string;
  visualSource: VisualSource | "mixed";
  structure: ContentStructure;
  productPattern: ProductPattern;
  postIds: string[];
  sampleCount: number;
  creatorCount: number;
  medianViews: number;
  medianSaveRate: number;
  hookTemplates: string[];
  slideFlow: PlaybookSlide[];
  whyItWorks: string;
  confidence: number;
  singleCreator: boolean;
}

export interface PatternAnalysisRun {
  id: string;
  sessionId: string;
  status: PatternRunStatus;
  stage: PatternRunStage;
  includeMaybe: boolean;
  selectedPostIds: string[];
  completed: number;
  total: number;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  categories: CategorySummary[];
  playbooks: CarouselPlaybook[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardSlide {
  index: number;
  role: SlideRole;
  copy: string;
  visualBrief: string;
  sourcePostIds: string[];
  productSlide: boolean;
  design: SlideDesign;
}

export interface StoryboardVariant {
  title: string;
  angle: string;
  slides: StoryboardSlide[];
}

export interface AppBrief {
  appName: string;
  audience: string;
  promise: string;
  proof: string;
  cta: string;
  visualStyle: string;
  restrictions: string;
}

export type RemixStatus = "queued" | "importing" | "analyzing" | "generating" | "ready" | "failed" | "interrupted";

export interface RemixFolder {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RemixItem {
  id: string;
  folderId: string | null;
  sourceUrl: string;
  sourcePost: CarouselPost | null;
  status: RemixStatus;
  requestedVariants: number;
  completedVariants: number;
  includeApp: boolean;
  autoFolder: boolean;
  appBrief: AppBrief;
  instructions: string;
  visualProfile: VisualProfile | null;
  variants: StoryboardVariant[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CarouselDraft {
  id: string;
  sessionId: string;
  analysisRunId: string;
  playbookId: string;
  appBrief: AppBrief;
  variants: StoryboardVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface CarouselProject extends CarouselDraft {
  sessionTitle: string;
  playbookTitle: string;
}

export interface ResearchSessionSummary {
  id: string;
  projectId: string;
  runNumber: number;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  resultCount: number;
  completedQueries: number;
  totalQueries: number;
  currentQuery: string | null;
  targetResults: number;
  excludeSeen: boolean;
}

export interface ResearchProject {
  id: string;
  title: string;
  brief: ResearchBrief;
  defaultQueries: string[];
  defaultTarget: number;
  createdAt: string;
  updatedAt: string;
  runs: ResearchSessionSummary[];
}

export interface ResearchSession extends ResearchSessionSummary {
  brief: ResearchBrief;
  queries: string[];
  error: string | null;
  posts: SessionPost[];
  analysis: PatternAnalysisRun | null;
  drafts: CarouselDraft[];
}

export interface AiJobSnapshot {
  running: boolean;
  completed: number;
  total: number;
  completedBatches: number;
  totalBatches: number;
  model: string;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface ChromeHealth {
  connected: boolean;
  endpoint: string;
  browser?: string;
  error?: string;
}

export interface AppHealth {
  ok: true;
  chrome: ChromeHealth;
  databasePath: string;
}
