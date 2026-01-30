# Headless Paint - Architecture

## Overview

WebベースのペイントツールのためのヘッドレスエンジンとUIの分離設計。

### 設計方針

- **エンジンとUIの分離**: コアロジックは特定のUIフレームワークに依存しない。また、ブラウザの入力イベント（PointerEvent等）にも直接依存せず、入力抽象化層（input）がこの橋渡しを行う
- **入力デバイス非依存**: 抽象化された入力イベントを受け取る設計
- **テスタビリティ**: エンジンはDOM非依存でユニットテスト可能
- **関数型アプローチ**: クラスではなく関数とデータ構造で構成。状態管理はアプリ側の責任

## Core Design Decisions

### Canvas2D ベースの実装

パフォーマンス検証の結果、Canvas2D APIを内部で使用することを決定：

**理由:**
- Canvas2DはGPUアクセラレーションされており、大きなブラシサイズでも高速
- 手動ピクセル操作（Bresenham等）は小さいブラシでは問題ないが、半径50px以上で実用に耐えない
- 100スタンプ描画: 手動実装 56ms vs Canvas2D arc 0.1ms（約500倍差）

**トレードオフ:**
- アンチエイリアスの細かい制御は難しくなる
- ピクセルパーフェクトな描画には`getImageData()`が必要

### 関数型アプローチ

クラスではなく、データ構造 + 関数で構成：

```typescript
// Layer = ただのデータ構造
interface Layer {
  readonly width: number;
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly meta: LayerMeta;
}

// 操作は全て関数
function createLayer(width, height, meta?): Layer;
function drawLine(layer, from, to, color, lineWidth?): void;
function drawCircle(layer, center, radius, color): void;
function getImageData(layer): ImageData;
```

**メリット:**
- 状態の流れが明確（神クラス問題を回避）
- テストしやすい（入力→出力が明確）
- 状態管理はアプリ側の責任（React useState等）

## Current Target

シンプルな単色ブラシでの描画機能を最初のマイルストーンとする。
以下の設計は将来的な拡張を見据えたものであり、段階的に実装を進める。

## Package Structure

```
headless-paint/
├── packages/
│   ├── engine/              # コアエンジン（Canvas2Dベース）
│   │   ├── src/
│   │   │   ├── types.ts        # 型定義（Layer, Color, Point等）
│   │   │   ├── layer.ts        # レイヤー操作関数
│   │   │   ├── draw.ts         # 描画関数（Canvas2D API使用）
│   │   │   ├── stroke.ts       # ストローク補間（将来）
│   │   │   ├── composite.ts    # レイヤー合成（将来）
│   │   │   ├── command.ts      # Undo/Redo（将来）
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

コアエンジン。レイヤー管理と描画ロジックを担当。

**主要な関数:**
```typescript
// Layer操作
createLayer(width, height, meta?): Layer
clearLayer(layer): void
getImageData(layer): ImageData
getPixel(layer, x, y): Color
setPixel(layer, x, y, color): void

// 描画
drawLine(layer, from, to, color, lineWidth?): void
drawCircle(layer, center, radius, color): void
drawPath(layer, points, color, lineWidth?): void

// ユーティリティ
colorToStyle(color): string
```

**依存:**
- `gl-matrix`: 行列・ベクトル演算（将来使用）
- `culori`: 色空間変換（将来使用）

**重要な設計判断:**
- 内部的にOffscreenCanvas + Canvas2D APIを使用
- Layerはデータ構造であり、操作は関数で行う
- `getImageData()` でUI側に合成済み画像を渡す
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
- `getImageData(layer)`の結果を`<canvas>`に表示
- ツールバー、レイヤーパネル等のUI
- ユーザーインタラクション
- 状態管理（React useState/useReducer）

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
│  draw.ts        │  Canvas2D APIで描画
│       ↓         │
│  layer.canvas   │  OffscreenCanvas更新
│       ↓         │
│  composite.ts   │  全レイヤー合成（将来）
│                 │
└─────────────────┘
         │
         │ ImageData (via getImageData)
         ▼
┌─────────────────┐
│  UI (apps/web)  │  ctx.putImageData()
│  <canvas>       │
└─────────────────┘
```

## Performance Notes

Canvas2D APIを使用することで、以下のパフォーマンス特性を得られる：

| 操作 | 手動実装 | Canvas2D | 備考 |
|------|---------|----------|------|
| 100本の線 (1920x1080) | 5.2ms | 0.1ms | 52倍高速 |
| 100スタンプ radius=50px | 56ms | 0.1ms | 500倍以上高速 |
| 100スタンプ radius=100px | 229ms | 0.1ms | 2000倍以上高速 |

60fpsを維持するには16.67ms/frame以内に収める必要があるため、Canvas2Dの選択は必須。

## Future Considerations

### WebGL Backend

Canvas2Dでパフォーマンス問題が発生した場合、バックエンドの差し替えを検討:

```
packages/engine/
├── core/              # 共通ロジック（バックエンド非依存）
│   ├── stroke.ts
│   ├── types.ts
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
