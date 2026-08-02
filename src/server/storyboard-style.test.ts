import { describe, expect, it } from "vitest";
import type { StoryboardBatch } from "./draft-contract.js";
import { nativeCopyIssues, simplePinterestQuery } from "./storyboard-style.js";

describe("simplePinterestQuery", () => {
  it("removes art-director filler from a literal subject", () => {
    expect(simplePinterestQuery("tired man aesthetic portrait photography")).toBe("tired man");
  });

  it("keeps generated searches to three plain words", () => {
    expect(simplePinterestQuery("man drinking water near kitchen window")).toBe("man drinking water");
  });
});

function batchWithHook(copy: string): StoryboardBatch {
  return { variants: [{
    title: "Fast debloat",
    angle: "Direct how-to",
    slides: [
      { index: 1, role: "hook", copy, visual_brief: "Фото лица", pinterest_query: "puffy face", source_post_ids: [], product_slide: false },
      { index: 2, role: "tip", copy: "drink more water", visual_brief: "Стакан воды", pinterest_query: "drinking water", source_post_ids: [], product_slide: false },
      { index: 3, role: "tip", copy: "stop eating so late", visual_brief: "Поздняя еда", pinterest_query: "late food", source_post_ids: [], product_slide: false },
      { index: 4, role: "ending", copy: "save this for tomorrow", visual_brief: "Фото телефона", pinterest_query: "phone reminder", source_post_ids: [], product_slide: false },
    ],
  }] };
}

describe("nativeCopyIssues", () => {
  it("rejects a vague AI hook that hides the actual topic", () => {
    expect(nativeCopyIssues(batchWithHook("Before changing your face, check these 4 things"), "face debloating and puffiness")).not.toHaveLength(0);
    expect(nativeCopyIssues(batchWithHook("A sharper-looking face starts with a routine you can actually repeat"), "face debloating and puffiness")).not.toHaveLength(0);
    expect(nativeCopyIssues(batchWithHook("Face looks puffy? Try this simple reset"), "face debloating and puffiness")).not.toHaveLength(0);
  });

  it("accepts a direct TikTok-style search-intent hook", () => {
    expect(nativeCopyIssues(batchWithHook("the best ways to debloat your face"), "face debloating and puffiness")).toEqual([]);
    expect(nativeCopyIssues(batchWithHook("top ways to depuff fast"), "face debloating and puffiness")).toEqual([]);
  });
});
