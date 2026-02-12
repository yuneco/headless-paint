# @headless-paint/react

headless-paint の描画エンジンを React アプリケーションに統合するための hooks パッケージ。
UI コンポーネントは含まず、状態管理とロジックを hooks として提供する。Canvas のレンダリング方法やUIデザインはアプリケーション側で自由に決められる。

## hooks の選び方

このパッケージは、アプリケーションの複雑さに応じて組み合わせ可能な hooks を提供する。

### 単一レイヤーで描くだけの場合

`useStrokeSession` がストローク1本のライフサイクル（開始→移動→終了）を管理する。レイヤー管理や履歴は含まないため、シンプルな描画アプリやエディタ内の手書き入力など、最小構成に向いている。

```
useStrokeSession ─── ストロークの描画ロジック
usePointerHandler ── ポインタイベント → 描画コールバック変換
usePenSettings ───── 色・線幅などの描画スタイル
useSmoothing ─────── 入力スムージング
```

### レイヤー管理や Undo/Redo も必要な場合

`usePaintEngine` がストローク描画・複数レイヤー・Undo/Redo 履歴・Wrap shift をまとめてオーケストレーションする。ペイントアプリやイラストツールなど、本格的な描画機能に向いている。

```
usePaintEngine ───── ストローク + レイヤー + 履歴 + wrap shift
usePointerHandler ── ポインタイベント変換
usePenSettings ───── 描画スタイル
useSmoothing ─────── 入力スムージング
useExpand ─────────── 対称展開（使う場合のみ）
```

`usePaintEngine` は内部で `useStrokeSession` と `useLayers` を使用している。利用する機能のうち不要なものがあれば（例: Wrap shift を使わない）、対応するコールバックを接続しなければよい。

### 中間: 自前の履歴管理をしたい場合

`useStrokeSession` + `useLayers` を直接使い、ストローク完了時のコールバックで自前の履歴ロジックに接続する。

---

## 設定系 hooks

描画スタイルやスムージングなどの設定を管理する hooks。どの構成でも使用できる。

### `usePenSettings`

ペンの色・線幅・筆圧感度・筆圧カーブ・消しゴムモードを管理する。
これらの値から描画に必要な `StrokeStyle` を自動的に構築して返す。

```typescript
function usePenSettings(config?: PenSettingsConfig): UsePenSettingsResult;
```

#### PenSettingsConfig

| フィールド | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `initialColor` | `Color` | `{ r: 0, g: 0, b: 0, a: 255 }` | ペンの初期色（RGBA 0-255） |
| `initialLineWidth` | `number` | `8` | 初期線幅（px） |
| `initialPressureSensitivity` | `number` | `1.0` | 筆圧感度。0 で無効、1 で最大 |
| `initialPressureCurve` | `PressureCurve` | `DEFAULT_PRESSURE_CURVE` | 筆圧の入出力カーブ |

#### UsePenSettingsResult

```typescript
interface UsePenSettingsResult {
  /** 現在のペン色 */
  readonly color: Color;
  /** 現在の線幅（px） */
  readonly lineWidth: number;
  /** 筆圧感度（0: 無効, 1: 最大） */
  readonly pressureSensitivity: number;
  /** 筆圧の入出力カーブ */
  readonly pressureCurve: PressureCurve;
  /** 消しゴムモードが有効か */
  readonly eraser: boolean;
  /** 上記の値から自動構築された描画スタイル。useStrokeSession / usePaintEngine に渡す */
  readonly strokeStyle: StrokeStyle;
  readonly setColor: (color: Color) => void;
  readonly setLineWidth: (width: number) => void;
  readonly setPressureSensitivity: (sensitivity: number) => void;
  readonly setPressureCurve: (curve: PressureCurve) => void;
  /** true にすると compositeOperation が "destination-out" に設定される */
  readonly setEraser: (eraser: boolean) => void;
}
```

### `useSmoothing`

入力ポイントのスムージング（移動平均フィルタ）を管理する。
設定値から `CompiledFilterPipeline` を自動構築して返す。

```typescript
function useSmoothing(config?: SmoothingConfig): UseSmoothingResult;
```

#### SmoothingConfig

| フィールド | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `initialEnabled` | `boolean` | `true` | スムージングの初期有効状態 |
| `initialWindowSize` | `number` | `5` | 移動平均のウィンドウサイズ（奇数、3-13。偶数は +1 される） |

#### UseSmoothingResult

```typescript
interface UseSmoothingResult {
  /** スムージングが有効か */
  readonly enabled: boolean;
  /** 移動平均のウィンドウサイズ */
  readonly windowSize: number;
  /** 設定から構築済みの FilterPipeline。useStrokeSession / usePaintEngine に渡す */
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly setEnabled: (enabled: boolean) => void;
  /** 値は [3, 13] にクランプされ奇数に正規化される */
  readonly setWindowSize: (windowSize: number) => void;
}
```

### `useExpand`

対称展開（axial / radial / kaleidoscope）の設定を管理する。Root レベルと Sub レベルの2階層構成で、Sub は任意で有効化できる。設定値から `CompiledExpand` を自動構築して返す。

```typescript
function useExpand(layerWidth: number, layerHeight: number): UseExpandResult;
```

`layerWidth` / `layerHeight` は `createDefaultExpandConfig()` に渡され、デフォルト展開設定の中心座標（`offset`）の計算に使用される。

#### UseExpandResult

```typescript
interface UseExpandResult {
  /** 現在の展開設定。useStrokeSession / usePaintEngine に渡す */
  readonly config: ExpandConfig;
  /** 設定から構築済みの展開変換。useStrokeSession / usePaintEngine に渡す */
  readonly compiled: CompiledExpand;
  // Root レベル
  /** none / axial / radial / kaleidoscope */
  readonly setMode: (mode: ExpandMode) => void;
  /** 分割数（最小2） */
  readonly setDivisions: (divisions: number) => void;
  /** 回転角度（ラジアン） */
  readonly setAngle: (angle: number) => void;
  // Sub レベル（入れ子の対称展開）
  /** Sub レベルが有効か */
  readonly subEnabled: boolean;
  readonly setSubEnabled: (enabled: boolean) => void;
  readonly setSubMode: (mode: ExpandMode) => void;
  readonly setSubDivisions: (divisions: number) => void;
  readonly setSubAngle: (angle: number) => void;
  /** Sub レベルの中心オフセット（Root の中心からの相対位置） */
  readonly setSubOffset: (offset: Point) => void;
}
```

---

## ビュー・入力系 hooks

### `useViewTransform`

Canvas のビュー変換（pan / zoom / rotate）を管理する。

```typescript
function useViewTransform(): UseViewTransformResult;
```

#### UseViewTransformResult

```typescript
interface UseViewTransformResult {
  /** 現在のビュー変換行列 */
  readonly transform: ViewTransform;
  /** スクリーン座標系での平行移動 */
  readonly handlePan: (dx: number, dy: number) => void;
  /** centerX, centerY を中心にスケール */
  readonly handleZoom: (scale: number, centerX: number, centerY: number) => void;
  /** centerX, centerY を中心に回転（ラジアン） */
  readonly handleRotate: (angleRad: number, centerX: number, centerY: number) => void;
  /** ビュー変換を直接設定する（ジェスチャーからの更新等） */
  readonly handleSetTransform: (newTransform: ViewTransform) => void;
  /** 変換を初期状態にリセット */
  readonly reset: () => void;
  /** レイヤー全体がビューに収まるようにフィットさせる */
  readonly setInitialFit: (viewW: number, viewH: number, layerW: number, layerH: number) => void;
}
```

### `usePointerHandler`

マウス / ペンのポインタイベントを、選択中のツールに応じたコールバックに変換する。
内部で screen→layer の座標変換とポイントサンプリング（間引き）を行う。

```typescript
function usePointerHandler(tool: ToolType, options: UsePointerHandlerOptions): PointerHandlers;

type ToolType = "pen" | "eraser" | "scroll" | "rotate" | "zoom" | "offset";
```

#### UsePointerHandlerOptions

```typescript
interface UsePointerHandlerOptions {
  /** 現在のビュー変換（screen→layer 変換に使用） */
  readonly transform: ViewTransform;
  /** scroll ツールでの平行移動 */
  readonly onPan: (dx: number, dy: number) => void;
  /** zoom ツールでのズーム、またはホイール操作 */
  readonly onZoom: (scale: number, centerX: number, centerY: number) => void;
  /** rotate ツールでの回転 */
  readonly onRotate: (angleRad: number, centerX: number, centerY: number) => void;
  /** pen / eraser ツールでの描画開始（layer 座標に変換済み） */
  readonly onStrokeStart?: (point: InputPoint) => void;
  /** pen / eraser ツールでの描画移動 */
  readonly onStrokeMove?: (point: InputPoint) => void;
  /** pen / eraser ツールでの描画終了 */
  readonly onStrokeEnd?: () => void;
  /** offset ツールでの差分移動（layer 座標系、ピクセル単位に丸め済み） */
  readonly onWrapShift?: (dx: number, dy: number) => void;
  /** offset ツールでのドラッグ完了（累計移動量） */
  readonly onWrapShiftEnd?: (totalDx: number, totalDy: number) => void;
  /** Canvas の表示幅（px）。rotate / zoom の中心計算に使用 */
  readonly canvasWidth: number;
  /** Canvas の表示高さ（px） */
  readonly canvasHeight: number;
  /** ポイントサンプリングの設定。省略時は `{ minDistance: 2 }` */
  readonly samplingConfig?: SamplingConfig;
}
```

#### PointerHandlers

```typescript
interface PointerHandlers {
  /** Canvas 要素の onPointerDown に接続する */
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly onPointerMove: (e: React.PointerEvent) => void;
  readonly onPointerUp: (e: React.PointerEvent) => void;
  /** Canvas 要素の wheel イベントに接続する（ズーム操作）。標準 DOM WheelEvent（React.WheelEvent ではない） */
  readonly onWheel: (e: WheelEvent) => void;
}
```

### `useTouchGesture`

タッチデバイスのマルチタッチイベントを認識し、ジェスチャーに応じたコールバックを発火する。

- 1本指: 描画（`onStrokeStart` を常に `{ pendingOnly: true }` で呼ぶ pending-until-confirmed パターン）
- 2本指: ピンチ（zoom + pan + rotate）
- 2本指タップ: Undo
- 描画中に2本目追加: 描画をキャンセルしてジェスチャーに遷移

```typescript
function useTouchGesture(options: UseTouchGestureOptions): UseTouchGestureResult;
```

#### UseTouchGestureOptions

```typescript
interface UseTouchGestureOptions {
  /** 現在のビュー変換 */
  readonly transform: ViewTransform;
  /** 描画開始 */
  readonly onStrokeStart?: (point: InputPoint, options?: StrokeStartOptions) => void;
  readonly onStrokeMove?: (point: InputPoint) => void;
  readonly onStrokeEnd?: () => void;
  /** pending ストロークの確定（1本指のまま描画完了時に呼ばれる） */
  readonly onDrawConfirm?: () => void;
  /** pending ストロークのキャンセル（描画中に2本指操作に遷移した時に呼ばれる） */
  readonly onDrawCancel?: () => void;
  /** ピンチ操作によるビュー変換更新 */
  readonly onSetTransform?: (t: ViewTransform) => void;
  /** 2本指タップによる Undo */
  readonly onUndo?: () => void;
  /** ポイントサンプリングの設定 */
  readonly samplingConfig?: SamplingConfig;
  /** true にするとデバッグ用の touchPoints / gesturePhase を更新する */
  readonly debugEnabled?: boolean;
}
```

#### UseTouchGestureResult

```typescript
interface UseTouchGestureResult {
  /** 全ポインタイベントをこのハンドラに渡す。touch 以外は内部で無視される */
  readonly handlePointerEvent: (e: React.PointerEvent) => void;
  /** 現在のタッチポイント位置（debugEnabled 時のみ更新） */
  readonly touchPoints: ReadonlyMap<number, Point>;
  /** 現在のジェスチャーフェーズ名（debugEnabled 時のみ更新） */
  readonly gesturePhase: string;
}
```

### `useWindowSize`

ブラウザのビューポートサイズを追跡する。resize イベントを 100ms でデバウンスする。

```typescript
function useWindowSize(): WindowSize;

interface WindowSize {
  /** ビューポートの幅（px） */
  readonly width: number;
  /** ビューポートの高さ（px） */
  readonly height: number;
}
```

---

## `useStrokeSession`

ストローク1本のライフサイクルを管理する hook。
ポインタの開始→移動→終了の間、FilterPipeline によるスムージング処理と committed/pending レイヤーへの差分レンダリングを自動で行う。

履歴管理やレイヤーの CRUD は含まない。これらが必要な場合は `usePaintEngine` を使うか、`onStrokeComplete` コールバックで自前のロジックに接続する。

```typescript
function useStrokeSession(config: UseStrokeSessionConfig): UseStrokeSessionResult;
```

### UseStrokeSessionConfig

```typescript
interface UseStrokeSessionConfig {
  /** 描画先レイヤー。null を渡すと描画操作が無効になる */
  readonly layer: Layer | null;
  /** 未確定ポイントの描画バッファ。毎フレーム消去→再描画される */
  readonly pendingLayer: Layer;
  /** ペンの描画スタイル（usePenSettings.strokeStyle を渡す） */
  readonly strokeStyle: StrokeStyle;
  /** スムージング設定（useSmoothing.compiledFilterPipeline を渡す） */
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  /** 対称展開の設定（useExpand.config を渡す） */
  readonly expandConfig: ExpandConfig;
  /** 対称展開の構築済み変換（useExpand.compiled を渡す） */
  readonly compiledExpand: CompiledExpand;
  /** ストローク完了時に呼ばれるコールバック。履歴記録やコマンド生成に利用する */
  readonly onStrokeComplete?: (data: StrokeCompleteData) => void;
}
```

### StrokeStartOptions

`onStrokeStart` の第2引数。ストローク開始時のモードを指定する。

```typescript
interface StrokeStartOptions {
  /** true にすると committed layer への描画を保留する（タッチの pending-until-confirmed 用） */
  readonly pendingOnly?: boolean;
  /** true にすると直線モード（始点→終点の2点に集約、筆圧は中央値）になる */
  readonly straightLine?: boolean;
}
```

### StrokeCompleteData

`onStrokeComplete` に渡されるデータ。ストロークの再現に必要な全情報を含む。

```typescript
interface StrokeCompleteData {
  /** 生の入力ポイント列（フィルタ適用前） */
  readonly inputPoints: readonly InputPoint[];
  /** ストローク時に使用された FilterPipeline の設定 */
  readonly filterPipelineConfig: FilterPipelineConfig;
  /** ストローク時に使用された対称展開の設定 */
  readonly expandConfig: ExpandConfig;
  /** ストローク時に使用された描画スタイル */
  readonly strokeStyle: StrokeStyle;
  /** 確定済みポイントの総数 */
  readonly totalPoints: number;
}
```

### UseStrokeSessionResult

```typescript
interface UseStrokeSessionResult {
  /**
   * ストロークを開始する。
   * options.pendingOnly=true にすると committed layer への描画を保留し、
   * onDrawConfirm() が呼ばれるまで pendingLayer のみに描画する。
   * options.straightLine=true にすると直線モード（始点→終点の2点に集約）になる。
   */
  readonly onStrokeStart: (point: InputPoint, options?: StrokeStartOptions) => void;
  /** ポイントを追加する。FilterPipeline を通過後、差分レンダリングが実行される */
  readonly onStrokeMove: (point: InputPoint) => void;
  /** ストロークを終了する。FilterPipeline をフラッシュし、onStrokeComplete を呼ぶ */
  readonly onStrokeEnd: () => void;
  /** pending ストロークを確定する。蓄積されたポイントが committed layer に描画される */
  readonly onDrawConfirm: () => void;
  /** pending ストロークを破棄する。pendingLayer がクリアされる */
  readonly onDrawCancel: () => void;
  /** layer が有効（非 null かつ visible）で描画可能な状態か */
  readonly canDraw: boolean;
  /** 描画操作のたびにインクリメントされる単純カウンタ。Canvas の再描画トリガーとして使う */
  readonly renderVersion: number;
  /** 現在のストロークで蓄積された入力ポイント列（デバッグ表示用） */
  readonly strokePoints: readonly InputPoint[];
  /** ストローク進行中か */
  readonly isDrawing: boolean;
}
```

### 使い方

```typescript
const session = useStrokeSession({
  layer: myLayer,
  pendingLayer,
  strokeStyle: pen.strokeStyle,
  compiledFilterPipeline: smoothing.compiledFilterPipeline,
  expandConfig: expand.config,
  compiledExpand: expand.compiled,
  onStrokeComplete: (data) => {
    // 例: 自前の履歴に記録する
    myHistory.push(data);
  },
});

// usePointerHandler に接続
const pointerHandlers = usePointerHandler("pen", {
  ...viewTransformCallbacks,
  onStrokeStart: session.canDraw ? session.onStrokeStart : undefined,
  onStrokeMove: session.canDraw ? session.onStrokeMove : undefined,
  onStrokeEnd: session.canDraw ? session.onStrokeEnd : undefined,
  canvasWidth: width,
  canvasHeight: height,
});
```

---

## `usePaintEngine`

ストローク描画・複数レイヤー管理・Undo/Redo 履歴・Wrap shift をオーケストレーションする hook。
内部で `useStrokeSession` と `useLayers` を使用し、レイヤー操作と履歴を自動で連携させる。

描画スタイル（`strokeStyle`）やスムージング（`compiledFilterPipeline`）、対称展開（`expandConfig` / `compiledExpand`）はアプリケーション側の hooks から渡す設計のため、設定 UI の構成は自由に決められる。

```typescript
function usePaintEngine(config: PaintEngineConfig): PaintEngineResult;
```

### PaintEngineConfig

```typescript
interface PaintEngineConfig {
  /** レイヤーの幅（px） */
  readonly layerWidth: number;
  /** レイヤーの高さ（px） */
  readonly layerHeight: number;
  /** 描画スタイル（usePenSettings.strokeStyle を渡す） */
  readonly strokeStyle: StrokeStyle;
  /** スムージング設定（useSmoothing.compiledFilterPipeline を渡す） */
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  /** 対称展開の設定（useExpand.config を渡す） */
  readonly expandConfig: ExpandConfig;
  /** 対称展開の構築済み変換（useExpand.compiled を渡す） */
  readonly compiledExpand: CompiledExpand;
  /** 履歴の容量設定。省略時はデフォルト値が使われる */
  readonly historyConfig?: HistoryConfig;
}
```

`historyConfig` のデフォルト値:

| フィールド | デフォルト | 説明 |
|-----------|-----------|------|
| `maxHistorySize` | `100` | 履歴に保持するコマンドの最大数 |
| `checkpointInterval` | `10` | チェックポイント（ImageData スナップショット）を取る間隔 |
| `maxCheckpoints` | `10` | 保持するチェックポイントの最大数 |

### PaintEngineResult

```typescript
interface PaintEngineResult {
  // ── レイヤー ──

  /** 全レイヤーのエントリ一覧 */
  readonly entries: readonly LayerEntry[];
  /** 選択中のレイヤー ID */
  readonly activeLayerId: string | null;
  /** 選択中のレイヤーエントリ */
  readonly activeEntry: LayerEntry | undefined;
  /** レイヤーを選択する */
  readonly setActiveLayerId: (id: string | null) => void;
  /** レイヤーの表示/非表示を切り替える */
  readonly toggleVisibility: (layerId: string) => void;
  /** レイヤー名を変更する */
  readonly renameLayer: (layerId: string, name: string) => void;

  // ── レイヤー操作（履歴に自動記録される） ──

  /** 新しいレイヤーを末尾に追加する */
  readonly addLayer: () => void;
  /** レイヤーを削除する。Undo 時にピクセルデータごと復元される */
  readonly removeLayer: (layerId: string) => void;
  /** レイヤーを1つ上（前面方向）に移動する */
  readonly moveLayerUp: (layerId: string) => void;
  /** レイヤーを1つ下（背面方向）に移動する */
  readonly moveLayerDown: (layerId: string) => void;

  // ── ストローク ──

  /** ストロークを開始する */
  readonly onStrokeStart: (point: InputPoint, options?: StrokeStartOptions) => void;
  /** ポイントを追加する */
  readonly onStrokeMove: (point: InputPoint) => void;
  /** ストロークを終了する。履歴にコマンドが自動記録される */
  readonly onStrokeEnd: () => void;
  /** pending ストロークを確定する */
  readonly onDrawConfirm: () => void;
  /** pending ストロークを破棄する */
  readonly onDrawCancel: () => void;

  // ── Wrap shift（全レイヤーのピクセルをラップ移動する） ──

  /** ドラッグ中の差分移動を適用する */
  readonly onWrapShift: (dx: number, dy: number) => void;
  /** ドラッグ完了。累計移動量が履歴に記録される */
  readonly onWrapShiftEnd: (totalDx: number, totalDy: number) => void;
  /** 累積オフセットを (0,0) にリセットする。逆方向の shift が適用・記録される */
  readonly onResetOffset: () => void;
  /** 全 wrap-shift コマンドの累積オフセット + 現在のドラッグ中の移動量 */
  readonly cumulativeOffset: { readonly x: number; readonly y: number };

  // ── 履歴 ──

  /** 直前の操作を元に戻す */
  readonly undo: () => void;
  /** 元に戻した操作をやり直す */
  readonly redo: () => void;
  /** Undo 可能か */
  readonly canUndo: boolean;
  /** Redo 可能か */
  readonly canRedo: boolean;
  /** 履歴の内部状態（HistoryContent 等の UI コンポーネントに渡す用途） */
  readonly historyState: HistoryState;

  // ── レンダリング ──

  /** 未確定ポイントの描画バッファ */
  readonly pendingLayer: Layer;
  /**
   * 描画用のレイヤー配列。各レイヤーの committedLayer に加え、
   * アクティブレイヤーの直後に pendingLayer が挿入済み。
   * composeLayers にそのまま渡せる。
   */
  readonly layers: readonly Layer[];
  /** 描画操作のたびにインクリメントされる。Canvas の再描画トリガーとして使う */
  readonly renderVersion: number;
  /** アクティブレイヤーが描画可能な状態か */
  readonly canDraw: boolean;
  /** 現在のストロークで蓄積された入力ポイント列（デバッグ表示用） */
  readonly strokePoints: readonly InputPoint[];
}
```

### 使い方

```typescript
const pen = usePenSettings();
const smoothing = useSmoothing();
const expand = useExpand(1024, 1024);

const engine = usePaintEngine({
  layerWidth: 1024,
  layerHeight: 1024,
  strokeStyle: pen.strokeStyle,
  compiledFilterPipeline: smoothing.compiledFilterPipeline,
  expandConfig: expand.config,
  compiledExpand: expand.compiled,
});

// ポインタ入力を接続
const pointerHandlers = usePointerHandler(tool, {
  ...viewTransformCallbacks,
  onStrokeStart: engine.canDraw ? engine.onStrokeStart : undefined,
  onStrokeMove: engine.canDraw ? engine.onStrokeMove : undefined,
  onStrokeEnd: engine.canDraw ? engine.onStrokeEnd : undefined,
  onWrapShift: engine.onWrapShift,
  onWrapShiftEnd: engine.onWrapShiftEnd,
  canvasWidth: width,
  canvasHeight: height,
});

// Canvas に engine.layers と engine.renderVersion を渡して描画する
```

---

## `useLayers`

レイヤーの作成・削除・並べ替え・可視性管理を行う hook。
`usePaintEngine` の内部で使用されるが、独立して使うこともできる。

```typescript
function useLayers(width: number, height: number): UseLayersResult;
```

### LayerEntry

```typescript
interface LayerEntry {
  /** レイヤーの一意な ID */
  readonly id: string;
  /** このレイヤーの確定済み描画データ */
  readonly committedLayer: Layer;
}
```

### UseLayersResult

```typescript
interface UseLayersResult {
  /** 全レイヤーのエントリ一覧（描画順） */
  readonly entries: readonly LayerEntry[];
  /** entries の最新値への ref（コールバック内で最新値を参照するため） */
  readonly entriesRef: React.RefObject<LayerEntry[]>;
  /** 選択中のレイヤー ID */
  readonly activeLayerId: string | null;
  /** 選択中のレイヤーエントリ */
  readonly activeEntry: LayerEntry | undefined;
  /** 新しいレイヤーを末尾に追加し、追加されたエントリと挿入位置を返す */
  readonly addLayer: () => { entry: LayerEntry; insertIndex: number };
  /** レイヤーを削除する。アクティブレイヤーが削除された場合、隣接レイヤーが自動選択される */
  readonly removeLayer: (layerId: string) => void;
  /** 指定位置にレイヤーを再挿入する（Undo 時のレイヤー復元用） */
  readonly reinsertLayer: (layerId: string, index: number, meta?: LayerMeta) => LayerEntry;
  /** レイヤーを選択する */
  readonly setActiveLayerId: (id: string | null) => void;
  /** レイヤー名を変更する */
  readonly renameLayer: (layerId: string, name: string) => void;
  /** レイヤーの表示/非表示を切り替える */
  readonly toggleVisibility: (layerId: string) => void;
  /** レイヤーの表示状態を明示的に設定する */
  readonly setLayerVisible: (layerId: string, visible: boolean) => void;
  /** レイヤーを1つ上（前面方向）に移動する。移動した場合はインデックスのペアを返す */
  readonly moveLayerUp: (layerId: string) => { fromIndex: number; toIndex: number } | null;
  /** レイヤーを1つ下（背面方向）に移動する */
  readonly moveLayerDown: (layerId: string) => { fromIndex: number; toIndex: number } | null;
  /** ID でエントリを検索する */
  readonly findEntry: (layerId: string) => LayerEntry | undefined;
  /** ID でインデックスを取得する */
  readonly getLayerIndex: (layerId: string) => number;
  /** 描画操作のたびにインクリメントされる再描画トリガー */
  readonly renderVersion: number;
  /** renderVersion を手動でインクリメントする */
  readonly bumpRenderVersion: () => void;
}
```

---

## 再エクスポート型

利用頻度の高い型をこのパッケージから再エクスポートしている。
アプリケーション側で `@headless-paint/engine` 等を直接 import する必要を減らす。

| 型 | 元パッケージ | 説明 |
|----|-------------|------|
| `Color` | engine | RGBA カラー値 |
| `Layer` | engine | 描画レイヤー |
| `LayerMeta` | engine | レイヤーのメタデータ（name, visible 等） |
| `StrokeStyle` | engine | 描画スタイル |
| `PressureCurve` | engine | 筆圧カーブ |
| `Point` | engine | 2D 座標 |
| `ExpandConfig` | engine | 対称展開の設定 |
| `CompiledExpand` | engine | 構築済み対称展開変換 |
| `ExpandMode` | engine | `"none" \| "axial" \| "radial" \| "kaleidoscope"` |
| `ViewTransform` | input | ビュー変換行列 |
| `InputPoint` | input | 入力ポイント（座標 + 筆圧 + タイムスタンプ） |
| `CompiledFilterPipeline` | input | 構築済み FilterPipeline |
| `FilterPipelineConfig` | input | FilterPipeline の設定 |
| `SamplingConfig` | input | ポイントサンプリングの設定 |
| `HistoryState` | stroke | 履歴の内部状態 |
| `StraightLineConfig` | input | 直線フィルタの設定 |
| `HistoryConfig` | stroke | 履歴の容量設定 |
