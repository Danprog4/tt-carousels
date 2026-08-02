import { CarouselDatabase } from "./database.js";
import type { AiStatus, CarouselPost, ResearchBrief } from "../shared/types.js";

const database = new CarouselDatabase();
const brief: ResearchBrief = {
  topic: "Face debloating and reducing facial puffiness for men",
  audience: "Men 18–35 who want a sharper, less puffy face",
  goal: "Find content and product funnels that can naturally lead into an App Store product",
  language: "English",
  include: "Routines, mistakes, transformations, apps and link-in-bio funnels",
  exclude: "Unrelated photo dumps",
};
const queries = [
  "debloat face men",
  "puffy face men",
  "reduce facial bloating",
  "morning depuff routine men",
  "face bloating mistakes",
  "jawline routine men",
  "face improvement app",
];
const session = database.createSession({ title: "Men’s face debloat · demo", brief, queries });
database.setSearchStarted(session.id);

const captions = [
  "3 reasons your face still looks puffy in the morning",
  "What I stopped doing to get rid of facial bloating",
  "My 5 minute morning routine for a sharper face",
  "Apps every guy should have for a better glow up",
  "Nobody tells men these sodium mistakes",
  "How I track the habits that changed my face",
  "Things that actually helped my jawline — no surgery",
  "The face depuff checklist I wish I had sooner",
];
const reasons = [
  "Точный мужской angle и диагностический hook.",
  "Нативная структура: советы → приложение → продолжение пользы.",
  "Смежная ниша, но сильный App Store funnel.",
  "Релевантный формат; продуктовая интеграция не подтверждена.",
  "Слабое совпадение с темой, оставлено для ручной проверки.",
];

for (let index = 0; index < 36; index += 1) {
  const slideCount = 5 + (index % 4);
  const id = `demo-${session.id.slice(0, 8)}-${String(index + 1).padStart(3, "0")}`;
  const post: CarouselPost = {
    id,
    url: "https://www.tiktok.com/",
    author: { username: `creator_${(index % 12) + 1}`, displayName: `Creator ${(index % 12) + 1}` },
    caption: captions[index % captions.length],
    createdAt: new Date(Date.now() - index * 9 * 60 * 60 * 1000).toISOString(),
    slides: Array.from({ length: slideCount }, (_, slideIndex) => ({
      index: slideIndex + 1,
      imageUrl: `/api/demo-image/${id}?slide=${slideIndex + 1}`,
      width: 720,
      height: 1280,
    })),
    metrics: {
      views: 28_000 + index * 34_700,
      likes: 1_400 + index * 920,
      comments: 80 + index * 17,
      shares: 120 + index * 61,
      saves: 410 + index * 227,
    },
  };
  database.upsertPost(session.id, post, queries[index % queries.length], (index % 40) + 1);
  const status: AiStatus = index < 8 ? "skip" : index < 19 ? "maybe" : "relevant";
  database.setAiAssessment(session.id, id, {
    status,
    score: status === "skip" ? 48 + index : status === "maybe" ? 58 + index : 72 + index / 2,
    nicheScore: 35 + ((index * 13) % 64),
    productScore: 22 + ((index * 19) % 76),
    appScore: 18 + ((index * 23) % 80),
    reason: reasons[index % reasons.length],
  });
}

database.setSearchProgress(session.id, queries.length, null);
database.setSearchFinished(session.id);
console.log(`Demo research created: ${session.id}`);
