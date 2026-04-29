# スタンプブラシ混色設計計画

## 目的

現行のスタンプタイプブラシに、描画先レイヤーの既存色を拾ってブラシ色へ反映する混色機能を追加する。

今回の対象は混色のみとし、色引き摺り（smudge / smear / blur）は実装対象外とする。ただし、将来の色引き摺り追加時に破壊的な再設計が必要にならないよう、dab 単位の描画先参照と分岐別状態を考慮した API にする。

web デモアプリでは混色パラメータを確認・調整できる UI を追加し、既存の `Marker` プリセットを削除して、代わりに混色サンプルとして `Acrylic` プリセットを追加する。

## 背景と判断

他プロダクトの事例では、混色・ぼかし・指先系は次のように分かれる。

- Photoshop: `Smudge Tool` は独立ツール、`Mixer Brush` は描画しながら混ぜるブラシ。
- Clip Studio Paint: `Blend tool` は独立ツールだが、通常ブラシにも `Color mixing` を有効化できる。
- Procreate: Paint / Smudge / Erase は独立ツールだが同じ Brush Library を共有する。
- Krita / MyPaint: ブラシエンジンまたはブラシ設定として混色・smudge を持つ。

本プロジェクトでは、複雑性を抑えるため今回の実装は「ブラシ設定としての混色」に限定する。独立したぼかし/指先ツールは将来検討とし、今回の API に tool 概念は入れない。

補正については既存の `FilterPipeline` に任せる。混色側は補正済みの `StrokePoint` 列だけを受け取り、追加の手ぶれ補正やパス補正を持たない。

## スコープ

### 対象

- `StampBrushConfig` に混色設定を追加する。
- スタンプ描画時に描画先レイヤーの footprint を分岐ごとのブラシ色バッファへ転写し、tip 内の局所的な色分布を保ったまま描画する。
- 透明領域では背景色を拾わず、元の描画色へ徐々に戻る。
- 半透明ピクセルは alpha に応じて拾う強さを弱める。
- Expand で分岐した各ストロークは独立したブラシ色バッファを持つ。
- Undo/Redo replay で同じ結果になるよう、履歴コマンドに混色設定を含む `StrokeStyle` と `brushSeed` を保存する。
- web デモで混色パラメータを調整できるようにする。
- web デモの `Marker` プリセットを削除し、`Acrylic` プリセットを追加する。

### 対象外

- 色引き摺りによるピクセル移動、方向ブラー、純粋なぼかしツール。
- 複数レイヤー全体からの色サンプリング。
- `getImageData` によるピクセル走査を前提にした混色実装。
- 物理的な顔料混色モデル、HCY/OKLab 等の高度な色空間混色。
- ブラシごとの専用入力補正。
- WebGL / GPU 最適化。

## 設計方針

### 混色モデル

混色は各 dab 配置時に行う。

1. ストローク開始時に、全分岐で共有する `tipMask` と、分岐ごとの `colorBuffer` を用意する。
2. `colorBuffer` はブラシ最大サイズの `OffscreenCanvas` とし、初期状態は `style.color` のベタ塗りにする。
3. dab 配置時に、描画先レイヤーの dab footprint を `pickup` の強さで `colorBuffer` へ転写する。
4. その後、`style.color` のベタ塗りを `restore` の強さで `colorBuffer` へ転写する。
5. 最後に `colorBuffer` を `tipMask` でマスクし、通常のスタンプと同じ transform / scale / rotation / scatter で描画先へ配置する。

透明領域では背景転写が実質的に起きず、restore のみが効く。半透明領域では Canvas2D の alpha 合成により pickup の影響が弱まる。

この方式では、ブラシが赤/青の境界をまたぐ場合でも、tip 全体が単一の紫に平均化されず、`colorBuffer` 内に赤寄り・青寄りの局所差を保持できる。

ピクセル平均色を `getImageData` で取得する設計は初期実装では採用しない。ブラウザによって `getImageData` は重く、Canvas2D の `drawImage` / `globalAlpha` / `globalCompositeOperation` に寄せる方針とする。

### API 案

`BrushDynamics` とは別に、色の状態変化を表す設定として `BrushMixing` を追加する。

```typescript
export interface BrushMixing {
  readonly enabled: boolean;
  readonly pickup: number;
  readonly restore: number;
}
```

各値の意味:

- `enabled`: 混色を有効にする。
- `pickup`: 描画先 footprint を `colorBuffer` へ転写する強さ。`0` で拾わず、`1` で最大。
- `restore`: 元の描画色へ戻る強さ。`0` で戻らず、`1` で即座に戻る。

`StampBrushConfig` は次のように拡張する。

```typescript
export interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
  readonly mixing?: BrushMixing;
}
```

`mixing` は optional とし、既存ブラシは未指定で混色なしにする。

デフォルト定数を追加する。

```typescript
export const DEFAULT_BRUSH_MIXING: BrushMixing = {
  enabled: false,
  pickup: 0,
  restore: 0.15,
};
```

### BrushRenderState

現行の `BrushRenderState` は単一の `accumulatedDistance` / `stampCount` / `tipCanvas` を持つ。混色では Expand 分岐ごとに拾う footprint が異なるため、分岐別状態が必要になる。

最小変更として、既存フィールドを維持しつつ分岐状態を optional で追加する。

```typescript
export interface BrushBranchRenderState {
  readonly accumulatedDistance: number;
  readonly stampCount: number;
  readonly colorBuffer?: OffscreenCanvas;
}

export interface BrushRenderState {
  readonly accumulatedDistance: number;
  readonly tipCanvas: OffscreenCanvas | null;
  readonly seed: number;
  readonly stampCount: number;
  readonly branches?: readonly BrushBranchRenderState[];
}
```

実装時には `branches` があれば分岐ごとに使い、なければ既存フィールドから初期化する。将来、色引き摺りで分岐ごとの smudge buffer が必要になった場合は `BrushBranchRenderState` に追加する。

### tipCanvas の扱い

現行の `generateBrushTip(config, size, color)` は、ストローク開始時に現在のブラシサイズをもとにした最大サイズで生成し、dab ごとに縮小して描画している。

混色実装でもこの前提を維持する。筆圧ごとに tip を再生成しない。

- `tipCanvas` は alpha mask として使う。
- `colorBuffer` は `tipCanvas` と同じサイズで分岐ごとに持つ。
- dab のサイズ変化は、最終描画時に `tipCanvas` / `colorBuffer` を同じ倍率で縮小描画して表現する。
- 背景転写時も、dab の実描画サイズに合わせて描画先 footprint を `colorBuffer` 座標へ `drawImage` で写す。

既存 API は維持する。必要であれば Phase 1 で内部 helper として `createSolidColorBuffer` / `renderMixedStamp` のような関数を設計するが、外部 API として `generateBrushMask` は追加しない。

### Canvas2D 合成方針

初期実装では `getImageData` を避け、Canvas2D の合成だけで `colorBuffer` を更新する。

想定手順:

1. `colorBuffer` へ描画先 footprint を `globalAlpha = pickup` で `drawImage` する。
2. 透明部分の挙動が不自然な場合は、背景 footprint を一時キャンバスへ切り出し、alpha を保持したまま `source-over` で合成する。
3. `colorBuffer` へ `style.color` のベタ塗りを `globalAlpha = restore` で重ねる。
4. 出力用一時キャンバスに `colorBuffer` を描き、`destination-in` で `tipCanvas` の alpha を適用する。
5. 出力用一時キャンバスを描画先へ配置する。

この手順で不足が出た場合にのみ、部分的な最適化または GPU 寄りの実装を別途検討する。初期設計ではピクセル走査に逃げない。

### Incremental / pending の扱い

混色は描画先レイヤーを読むため、pending preview と確定描画の一致が重要になる。

実装では次の方針を採用した。

- `appendToCommittedLayer` / `renderPendingLayer` に `sourceLayer?: Layer` を追加し、混色時の背景転写元を明示する。
- 通常ストローク開始時に committed レイヤーのスナップショットを作成し、混色ブラシではそのスナップショットを `sourceLayer` として使う。
- これにより、透明領域へ移動した後に同一ストローク内で描いた dab を背景として拾い続けることを避け、`restore` による元色への復元を安定させる。
- 混色ブラシの pending preview では `previewBaseLayer?: Layer` に現在の committed レイヤーを渡し、pending レイヤーを `"copy"` 合成で表示する。描画中の committed 差分と pending 差分をまとめたフルプレビューとして表示するため。
- 通常ストロークは描画中に committed レイヤーへ差分追記する。キャンセル時に復元できるよう、開始時スナップショットを `committedSnapshot` として保持する。

ただし、混色なしの既存ブラシでは現在と同じ挙動・性能を維持する。

### 引き摺りへの最低限の考慮

今回 `smudge` 設定は追加しない。考慮は以下に限定する。

- `BrushBranchRenderState` を導入し、将来 branch ごとの smudge 状態を持てるようにする。
- dab 単位の footprint 転写 helper を混色専用に閉じすぎず、将来 smudge からも再利用できる粒度にする。
- 独立ツール化を急がず、将来は「描画色追加量 0 の smudge brush」として表現できる可能性を残す。

## Doc-First Phase

### Phase 1: API設計・ドキュメント作成

コード実装前に、以下のドキュメントを更新する。

- `packages/engine/docs/types.md`
  - `BrushMixing`
  - `DEFAULT_BRUSH_MIXING`
  - `StampBrushConfig.mixing`
  - `BrushBranchRenderState`
  - `BrushBranchRenderState.colorBuffer`
  - `BrushRenderState.branches`
- `packages/engine/docs/brush-api.md`
  - 混色の動作
  - 分岐ごとの `colorBuffer`
  - Canvas2D 合成による背景転写と復元転写
  - `getImageData` を初期実装で避ける方針
  - Expand 分岐ごとの状態
  - `generateBrushTip` を mask として使う初期実装方針
- `packages/engine/docs/incremental-render-api.md`
  - mixed brush の pending/committed の扱い
  - 必要なら `renderPendingLayer` / `appendToCommittedLayer` の引数追加案
- `packages/react/docs/README.md`
  - `usePenSettings` が `BrushConfig` の `mixing` をそのまま `StrokeStyle` へ含めること
  - web demo 側での調整イメージ

Phase 1 では型・関数シグネチャを確定し、必要な場合だけ API 追加を行う。実装には進まない。

### Phase 2: 利用イメージレビュー

以下の利用イメージを提示し、承認を得る。

- web デモで `Acrylic` を選ぶ。
- `pickup` / `restore` を DebugPanel または BrushPanel から調整する。
- 赤い下地の上を青で描くと、stroke 中の dab が徐々に赤寄りになる。
- 赤/青の境界を大きなブラシでなぞると、tip 内に赤寄り・青寄りの局所差が残る。
- 透明領域へ抜けると、`restore` に従って青へ戻る。
- symmetry / radial expand では分岐ごとに異なる色を拾う。

承認が出るまで Phase 3 へ進まない。

### Phase 3: 実装

承認後に実装する。

実装候補:

1. engine 型追加
   - `BrushMixing`
   - `DEFAULT_BRUSH_MIXING`
   - `BrushBranchRenderState`
   - `StampBrushConfig.mixing`
2. brush rendering
   - dab 配置処理を小さく分割する。
   - 混色有効時だけ描画先 footprint を branch の `colorBuffer` へ転写する。
   - `restore` で元ブラシ色を `colorBuffer` へ重ねる。
   - `colorBuffer` と `tipCanvas` を合成して dab を描画する。
   - `getImageData` は使わない。
3. incremental rendering
   - Expand 後の stroke index と branch state を対応させる。
   - committed / pending の連続性を保つ。
4. stroke replay
   - `brushSeed` と `StrokeStyle` から同じ結果を再生成する。
5. persistence
   - `BrushConfig` clone / validation に `mixing` を追加する。
   - 既存ドキュメントにある通り、現時点では後方互換は強く考慮しない。
6. web demo
   - `APP_BRUSH_PRESETS` から `Marker` を削除。
   - `Acrylic` プリセットを追加。
   - BrushPanel に `pickup` / `restore` の調整を追加。

### Phase 4: アーキテクトレビュー

実装完了後、以下を確認する。

- docs に記載した型・デフォルト値・挙動が実装と一致する。
- 混色なしの既存ブラシで性能・見た目の不要な変化がない。
- `Acrylic` プリセットが web demo で選択・調整できる。
- Expand 分岐ごとに `colorBuffer` が独立している。
- Undo/Redo replay で混色結果が破綻しない。
- pending preview の制約が docs と一致している。
- review-library-usage skill によるセルフレビューを実施する。

## テスト計画

- `packages/engine/src/brush-render.test.ts`
  - 透明領域では pickup されない。
  - 半透明ピクセルでは pickup が alpha に応じて弱まる。
  - `restore` により元色へ戻る。
  - 赤/青の境界をまたぐ footprint で、単一平均色ではなく局所色差が残る。
  - mixing disabled では既存結果に影響しない。
- `packages/engine/src/incremental-render.test.ts`
  - Expand 分岐で branch state が独立する。
  - committed 分割描画と一括 replay の結果が一致する範囲を確認する。
- `packages/react/src/persistence.test.ts`
  - `BrushConfig.mixing` が保存・復元される。
- web demo
  - `Acrylic` プリセット表示。
  - DebugPanel / BrushPanel から混色値を変更できる。

実行予定:

```bash
pnpm test
pnpm lint
pnpm build
```

## 実装結果

- `BrushMixing` / `DEFAULT_BRUSH_MIXING` を追加した。
- `BrushBranchRenderState.colorBuffer` により、Expand 分岐ごとの混色状態を独立管理する。
- `getImageData` は混色処理に使わず、Canvas2D の `drawImage` / `globalAlpha` / `destination-in` で実装した。
- `renderBrushStroke` / `appendToCommittedLayer` / `renderPendingLayer` は混色時の背景転写元として `sourceLayer` を受け取れる。
- `renderPendingLayer` は混色プレビュー用の `previewBaseLayer` を受け取り、React 統合では `"copy"` 合成で表示する。
- `packages/stroke/src/replay.ts` は混色ストロークの replay 時に対象レイヤーをスナップショットし、ライブ描画と同じ `sourceLayer` ルールで再生する。
- web demo は `Marker` を削除し、`Acrylic` プリセットと `pickup` / `restore` slider を BrushPanel に追加した。

## 保留事項

- 背景転写時の rotation は `colorBuffer` 更新には反映せず、最終dab描画の transform にのみ反映する。重さや見た目が問題になった場合に追加検討する。
- 色引き摺り / smudge は今回未実装。
