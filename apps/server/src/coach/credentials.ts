import { loadConfig, loadCredentials } from "@anthropic-ai/sdk/core/credentials";
import type { ProviderId } from "@wms/shared";

/** SDK の readEnv と同じく、空白だけの値は未設定として扱う。 */
function readEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * `new Anthropic()` が認証情報を解決できるかを、SDK 自身のローダーで判定する。
 *
 * 判定順は SDK の解決順に合わせる:
 *   1. `ANTHROPIC_API_KEY`
 *   2. `ANTHROPIC_AUTH_TOKEN`
 *   3. `ANTHROPIC_PROFILE` が指すプロファイル。指す先が無いと SDK が例外を投げるので mock に倒す
 *   4. Workload Identity Federation の環境変数
 *   5. `ant auth login` の active profile(`<config_dir>/configs/<profile>.json`)
 *
 * 3 と 5 が user_oauth なら credentials ファイルも要る(`ant auth logout` 後は設定だけ残る)。
 * 3 以降の順は SDK の `loadConfig()` が決める。
 */
export async function hasAnthropicCredentials(): Promise<boolean> {
  if (readEnv("ANTHROPIC_API_KEY") || readEnv("ANTHROPIC_AUTH_TOKEN")) {
    return true;
  }
  try {
    const config = await loadConfig();
    if (!config) return false;
    if (config.authentication.type === "user_oauth") {
      return (await loadCredentials()) !== null;
    }
    return true;
  } catch (error) {
    console.warn(
      "[credentials] Anthropic プロファイルを読めなかったため mock にフォールバック:",
      error,
    );
    return false;
  }
}

/**
 * 既定プロバイダの解決順: `COACH_PROVIDER` 環境変数 >
 * 認証情報が解決できれば anthropic、できなければ mock。
 */
export async function resolveDefaultProviderId(): Promise<ProviderId> {
  const forced = readEnv("COACH_PROVIDER");
  if (forced === "anthropic" || forced === "mock") return forced;
  return (await hasAnthropicCredentials()) ? "anthropic" : "mock";
}
