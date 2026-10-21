import { existsSync } from "node:fs";
import type { LaunchOptions } from "playwright-core";

/**
 * simulate が起動するブラウザを決める。
 *
 * playwright-core 同梱の Chromium は Chrome の security fix に追従が遅れるため、
 * 既定ではマシンにインストールされた Chrome を使う。
 * CHROMIUM_PATH を明示したときだけ、その実行ファイルを優先する。
 */
export function resolveLaunchOptions(
  env: Record<string, string | undefined>,
): Pick<LaunchOptions, "channel" | "executablePath"> {
  const explicit = env.CHROMIUM_PATH;
  if (!explicit) return { channel: "chrome" };
  if (!existsSync(explicit)) {
    throw new Error(`CHROMIUM_PATH の実行ファイルが見つかりません: ${explicit}`);
  }
  return { executablePath: explicit };
}
