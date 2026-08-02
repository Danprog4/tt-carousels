import type { CarouselMetrics, SessionPost } from "./types.js";

export const MIN_TRACTION_VIEWS = 1_000;

export function isLowTraction(metrics: CarouselMetrics): boolean {
  return typeof metrics.views === "number" && metrics.views < MIN_TRACTION_VIEWS;
}

export function comparePostsForReview(left: SessionPost, right: SessionPost): number {
  const leftLow = isLowTraction(left.metrics);
  const rightLow = isLowTraction(right.metrics);
  if (leftLow !== rightLow) return leftLow ? 1 : -1;
  if (leftLow && rightLow) return (right.metrics.views ?? 0) - (left.metrics.views ?? 0);
  const scoreDifference = (right.aiScore ?? -1) - (left.aiScore ?? -1);
  if (scoreDifference) return scoreDifference;
  return (right.metrics.views ?? 0) - (left.metrics.views ?? 0);
}
