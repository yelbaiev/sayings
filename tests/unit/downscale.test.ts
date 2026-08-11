import { describe, expect, it } from "vitest";
import { MAX_EDGE, fitWithin } from "~/lib/downscale";

/**
 * Only the arithmetic. The canvas work around it cannot be tested here without mocking a canvas into
 * agreeing with whatever the code does, which would test nothing — so the sizing is a pure function
 * and the drawing is left to the browser.
 */

describe("fitWithin", () => {
  it("scales a landscape photo by its long edge", () => {
    // A typical phone photo, 12 megapixels.
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({ width: 1280, height: 960 });
  });

  it("scales a portrait photo by its long edge too", () => {
    expect(fitWithin({ width: 3024, height: 4032 })).toEqual({ width: 960, height: 1280 });
  });

  it("leaves a photo that already fits alone", () => {
    // Re-encoding a small image costs bytes and buys nothing.
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it("does not enlarge", () => {
    expect(fitWithin({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
  });

  it("treats the boundary as fitting", () => {
    expect(fitWithin({ width: MAX_EDGE, height: 900 })).toEqual({ width: MAX_EDGE, height: 900 });
  });

  it("never rounds a dimension to zero", () => {
    // A long till receipt photographed as a strip: 20000 x 40 would scale the short edge to 3.2,
    // and a naive floor would make it 0 — a canvas of width 0 throws.
    const result = fitWithin({ width: 20000, height: 40 });
    expect(result.width).toBe(MAX_EDGE);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("preserves the aspect ratio to within a pixel", () => {
    const source = { width: 4032, height: 3024 };
    const scaled = fitWithin(source);
    const before = source.width / source.height;
    const after = scaled.width / scaled.height;
    expect(Math.abs(before - after)).toBeLessThan(0.01);
  });

  it("survives a zero dimension instead of dividing by it", () => {
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });

  it("takes a custom limit", () => {
    expect(fitWithin({ width: 1000, height: 500 }, 200)).toEqual({ width: 200, height: 100 });
  });
});
