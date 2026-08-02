import { describe, expect, it } from "vitest";
import { normalizePinterestQuery } from "./pinterest.js";

describe("Pinterest query normalization", () => {
  it("shares cache entries across spacing and casing variants", () => {
    expect(normalizePinterestQuery("  Men   Morning ROUTINE aesthetic ")).toBe("men morning routine aesthetic");
  });
});
