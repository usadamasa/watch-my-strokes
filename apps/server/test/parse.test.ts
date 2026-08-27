import { describe, expect, test } from "bun:test";
import { parseDecision } from "../src/coach/anthropic.ts";

describe("parseDecision", () => {
  test("素のJSONを解釈する", () => {
    const d = parseDecision(
      '{"intervene": true, "message": "線を長く", "focus": "line-quality"}',
    );
    expect(d).toEqual({ intervene: true, message: "線を長く", focus: "line-quality" });
  });

  test("コードフェンスや前置きがあっても抽出する", () => {
    const d = parseDecision('見てみましょう。\n```json\n{"intervene": false}\n```');
    expect(d.intervene).toBe(false);
  });

  test("intervene=true でも message がなければ沈黙扱い", () => {
    expect(parseDecision('{"intervene": true}').intervene).toBe(false);
  });

  test("不正な focus は落とす", () => {
    const d = parseDecision('{"intervene": true, "message": "m", "focus": "banana"}');
    expect(d.intervene).toBe(true);
    expect(d.focus).toBeUndefined();
  });

  test("壊れた応答は沈黙にフォールバック", () => {
    expect(parseDecision("ごめんなさい、わかりません").intervene).toBe(false);
    expect(parseDecision("{broken json").intervene).toBe(false);
  });
});
