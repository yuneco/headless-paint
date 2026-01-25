# Headless Paint - Architecture

## Overview

WebベースのペイントツールのためのヘッドレスエンジンとUIの分離設計。

### 設計方針

- **エンジンとUIの分離**: コアロジックは特定のUIフレームワークに依存しない。また、ブラウザの入力イベント（PointerEvent等）にも直接依存せず、入力抽象化層（input）がこの橋渡しを行う
- **入力デバイス非依存**: 抽象化された入力イベントを受け取る設計
- **テスタビリティ**: エンジンはDOM非依存でユニットテスト可能

## Current Target

シンプルな単色ブラシでの描画機能を最初のマイルストーンとする。
以下の設計は将来的な拡張を見据えたものであり、段階的に実装を進める。

## Package Structure

```
headless-paint/
├── packages/
│   ├── engine/              # コアエンジン（Canvas2Dベース）
│   │   ├── src/
│   │   │   ├── layer.ts        # レイヤー管理 + ピクセルデータ
│   │   │   ├── stroke.ts       # ストローク補間
│   │   │   ├── brush.ts        # ブラシ描画
│   │   │   ├── composite.ts    # レイヤー合成
│   │   │   ├── command.ts      # Undo/Redo
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── input/               # 入力抽象化
│       ├── src/
│       │   ├── pointer.ts      # PointerEvent → Stroke
│       │   ├── types.ts
│       │   └── index.ts
│       └── package.json
│
├── apps/
│   └── web/                 # デモアプリ（React）
│
└── docs/                    # ドキュメント
```

## Package Responsibilities

### @headless-paint/engine

コアエンジン。ピクセルデータの管理と描画ロジックを担当。

**責務:**
- 各レイヤーのビットマップ（`Uint8ClampedArray`）の保持
- ストローク計算（点の補間、筆圧カーブ）
- ブラシによるピクセル描画
- レイヤー合成（composite）して`ImageData`を返す
- Undo/Redo履歴管理

**依存:**
- `gl-matrix`: 行列・ベクトル演算
- `culori`: 色空間変換

**重要な設計判断:**
- ビットマップデータはエンジンが所有
- レイヤー合成もエンジンが行う（CPU合成）
- `composite(): ImageData` でUI側に合成済み画像を渡す
- Rendererパッケージは設けない（UIが直接`putImageData`する）

### @headless-paint/input

入力イベントの抽象化レイヤー。

**責務:**
- `PointerEvent`を抽象化された`Stroke`に変換
- マウス/タッチ/ペンの統合
- 筆圧・傾き情報の正規化

**依存:**
- `@headless-paint/engine`（型定義のみ参照）

### apps/web

デモ用Webアプリケーション。

**責務:**
- `engine.composite()`の結果を`<canvas>`に表示
- ツールバー、レイヤーパネル等のUI
- ユーザーインタラクション

## Data Flow

```
User Input (PointerEvent)
         │
         ▼
┌─────────────────┐
│  @input         │  PointerEvent → Point[]
│  pointer.ts     │
└─────────────────┘
         │
         │ { points, pressure, tilt }
         ▼
┌─────────────────┐
│  @engine        │
│                 │
│  stroke.ts      │  点の補間・スムージング
│       ↓         │
│  brush.ts       │  ピクセルデータに描画
│       ↓         │
│  layer.pixels   │  Uint8ClampedArray更新
│       ↓         │
│  composite.ts   │  全レイヤー合成
│                 │
└─────────────────┘
         │
         │ ImageData
         ▼
┌─────────────────┐
│  UI (apps/web)  │  ctx.putImageData()
│  <canvas>       │
└─────────────────┘
```

## Future Considerations

### WebGL Backend

Canvas2Dでパフォーマンス問題が発生した場合、バックエンドの差し替えを検討:

```
packages/engine/
├── core/              # 共通ロジック（バックエンド非依存）
│   ├── stroke.ts
│   ├── brush-params.ts
│   └── command.ts
│
├── backend/
│   ├── interface.ts   # 共通インターフェース
│   ├── canvas2d/      # 現在の実装
│   └── webgl/         # 将来追加
```

共通化可能な部分:
- ストローク補間ロジック
- ブラシパラメータ定義
- ブレンドモード計算式
- レイヤー管理のメタデータ
- Undo/Redoコマンドパターン

## Tech Stack

- **Language**: TypeScript（strict mode）
- **Monorepo**: pnpm workspaces
- **Build**: Vite（library mode for packages）
- **Test**: Vitest（browser mode）
- **Lint/Format**: Biome
- **UI Framework**: React（apps/webのみ）
