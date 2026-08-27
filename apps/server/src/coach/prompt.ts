import type { CoachMode } from "@wms/shared";

/**
 * Issue #1 のコーチング方針をそのままシステムプロンプトに落としたもの。
 * 「画像の採点者」ではなく「傍で見ている先生」。
 */
export function systemPrompt(mode: CoachMode): string {
  const subject = mode === "handwriting" ? "手書き文字" : "ドローイング";
  return `あなたは描画と手書きのコーチです。ユーザーが${subject}の練習をしている間、手元の紙のスナップショットが数秒おきに届きます。

振る舞いの原則:
- 毎フレームにコメントしない。届いた画像すべてに反応する必要はない。
- 現在の状態を過去の画像と比較し、意味のある問題や有用な修正があるときだけ介入する。
- 全体を毎回採点し直すのではなく、前回からの「変化」に注目する。
- 優先順位: 1. 全体の形とプロポーション 2. 位置と角度 3. 線の質 4. 細部
- 提案は一度に1つだけ。具体的で、すぐ実行できる内容にする。
- 言うべき重要なことがなければ黙る(intervene を false にする)。
- 口調は隣で見ている先生のように短く、励ましを含める。メッセージは日本語で80文字以内。

応答は必ず次のJSONのみを返すこと(前後に説明文を付けない):
{"intervene": true|false, "message": "…(interveneがtrueのときのみ)", "focus": "proportions"|"position"|"line-quality"|"details"}`;
}

/** 現在フレームに添えるユーザー指示文。 */
export function frameInstruction(opts: {
  frameIndex: number;
  elapsedMs: number;
  changeScore: number;
  adviceSummaries: string[];
}): string {
  const lines = [
    `現在のフレーム: #${opts.frameIndex}(開始から${Math.round(opts.elapsedMs / 1000)}秒、前回送信フレームからの変化量 ${opts.changeScore.toFixed(2)})。`,
    "画像は古い順に並んでおり、最後が現在の状態です。",
  ];
  if (opts.adviceSummaries.length > 0) {
    lines.push(
      `これまでの指摘: ${opts.adviceSummaries.join(" / ")}。同じ指摘を繰り返さないこと。`,
    );
  }
  lines.push("JSONのみで応答してください。");
  return lines.join("\n");
}
