# 履歴コマンドの拡張性（Extensible History Commands）

## 背景と動機

現状の履歴システムは `Command = DrawCommand | StructuralCommand` という閉じた union 型で、ライブラリ内部で定義された7種のコマンドのみサポートしている。アプリが独自の操作（レイヤー名変更、不透明度変更、ツール切替等）を同じ undo/redo タイムラインに乗せたい場合、独立した履歴システムを構築してライブラリ側とマージ管理する必要がある。

この計画では、ライブラリの履歴システムにアプリ定義コマンドの拡張ポイントを追加し、**1本のタイムラインで全てのコマンドを統一管理** できるようにする。

## 設計方針

### アプローチ: ジェネリクスによるコマンド型の開放

`HistoryState` と関連関数にジェネリクス `<TCustom>` を導入し、アプリ定義コマンドを型安全に受け入れる。

- ライブラリの既存7コマンドの所属は変更しない
- ピクセルリプレイ・チェックポイントは `DrawCommand` のみが対象（変更なし）
- カスタムコマンドの apply/undo はアプリが `CustomCommandHandler<TCustom>` として提供する
- タイムライン管理（ポインタ移動、future 切り捨て、最大履歴数制限）はライブラリが担当

### 履歴カウントの修正（チェックポイント間隔 & 最大履歴数）

既存の `pushCommand` には2つのカウント問題がある:

1. **チェックポイント間隔**: `(newIndex + 1) % checkpointInterval` でコマンド配列全体のインデックスを使用。非 DrawCommand もカウントに含まれるため、間隔が不安定になる
2. **最大履歴数**: `commands.length > maxHistorySize` で全コマンドをカウント。メモリを消費するのは DrawCommand（リプレイコスト + チェックポイントの ImageData）であり、軽量なカスタムコマンドや StructuralCommand がカウントを消費すると、描画の undo 可能回数が不当に減る

**修正**: どちらも DrawCommand のカウントに基づくよう変更する。

#### チェックポイント間隔

`HistoryState` に `drawsSinceCheckpoint: number` カウンタを追加:

- DrawCommand push 時: カウンタ +1。`checkpointInterval` に達したら checkpoint 作成 & リセット
- 非 DrawCommand push 時: カウンタ変更なし
- `remove-layer`: 従来通り強制 checkpoint 作成 & カウンタリセット
- undo 後の新規 push（future 切り捨て時）: 切り捨てた範囲の最後の checkpoint 以降の DrawCommand 数を再計算してカウンタを補正

#### 最大履歴数

`maxHistorySize` は DrawCommand の数でカウントする:

- DrawCommand push 時: 現在の DrawCommand 総数が `maxHistorySize` を超えたら、最も古い DrawCommand とそれ以前のコマンドをまとめて切り捨て
- 非 DrawCommand push 時: 切り捨て判定なし（非 DrawCommand だけでは上限に達しない）
- 切り捨て時: チェックポイントのインデックスも従来通り調整

### コマンドの責務分離

| コマンド | 所属 | リプレイ | チェックポイント |
|---|---|---|---|
| stroke, clear, transform-layer, wrap-shift | ライブラリ (DrawCommand) | ライブラリが実行 | 対象 |
| add-layer, remove-layer, reorder-layer | ライブラリ (StructuralCommand) | ライブラリが実行 | remove-layer のみ |
| アプリ定義コマンド | アプリ | アプリが apply/undo を提供 | 対象外 |

### ジェネリクスの伝搬範囲

`<TCustom>` が影響するのは以下に限定される:

- **stroke パッケージ**: `HistoryState<TCustom>`, `pushCommand`, `undo`, `redo`, `canUndo`, `canRedo`、型ガード関数
- **react パッケージ**: `usePaintEngine<TCustom>`, `PaintEngineConfig`, `PaintEngineResult`

リプレイ・チェックポイント関連（`rebuildLayerFromHistory`, `replayCommand`, `getCommandsToReplayForLayer` 等）は `DrawCommand` のみを扱うため変更不要。

## 変更対象

### stroke パッケージ

#### types.ts

- `Command` 型をジェネリクス化: `type Command<TCustom = never> = DrawCommand | StructuralCommand | TCustom`
- `HistoryState` をジェネリクス化: `commands: readonly Command<TCustom>[]`、`drawsSinceCheckpoint: number` 追加
- 型ガード関数を `Command<TCustom>` 対応に更新（`isDrawCommand`, `isLayerDrawCommand`, `isStructuralCommand`）
- カスタムコマンド判定ヘルパー `isCustomCommand` を追加

#### history.ts

- `pushCommand` を `HistoryState<TCustom>` 対応に更新
  - チェックポイント間隔を `drawsSinceCheckpoint` カウンタベースに変更
  - 最大履歴数を DrawCommand カウントベースに変更
  - カスタムコマンドはチェックポイント不要なので `DrawCommand` 判定のみで分岐
- `undo`, `redo`, `canUndo`, `canRedo` をジェネリクス対応
- `createHistoryState` をジェネリクス対応
- `getAffectedLayerIds`, `computeCumulativeOffset` — `DrawCommand` しか見ないため実質的な変更はシグネチャのみ
- `findBestCheckpointForLayer`, `getCommandsToReplayForLayer` — `DrawCommand` のみ対象なので変更なし

#### replay.ts

- 変更なし（`DrawCommand` のみ処理するため）

#### session.ts

- 変更なし（コマンド生成ヘルパーは個別の型を返すため）

#### index.ts (exports)

- 新しい型・関数のエクスポートを追加

### react パッケージ

#### usePaintEngine.ts

- `PaintEngineConfig` に `customCommandHandler?: CustomCommandHandler<TCustom>` を追加
- `PaintEngineResult` に `pushCustomCommand: (cmd: TCustom) => void` を追加
- `handleUndo` / `handleRedo` にカスタムコマンドの分岐を追加（ハンドラに委譲）
- `CustomCommandHandler<TCustom>` インターフェースを定義

#### index.ts (exports)

- 新しい型のエクスポートを追加

### ドキュメント

- `packages/stroke/docs/types.md` — Command, HistoryState のジェネリクス化を反映
- `packages/stroke/docs/history-api.md` — pushCommand 等のシグネチャ更新
- `packages/stroke/docs/README.md` — 関数テーブル更新
- `packages/react/docs/README.md` — usePaintEngine のConfig/Result更新、CustomCommandHandler の説明追加

## Phase 1: API設計・ドキュメント作成

以下の型と関数シグネチャを設計し、docs に反映する。

### 1-1. stroke パッケージの型変更

`packages/stroke/docs/types.md` に反映:

```typescript
// Command 型のジェネリクス化
type Command<TCustom = never> = DrawCommand | StructuralCommand | TCustom;

// HistoryState のジェネリクス化
interface HistoryState<TCustom = never> {
  readonly commands: readonly Command<TCustom>[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly drawsSinceCheckpoint: number; // DrawCommand カウンタ（チェックポイント間隔用）
}

// 型ガード — TCustom を含む Command に対して動作
function isDrawCommand<TCustom>(cmd: Command<TCustom>): cmd is DrawCommand;
function isLayerDrawCommand<TCustom>(cmd: Command<TCustom>): cmd is LayerDrawCommand;
function isStructuralCommand<TCustom>(cmd: Command<TCustom>): cmd is StructuralCommand;
function isCustomCommand<TCustom>(cmd: Command<TCustom>): cmd is TCustom;
```

### 1-2. stroke パッケージの関数シグネチャ変更

`packages/stroke/docs/history-api.md` に反映:

```typescript
function createHistoryState<TCustom = never>(width: number, height: number): HistoryState<TCustom>;

function pushCommand<TCustom = never>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  layer: Layer | null,
  config?: HistoryConfig,
): HistoryState<TCustom>;

function undo<TCustom = never>(state: HistoryState<TCustom>): HistoryState<TCustom>;
function redo<TCustom = never>(state: HistoryState<TCustom>): HistoryState<TCustom>;
function canUndo<TCustom = never>(state: HistoryState<TCustom>): boolean;
function canRedo<TCustom = never>(state: HistoryState<TCustom>): boolean;

function getAffectedLayerIds<TCustom = never>(
  state: HistoryState<TCustom>,
  fromIndex: number,
  toIndex: number,
): ReadonlySet<string>;

function computeCumulativeOffset<TCustom = never>(
  state: HistoryState<TCustom>,
): { readonly x: number; readonly y: number };

// 以下は DrawCommand のみ扱うため TCustom 不要（シグネチャ変更なし）
function findBestCheckpointForLayer(state: HistoryState, layerId: string): Checkpoint | undefined;
function getCommandsToReplayForLayer(state: HistoryState, layerId: string, fromCheckpoint?: Checkpoint): readonly DrawCommand[];
```

### 1-3. react パッケージの型追加・変更

`packages/react/docs/README.md` に反映:

```typescript
// カスタムコマンドハンドラ
interface CustomCommandHandler<TCustom> {
  readonly apply: (cmd: TCustom, ctx: CustomCommandContext) => void;
  readonly undo: (cmd: TCustom, ctx: CustomCommandContext) => void;
}

// ハンドラに渡されるコンテキスト
interface CustomCommandContext {
  readonly entries: readonly LayerEntry[];
  readonly findEntry: (layerId: string) => LayerEntry | undefined;
  readonly bumpRenderVersion: () => void;
}

// PaintEngineConfig に追加
interface PaintEngineConfig<TCustom = never> {
  // ...既存フィールド
  readonly customCommandHandler?: CustomCommandHandler<TCustom>;
}

// PaintEngineResult に追加
interface PaintEngineResult<TCustom = never> {
  // ...既存フィールド
  readonly pushCustomCommand: (cmd: TCustom) => void;
  readonly historyState: HistoryState<TCustom>;
}
```

## Phase 2: 利用イメージレビュー

### アプリ側の利用例

```typescript
// ① アプリ固有のコマンド型を定義
interface RenameLayerCommand {
  readonly type: "rename-layer";
  readonly layerId: string;
  readonly oldName: string;
  readonly newName: string;
  readonly timestamp: number;
}

interface SetOpacityCommand {
  readonly type: "set-opacity";
  readonly layerId: string;
  readonly oldOpacity: number;
  readonly newOpacity: number;
  readonly timestamp: number;
}

type MyCustomCommand = RenameLayerCommand | SetOpacityCommand;

// ② apply/undo ハンドラを実装
const customCommandHandler: CustomCommandHandler<MyCustomCommand> = {
  apply(cmd, ctx) {
    const entry = ctx.findEntry(cmd.layerId);
    if (!entry) return;
    switch (cmd.type) {
      case "rename-layer":
        entry.committedLayer.meta.name = cmd.newName;
        break;
      case "set-opacity":
        entry.committedLayer.meta.opacity = cmd.newOpacity;
        break;
    }
    ctx.bumpRenderVersion();
  },
  undo(cmd, ctx) {
    const entry = ctx.findEntry(cmd.layerId);
    if (!entry) return;
    switch (cmd.type) {
      case "rename-layer":
        entry.committedLayer.meta.name = cmd.oldName;
        break;
      case "set-opacity":
        entry.committedLayer.meta.opacity = cmd.oldOpacity;
        break;
    }
    ctx.bumpRenderVersion();
  },
};

// ③ usePaintEngine にジェネリクスで渡す
const engine = usePaintEngine<MyCustomCommand>({
  layerWidth: 1024,
  layerHeight: 1024,
  strokeStyle: pen.strokeStyle,
  compiledFilterPipeline: smoothing.compiledFilterPipeline,
  expandConfig: expand.config,
  compiledExpand: expand.compiled,
  customCommandHandler,
});

// ④ UIイベントからカスタムコマンドを push
const handleRename = (layerId: string, newName: string) => {
  const entry = engine.entries.find((e) => e.id === layerId);
  if (!entry) return;
  engine.pushCustomCommand({
    type: "rename-layer",
    layerId,
    oldName: entry.committedLayer.meta.name,
    newName,
    timestamp: Date.now(),
  });
};
```

### undo/redo の統一動作

```
Timeline: [stroke, stroke, rename-layer, stroke, set-opacity]
                                                       ↑ currentIndex

undo() → set-opacity:  customCommandHandler.undo() が呼ばれる
undo() → stroke:       ライブラリが rebuildLayerFromHistory() を実行
undo() → rename-layer: customCommandHandler.undo() が呼ばれる
redo() → rename-layer: customCommandHandler.apply() が呼ばれる
```

### TCustom を使わない場合（後方互換）

```typescript
// TCustom = never のまま（デフォルト）。既存コードは一切変更不要
const engine = usePaintEngine({ ... });
// pushCustomCommand は (cmd: never) => void 型 → 呼び出し不可
```

## Phase 1〜2 完了状況

Phase 1（API設計・ドキュメント作成）と Phase 2（利用イメージレビュー）は完了済み。以下のドキュメントが更新済み:

- `packages/stroke/docs/types.md` — `Command<TCustom>`, `HistoryState<TCustom>`, `drawsSinceCheckpoint`, 型ガード（`isCustomCommand` 追加）, `HistoryConfig` の説明更新
- `packages/stroke/docs/history-api.md` — 全関数シグネチャのジェネリクス化、`pushCommand` の動作説明更新（drawsSinceCheckpoint カウンタ、DrawCommand ベースの最大履歴数）、`getAffectedLayerIds` のシグネチャ追加
- `packages/stroke/docs/README.md` — 型テーブル・関数テーブル更新、「カスタムコマンド」セクション追加（コア利用例 + react README へのリンク）
- `packages/react/docs/README.md` — `CustomCommandHandler`, `CustomCommandContext` 追加、`PaintEngineConfig<TCustom>`, `PaintEngineResult<TCustom>` 更新、「カスタムコマンドの使い方」セクション追加

## Phase 3: 実装

Phase 1 のドキュメント通りにコードを実装する。

### 3-1. stroke/types.ts

- `Command` 型: `type Command<TCustom = never> = DrawCommand | StructuralCommand | TCustom`
- `HistoryState` 型: ジェネリクス化 + `drawsSinceCheckpoint: number` 追加
- 型ガード関数 `isDrawCommand`, `isLayerDrawCommand`, `isStructuralCommand` のシグネチャを `Command<TCustom>` 対応に変更（内部ロジックは同一）
- `isCustomCommand<TCustom>(cmd: Command<TCustom>): cmd is TCustom` を追加（`!isDrawCommand(cmd) && !isStructuralCommand(cmd)` で判定）

### 3-2. stroke/history.ts

- 全関数のシグネチャにジェネリクス `<TCustom = never>` 追加
- `createHistoryState`: 戻り値に `drawsSinceCheckpoint: 0` を追加
- `pushCommand` の変更:
  - チェックポイント間隔: `(newIndex + 1) % checkpointInterval` → `drawsSinceCheckpoint` カウンタベースに変更。DrawCommand push 時のみカウンタ +1、`checkpointInterval` に達したら checkpoint 作成 & リセット
  - `remove-layer`: 従来通り強制 checkpoint 作成 & カウンタリセット
  - 最大履歴数: `commands.length > maxHistorySize` → DrawCommand の数でカウント。超過時は最も古い DrawCommand とそれ以前のコマンドをまとめて切り捨て。切り捨て後に `drawsSinceCheckpoint` を再計算
  - undo 後の新規 push（future 切り捨て時）: 切り捨て範囲の最後の checkpoint 以降の DrawCommand 数を再計算してカウンタを補正

### 3-3. stroke/index.ts

- `isCustomCommand` のエクスポートを追加

### 3-4. react/usePaintEngine.ts

- `CustomCommandHandler<TCustom>` インターフェース定義（`apply` / `undo`）
- `CustomCommandContext` インターフェース定義（`entries`, `findEntry`, `bumpRenderVersion`）
- `PaintEngineConfig<TCustom = never>` にジェネリクス + `customCommandHandler?` フィールド追加
- `PaintEngineResult<TCustom = never>` にジェネリクス + `pushCustomCommand` + `historyState: HistoryState<TCustom>` 追加
- `usePaintEngine<TCustom = never>` の実装:
  - `pushCustomCommand`: コマンドを `pushCommand` に渡す（`layer: null`）。push 後に `customCommandHandler.apply()` を呼ぶ
  - `handleUndo` に `isCustomCommand` 分岐を追加: カスタムコマンドなら `customCommandHandler.undo()` に委譲（rebuildLayerFromHistory は不要）
  - `handleRedo` に `isCustomCommand` 分岐を追加: カスタムコマンドなら `customCommandHandler.apply()` に委譲
  - `CustomCommandContext` は `useLayers` の `entriesRef.current`, `findEntry`, `bumpRenderVersion` から構築

### 3-5. react/index.ts

- `CustomCommandHandler`, `CustomCommandContext` の型エクスポートを追加

### 3-6. テスト・lint

- `packages/stroke/src/history.test.ts` にカスタムコマンド関連のテストを追加（pushCommand, undo, redo, drawsSinceCheckpoint, maxHistorySize のDrawCommand カウント）
- `pnpm test && pnpm lint && pnpm build`

### 注意点

- `session.ts` は変更なし
- `usePaintEngine` の undo/redo で `isCustomCommand` を使って分岐する際、DrawCommand / StructuralCommand の既存処理パスはそのまま維持する

## Phase 4: アーキテクトレビュー

1. ドキュメント整合性（双方向）の確認
2. 型安全性: `pushCustomCommand` が `TCustom` のみ受け付けること
3. カスタムコマンドがチェックポイント・リプレイに影響しないこと
4. パッケージ間の責務分離が保たれていること
5. review-library-usage スキルによるセルフレビュー

## 実装結果

Phase 3・4 完了。ビルド・lint・テスト全パス（stroke パッケージ 76 テスト）。

### 実装時の調整内容（補足）

計画時の想定と実装時に判明した差異:

1. **TypeScript の共変性制約**: 計画では `findBestCheckpointForLayer` と `getCommandsToReplayForLayer` は `HistoryState` のまま受け取れる（`HistoryState<TCustom>` は共変で代入可能）と想定していたが、TypeScript では `readonly (DrawCommand | StructuralCommand | TCustom)[]` は `readonly (DrawCommand | StructuralCommand)[]` に代入不可。全関数に `<TCustom = never>` を追加して対応。

2. **replay.ts のジェネリクス追加**: 計画では「変更なし」としていたが、上記の理由で `rebuildLayerFromHistory` と `rebuildLayerState` にも `<TCustom = never>` を追加（`replayCommand` / `replayCommands` は `DrawCommand` のみ処理するため変更不要）。

3. **型ガード内部の TCustom 安全対策**: `TCustom` が `.type` プロパティを持つとは限らないため、型ガード関数内で `as { type?: string }` キャストを使用。`pushCommand` 内の `command.type === "remove-layer"` も `isStructuralCommand(command) &&` ガードを先行させる形に変更。

4. **wrap-shift 判定パターン**: `computeCumulativeOffset` と `getCommandsToReplayForLayer` で `cmd.type === "wrap-shift"` を直接参照していた箇所を `isDrawCommand(cmd) && cmd.type === "wrap-shift"` パターンに変更。

5. **ドキュメント補完**: Phase 4 レビューで `findBestCheckpointForLayer`、`getCommandsToReplayForLayer` の詳細APIセクションが history-api.md に不足していたため追加。`rebuildLayerFromHistory` の `registry?: BrushTipRegistry` パラメータもドキュメントに追記。

### 利用者への影響

全て `<TCustom = never>` デフォルト値により、**既存の利用コードへの影響はゼロ**。ジェネリクスを指定しない限り従来と同じ型が推論される。
