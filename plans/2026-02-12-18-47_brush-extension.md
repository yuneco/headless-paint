# ブラシ拡張システム - 調査結果と設計提案

## Context

現在の描画システムは `drawVariableWidthPath()` による単一レンダリング方式（circle + trapezoid fill）。全ストロークが同じ見た目になる。エアブラシ・鉛筆・パステル等の多様なブラシタイプを実現するための拡張アーキテクチャを設計する。

## 1. 一般的なアプローチ調査結果

### スタンプ方式（業界標準）

プロ向けペイントソフト（Krita, Photoshop, Procreate）の **90%以上のブラシがスタンプ方式**。

- **原理**: ブラシチップ画像（stamp/footprint）をストロークパスに沿って一定間隔で配置
- **間隔**: 通常ブラシ幅の 1/4（`spacing = 0.25`）
- **パラメータ**: scatter, rotation, size/opacity jitter で多様な質感を実現
- **利点**: 直感的、高速（`drawImage` は GPU アクセラレート）、アーティストがカスタムチップ画像で拡張可能

### Canvas2D で使える技法

| 技法 | 用途 | GPU加速 |
|------|------|---------|
| `drawImage()` でスタンプ配置 | 汎用ブラシレンダリング | Yes |
| `createRadialGradient()` | エアブラシのフォールオフ | Yes |
| `globalCompositeOperation` | multiply(水彩的), screen(エアブラシ的) | Yes |
| `globalAlpha` | flow/opacity 制御 | Yes |
| `getImageData/putImageData` | ピクセル単位操作 | **No** (CPU) |

### 既存ライブラリ評価

| ライブラリ | 概要 | 適合性 |
|-----------|------|--------|
| perfect-freehand | 筆圧対応ストロークの外形計算 | △ パス形状のみ、レンダリング方式が異なる |
| p5.brush.js | p5.js 用アーティスティックブラシ | × p5.js 依存、OffscreenCanvas 非対応 |
| brushes.js | Canvas2D ブラシ | × メンテされていない |
| Lazy Brush | スムージング特化 | × FilterPipeline で既にカバー |

**結論**: 適合するライブラリなし。自前実装が最適。理由:
- OffscreenCanvas + ヘッドレス要件に対応するライブラリがない
- committed/pending モデルとの統合が必要
- 関数型 API スタイルの維持

## 2. 現在のシステムの拡張ポイント分析

### 現在の `drawVariableWidthPath` は本質的にスタンプ方式

```
interpolateStrokePoints (Catmull-Rom)
  → 各点に circle を fill
  → 隣接点間を trapezoid polygon で接続
```

**これは「硬い円チップ + 100%間隔のスタンプ + trapezoid 接続」のハードコーディング**。
拡張するには:
1. チップ形状を可変にする（円 / テクスチャ / グラデーション）
2. 接続方式を可変にする（trapezoid / スタンプのみ / なし）
3. スタンプごとのパラメータ変動を追加（rotation, scatter, opacity jitter）

### `drawVariableWidthPath` の呼び出し箇所（置換対象）

1. [incremental-render.ts:22](packages/engine/src/incremental-render.ts#L22) - `appendToCommittedLayer` 内
2. [incremental-render.ts:54](packages/engine/src/incremental-render.ts#L54) - `renderPendingLayer` 内
3. [replay.ts:43](packages/stroke/src/replay.ts#L43) - `replayStrokeCommand` 内

## 3. 推奨アーキテクチャ: `BrushConfig` 判別共用体 + `renderBrushStroke` ディスパッチ

### 型設計

```typescript
// ============================================================
// Brush Tip（チップ形状の定義）
// ============================================================

/** 手続き的円形チップ（hardness でエッジの柔らかさ制御） */
interface CircleTipConfig {
  readonly type: "circle";
  readonly hardness: number; // 0.0 = ガウシアン, 1.0 = ハード円。default: 1.0
}

/** 画像ベースチップ（imageId で BrushTipRegistry から解決） */
interface ImageTipConfig {
  readonly type: "image";
  readonly imageId: string;
}

type BrushTipConfig = CircleTipConfig | ImageTipConfig;

// ============================================================
// Brush Dynamics（スタンプごとの変動パラメータ）
// ============================================================

interface BrushDynamics {
  readonly spacing: number;           // ブラシ直径に対するスタンプ間隔の比率。default: 0.25
  readonly opacityJitter?: number;    // 不透明度のランダム変動 [0,1]
  readonly sizeJitter?: number;       // サイズのランダム変動 [0,1]
  readonly rotationJitter?: number;   // 回転のランダム変動 [0,PI]
  readonly scatter?: number;          // 散布距離（直径比率）
  readonly flow?: number;             // 1スタンプあたりの塗料量 [0,1]。default: 1.0
}

// ============================================================
// BrushConfig（判別共用体・シリアライズ可能）
// ============================================================

/** 現在の circle+trapezoid 方式（デフォルト） */
interface RoundPenBrushConfig {
  readonly type: "round-pen";
}

/** スタンプベースブラシ（汎用拡張型） */
interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
}

type BrushConfig = RoundPenBrushConfig | StampBrushConfig;
```

### `StrokeStyle` 拡張

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;
  readonly pressureCurve?: PressureCurve;
  readonly compositeOperation?: GlobalCompositeOperation;
  readonly brush?: BrushConfig; // NEW: 省略時は round-pen（後方互換）
}
```

### レンダリングディスパッチ

```typescript
function renderBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  overlapCount?: number,
  tipRegistry?: BrushTipRegistry,
): void {
  const brush = style.brush ?? { type: "round-pen" };
  switch (brush.type) {
    case "round-pen":
      drawVariableWidthPath(layer, points, ...); // 既存コード再利用
      break;
    case "stamp":
      renderStampBrushStroke(layer, points, style, brush, overlapCount, tipRegistry);
      break;
  }
}
```

### スタンプブラシの処理フロー

```
interpolateStrokePoints (既存 Catmull-Rom 再利用)
  → prepareTipStamp (チップ画像生成/キャッシュ)
  → spacing 間隔でパスを走査
    → stampAt (drawImage + dynamics 適用)
```

**チップ画像キャッシュ**: lineWidth * 2 の最大サイズで1枚生成し、`drawImage` のスケーリングで圧力対応（GPU アクセラレート）。

### Undo/Redo 対応

- `StrokeCommand` に `brush?: BrushConfig` と `brushSeed?: number` を追加
- jitter 系パラメータは seeded PRNG で決定論的にリプレイ
- seed は session 開始時に生成、command に保存

## 4. プリセットブラシ例

```typescript
const AIRBRUSH: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },           // ソフトフォールオフ
  dynamics: { spacing: 0.05, flow: 0.1 },            // 密間隔・低フロー → 滑らかな噴射
};

const PENCIL: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.95 },           // ほぼハード
  dynamics: { spacing: 0.1, sizeJitter: 0.05, scatter: 0.02 }, // 微ゆらぎ
};

const MARKER: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.7 },            // やや柔らか
  dynamics: { spacing: 0.15, flow: 0.8 },            // 中間フロー
};

const PASTEL: StampBrushConfig = {
  type: "stamp",
  tip: { type: "image", imageId: "pastel-grain" },   // テクスチャ画像
  dynamics: { spacing: 0.2, rotationJitter: Math.PI, scatter: 0.1, opacityJitter: 0.2 },
};
```

## 5. 設計上のトレードオフ

### 5.1 round-pen の扱い（未決定）

**案A: 独立 variant として残す**
```typescript
type BrushConfig = RoundPenBrushConfig | StampBrushConfig;
```
- Pro: 現行 circle+trapezoid アルゴリズムは高速・高品質。オーバーヘッドゼロ
- Pro: スタンプ方式で trapezoid 接続の品質を再現するのは本質的に困難（spacing=0 のスタンプ ≠ trapezoid fill）
- Con: 2つのレンダリングコードパスを維持する必要

**案B: 全ブラシをスタンプ方式に統一**
```typescript
type BrushConfig = StampBrushConfig; // round-pen も stamp の特殊ケース
```
- Pro: コードパスが1つで単純。全ブラシが同じレンダリングパイプラインを通る
- Con: 現行品質を維持するためにスタンプの spacing を極小にする必要があり、パフォーマンス低下の可能性
- Con: trapezoid 接続のような隣接点間の滑らかな補間がスタンプ方式では自然に得られない

→ **実装時に判断**。まず案Aで実装し、stamp ブラシの品質検証後に統一可能か評価するのが安全。

### 5.2 その他のトレードオフ

| 判断 | 選択 | 理由 |
|------|------|------|
| 画像チップの保存方式 | imageId 参照 | base64 埋め込みはコマンド履歴が肥大化。Registry でランタイム解決 |
| jitter の決定論性 | seeded PRNG | undo/redo で同一結果を保証。seed は StrokeCommand に保存（8 bytes/stroke） |
| spacing 累積の committed/pending 境界 | ~~軽微なアーティファクト許容~~ **accumulatedDistance で完全対応可能** | PoC で検証済み。session ref に距離を保持し引き継ぐことで境界をまたいだ連続配置が実現できる |

## 6. PoC 検証結果からの学び

[PoC 実装報告](2026-02-13-20-43_stamp-brush-poc.md) で以下が検証済み:

### 6.1 committed/pending 境界は解決可能

当初「軽微なアーティファクト許容」としていたが、PoC で **accumulatedDistance を session ref に保持し committed→pending 間で引き継ぐ** ことで、境界をまたいだスタンプ配置が二重スタンプやギャップなく動作することを確認。本実装でもこのアプローチを採用すべき。

### 6.2 位置ベース PRNG が sequential より優れている

計画では sequential PRNG（ストローク単位シード）を想定していたが、PoC で **位置ベースシード `hashSeed(globalSeed, round(distance * 100))`** を採用。利点:
- committed と pending を independent に描画しても同一距離のスタンプは同一 jitter
- pending 再描画時に committed のスタンプ数を復元する必要がない
- Undo/Redo リプレイでも同じ distance → 同じ jitter（seed + distance で決定論的）

**本実装でも位置ベース PRNG を採用すること。**

### 6.3 型配置: interface は types.ts に集約

PoC では StampConfig を stamp.ts に置く計画だったが、StrokeStyle（types.ts）が StampConfig を参照するため循環依存が発生。**interface は types.ts に、実装関数は機能モジュールに** というルールで本実装も進めるべき。

つまり:
- `BrushConfig`, `BrushDynamics`, `BrushTipConfig` → **`types.ts`** に配置
- `renderBrushStroke`, `renderStampBrushStroke`, チップ生成 → `brush-render.ts` / `brush-tip.ts` に配置

### 6.4 spacing 計算: 定数 vs 筆圧連動

PoC では `baseLineWidth * spacing`（定数）を使用。定数でも視覚的に問題はなかったが、筆圧で大きくサイズが変わる場合（筆圧高→太い部分でスタンプ密度が低く見える）は改善の余地がある。

本実装で検討すべきオプション:
- **定数 spacing（PoC方式）**: 蓄積計算が単純、committed/pending 境界で一貫性が高い
- **動的 spacing**: `calculateRadius() * 2 * spacing` でセグメントごとに計算。蓄積が非線形になるため、distance ベースの PRNG シードとの整合性に注意が必要

### 6.5 チップへの色焼き込みは正しいアプローチ

`drawStampStroke` に `color` を渡す設計だったが、チップ生成時に色を焼き込む方式では関数内で color を使用しない。**チップ生成を呼び出し側（useStrokeSession）の責務にし、drawStampStroke は tipCanvas のみを受け取る** 設計が自然。本実装でも `renderBrushStroke` は tip を受け取る形にすべき。

### 6.6 App.tsx 配線は不要

StrokeStyle に brush 情報を含めれば、既存のデータフロー（penSettings → strokeStyle → usePaintEngine → useStrokeSession → incremental-render）で自動的に伝播する。**App.tsx や PaintCanvas の変更なしでブラシ切り替えが動作する**。

### 6.7 `appendToCommittedLayer` / `renderPendingLayer` の戻り値変更

PoC では void→number（accumulatedDistance）に変更。本実装の `renderBrushStroke` ディスパッチ設計では、**戻り値をブラシ固有のコンテキスト（距離、スタンプ数等）を含むオブジェクトにする** ことも検討に値する。

## 7. パッケージ配置

全ブラシコードは **`packages/engine`** に配置（描画関心事のため）。

### 新規ファイル
- `packages/engine/src/brush-tip.ts` - チップ生成・キャッシュ・BrushTipRegistry
- `packages/engine/src/brush-render.ts` - renderBrushStroke + renderStampBrushStroke

### 変更ファイル
- `packages/engine/src/types.ts` - BrushConfig 型群 + StrokeStyle に `brush?: BrushConfig` 追加
- `packages/engine/src/incremental-render.ts` - drawVariableWidthPath → renderBrushStroke
- `packages/engine/src/index.ts` - 新 API エクスポート
- `packages/stroke/src/types.ts` - StrokeCommand に `brush?` + `brushSeed?` 追加
- `packages/stroke/src/session.ts` - brush/brushSeed のパススルー
- `packages/stroke/src/replay.ts` - drawVariableWidthPath → renderBrushStroke

> **注**: PoC では `brush.ts` に型定義を置く計画だったが循環依存が発生した。型定義は `types.ts` に集約し、`brush.ts` は廃止して `brush-render.ts` + `brush-tip.ts` に分割する。

## 8. 実装フェーズ（参考・将来実行時のガイド）

### Phase 1: Doc + 型定義 + リファクタ（挙動変更なし）
- API ドキュメント作成（Doc-First）
- 型定義を **`types.ts`** に追加（`BrushConfig`, `BrushDynamics`, `BrushTipConfig`）
- `renderBrushStroke` ディスパッチ関数（round-pen のみ実装）
- incremental-render.ts, replay.ts の呼び出し置換
- StrokeCommand 拡張
- **全テスト通過確認（純粋リファクタ）**

### Phase 2: スタンプブラシ実装
- チップ生成 (`generateCircleTip` with hardness)
- `renderStampBrushStroke` 実装（PoC の `drawStampStroke` を基に）
  - **位置ベース PRNG** を採用（PoC で検証済み）
  - **accumulatedDistance** による committed/pending 境界対応
  - tip 生成は呼び出し側の責務（drawStampStroke は tipCanvas を受け取る）
- Seeded PRNG ユーティリティ（mulberry32 + hashSeed）
- BrushTipRegistry（image tip 用）
- テスト

### Phase 3: プリセット + デモ
- プリセットブラシ定義
- Web デモにブラシ選択 UI（PoC と同様、既存データフローで自動伝播するため App.tsx 変更は最小限）
- image tip アセット

## 検証方法（将来実装時）
- `pnpm test` - 全テスト通過（Phase 1 は既存テストが完全にパス）
- `pnpm build` - ビルド成功
- `pnpm dev` - デモアプリで round-pen が従来通り動作、stamp ブラシで新しい質感が確認可能
- undo/redo でスタンプブラシのストロークが同一に再現される

## ステータス

- 調査・設計提案: 完了
- **PoC 検証: 完了** → [PoC報告](2026-02-13-20-43_stamp-brush-poc.md)
- 本実装: 未着手
