import { describe, expect, it } from "vitest";
import type { SessionPost } from "./types.js";
import { comparePostsForReview, isLowTraction } from "./ranking.js";

function post(id: string, views: number, aiScore: number): SessionPost {
  return {
    id,
    url: `https://www.tiktok.com/@creator/photo/${id}`,
    author: { username: "creator" },
    caption: "",
    slides: [],
    metrics: { views },
    searchQueries: [],
    bestSearchRank: 1,
    aiStatus: "relevant",
    aiScore,
    aiNicheScore: null,
    aiProductScore: null,
    aiAppScore: null,
    aiReason: null,
    humanStatus: null,
    finalStatus: "relevant",
    pinned: false,
    visualStatus: "pending",
    visualProfile: null,
  };
}

describe("traction gate", () => {
  it("treats fewer than 1000 known views as low traction", () => {
    expect(isLowTraction({ views: 999 })).toBe(true);
    expect(isLowTraction({ views: 1_000 })).toBe(false);
    expect(isLowTraction({})).toBe(false);
  });

  it("puts low-traction posts below viable posts regardless of AI score", () => {
    const sorted = [post("noise", 5, 99), post("working", 12_000, 70)].sort(comparePostsForReview);
    expect(sorted.map((item) => item.id)).toEqual(["working", "noise"]);
  });
});
