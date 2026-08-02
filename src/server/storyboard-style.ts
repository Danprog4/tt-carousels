import type { StoryboardBatch } from "./draft-contract.js";

export const NATIVE_TIKTOK_COPY_RULES = `
NATIVE TIKTOK COPY — HIGHEST PRIORITY:
- Start with the exact topic and desired outcome. The hook must say what the post actually helps with in words people search and use on TikTok.
- Preserve the source hook's intent. If the source is "how to debloat your face in days", stay in that lane: "the best ways to debloat your face", "top ways to debloat", "how to debloat fast". Do not replace it with a vague umbrella like "change your face" or "improve your appearance".
- Give value immediately. Never start with meta setup such as "before you...", "check these things", "things you need to know", "are you ready", or "here's what to consider".
- Write like a real person making a TikTok carousel: simple words, direct claims, short fragments, natural contractions, one idea per slide.
- Match the full reference carousel's casing, POV, punctuation, slang level, amount of text, and swipe rhythm. Do not force slang that is not in the reference.
- Most slides should be 3–12 words. A hook should normally fit on one short line and must not exceed 14 words.
- Do not use awkward compliance hedges such as "puffy-looking", "sharper-looking", or "improve your appearance". Be direct without making medical promises.
- Never sound like a marketer, coach, magazine, brand, or AI assistant. Do not use: unlock, transform your, elevate, discover, say goodbye to, game changer, ultimate guide, journey, personalized experience, here's why, the secret to, achieve your, or revolutionize.
- Specific beats clever. "how to debloat your face fast" is better than "before changing your face, check these 4 things".
`;

export const SIMPLE_PINTEREST_QUERY_RULES = `
PINTEREST QUERY — HIGHEST PRIORITY:
- Use only 1–3 simple English words naming the main visible subject.
- Search like a normal person. If the image is a tired man, write "tired man" — never "tired man morning window portrait".
- Do not add aesthetic, portrait, editorial, cinematic, lifestyle, lighting, photo, shot, composition, camera, TikTok, carousel, slide, or text.
- Use gender only when it is visibly relevant. Product slides use an empty pinterest_query.
`;

const pinterestFiller = new Set([
  "aesthetic",
  "cinematic",
  "editorial",
  "image",
  "lifestyle",
  "lighting",
  "moody",
  "photo",
  "photography",
  "portrait",
  "shot",
  "vibes",
]);

const vagueHookPatterns = [
  /^before\b/i,
  /\bcheck (these|this|the)( \d+)? things\b/i,
  /\bthings (you )?(need|should|must) (to )?(know|check|consider)\b/i,
  /\bwhat you need to know\b/i,
  /\bstart your journey\b/i,
  /\bstarts? with\b/i,
  /\btry this (simple )?(reset|routine|sequence)\b/i,
  /\broutine you can (actually )?repeat\b/i,
  /^need a\b/i,
  /^(want to|ready to)\b/i,
];

const slopPatterns = [
  /\bunlock\b/i,
  /\btransform your\b/i,
  /\belevate\b/i,
  /\bdiscover\b/i,
  /\bsay goodbye to\b/i,
  /\bgame[ -]?changer\b/i,
  /\bultimate guide\b/i,
  /\bjourney\b/i,
  /\bpersonalized experience\b/i,
  /\bhere'?s why\b/i,
  /\bthe secret to\b/i,
  /\bachieve your\b/i,
  /\brevolutioni[sz]e\b/i,
  /\b(puffy|sharper)-looking\b/i,
  /\bimprove your appearance\b/i,
  /\bpersonali[sz](ed|ation)\b/i,
  /\bsimple reset\b/i,
];

const contextStopWords = new Set([
  "about", "after", "based", "before", "content", "daily", "find", "from", "have", "into", "people", "photo", "source", "that", "their", "them", "these", "things", "this", "tiktok", "using", "variant", "what", "when", "where", "which", "will", "with", "without", "your",
]);

function words(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]+/g) || [];
}

function topicTerms(value: string): string[] {
  const extracted = words(value).filter((word) => word.length >= 4 && !contextStopWords.has(word));
  const aliases = /debloat|bloat|puff|facial|\bface\b/i.test(value)
    ? ["debloat", "depuff", "puffy", "bloat", "face"]
    : [];
  return [...new Set([...aliases, ...extracted])].slice(0, 12);
}

export function nativeCopyIssues(result: StoryboardBatch, topicContext: string): string[] {
  const issues: string[] = [];
  const terms = topicTerms(topicContext);
  result.variants.forEach((variant, variantIndex) => {
    const hook = variant.slides[0]?.copy.trim() || "";
    const hookWords = words(hook);
    if (vagueHookPatterns.some((pattern) => pattern.test(hook))) {
      issues.push(`Variant ${variantIndex + 1} has a vague/meta hook: "${hook}". State the exact topic and outcome immediately.`);
    }
    if (hookWords.length > 14) {
      issues.push(`Variant ${variantIndex + 1} hook is ${hookWords.length} words; make it 14 or fewer.`);
    }
    if (terms.length && !terms.some((term) => hook.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "").includes(term.replace(/(ing|ed|s)$/i, "")))) {
      issues.push(`Variant ${variantIndex + 1} hook does not name the concrete topic. Use one of these ideas directly: ${terms.slice(0, 6).join(", ")}.`);
    }
    variant.slides.forEach((slide) => {
      const matched = slopPatterns.find((pattern) => pattern.test(slide.copy));
      if (matched) issues.push(`Variant ${variantIndex + 1}, slide ${slide.index} uses AI/marketing copy: "${slide.copy}".`);
      const slideWords = words(slide.copy).length;
      if (!slide.product_slide && slideWords > 22) issues.push(`Variant ${variantIndex + 1}, slide ${slide.index} is too wordy (${slideWords} words).`);
    });
  });
  return issues.slice(0, 12);
}

export function simplePinterestQuery(value: string): string {
  const original = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const simple = original.filter((word) => !pinterestFiller.has(word)).slice(0, 3);
  return (simple.length ? simple : original.slice(0, 3)).join(" ");
}
