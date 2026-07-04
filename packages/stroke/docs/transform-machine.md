# transform-machine / transform-geometry 設計（WS3・Phase 1）

> ステータス: 実装中（Phase 2 レビューは運用緩和により省略、仮決定事項は paint-app 計画 md に記録）。
> 参照実装: paint-app `features/transform/transformAtoms.ts`（セッション遷移）と
> `ui/widgets/TransformOverlay/TransformOverlay.tsx`（ハンドル幾何）。
> パターン先例: [stroke-machine.md](stroke-machine.md)。

## 層の分業と語彙境界

```
packages/stroke/src/transform-machine.ts   セッション純遷移（begin/set-matrix/commit/cancel、
                                           identity 判定は commit 遷移内）
packages/engine/src/transform-geometry.ts  ハンドル幾何の純関数（レイヤー座標系のみ）
app（transformAtoms / TransformOverlay）    jotai 配線、screen↔layer 変換、カーソル形状、
                                           ツール切替（activate/exit はアプリ語彙のまま）
```

lib はドメイン語（matrix/bounds/commit/cancel）のみ。screen 座標・カーソル・ツールは扱わない。

## transform-machine

```ts
type TransformPixelSource = { readonly type: "layer" };   // 将来 selection の腕を追加

type TransformPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "active";
      readonly layerId: string;
      readonly source: TransformPixelSource;
      readonly bounds: ContentBounds;          // begin 時の content bounds（凍結）
      readonly matrix: readonly number[] };    // mat3 flat（gl-matrix column-major）

type TransformMachineEvent =
  | { type: "begin"; layerId: string; bounds: ContentBounds; source?: TransformPixelSource }
  | { type: "set-matrix"; matrix: readonly number[] }
  | { type: "commit" }
  | { type: "cancel" };

type TransformMachineEffect =
  | { type: "bake-and-record"; layerId: string; matrix: readonly number[] }
      // シェル: transformLayer 焼き込み → createTransformLayerCommand → 履歴 push
  | { type: "session-ended" };   // commit(identity含む)/cancel の共通後始末（アプリ: exitTool 等）

transitionTransform(state, event) => { next: TransformPhase; effects: readonly TransformMachineEffect[] }
createInitialTransformPhase(): TransformPhase
```

- **commit 遷移内の identity 判定**: `matrix` が単位行列（`mat3.exactEquals` 相当の厳密比較、
  現行挙動と同一）なら `bake-and-record` を出さず `session-ended` のみ
- active 中の begin（多重開始）は「前セッションを commit 相当で確定してから新規 begin」ではなく
  **no-op**（現行 app は activate 側で forceCommit してから begin する。その責務はアプリ側に残す）
- 不正イベント（idle への set-matrix/commit/cancel）は no-op + 空 effects
- isDrawing 排他は app 責務（WS2 割り込み仕様で確定済み）

## transform-geometry（packages/engine）

TransformOverlay.tsx に埋まっている行列・幾何の純関数を移設。**すべてレイヤー座標系**で、
screen↔layer 変換（input の layerToScreen/screenToLayer）は呼び出し側が行う。

```ts
// ハンドル配置
getTransformedCorners(bounds: ContentBounds, matrix: mat3like): readonly [Point, Point, Point, Point]
getEdgeMidpoints(corners): readonly [Point, Point, Point, Point]
getOutwardNormal(edgeStart: Point, edgeEnd: Point, quadCenter: Point): Point   // 単位法線

// ヒットテスト
isPointInQuad(point: Point, corners): boolean

// 行列合成（すべて startMatrix に対する合成で新しい mat3 flat を返す）
composeTranslation(startMatrix, dx, dy): Float32Array
composeRotation(startMatrix, center: Point, angleDelta: number): Float32Array
composeScaleAboutAnchor(startMatrix, anchor: Point, sx: number, sy: number): Float32Array

// 判定
isIdentityMatrix(matrix): boolean   // 厳密比較（transform-machine の commit も利用）
```

- リサイズの「ハンドル種別→アンカー/スケール軸の決定」「アスペクト比スナップの閾値判定」は
  UI 入力解釈なので app 側（TransformOverlay）に残す。app はハンドルとアンカーのレイヤー座標から
  sx/sy を計算し `composeScaleAboutAnchor` を呼ぶ
- カーソル形状（`resizeCursor`）・HANDLE_SIZE 等の定数は UI 表現なので app に残す

## テスト計画

- machine: idle/active × 全 event 遷移網羅 + identity commit（純関数）
- geometry: 各合成関数の数値テスト（既知行列との一致）、isPointInQuad の内外・境界、
  getTransformedCorners の回転/反転ケース
- app 追随（WS3 タスク②）: 変形→confirm/cancel/identity/変形後 undo の既存挙動維持。
  TransformOverlay の描画結果が挙動不変（既存 screenshot テスト維持）
