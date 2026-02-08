# headless-paint

Canvas2D ベースのペイントライブラリ。OffscreenCanvas を使用し、DOM に依存せず Web Worker 等でも動作します。

## 特徴

- **DOM 非依存** — OffscreenCanvas ベースで Web Worker 上でも動作
- **関数型設計** — クラスを使わず純粋関数 + イミュータブルデータで構成
- **差分レンダリング** — committed/pending モデルによる効率的な描画更新
- **対称展開（Expand）** — 万華鏡・ミラーなどの対称描画を描画時に展開
- **入力パイプライン** — スムージング・サンプリングなどをプラグイン的に合成
- **Undo/Redo** — コマンドリプレイ + チェックポイントによる履歴管理

## パッケージ構成

```
headless-paint/
├── packages/
│   ├── engine   … 描画エンジン（レイヤー管理・描画・対称展開・差分レンダリング）
│   ├── input    … 入力処理（座標変換・ビュー操作・フィルタパイプライン）
│   └── stroke   … ストローク管理（セッション・Undo/Redo 履歴・コマンド）
└── apps/
    └── web      … React デモアプリ
```

| パッケージ | 概要 | 詳細ドキュメント |
|-----------|------|-----------------|
| `@headless-paint/engine` | レイヤーの作成・描画プリミティブ・可変幅パス・対称展開・差分レンダリング | [engine/docs](./packages/engine/docs/README.md) |
| `@headless-paint/input` | スクリーン↔レイヤー座標変換、pan/zoom/rotate ビュー操作、フィルタパイプライン（スムージング等） | [input/docs](./packages/input/docs/README.md) |
| `@headless-paint/stroke` | 1 ストロークのセッション管理、committed/pending の差分計算、Undo/Redo 履歴 | [stroke/docs](./packages/stroke/docs/README.md) |

### 依存関係

```
engine          ← culori, gl-matrix
input           ← gl-matrix
stroke          ← engine, input (peer deps)
```

## デモアプリ（apps/web）

`apps/web` は各パッケージを組み合わせた React ベースのデモアプリケーションです。ライブラリとしての利用イメージの参考になります。

- 筆圧対応のフリーハンド描画（ペン / 消しゴム）
- pan / zoom / rotate によるキャンバス操作
- 万華鏡・ミラーなどの対称描画
- スムージングによる手ブレ補正
- Undo / Redo
- ラップシフト（シームレスパターン作成）
- ミニマップ・デバッグパネル

## セットアップ

```bash
git clone https://github.com/yuneco/headless-paint.git
cd headless-paint
pnpm install
```

```bash
pnpm dev     # デモアプリの開発サーバー起動
pnpm build   # 全パッケージビルド
pnpm test    # テスト実行（Vitest + Playwright/Chromium）
pnpm lint    # Biome lint
pnpm format  # Biome format
```

## 技術スタック

- **言語**: TypeScript（strict mode）
- **ビルド**: Vite（ライブラリモード）
- **テスト**: Vitest + Playwright（Chromium ブラウザ上で実行）
- **Lint / Format**: Biome
- **モノレポ**: pnpm workspaces

## ライセンス

MIT
