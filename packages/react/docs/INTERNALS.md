# @headless-paint/react 内部設計ガイド

このドキュメントはパッケージの開発者およびコントリビューター向け。
利用者向けの API ドキュメントは [README.md](./README.md) を参照。

## 設計方針

headless-paint のコアパッケージ（engine / input / stroke）を React アプリケーションに統合する際、ストロークライフサイクル・履歴管理・レイヤー連携といったオーケストレーションロジックは利用者ごとに本質的に同じ実装になる。このパッケージはそのロジックを hooks として提供する。

ただし headless の価値（UI の自由度、機能の取捨選択）を損なわないよう、以下の制約を置く:

- **hooks のみ提供**。UI コンポーネントは含めない
- **Canvas レンダリングは対象外**。描画方法はアプリが決める
- **設定系 hooks は外部注入**。usePenSettings / useSmoothing / useExpand の戻り値を usePaintEngine / useStrokeSession に渡す設計とし、設定 UI の構成はアプリが決める

## hooks の内部責務

### useStrokeSession

ストローク1本のライフサイクルに関わる以下のロジックをカプセル化する:

| 責務 | 詳細 |
|------|------|
| セッション状態の管理 | `StrokeSessionState`, `FilterPipelineState`, `InputPoint[]` を `useRef` で保持。ストローク開始時にスナップショットとして `compiledExpand`, `compiledFilterPipeline`, `layerId` も記録する |
| pendingOnly モード | タッチ入力の pending-until-confirmed パターン。`onStrokeStart(point, true)` で開始し、`onDrawConfirm()` まで committed layer への書き込みを保留する |
| FilterPipeline 処理 | `createFilterPipelineState` → `processPoint`（毎ポイント）→ `finalizePipeline`（ストローク終了時）の一連のフローを管理 |
| 差分レンダリング | `appendToCommittedLayer` / `renderPendingLayer` / `clearLayer` の呼び出し。`committedOverlapCount` による差分描画最適化を含む |
| compositeOperation の同期 | ストローク開始時に `pendingLayer.meta.compositeOperation` を strokeStyle から設定し、終了時に `undefined` にリセット |
| renderVersion | 描画操作のたびにインクリメントする再描画トリガー |
| canDraw 判定 | `layer !== null && layer.meta.visible` |

**境界**: 履歴への記録は責務外。ストローク完了時に `onStrokeComplete` コールバックでデータを通知し、呼び出し側が記録する。

### usePaintEngine

useStrokeSession + useLayers + 履歴 + wrap shift のオーケストレーションを担当する。

| 責務 | 詳細 |
|------|------|
| レイヤー管理の内包 | 内部で `useLayers` を呼び出し、entries / activeEntry 等を戻り値に委譲する |
| ストロークと履歴の接続 | `useStrokeSession` の `onStrokeComplete` を受け取り、`createStrokeCommand` → `pushCommand` で履歴に記録する |
| レイヤー操作の履歴連携 | addLayer / removeLayer / moveLayerUp / moveLayerDown の各操作で、対応するコマンドを作成して `pushCommand` する |
| Wrap shift | 全 entry に `wrapShiftLayer` を適用し、ドラッグ完了時に `createWrapShiftCommand` → `pushCommand` |
| Undo/Redo | コマンド種別に応じた3分岐の処理（後述） |
| pendingLayer の管理 | 内部で `createLayer` した pendingLayer を保持し、戻り値に含める |
| layers 配列の構築 | 各 entry の committedLayer + アクティブレイヤー直後に pendingLayer を挿入した描画用配列 |
| cumulativeOffset の計算 | 履歴中の全 wrap-shift コマンドの累積 + ドラッグ中の移動量 |

### 設定系 hooks（usePenSettings / useSmoothing）

コアパッケージの関数が要求する設定値（`StrokeStyle`, `CompiledFilterPipeline`）を React の state として管理し、変更のたびに自動で再構築する。アプリ固有のデフォルト値への依存を持たず、オプショナルな初期値引数で受け取る。

フォールバック値:

| hook | フィールド | パッケージデフォルト |
|------|-----------|-------------------|
| usePenSettings | color | `{ r: 0, g: 0, b: 0, a: 255 }` |
| usePenSettings | lineWidth | `8` |
| usePenSettings | pressureSensitivity | `1.0` |
| usePenSettings | pressureCurve | `DEFAULT_PRESSURE_CURVE`（engine） |
| useSmoothing | enabled | `true` |
| useSmoothing | windowSize | `5` |

### その他の hooks

useViewTransform / useExpand / useLayers / usePointerHandler / useTouchGesture / useWindowSize はコアパッケージの関数を薄くラップする hooks で、内部ロジックは単純。各 hook のソースコードが最良のドキュメントとなる。

## パッケージスコープ外のもの

以下はアプリ固有の領域であり、このパッケージには含めない:

| 要素 | 理由 |
|------|------|
| キーボードショートカット | キーバインドはアプリごとに異なる |
| パターンプレビュー | タイリングプレビューはニッチ機能 |
| 背景設定（BackgroundSettings） | エンジン内部に無関係。アプリ側の state で管理する |
| ツール選択の state | ToolType の選択 UI はアプリが決める |
| Canvas レンダリングコンポーネント | 描画方法のカスタマイズ領域 |
| UI コンポーネント全般 | Toolbar, LayerPanel, DebugPanel 等 |

## Undo/Redo の内部設計

usePaintEngine の handleUndo / handleRedo は、コマンドの種類に応じて3つの分岐を持つ:

### 1. wrap-shift コマンド（高速パス）

全レイヤーに逆方向（Undo）/ 順方向（Redo）の `wrapShiftLayer` を適用する。ピクセルの位置を移動するだけなのでリビルド不要。

### 2. structural コマンド（add-layer / remove-layer / reorder-layer）

レイヤー構造の変更を元に戻す/やり直す:

- **add-layer Undo**: レイヤーを削除
- **remove-layer Undo**: レイヤーを再挿入。checkpoint があれば `restoreFromCheckpoint` で高速復元、なければ `rebuildLayerFromHistory` でコマンドをリプレイ
- **reorder-layer Undo/Redo**: 逆/順方向に移動

`removeLayer` 時に `pushCommand` の第3引数で committedLayer を渡すことで、checkpoint にピクセルデータが保存される。これが Undo 時の高速復元を可能にしている。

### 3. stroke / draw コマンド

`getAffectedLayerIds` で影響を受けるレイヤーを特定し、`rebuildLayerFromHistory` でコマンドをリプレイする。影響のないレイヤーには触れない。

## React StrictMode への対応

**重要**: このパッケージの hooks は React StrictMode で安全に動作する必要がある。

StrictMode は `setState` の functional updater を同じ `prev` 値で2回呼ぶ。以下のパターンに注意:

### NG: functional updater 内での in-place mutation

```typescript
setEntries((prev) => prev.map((e) => {
  e.meta.visible = !e.meta.visible; // 2回目で元に戻る
  return e;
}));
```

### NG: functional updater で配列挿入

```typescript
setEntries((prev) => [...prev.slice(0, i), entry, ...prev.slice(i)]);
// 2回目は1回目の結果に対して実行され、重複挿入される
```

### OK: direct set パターン（冪等）

```typescript
const entry = entriesRef.current.find(...);
entry.meta.visible = !entry.meta.visible;
setEntries([...entriesRef.current]); // direct set
```

### OK: 純粋な functional updater

```typescript
setRenderVersion((n) => n + 1); // 副作用なし
```

**原則**: `setState` updater 内で in-place mutation や配列操作の副作用を行わない。`entriesRef.current` を元に計算した値を direct set する。

`useLayers` はこのパターンを全面的に採用している。`usePaintEngine` の履歴操作でも同様の注意が必要。

## ビルド設定

- Vite の ES モジュールライブラリビルド
- external: `react`, `react/jsx-runtime`, `@headless-paint/engine`, `@headless-paint/input`, `@headless-paint/stroke`
- `vite-plugin-dts` で型定義を生成
- peerDependencies: react ^18.0.0 || ^19.0.0, headless-paint の3パッケージ
