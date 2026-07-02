# Zoom-aware sampling plan

## 背景

現在の入力サンプリングは `screenToLayer()` 後の Layer Space 座標だけで `minDistance` を判定している。デフォルト `minDistance: 2` の場合、10倍ズーム中は画面上で約20px動くまで次の入力点が採用されない。

これはキャンバス実座標基準としては一貫しているが、高倍率ズームで細部を描く操作感としては鈍い。特にスタンプブラシに限らず、丸ペンでも「少し動かしたのに点列が更新されない」状態が起きる。

この課題はブラシ描画ではなく、PointerEvent から `InputPoint` を作る前段の採用判定の問題なので、input 層の小さな改善として独立して扱う。

## 現状調査

- `packages/react/src/usePointerHandler.ts`
  - `screenToLayer()` 後の `layerPoint` と `e.timeStamp` を `shouldAcceptPoint()` に渡している。
  - デフォルト設定は `samplingConfig = { minDistance: 2 }`。
- `packages/input/src/sampling.ts`
  - `shouldAcceptPoint(point, timestamp, state, config)` は Layer Space の `Point` だけを受け取る。
  - 採用条件は初回、`minDistance`、`minTimeInterval`。
- `packages/input/src/types.ts`
  - `SamplingState.lastPoint` は Layer Space の最後の採用点だけを保持する。
  - Screen Space の最後の採用点は保持していない。
- `packages/input/docs/sampling-api.md`
  - 間引きは Layer Space で評価されると明記している。

## 方針

Layer Space の距離判定は維持しつつ、Screen Space の距離判定を追加する。

採用条件:

```text
初回
OR layerDistance >= minDistance
OR screenDistance >= minScreenDistance
OR elapsed >= minTimeInterval
```

これにより、高倍率ズーム時は画面上の小さな移動で入力点が採用される。一方、通常倍率やズームアウト時には従来どおり Layer Space の `minDistance` が効く。

## API案

### SamplingConfig

```typescript
interface SamplingConfig {
  readonly minDistance?: number;
  readonly minScreenDistance?: number;
  readonly minTimeInterval?: number;
}
```

- `minDistance`: Layer Space px。従来互換の基準。
- `minScreenDistance`: Screen Space px。高倍率ズーム時の操作追従用。
- `minTimeInterval`: ms。従来どおり時間による採用。

デフォルト案:

```typescript
const defaultSamplingConfig = {
  minDistance: 2,
  minScreenDistance: 2,
};
```

`minScreenDistance` の初期値は Phase 2 で確認する。候補は `2` または `3` px。ペンタブの微小ノイズを拾いすぎる場合は `3` px を優先する。

### SamplingState

```typescript
interface SamplingState {
  readonly lastPoint: Point | null;
  readonly lastScreenPoint: Point | null;
  readonly lastTimestamp: number | null;
}
```

`lastPoint` は Layer Space、`lastScreenPoint` は Screen Space の最後の採用点とする。採用されたときだけ両方を更新する。

### shouldAcceptPoint

既存関数を破壊的に拡張する案:

```typescript
function shouldAcceptPoint(
  point: Point,
  timestamp: number,
  state: SamplingState,
  config: SamplingConfig,
  screenPoint?: Point,
): [boolean, SamplingState]
```

`screenPoint` を optional にすることで、既存の呼び出しは Layer Space 判定だけで動く。React 統合では `screenPoint` を渡す。

別案として `SamplingInput` オブジェクトを導入する案もあるが、今回は小改善なので引数追加に留める。

## 利用イメージ

`usePointerHandler` では、PointerEvent 由来の画面座標と変換後の Layer 座標を両方渡す。

```typescript
const screenPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
const layerPoint = screenToLayer(screenPoint, transform);

const [accepted, newState] = shouldAcceptPoint(
  layerPoint,
  e.timeStamp,
  samplingStateRef.current,
  samplingConfig,
  screenPoint,
);
```

ズーム10倍、`minDistance: 2`, `minScreenDistance: 2` の場合:

- 画面上で2px動いた時点で採用される。
- Layer Space では0.2px相当なので、細部描画の入力追従が改善する。
- ズーム1倍では従来とほぼ同じ密度になる。

## 非目標

- スタンプブラシの静止中描画、時間dab、速度による flow 変化はこの計画では扱わない。
- `InputPoint.timestamp` を engine まで渡す変更は行わない。
- `pointerrawupdate` や coalesced events の対応は行わない。
- 座標スムージングや補間アルゴリズムは変更しない。

## Doc-First Phase

### Phase 1: API設計・ドキュメント作成

1. `SamplingConfig` に `readonly minScreenDistance?: number` を追加する設計を確定する。
2. `SamplingState` に `readonly lastScreenPoint: Point | null` を追加する設計を確定する。
3. `shouldAcceptPoint()` の拡張シグネチャを `packages/input/docs/` に記載する。
4. `packages/react/docs/README.md` の `samplingConfig` 説明を更新する。
5. Layer Space と Screen Space の併用ルール、ズーム時の例、未指定時の挙動を明記する。

### Phase 2: 利用イメージレビュー

1. `apps/web` / `packages/react` の呼び出し例を提示する。
2. デフォルト `minScreenDistance` を `2` px にするか `3` px にするか確認する。
3. `screenPoint` optional 引数案で十分か、オブジェクト引数化するか確認する。
4. 承認後に Phase 3 へ進む。

### Phase 3: 実装

1. `packages/input/src/types.ts`
   - `SamplingConfig.minScreenDistance` を追加する。
   - `SamplingState.lastScreenPoint` を追加する。
2. `packages/input/src/sampling.ts`
   - `createSamplingState()` の戻り値を更新する。
   - `shouldAcceptPoint()` に `screenPoint` 引数を追加する。
   - screen distance 判定を追加する。
   - `screenPoint` がない場合は従来どおり Layer Space と time だけで判定する。
3. `packages/react/src/usePointerHandler.ts`
   - pointer down / move の両方で `screenPoint` を渡す。
   - デフォルト `samplingConfig` を更新する。
4. `packages/react/src/useTouchGesture.ts`
   - Gesture 経由の描画入力でも screenPoint を渡せるか確認し、必要なら同様に対応する。
5. テストを追加・更新する。
   - Layer Space 距離未満でも Screen Space 距離以上なら採用される。
   - Screen Space 未指定時は従来どおり。
   - 採用時のみ `lastScreenPoint` が更新される。
6. `pnpm --filter @headless-paint/input test`
7. 影響範囲に応じて `pnpm --filter @headless-paint/react test` または `pnpm build` を実行する。

### Phase 4: アーキテクトレビュー

1. review-library-usage skill でセルフレビューする。
2. input 層の責務に収まっているか確認する。
3. docs と実装の双方向整合性を確認する。
4. デフォルト値により通常倍率で入力点が過剰に増えていないか確認する。
5. スタンプ時間dab計画と責務が混ざっていないことを確認する。

## 完了条件

- 高倍率ズーム時に画面上の小さな移動でも入力点が採用される。
- `minDistance` による Layer Space 判定は維持される。
- Screen Space 判定が不要な呼び出しでは従来どおり動作する。
- 関連 docs とテストが更新されている。
