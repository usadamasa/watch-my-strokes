# 実行プラン: watch-my-strokes MVP

[要件定義](./requirements.md) を実装に落とすプラン。各マイルストーンはGitHubのサブイシュー(#1配下)でトラッキングする。

## 技術スタック

| レイヤ | 選定 | 理由 |
|---|---|---|
| ランタイム / PM | **Bun**(workspaces) | TS直接実行・高速インストール・テストランナー同梱 |
| 型チェック | **tsgo**(`@typescript/native-preview`) | ネイティブ実装の高速な `tsc` 相当。`--noEmit` で全ワークスペースを検査 |
| フロントエンド | Vite + React + TypeScript | Issue原案どおり。Canvas/getUserMediaを直接扱う |
| バックエンド | `Bun.serve` + TypeScript | ~0.7fpsの低頻度POSTにはNestJS/WebSocketは過剰。依存ゼロの最小構成 |
| LLM | `@anthropic-ai/sdk`(既定モデル `claude-opus-5`) | vision対応。プロバイダIFで差し替え可能、モック同梱 |
| 共有型 | `packages/shared`(TSソースを直接参照) | フロント/サーバー間のAPI型を一元化 |
| テスト | `bun test` | 変化検知・クールダウン・コーチエンジンの単体テスト |
| E2E/シミュレーション | Playwright(同梱Chromium) | カメラなし環境で全ループを検証しレポート生成 |

## リポジトリ構成

```
apps/web/        # Vite + React フロントエンド
apps/server/     # Express API + CoachEngine + プロバイダ
packages/shared/ # API型定義
scripts/         # シミュレーション実行スクリプト
docs/            # 要件・プラン・シミュレーション結果
```

## マイルストーン

### M0. 要件定義・実行プラン(本ドキュメント)
- requirements.md / plan.md を作成し、サブイシューを起票する。

### M1. フロントエンド基盤: 映像ソースとフレームキャプチャ
- `FrameSource` インターフェース(`start/stop/drawTo(canvas)`)。
- `WebcamSource`(getUserMedia)と `SimulatedSource`(合成描画: ドローイング/手書き2シナリオ)。
- 設定間隔でクロップ→JPEGエンコードするキャプチャループ。

### M2. 紙領域クロップUI
- プレビュー上のドラッグで矩形選択、リセット可能。キャプチャはクロップ領域を切り出す。

### M3. フィードバック抑制: 変化検知 + クールダウン
- `frameDiff(prev, next): changeScore`(ダウンスケール・グレースケール画素差、純関数)。
- クールダウン状態機械(純関数 reducer)。閾値・時間は設定可能。
- 単体テストで境界条件(初回フレーム、閾値ちょうど、クールダウン中の大変化)を担保。

### M4. コーチングバックエンド
- `POST /api/sessions` / `POST /api/sessions/:id/frames`。
- `CoachEngine`: セッション毎に直近Nフレーム+指摘履歴を保持し、プロバイダへ問い合わせ。
- `AnthropicCoach`: Issue記載の方針のシステムプロンプト、JSON応答、直近3画像のみ送信。
- `MockCoach`: メタ情報ベースの決定論的模倣(沈黙も再現)。`ANTHROPIC_API_KEY` 未設定時の既定。
- 単体テスト: エンジンの履歴管理、モックの介入/沈黙判定。

### M5. 音声フィードバック(TTS)+ セッションUI
- `speechSynthesis` ラッパー(最新優先、キュー破棄)。
- フィードバック表示、セッションタイムライン、ログのJSONエクスポート。

### M6. E2Eシミュレーションと結果レポート
- Playwrightでヘッドレス起動: シミュレーションソース+モックコーチで60秒相当のセッションを実行。
- スクリーンショットとセッションログを `docs/simulation/` に保存し、`report.md` にまとめる。
- これが「人間のフィードバックなしでの動作確認」の代替となる。

## 検証方法(Definition of Done)

1. `npm test` が全ワークスペースで成功する。
2. `npm run simulate` 一発で、シミュレーションセッションが完走し `docs/simulation/report.md` が生成される。
3. レポート上で以下が確認できる:
   - 変化のないフレームが送信スキップされている
   - クールダウン中は問い合わせが起きていない
   - フィードバックが「一度に1つ」で、発話イベントとして記録されている
4. `ANTHROPIC_API_KEY` を設定すれば、コード変更なしで実モデル(既定 `claude-opus-5`)に切り替わる。

## リスクと対応

| リスク | 対応 |
|---|---|
| 実LLMの応答品質・レイテンシが未検証(本環境にAPIキーなし) | プロバイダIFで分離し、プロンプトと入出力契約を文書化。モックで制御フローを先に固める |
| ヘッドレス環境に音声デバイスがない | TTSは失敗しても握りつぶし、ログに「発話イベント」を必ず記録 |
| カメラ映像の照明・歪み | MVPではユーザーがカメラ位置を調整する前提(F2クロップで緩和)。CV補正は将来拡張 |
