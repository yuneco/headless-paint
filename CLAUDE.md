# CLAUDE.md

## プロジェクト概要

Canvas2Dベースのペイントライブラリ。OffscreenCanvasを使用しヘッドレス環境(Node.js, Worker)で動作する。関数型設計で純粋関数+イミュータブルデータ構造を採用。
本プロジェクトは現時点で初期開発中であり、既存の顧客データは存在しない。過去データの互換性は考慮せず破壊的な仕様変更を行って良い。

## コマンド

```bash
pnpm dev                  # Webデモアプリの開発サーバー起動
pnpm build                # 全パッケージビルド
pnpm test                 # 全テスト実行 (Playwright + Chromium でブラウザテスト)
pnpm lint                 # Biome lint
pnpm format               # Biome format

# パッケージ単体
pnpm --filter @headless-paint/engine test
pnpm --filter @headless-paint/stroke test
pnpm --filter @headless-paint/input test
```

テストはVitest + Playwright (Chromium) でブラウザ上実行される。`packages/**/*.test.ts` が対象。

## パッケージ構成と依存関係

```
engine (描画エンジン)          ← culori, gl-matrix
  Layer管理、描画プリミティブ、Expand(対称展開)、差分レンダリング

input (入力処理)              ← gl-matrix
  座標変換(Screen↔Layer)、ビュー変換(pan/zoom/rotate)、FilterPipeline

stroke (ストローク管理)        ← engine, input (peer deps)
  セッション管理(1ストロークのライフサイクル)、Undo/Redo履歴、コマンド生成

web (apps/web, Reactデモ)     ← engine, input, stroke, react, lil-gui
  UIとイベントハンドリング統合層
```

## アーキテクチャの要点

### データフロー

```
PointerEvent → 座標変換(ViewTransform) → FilterPipeline(smoothing等)
  → StrokeSession → RenderUpdate → Engine(差分レンダリング)
```

### committed/pending モデル

描画は2レイヤーに分離される:
- **committedLayer**: 確定済みポイントの累積描画。新規確定分のみ追記(差分)
- **pendingLayer**: 未確定ポイント。毎フレーム全消去→再描画

FilterPipelineのsmoothing windowにより、末尾のポイントはpending(座標が変わりうる)。ストローク終了時にfinalizeで全て確定。

### Expand(対称展開)のタイミング

Expandは**入力時ではなく描画時**に適用される。SessionはExpandを意識せず常に1ストロークを管理。`appendToCommittedLayer`/`renderPendingLayer`に`ExpandConfig`を渡す。

### 履歴(Undo/Redo)

- `StrokeCommand`に入力ポイント+FilterConfig+Expand設定を保存
- Undo時はコマンド列をリプレイ(Filterを再適用)
- Checkpoint(ImageDataスナップショット)で効率化

## コーディング規約

- **Biome**: スペース2、ダブルクォート、セミコロンあり、import自動整理
- **関数型API**: クラスではなく純粋関数。状態は明示的に受け渡し
- **readonly**: 型定義のフィールドはreadonly

## スキルと作業フロー

### Doc-First開発 

計画の作成や、計画に従った実装を行う際は、planning-flow skillのフローに必ず従う。
このプロジェクトではDoc-Firstで開発する。計画の中身（作業手順）を以下のPhaseで構成すること:

1. API設計・ドキュメント作成 → 2. 利用イメージレビュー(承認まで実装に進まない) → 3. 実装 → 4. アーキテクトレビュー(通過して初めて完了報告)

### セルフレビュー (review-library-usage)

実装完了後、報告前にセルフレビューを行う:
- review-library-usage スキルを使用してセルフレビューを行う
- パッケージAPIの活用漏れがないか
- 既存コードとの実装パターンの一貫性
- ドキュメント(`packages/*/docs/README.md`)との整合性

## ドキュメント

各パッケージの詳細APIは `packages/*/docs/` にある。新機能追加時はこれらを参照し、影響範囲のドキュメント更新漏れがないか確認する。

### ドキュメント更新ルール

- **readonly**: ドキュメント内の型定義にもコーディング規約に従い `readonly` を付ける
- **バグ修正・リファクタ時**: planning-flowが適用されない小さな修正でも、関数シグネチャ・デフォルト値・型を変更した場合は対応する `packages/*/docs/` のドキュメントを確認・更新する

## コンテキスト管理
次のステップ/フェーズに進む前にコンテキストの残りを把握する。
使用量が70%を超えたら新規の作業には着手しない。現在の作業をできるだけ詳細に計画に記載し、速やかに停止する。
