import { describe, expect, test } from "bun:test";
import type { FrameMetrics } from "@wms/shared";
import { mockDecide, stageFor } from "../src/coach/mock.ts";
import type { CoachContext } from "../src/coach/provider.ts";

function ctx(
  metrics: Partial<FrameMetrics>,
  overrides?: Partial<CoachContext>,
): CoachContext {
  const m: FrameMetrics = {
    frameIndex: 5,
    elapsedMs: 10_000,
    changeScore: 0.005,
    inkRatio: 0.012, // → position 段階
    ...metrics,
  };
  return {
    mode: "drawing",
    frames: [{ imageBase64: "x", mediaType: "image/jpeg", metrics: m }],
    adviceHistory: [],
    ...overrides,
  };
}

describe("stageFor", () => {
  test("インク被覆率に応じて指導段階が進む", () => {
    expect(stageFor(0.004)).toBe("proportions");
    expect(stageFor(0.012)).toBe("position");
    expect(stageFor(0.02)).toBe("line-quality");
    expect(stageFor(0.05)).toBe("details");
  });
});

describe("mockDecide", () => {
  test("最初の2フレームは観察に徹して黙る", () => {
    expect(mockDecide(ctx({ frameIndex: 0 })).intervene).toBe(false);
    expect(mockDecide(ctx({ frameIndex: 1 })).intervene).toBe(false);
    expect(mockDecide(ctx({ frameIndex: 2 })).intervene).toBe(true);
  });

  test("ほぼ白紙なら黙る", () => {
    expect(mockDecide(ctx({ inkRatio: 0.001 })).intervene).toBe(false);
  });

  test("変化が小さければ黙る", () => {
    expect(mockDecide(ctx({ changeScore: 0.0001 })).intervene).toBe(false);
  });

  test("介入時はメッセージが1つだけ・80文字以内", () => {
    const d = mockDecide(ctx({}));
    expect(d.intervene).toBe(true);
    expect(d.message).toBeDefined();
    expect(d.message!.length).toBeLessThanOrEqual(80);
    expect(d.focus).toBeDefined();
  });

  test("直近の指摘から3フレーム未満なら黙る", () => {
    const history = [
      {
        frameIndex: 4,
        elapsedMs: 8_000,
        decision: { intervene: true, message: "m", focus: "position" as const },
      },
    ];
    expect(mockDecide(ctx({ frameIndex: 6 }, { adviceHistory: history })).intervene).toBe(
      false,
    );
    expect(mockDecide(ctx({ frameIndex: 7 }, { adviceHistory: history })).intervene).toBe(
      true,
    );
  });

  test("同じ観点は大きな変化がない限り繰り返さない", () => {
    const history = [
      {
        frameIndex: 2,
        elapsedMs: 4_000,
        // 既定の inkRatio 0.012 → 観点は position で同じ
        decision: { intervene: true, message: "m", focus: "position" as const },
      },
    ];
    expect(
      mockDecide(ctx({ frameIndex: 8, changeScore: 0.001 }, { adviceHistory: history }))
        .intervene,
    ).toBe(false);
    expect(
      mockDecide(ctx({ frameIndex: 8, changeScore: 0.005 }, { adviceHistory: history }))
        .intervene,
    ).toBe(true);
  });
});
