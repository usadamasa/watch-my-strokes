import { describe, expect, test } from "bun:test";
import { changeScore, inkRatio, toGrayscale } from "../src/lib/frameDiff.ts";

function rgba(pixels: [number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe("toGrayscale", () => {
  test("白・黒・純色を輝度へ変換する", () => {
    const gray = toGrayscale(
      rgba([
        [255, 255, 255],
        [0, 0, 0],
        [255, 0, 0],
      ]),
    );
    expect(gray[0]).toBe(255);
    expect(gray[1]).toBe(0);
    expect(Math.round(gray[2]!)).toBe(76); // 0.299 * 255
  });
});

describe("changeScore", () => {
  test("同一画像は 0", () => {
    const a = new Uint8Array([10, 200, 30, 40]);
    expect(changeScore(a, a)).toBe(0);
  });

  test("deadband 以下のゆらぎは無視する", () => {
    const a = new Uint8Array([100, 100, 100, 100]);
    const b = new Uint8Array([110, 90, 105, 100]);
    expect(changeScore(a, b)).toBe(0);
  });

  test("大きく変わった画素の割合を返す", () => {
    const a = new Uint8Array([255, 255, 255, 255]);
    const b = new Uint8Array([0, 255, 255, 255]);
    expect(changeScore(a, b)).toBe(0.25);
  });

  test("サイズ不一致は全変化として扱う", () => {
    expect(changeScore(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(1);
  });
});

describe("inkRatio", () => {
  test("白紙は 0、黒画素の割合を返す", () => {
    expect(inkRatio(new Uint8Array([255, 255, 255, 255]))).toBe(0);
    expect(inkRatio(new Uint8Array([0, 255, 255, 255]))).toBe(0.25);
  });
});
