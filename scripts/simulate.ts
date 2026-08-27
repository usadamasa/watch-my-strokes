/**
 * E2Eシミュレーションハーネス。
 *
 * カメラ・APIキー・人間の操作なしで
 *   映像 → フレーム抽出 → (足切り/クールダウン) → コーチ → フィードバック
 * の全ループを検証する。
 *
 *   bun run scripts/simulate.ts
 *
 * サーバー(モックコーチ)と Vite を起動し、ヘッドレスChromiumで
 * シミュレーション映像ソースのセッションを2シナリオ実行して、
 * スクリーンショットとセッションログを docs/simulation/ に保存する。
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import type { SessionEvent } from "../packages/shared/src/types.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT_DIR = path.join(ROOT, "docs", "simulation");
const SERVER_PORT = 8791;
const WEB_PORT = 5179;
/** 各シナリオの観察時間(ms)。 */
const SESSION_MS = 52_000;

function findChromium(): string {
  const candidates = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(
    (p): p is string => !!p,
  );
  for (const c of candidates) {
    if (existsSync(c) && Bun.file(c).size > 0) return c;
  }
  // playwright のディレクトリレイアウト(chromium-XXXX/chrome-linux/chrome)を探す
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  const glob = new Bun.Glob("chromium-*/chrome-linux/chrome");
  for (const match of glob.scanSync({ cwd: base, onlyFiles: true })) {
    return path.join(base, match);
  }
  throw new Error("Chromium が見つかりません。CHROMIUM_PATH を設定してください。");
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // まだ起動中
    }
    await Bun.sleep(300);
  }
  throw new Error(`起動待ちタイムアウト: ${url}`);
}

interface ScenarioResult {
  scenario: string;
  events: SessionEvent[];
  counts: Record<string, number>;
  advices: { t: number; detail: string }[];
}

function summarize(scenario: string, events: SessionEvent[]): ScenarioResult {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const advices = events
    .filter((e) => e.type === "advice")
    .map((e) => ({ t: e.t, detail: e.detail ?? "" }));
  return { scenario, events, counts, advices };
}

function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderReport(results: ScenarioResult[]): string {
  const lines: string[] = [
    "# E2Eシミュレーション結果",
    "",
    "`bun run simulate` により自動生成。ヘッドレスChromium上でシミュレーション映像ソース",
    "(徐々に描き進む合成映像)を再生し、モックコーチとの全ループを検証した。",
    "",
    "パイプライン: 映像 → 1.5秒毎キャプチャ → 変化検知(足切り) → クールダウン →",
    "コーチ問い合わせ → 介入判断 → 発話イベント(TTS)",
    "",
  ];
  for (const r of results) {
    const c = r.counts;
    lines.push(
      `## シナリオ: ${r.scenario}`,
      "",
      `![early](./${r.scenario}-early.png) ![late](./${r.scenario}-late.png)`,
      "",
      "| 指標 | 値 |",
      "|---|---|",
      `| キャプチャ | ${c.capture ?? 0} |`,
      `| 送信スキップ(変化なし) | ${c["skip-nochange"] ?? 0} |`,
      `| 送信スキップ(クールダウン) | ${c["skip-cooldown"] ?? 0} |`,
      `| 送信スキップ(問い合わせ中) | ${c["skip-inflight"] ?? 0} |`,
      `| コーチ問い合わせ | ${c.ask ?? 0} |`,
      `| 介入(アドバイス) | ${c.advice ?? 0} |`,
      `| 沈黙判断 | ${c.silent ?? 0} |`,
      `| 発話イベント | ${c.speak ?? 0} |`,
      `| エラー | ${c.error ?? 0} |`,
      "",
      "### コーチの発話タイムライン",
      "",
    );
    if (r.advices.length === 0) {
      lines.push("(介入なし)");
    } else {
      lines.push("| 時刻 | アドバイス |", "|---|---|");
      for (const a of r.advices) {
        lines.push(`| ${fmtSec(a.t)} | ${a.detail.replace(/\|/g, "\\|")} |`);
      }
    }
    lines.push("");
  }
  lines.push(
    "## 検証ポイント",
    "",
    "- 変化のないフレームは `skip-nochange` としてAPI到達前に足切りされている",
    "- 発話直後は `skip-cooldown` により問い合わせ自体が止まっている",
    "- 問い合わせても `silent`(介入なし)になるケースがあり、「言うことがなければ黙る」が機能している",
    "- 介入は一度に1メッセージで、`speak` イベントとして記録されている",
    "",
  );
  return lines.join("\n");
}

async function runScenario(
  browserPath: string,
  scenario: "sim-drawing" | "sim-handwriting",
): Promise<ScenarioResult> {
  const name = scenario.replace("sim-", "");
  console.log(`[simulate] scenario: ${name}`);
  const browser = await chromium.launch({ executablePath: browserPath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://localhost:${WEB_PORT}/`);
    await page.selectOption('[data-testid="source-select"]', scenario);
    await page.click('[data-testid="start"]');

    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-early.png`) });
    await page.waitForTimeout(SESSION_MS / 2 - 4000);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-mid.png`) });
    await page.waitForTimeout(SESSION_MS / 2);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-late.png`) });

    await page.click('[data-testid="stop"]');
    const events = (await page.evaluate(
      // @ts-expect-error ブラウザ側で定義しているフック
      () => window.__wms.getEvents(),
    )) as SessionEvent[];
    const result = summarize(name, events);
    await Bun.write(
      path.join(OUT_DIR, `session-${name}.json`),
      JSON.stringify({ scenario: name, counts: result.counts, events }, null, 2),
    );
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("[simulate] starting server and web...");
  const serverProc = Bun.spawn(["bun", "run", "apps/server/src/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(SERVER_PORT), COACH_PROVIDER: "mock" },
    stdout: "inherit",
    stderr: "inherit",
  });
  const webProc = Bun.spawn(
    ["bunx", "vite", "dev", "--port", String(WEB_PORT), "--strictPort"],
    {
      cwd: path.join(ROOT, "apps", "web"),
      env: { ...process.env, SERVER_PORT: String(SERVER_PORT) },
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  try {
    await waitForHttp(`http://localhost:${SERVER_PORT}/api/health`);
    await waitForHttp(`http://localhost:${WEB_PORT}/`);
    const browserPath = findChromium();
    console.log(`[simulate] chromium: ${browserPath}`);

    const results: ScenarioResult[] = [];
    results.push(await runScenario(browserPath, "sim-drawing"));
    results.push(await runScenario(browserPath, "sim-handwriting"));

    await Bun.write(path.join(OUT_DIR, "report.md"), renderReport(results));
    console.log(`[simulate] done. see docs/simulation/report.md`);
    for (const r of results) {
      console.log(`  ${r.scenario}:`, JSON.stringify(r.counts));
    }
  } finally {
    serverProc.kill();
    webProc.kill();
  }
}

await main();
