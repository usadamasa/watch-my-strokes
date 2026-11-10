import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDefaultProviderId } from "../src/coach/credentials.ts";

/** SDK の認証解決に影響する環境変数。テスト間で漏れないよう毎回退避・消去する。 */
const ENV_KEYS = [
  "COACH_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CONFIG_DIR",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
] as const;

/** Workload Identity Federation を環境変数だけで構成する。 */
function setFederationEnv() {
  process.env.ANTHROPIC_FEDERATION_RULE_ID = "fdrl_test";
  process.env.ANTHROPIC_ORGANIZATION_ID = "org_test";
  process.env.ANTHROPIC_IDENTITY_TOKEN = "test-identity-token";
}

let saved: Partial<Record<(typeof ENV_KEYS)[number], string>>;
let configDir: string;

/** `ant auth login` が書く形のプロファイルを一時ディレクトリに作る。 */
function writeProfile(opts: { credentials: boolean; configJson?: string }) {
  mkdirSync(join(configDir, "configs"), { recursive: true });
  writeFileSync(
    join(configDir, "configs", "default.json"),
    opts.configJson ??
      JSON.stringify({
        version: "1.0",
        authentication: { type: "user_oauth", client_id: "test-client" },
      }),
  );
  if (opts.credentials) {
    mkdirSync(join(configDir, "credentials"), { recursive: true });
    writeFileSync(
      join(configDir, "credentials", "default.json"),
      JSON.stringify({
        version: "1.0",
        type: "oauth_token",
        access_token: "sk-ant-oat01-test",
        refresh_token: "sk-ant-ort01-test",
        expires_at: 4102444800,
      }),
    );
  }
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // このマシンの実プロファイル(~/.config/anthropic)を読まないよう、空の一時ディレクトリへ向ける
  configDir = mkdtempSync(join(tmpdir(), "wms-credentials-"));
  process.env.ANTHROPIC_CONFIG_DIR = configDir;
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("resolveDefaultProviderId", () => {
  test("認証情報が何もなければ mock", async () => {
    expect(await resolveDefaultProviderId()).toBe("mock");
  });

  test("COACH_PROVIDER=mock は API キーがあっても mock", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test";
    process.env.COACH_PROVIDER = "mock";
    expect(await resolveDefaultProviderId()).toBe("mock");
  });

  test("COACH_PROVIDER=anthropic は認証情報がなくても anthropic", async () => {
    process.env.COACH_PROVIDER = "anthropic";
    expect(await resolveDefaultProviderId()).toBe("anthropic");
  });

  test("ANTHROPIC_API_KEY があれば anthropic", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test";
    expect(await resolveDefaultProviderId()).toBe("anthropic");
  });

  test("空白だけの ANTHROPIC_API_KEY は未設定扱い(SDK の readEnv と同じ)", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(await resolveDefaultProviderId()).toBe("mock");
  });

  test("ANTHROPIC_AUTH_TOKEN があれば anthropic", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-ant-oat01-test";
    expect(await resolveDefaultProviderId()).toBe("anthropic");
  });

  test("ant auth login の OAuth プロファイルがあれば anthropic", async () => {
    writeProfile({ credentials: true });
    expect(await resolveDefaultProviderId()).toBe("anthropic");
  });

  test("プロファイル設定だけで credentials がない(logout 後)なら mock", async () => {
    writeProfile({ credentials: false });
    expect(await resolveDefaultProviderId()).toBe("mock");
  });

  test("プロファイル設定が壊れていたら警告して mock", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      writeProfile({ credentials: true, configJson: "{ not json" });
      expect(await resolveDefaultProviderId()).toBe("mock");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("ANTHROPIC_PROFILE が無いプロファイルを指すと警告して mock", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.ANTHROPIC_PROFILE = "missing";
      setFederationEnv();
      expect(await resolveDefaultProviderId()).toBe("mock");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("ANTHROPIC_API_KEY があれば ANTHROPIC_PROFILE が無いプロファイルを指していても anthropic", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test";
    process.env.ANTHROPIC_PROFILE = "missing";
    expect(await resolveDefaultProviderId()).toBe("anthropic");
  });

  test("ANTHROPIC_PROFILE のプロファイルは Federation の環境変数より優先", async () => {
    writeProfile({ credentials: false });
    process.env.ANTHROPIC_PROFILE = "default";
    setFederationEnv();
    expect(await resolveDefaultProviderId()).toBe("mock");
  });

  test("Federation の環境変数は active profile より優先", async () => {
    writeProfile({ credentials: false });
    setFederationEnv();
    expect(await resolveDefaultProviderId()).toBe("anthropic");
  });
});
