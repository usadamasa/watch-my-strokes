# watch-my-strokes

Webカメラで手元の紙を見守り、描画・手書きの練習にリアルタイムで短いコーチングを返すAIコーチのプロトタイプ。
[Issue #1](https://github.com/usadamasa/watch-my-strokes/issues/1) の原案に基づく。

```
映像(Webカメラ | シミュレーション)
  → 1〜2秒毎のJPEGスナップショット
  → 変化検知で足切り → クールダウン
  → マルチモーダルLLM(または モックコーチ)
  → 1つだけの短いアドバイス → TTSで読み上げ
```

- 要件の深掘り: [docs/requirements.md](./docs/requirements.md)
- 実行プラン: [docs/plan.md](./docs/plan.md)
- E2Eシミュレーション結果: [docs/simulation/report.md](./docs/simulation/report.md)

## セットアップ

必要なもの: [Bun](https://bun.sh) 1.3+

```bash
bun install
```

## 起動

```bash
# ターミナル1: APIサーバー (http://localhost:8787)
bun run dev:server

# ターミナル2: フロントエンド (http://localhost:5173)
bun run dev:web
```

ブラウザで http://localhost:5173 を開き、映像ソース(Webカメラ / シミュレーション)を選んで「開始」。
プレビュー上をドラッグすると紙領域をクロップできる。

### コーチのプロバイダ

| 環境変数 | 挙動 |
|---|---|
| `ANTHROPIC_API_KEY` を設定 | Claude(既定 `claude-opus-5`)が画像を見てコーチングする |
| 未設定 | 決定論的なモックコーチ(開発・CI・シミュレーション用) |
| `COACH_MODEL` | 使用モデルの上書き |
| `COACH_PROVIDER=mock\|anthropic` | プロバイダの強制指定 |

## テスト・型チェック

```bash
bun test           # 変化検知 / クールダウン / コーチエンジンの単体テスト
bun run typecheck  # tsgo (@typescript/native-preview) による型チェック
```

## E2Eシミュレーション

カメラ・APIキー・人間の操作なしで全ループを検証する:

```bash
bun run simulate
```

ヘッドレスChromiumがシミュレーション映像(徐々に描き進む線画/手書き)でセッションを実行し、
スクリーンショット・セッションログ・レポートを `docs/simulation/` に出力する。
