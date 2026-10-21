import { describe, expect, test } from "bun:test";
import { resolveLaunchOptions } from "../launchOptions.ts";

describe("resolveLaunchOptions", () => {
  test("CHROMIUM_PATH が無ければマシンの Chrome を channel で使う", () => {
    expect(resolveLaunchOptions({})).toEqual({ channel: "chrome" });
  });

  test("CHROMIUM_PATH が空文字ならマシンの Chrome を使う", () => {
    expect(resolveLaunchOptions({ CHROMIUM_PATH: "" })).toEqual({ channel: "chrome" });
  });

  test("CHROMIUM_PATH を明示したらその実行ファイルを使う", () => {
    expect(resolveLaunchOptions({ CHROMIUM_PATH: process.execPath })).toEqual({
      executablePath: process.execPath,
    });
  });

  test("CHROMIUM_PATH が存在しないパスならエラーにする", () => {
    expect(() => resolveLaunchOptions({ CHROMIUM_PATH: "/nonexistent/chrome" })).toThrow(
      "CHROMIUM_PATH",
    );
  });
});
