# Stamp time dabs plan

## 背景

現状のスタンプブラシは、ストローク上の累積距離が `spacingPx` に達した地点へ dab を配置する。座標が動かない場合、または `spacingPx` に届かないほどゆっくり小さく動く場合、新しい dab が発生しない。

そのため、一点でブラシを押し当て続けても描画が濃くならない。エアブラシや柔らかいスタンプブラシとしては、時間経過に応じて同じ場所へ繰り返し dab が乗る体験が必要になる。

今回は大きなセンサーシステムや速度ダイナミクスまでは広げず、「スタンプブラシで、押し続けている間にその場で描画が繰り返される」ことを最小スコープにする。

## 現状調査

- `InputPoint` は `timestamp` を持つ。
- `StrokePoint` は `{ x, y, pressure? }` のみで、`timestamp` は engine 層へ渡っていない。
- `packages/stroke/src/session.ts` の `toStrokePoints()` で `timestamp` が落ちる。
- `packages/engine/src/brush-render.ts` のスタンプ配置は `accumulatedDistance` と `stampCount` を使う距離ベースのみ。
- `BrushRenderState` は `accumulatedDistance`, `stampCount`, 混色状態を持つが、最後に描画した時刻は持たない。
- 履歴 replay は `StrokeCommand.inputPoints` を filter pipeline に再投入し、同じ点列と `brushSeed` から描画を再現する。

## 重要な設計論点

### 時間経過をどこでサンプル化するか

候補は2つある。

#### 案A: renderer が timestamp を見て時間dabを補間生成する

入力点列に timestamp を保持し、engine の `renderStampBrushStroke()` が `timeSpacingMs` ごとに dab を生成する。

利点:

- 入力点列が過剰に増えにくい。
- 時間dabの責務が brush engine に集まる。

懸念:

- 完全静止中は PointerEvent が来ないため、新しい timestamp 区間が engine へ渡らない。
- ライブ中に renderer が現在時刻を読むと replay 等価性が壊れる。
- pending/committed 分割と overlap の境界で、時間dabの二重配置を避ける状態設計が必要。

#### 案B: input/react 層が時間経過で synthetic InputPoint を流し、それを履歴に保存する

描画中、一定間隔で最後の座標・最後の筆圧・現在時刻を持つ synthetic point を `onStrokeMove()` に流す。通常の PointerEvent 由来の点と同じく filter pipeline / stroke session / history に保存する。

利点:

- replay は保存済み `inputPoints` を再処理するだけなので等価性を保ちやすい。
- 静止中でも点列が増えるため、engine は「点列と timestamp から描画」できる。
- synthetic point の筆圧は、その時点で最後に観測した筆圧を使える。
- ライブと replay で同じ `inputPoints`、同じ `brushSeed` を使える。

懸念:

- 履歴サイズが増える。
- input 層のサンプリングと time dab 用サンプリングの責務が混ざりやすい。
- filter pipeline に同一座標の点が連続して流れるため、smoothing との相性確認が必要。

今回の本命は案Bとする。リプレイ等価性を優先し、ライブ時に発生した時間経過を「保存される入力」として固定する。

ただし、engine 側には `timestamp` と時間配置状態が必要なので、案Bだけで完結はしない。input/react 層が時間で点を密にし、engine 層がその点列の時間差を使って同座標 dab を配置する分担にする。

## 方針

1. `StrokePoint` に `readonly timestamp?: number` を追加し、`InputPoint.timestamp` を engine まで保持する。
2. スタンプブラシに時間dab設定を追加する。
3. React 統合で、描画中に最後の座標・最後の筆圧を使った synthetic `InputPoint` を一定間隔で流す。
4. synthetic point は `StrokeCompleteData.inputPoints` と `StrokeCommand.inputPoints` に保存する。
5. replay は保存済み点列だけを使い、現在時刻や timer を参照しない。

## API案

### StrokePoint

```typescript
interface StrokePoint extends Point {
  readonly pressure?: number;
  readonly timestamp?: number;
}
```

`timestamp` は optional とする。既存の engine 内部テストやユーティリティで timestamp がない点列を扱えるようにするため。時間dabは、必要な timestamp がない場合は無効化または距離dabのみへフォールバックする。

### BrushDynamics

最小案として `timeSpacingMs` を追加する。

```typescript
interface BrushDynamics {
  readonly spacing: number;
  readonly opacityJitter: number;
  readonly sizeJitter: number;
  readonly rotationJitter: number;
  readonly scatter: number;
  readonly flow: number;
  readonly timeSpacingMs?: number;
}
```

- `timeSpacingMs` 未指定または `<= 0`: 時間dabなし。
- `timeSpacingMs = 33`: 約30 dabs/sec。
- 時間dabは stamp brush のみ対象。
- `round-pen` は対象外。

将来的に `dabsPerSecond` の方がUIとして自然なら、Phase 1で `timeSpacingMs` と比較して決める。初期実装では ms 間隔の方が scheduler 状態と対応しやすい。

### BrushBranchRenderState / BrushRenderState

時間dab用に最後の処理時刻を保持する。

```typescript
interface BrushBranchRenderState {
  readonly accumulatedDistance: number;
  readonly stampCount: number;
  readonly lastTimestamp?: number;
  readonly nextTimeStampAt?: number;
  readonly colorBuffer?: OffscreenCanvas;
  readonly mixedCanvas?: OffscreenCanvas;
  readonly lastMixingUpdateDistance?: number;
}
```

命名は Phase 1 で詰める。意味は以下。

- `lastTimestamp`: この分岐で最後に処理した入力時刻。
- `nextTimeStampAt`: 次に時間dabを配置する時刻。

距離dabは従来どおり `accumulatedDistance` で管理し、時間dabは `timestamp` で管理する。

### React 側の time input 設定

ブラシ設定だけでなく、ライブ中に synthetic point を発生させるための統合設定が必要。

案:

```typescript
interface StrokeStartOptions {
  readonly pendingOnly?: boolean;
  readonly straightLine?: boolean;
}

interface UseStrokeSessionConfig {
  // 既存フィールド...
  readonly timeSamplingIntervalMs?: number;
}
```

ただし `timeSamplingIntervalMs` は brush から導出する方が設定重複が少ない。初期案では、`strokeStyle.brush.type === "stamp"` かつ `brush.dynamics.timeSpacingMs` が有効な時だけ、React hook が同じ間隔で synthetic point を流す。

## 描画ルール案

### 時間dabの配置

入力点 `p1 -> p2` の `timestamp` 差を見て、`timeSpacingMs` ごとに dab を配置する。

- `p1` と `p2` の座標が同じなら、その座標へ配置する。
- 座標が動いている場合は、時刻比率で座標と筆圧を線形補間する。
- 時間dabの stamp distance は、混色更新や jitter seed のために現在の `accumulatedDistance` を使う。
- `stampCount` は距離dabと時間dabで共通に増やす。PRNG は dab の実配置順で決まる。

### 距離dabとの重複

同じ区間で距離dabと時間dabが両方発生しうる。初期実装では以下のどちらかを Phase 1 で選ぶ。

候補1: 両方を配置する

- 低速では濃くなり、高速では距離dabが主になる。
- ただし時間dabと距離dabが近接して濃くなりすぎる可能性がある。

候補2: イベント列を時刻順に統合し、近すぎる dab は抑制する

- 最小間隔を保てる。
- 実装が少し複雑になる。

今回の最小スコープでは候補1から始める。ただし flow 過多が目立つ場合は Phase 1 で `timeDabFlowScale` を追加するか、時間dab専用 flow を検討する。

### 筆圧

synthetic point の `pressure` は、その時点で最後に観測した PointerEvent の pressure を使う。

engine 側で `p1 -> p2` 間の時間dabを補間する場合:

- `p1.pressure` と `p2.pressure` が両方ある場合は時刻比率で線形補間する。
- 片方がない場合はある方を使う。
- 両方ない場合は既存どおり `0.5` 扱い。

静止中は synthetic point が最後の pressure を持つため、押し続けて筆圧が変化するデバイスでは、PointerEvent または timer 時点で更新された最後の pressure が反映される。ブラウザが静止中の筆圧変化イベントを出さない場合、最後に観測した pressure が維持される。

## replay 等価性

この機能で最も重要な制約。

- ライブ描画中に発生した synthetic point は `inputPoints` に保存する。
- `StrokeCommand` には従来どおり `inputPoints`, `filterPipeline`, `expand`, `style`, `brushSeed` を保存する。
- replay では timer を起動しない。
- replay では保存済み `inputPoints.timestamp` を使う。
- engine は `Date.now()` や `performance.now()` を参照しない。
- `stampCount` は距離dabと時間dabの両方で決定論的に増やす。
- pending 描画で生成された時間dabが committed 確定時に二重配置されないよう、`BrushRenderState.lastTimestamp` / `nextTimeStampAt` を committed と pending に引き継ぐ。

注意点:

現在の pending layer は毎回消去して再描画される。pending 描画が `brushState` を直接汚さないように複製状態を使っている箇所があるため、時間状態も混色状態と同じく pending 側で隔離する必要がある。

## input が時間ベースで密になるのか

結論として、今回の最小機能では「はい。ただし通常の座標サンプリングとは別の目的の synthetic input」として扱う。

- 通常の `shouldAcceptPoint()` は、実ポインタイベントを採用するか決める。
- 時間dab用の synthetic input は、描画中の時間経過を履歴に固定するために追加する。
- synthetic input は座標が同じでも保存される。
- synthetic input は stamp brush の `timeSpacingMs` が有効な時だけ発生する。

この設計により、ストローク記録自体は「時間付き入力点列」になる。時間経過で入力が密になるが、それは replay 等価性を保つための意図的な履歴化であり、ブラシエンジンがライブ時の時計を直接読むより安全。

## 非目標

- 速度に応じた size / flow / spacing 変化は今回は行わない。
- slow tracking や手ぶれ補正は今回は行わない。
- `pointerrawupdate` / `getCoalescedEvents()` 対応は今回は行わない。
- 時間dabの flow 正規化や物理的な塗料蓄積モデルは初期実装に含めない。
- round-pen に時間描画を追加しない。

## Doc-First Phase

### Phase 1: API設計・ドキュメント作成

1. `StrokePoint.timestamp` の追加を設計し、`packages/engine/docs/types.md` に記載する。
2. `BrushDynamics` の時間dab設定を設計する。
   - `timeSpacingMs?: number` 案
   - `dabsPerSecond?: number` 案
   - どちらを外部IFにするか決める。
3. `BrushRenderState` / `BrushBranchRenderState` の時間状態を設計する。
4. `packages/engine/docs/brush-api.md` に時間dabの動作、距離dabとの関係、replay 等価性の制約を書く。
5. `packages/stroke/docs/` が存在する場合は、`InputPoint.timestamp` を `StrokePoint` へ保持する変換と履歴保存の意味を記載する。
6. `packages/react/docs/README.md` に synthetic input の発生条件と保存されることを記載する。

### Phase 2: 利用イメージレビュー

1. スタンプブラシ設定例を提示する。

```typescript
const airbrush = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.05,
    flow: 0.08,
    timeSpacingMs: 33,
  },
  pressureDynamics: { size: 0, flow: 1 },
};
```

2. React 統合の利用イメージを提示する。
   - time dab 有効な stamp brush では描画中に synthetic `InputPoint` が追加される。
   - synthetic point は `strokePoints` と history に含まれる。
3. replay の利用イメージを提示する。
   - 保存済み点列のみで時間dabが再現される。
   - replay 時に timer は動かない。
4. ユーザー確認項目。
   - 外部IFは `timeSpacingMs` と `dabsPerSecond` のどちらがよいか。
   - 初期プリセットでどのブラシに有効化するか。
   - 距離dabと時間dabを両方配置する初期挙動でよいか。
   - synthetic point が履歴サイズを増やすことを許容するか。

### Phase 3: 実装

1. `packages/engine/src/types.ts`
   - `StrokePoint.timestamp?: number` を追加する。
   - `BrushDynamics` に時間dab設定を追加する。
   - `BrushBranchRenderState` / `BrushRenderState` に時間状態を追加する。
2. `packages/stroke/src/session.ts`
   - `toStrokePoints()` / `toStrokePoint()` で `timestamp` を保持する。
3. `packages/engine/src/stroke-interpolation.ts`
   - `StrokePoint.timestamp` を線形補間する。
   - extrapolate 時の timestamp 扱いを決める。時間dab用途では実入力区間の p1/p2 timestamp を優先するため、補間点 timestamp は単調性を保つ。
4. `packages/engine/src/brush-render.ts`
   - 距離dab scheduler に時間dab scheduler を追加する。
   - `lastTimestamp` / `nextTimeStampAt` を state から復元し、戻り値に保存する。
   - 距離dabと時間dabの `stampCount` 更新順を決定論的にする。
   - pending 描画で state を汚さない既存方針を維持する。
5. `packages/react/src/useStrokeSession.ts`
   - time dab 有効な stamp brush で描画中 timer を開始する。
   - 最後の座標・筆圧を保持し、interval ごとに synthetic `InputPoint` を `onStrokeMove` 相当で処理する。
   - stroke end / cancel / pendingOnly 終了時に timer を止める。
   - synthetic point を `inputPoints` に保存する。
6. persistence / preset / UI
   - `BrushDynamics` の時間dab設定を保存・復元する。
   - 必要なら web UI に Time Dabs / Rate を追加する。
   - 初期スコープでは UI を最小にし、プリセットまたは内部設定だけでもよい。
7. テスト
   - 同一座標で timestamp 差がある点列から複数 dab が配置される。
   - `timeSpacingMs` 無効時は従来の距離dabだけ。
   - replay と incremental で `stampCount` が一致する。
   - synthetic point を含む `inputPoints` が persistence で保持される。
   - pending 再描画で時間dabが二重に committed されない。
8. 検証コマンド
   - `pnpm --filter @headless-paint/engine test`
   - `pnpm --filter @headless-paint/stroke test`
   - `pnpm --filter @headless-paint/react test`
   - `pnpm build`
   - 必要なら `pnpm lint`

### Phase 4: アーキテクトレビュー

1. review-library-usage skill でセルフレビューする。
2. replay 等価性を重点確認する。
   - engine が現在時刻を読んでいない。
   - synthetic point が履歴に保存される。
   - `brushSeed` と `stampCount` で jitter が再現される。
3. committed/pending モデルへの適合を確認する。
   - committed state と pending state の時間状態が混ざらない。
   - finalize 時に時間dabが二重配置されない。
4. Expand との適合を確認する。
   - 分岐ごとの `BrushBranchRenderState` に時間状態が入る。
   - 分岐ごとに同じ時刻列で決定論的に dab が増える。
5. docs と実装の双方向整合性を確認する。

## 完了条件

- time dab 有効な stamp brush で、一点に押し続けると同じ場所に繰り返し描画される。
- synthetic point は最後に観測した座標・筆圧・時刻を持ち、履歴に保存される。
- replay は保存済み `inputPoints` と `brushSeed` だけでライブと同等の結果を再現する。
- time dab 無効時は従来の距離ベース挙動を維持する。
- 関連 docs とテストが更新されている。

## 保留事項

- 外部IF名を `timeSpacingMs` にするか `dabsPerSecond` にするか。
- 距離dabと時間dabを単純加算するか、近接 dab を抑制するか。
- time dab の flow を通常 dab と同じにするか、専用倍率を持つか。
- synthetic point をどの層で生成するか。初期案は `packages/react/src/useStrokeSession.ts` だが、将来的には DOM 非依存の helper を input パッケージに切り出す余地がある。
