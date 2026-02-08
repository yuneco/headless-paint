# WrapShift をグローバル操作に修正

> 保存先: `/plans/2026-02-08-11-00_global-wrap-shift.md`

## Context

[レイヤー機能の設計](../../plans/2026-02-08-04-50_layer-feature.md) で `WrapShiftCommand` に `layerId` を追加し、全描画コマンドをレイヤー単位にした。しかし wrap-shift は「キャンバス全体をシフトしてシームレスタイルを確認・修正する」操作であり、レイヤー個別に持つのは設計ミス。

**何が困るか**:
1. レイヤーごとに offset がバラバラ → 合成結果がタイルとして繋がらない
2. シフト操作がアクティブレイヤーだけに効く → 全体の継ぎ目が確認できない
3. Reset Offset がアクティブレイヤーだけ → 全レイヤーを戻すには1枚ずつ操作が必要

**修正方針**: `WrapShiftCommand` から `layerId` を削除し、全レイヤーに一括適用されるグローバルコマンドにする。

---

## Phase 1: API設計・ドキュメント作成

### 1-1. 型の変更

**[types.ts](packages/stroke/src/types.ts)**

```typescript
// NEW: レイヤーに紐づく描画コマンド（layerId あり）
export type LayerDrawCommand = StrokeCommand | ClearCommand;

// CHANGED: layerId を削除
export interface WrapShiftCommand {
  readonly type: "wrap-shift";
  // layerId 削除
  readonly dx: number;
  readonly dy: number;
  readonly timestamp: number;
}

// 変更なし
export type DrawCommand = LayerDrawCommand | WrapShiftCommand;
export type Command = DrawCommand | StructuralCommand;

// NEW: 型ガード
export function isLayerDrawCommand(cmd: Command): cmd is LayerDrawCommand {
  return cmd.type === "stroke" || cmd.type === "clear";
}

// isDrawCommand, isStructuralCommand は変更なし
```

### 1-2. Session API の変更

**[session.ts](packages/stroke/src/session.ts)**

```typescript
// CHANGED: layerId パラメータ削除
export function createWrapShiftCommand(
  dx: number,
  dy: number,
): WrapShiftCommand
```

### 1-3. History API の変更

**[history.ts](packages/stroke/src/history.ts)**

| 関数 | 変更内容 |
|------|---------|
| `computeCumulativeOffsetForLayer` | **削除** |
| `computeCumulativeOffset` (旧 deprecated) | **昇格**: `@deprecated` 除去、正規APIに。`layerId` フィルタなしで全 wrap-shift を合算 |
| `getCommandsToReplayForLayer` | **変更**: wrap-shift は `layerId` フィルタなしで全件含める（グローバルなので） |
| `getAffectedLayerIds` | **変更**: `isDrawCommand` → `isLayerDrawCommand` に変更（wrap-shift は含めない） |
| `pushCommand` | **コード変更なし**: wrap-shift 時は `layer: null` で呼ぶので既存ロジックでOK |

`getCommandsToReplayForLayer` の新しいロジック:

```typescript
for (let i = startIndex; i <= state.currentIndex; i++) {
  const cmd = state.commands[i];
  if (cmd.type === "wrap-shift") {
    commands.push(cmd);                    // グローバル: 全レイヤーに含める
  } else if (isLayerDrawCommand(cmd) && cmd.layerId === layerId) {
    commands.push(cmd);                    // レイヤー固有: layerId でフィルタ
  }
}
```

### 1-4. Index exports の変更

**[index.ts](packages/stroke/src/index.ts)**

- 追加: `LayerDrawCommand` (型), `isLayerDrawCommand` (関数)
- 削除: `computeCumulativeOffsetForLayer`
- `computeCumulativeOffset` を deprecated セクションから通常セクションへ移動

---

## Phase 2: 利用イメージレビュー

### App.tsx の主要変更

```typescript
// --- handleWrapShift: 全レイヤーに適用 ---
const handleWrapShift = useCallback(
  (dx: number, dy: number) => {
    for (const entry of entriesRef.current) {
      wrapShiftLayer(entry.committedLayer, dx, dy, shiftTempCanvas);
    }
    dragShiftRef.current = {
      x: dragShiftRef.current.x + dx,
      y: dragShiftRef.current.y + dy,
    };
    bumpRenderVersion();
  },
  [shiftTempCanvas, bumpRenderVersion],
);

// --- handleWrapShiftEnd: グローバルコマンド1つ、layer=null ---
const handleWrapShiftEnd = useCallback(
  (totalDx: number, totalDy: number) => {
    dragShiftRef.current = { x: 0, y: 0 };
    if (totalDx === 0 && totalDy === 0) return;
    const command = createWrapShiftCommand(totalDx, totalDy); // layerId なし
    setHistoryState((prev) =>
      pushCommand(prev, command, null, HISTORY_CONFIG),        // layer=null
    );
  },
  [],
);

// --- handleResetOffset: グローバル offset を全レイヤーに逆適用 ---
const handleResetOffset = useCallback(() => {
  setHistoryState((prev) => {
    const { x, y } = computeCumulativeOffset(prev); // layerId なし
    if (x === 0 && y === 0) return prev;
    for (const entry of entriesRef.current) {
      wrapShiftLayer(entry.committedLayer, -x, -y, shiftTempCanvas);
    }
    const command = createWrapShiftCommand(-x, -y);
    bumpRenderVersion();
    return pushCommand(prev, command, null, HISTORY_CONFIG);
  });
}, [shiftTempCanvas, bumpRenderVersion]);

// --- currentOffset: グローバル ---
const cumulativeOffset = computeCumulativeOffset(historyState); // activeLayerId 不要
const currentOffset = {
  x: cumulativeOffset.x + dragShiftRef.current.x,
  y: cumulativeOffset.y + dragShiftRef.current.y,
};

// --- Undo: wrap-shift は直接逆シフト（リビルド不要） ---
if (undoneCommand.type === "wrap-shift") {
  for (const entry of entriesRef.current) {
    wrapShiftLayer(entry.committedLayer, -undoneCommand.dx, -undoneCommand.dy, shiftTempCanvas);
  }
} else if (isStructuralCommand(undoneCommand)) {
  // ... 既存の構造コマンド処理 ...
} else {
  // レイヤー描画コマンド: 影響レイヤーのみリビルド
  const affectedIds = getAffectedLayerIds(prev, newState.currentIndex, prev.currentIndex);
  // ...
}

// --- Redo: 同様に直接シフト ---
if (redoneCommand.type === "wrap-shift") {
  for (const entry of entriesRef.current) {
    wrapShiftLayer(entry.committedLayer, redoneCommand.dx, redoneCommand.dy, shiftTempCanvas);
  }
} else if (isStructuralCommand(redoneCommand)) {
  // ...
} else {
  // ...
}
```

### entriesRef の公開

`useLayers` hook から `entriesRef` を公開する（`handleWrapShift` 等で全レイヤーにアクセスするため）。

**[useLayers.ts](apps/web/src/hooks/useLayers.ts)**:
- `UseLayersReturn` に `entriesRef: React.RefObject<LayerEntry[]>` を追加
- return に `entriesRef` を追加

### HistoryContent の表示変更

**[HistoryContent.tsx](apps/web/src/components/HistoryContent.tsx)**:

```typescript
function getCommandLabel(command: Command, layerIdToName: (id: string) => string): string {
  // wrap-shift はグローバルなので先に処理
  if (command.type === "wrap-shift") {
    return "Offset";  // レイヤープレフィックスなし
  }

  if (isDrawCommand(command)) {
    // ここに来るのは StrokeCommand | ClearCommand のみ（layerId あり）
    const name = layerIdToName(command.layerId);
    // ...
  }
  // ...
}
```

### DebugPanel の表示変更

**[DebugPanel.tsx](apps/web/src/components/DebugPanel.tsx)**: フォルダ名 `"Layer Offset"` → `"Offset"` に変更

### エッジケース確認

| シナリオ | 動作 | 正しさ |
|---------|------|--------|
| L1描画 → wrap-shift → L2描画 → Undo×3 | 各Undoが独立動作（wrap-shiftは全レイヤー逆シフト） | OK |
| wrap-shift後のcheckpoint復元 | checkpointはシフト後のピクセル状態を含む。リプレイはcheckpoint以降のwrap-shiftも含む | OK |
| wrap-shift → remove-layer → undo | re-insertしたレイヤーをcheckpointから復元（シフト済み状態）。以降のリプレイにwrap-shiftも含まれる | OK |
| 全レイヤー不可視でwrap-shift | 不可視レイヤーにもシフト適用（可視化時にタイルが揃う） | OK |
| wrap-shift → pushCommand で checkpoint | `layer=null` → チェックポイント作成スキップ。wrap-shiftはリプレイが軽量なので問題なし | OK |

---

## Phase 3: 実装

### Step 3-1: Stroke パッケージ — 型・セッション

1. **[types.ts](packages/stroke/src/types.ts)**:
   - `WrapShiftCommand` から `readonly layerId: string` を削除 (line 63)
   - `LayerDrawCommand` 型を追加: `export type LayerDrawCommand = StrokeCommand | ClearCommand;`
   - `isLayerDrawCommand` 型ガードを追加

2. **[session.ts](packages/stroke/src/session.ts)**:
   - `createWrapShiftCommand` から `layerId` パラメータを削除 (line 219)
   - 戻り値の型注釈から `layerId` を削除
   - return オブジェクトから `layerId` を削除

3. **[index.ts](packages/stroke/src/index.ts)**:
   - types exports に `LayerDrawCommand` 追加
   - types exports に `isLayerDrawCommand` 追加
   - history exports から `computeCumulativeOffsetForLayer` 削除
   - `computeCumulativeOffset` を deprecated セクションから通常セクションへ移動

### Step 3-2: Stroke パッケージ — 履歴

4. **[history.ts](packages/stroke/src/history.ts)**:
   - `isLayerDrawCommand` を import に追加
   - `getCommandsToReplayForLayer` (line 166-180): wrap-shift は `layerId` フィルタなしで含める
   - `getAffectedLayerIds` (line 185-201): `isDrawCommand` → `isLayerDrawCommand` に変更
   - `computeCumulativeOffsetForLayer` (line 206-222) を削除
   - `computeCumulativeOffset` (line 259-275): `@deprecated` 除去、deprecated セクションから移動

### Step 3-3: テスト更新

5. **[session.test.ts](packages/stroke/src/session.test.ts)**:
   - `createWrapShiftCommand` テスト: `layerId` 引数と assertion を削除

6. **[history.test.ts](packages/stroke/src/history.test.ts)**:
   - `createWrapShift` ヘルパーから `layerId` パラメータを削除
   - `computeCumulativeOffsetForLayer` テスト群を削除
   - `computeCumulativeOffset` テスト群の `@deprecated` ラベルを除去
   - `getCommandsToReplayForLayer` テスト: wrap-shift が全レイヤーに含まれることを検証する新テスト追加
   - `getAffectedLayerIds` テスト: wrap-shift が含まれないことを検証する新テスト追加

7. **[types.test.ts](packages/stroke/src/types.test.ts)**:
   - `isLayerDrawCommand` テスト群を追加

### Step 3-4: Web App

8. **[useLayers.ts](apps/web/src/hooks/useLayers.ts)**:
   - `UseLayersReturn` に `entriesRef` を追加
   - return に `entriesRef` を追加

9. **[App.tsx](apps/web/src/App.tsx)**:
   - import 変更: `computeCumulativeOffsetForLayer` → `computeCumulativeOffset`
   - `layerManager` から `entriesRef` を取得
   - `handleWrapShift` (line 324): 全 `entriesRef.current` にループ
   - `handleWrapShiftEnd` (line 337): `createWrapShiftCommand(totalDx, totalDy)`, `pushCommand(..., null, ...)`
   - `handleResetOffset` (line 350): `computeCumulativeOffset`, 全レイヤーに逆シフト
   - `currentOffset` (line 587): `computeCumulativeOffset(historyState)` に変更
   - `handleUndo` (line 435): wrap-shift 用の分岐追加（全レイヤー逆シフト）
   - `handleRedo` (line 515): wrap-shift 用の分岐追加（全レイヤー順シフト）

10. **[HistoryContent.tsx](apps/web/src/components/HistoryContent.tsx)**:
    - `getCommandLabel`: wrap-shift を `isDrawCommand` の前に分岐、`"Offset"` を返す

11. **[DebugPanel.tsx](apps/web/src/components/DebugPanel.tsx)**:
    - フォルダ名 `"Layer Offset"` → `"Offset"`

### Step 3-5: ドキュメント更新

12. **[types.md](packages/stroke/docs/types.md)**:
    - `WrapShiftCommand` から `layerId` フィールドを削除
    - `LayerDrawCommand` セクション追加
    - `DrawCommand` の説明を更新
    - `isLayerDrawCommand` を型ガードに追加

13. **[history-api.md](packages/stroke/docs/history-api.md)**:
    - `pushCommand` の `layer` 引数説明: wrap-shift 時は `null` と明記
    - `computeCumulativeOffsetForLayer` → `computeCumulativeOffset` に差し替え
    - `getAffectedLayerIds` の説明: wrap-shift はレイヤー固有でないため含まないことを明記

14. **[session-api.md](packages/stroke/docs/session-api.md)**:
    - `createWrapShiftCommand` シグネチャから `layerId` を削除

15. **[README.md](packages/stroke/docs/README.md)**:
    - API テーブル: `WrapShiftCommand` の説明から「`layerId` 付き」を削除
    - API テーブル: `createWrapShiftCommand(dx, dy)` に変更
    - API テーブル: `computeCumulativeOffsetForLayer` → `computeCumulativeOffset(state)`
    - API テーブル: `isLayerDrawCommand` 追加, `LayerDrawCommand` 追加

16. **元の設計書** [layer-feature.md](plans/2026-02-08-04-50_layer-feature.md):
    - 末尾に Erratum セクション追加: wrap-shift を `layerId` 付き DrawCommand にした設計が誤りであること、修正計画へのリンク

---

## Phase 4: 検証

### 4-1. 自動テスト

```bash
pnpm --filter @headless-paint/stroke test  # 型ガード、履歴、セッションのテスト
pnpm --filter @headless-paint/engine test  # 影響なしの確認
pnpm build                                  # TypeScript コンパイルエラー検出
pnpm lint
```

TypeScript コンパイルが最も重要な検証ポイント: `WrapShiftCommand` から `layerId` を削除すると、`cmd.layerId` にアクセスしていた箇所がコンパイルエラーになる。これにより未対応箇所を漏れなく検出できる。

### 4-2. 手動検証 (`pnpm dev`)

- [ ] 1レイヤーで wrap-shift → 従来通り動作
- [ ] 2レイヤーで wrap-shift → **両レイヤーが同時にシフト**
- [ ] Reset Offset → **全レイヤーが元に戻る**
- [ ] Undo/Redo wrap-shift → **全レイヤーが逆/順シフト**
- [ ] L1描画 → wrap-shift → L2描画 → Undo×3 → Redo×3 → 正しい状態
- [ ] wrap-shift → remove-layer → undo → レイヤーがシフト済み状態で復元
- [ ] 履歴パネル: wrap-shift が `"Offset"` と表示（レイヤープレフィックスなし）
- [ ] DebugPanel: "Offset" フォルダ名

### 4-3. セルフレビュー

review-library-usage スキルでセルフレビュー
