# Bristle の向きの安定化（引きずり柄モデル）

## 目的

低速・不安定な入力で、ハケの横断方向（掃引フレーム）が暴れる問題を直す。横に引いているつもりで次の入力が (x+0, y+1) になると、接線が 90° 跳んでフレームが即座に縦を向き、さらに折返し（cusp、閾値 65°）に誤判定されて「保持してからグイッと回る」動きになる。

## 現状の事実（2026-09-09 調査）

- フレームは Catmull-Rom 補間後の中心線を `geometryStepPx`（1px）で歩いた**その場の接線**をそのまま使う（`resolveSweepPoints`）
- 内部の方向平滑値 `incoming`（`cuspDetectionSpanRatio` = 幅 × 0.14 の距離で追従）は折返し判定にしか使われず、フレームには使われない
- 折返し後は `lagLengthRatio`（幅 × 0.3）の距離をかけてフレームを回す。つまり「距離で回る」振る舞いは既にある
- フレームは dropout ノイズの横断座標にも使われるので、フレームの暴れは筋のガタつきにもなる

## 設計（ユーザー承認 2026-09-09: 案 B）

ペン先の後ろに距離 L の「柄の点」を置き、フレーム = 柄からペン先への方向とする。

- L = `brushSize × handleLengthRatio`。`handleLengthRatio = 0` は従来どおり接線をそのまま使う
- 柄はペン先との距離が L を超えたときだけ、距離が L になるまで引きずられる（pulled string）。距離が L 以下（たるみ）の間は柄も方向も更新しない
- 描画位置はペン先のまま。遅れるのは向きだけで、距離ベースなので停止中に変化しない
- 折返し: 引き返すと柄との距離が縮み（たるみ）、柄を通り越して L を超えた時点で方向が 180° 反転する。この反転は既存の折返し判定（`cuspAngleThresholdDeg`）にそのまま入り、`frameSign` 反転と lag による回転も従来どおり動く。小さなブレはたるみで吸収され折返しにならない
- ストローク開始: 最初の emission で柄を「始点 − 接線 × L」に初期化し、最初から向きが出る
- 柄の位置は `BristleBranchRenderState` に持ち、Expand の branch ごと・flush をまたいで引き継ぐ（replay でも決定的）

## API 設計（クライアントから見える変更）

```typescript
interface BristleDynamics {
  // ...既存
  readonly handleLengthRatio: number; // 柄の長さ（ブラシ幅に対する比率）。0 = 接線をそのまま使う（従来）
}
// DEFAULT_BRISTLE_DYNAMICS.handleLengthRatio = 0.5（官能評価で調整）

interface BristleBranchRenderState {
  // ...既存
  readonly handleX?: number; // 柄の点。未設定なら次の emission で初期化
  readonly handleY?: number;
  readonly handleDirectionX?: number; // 柄からペン先への方向。たるみ中はこの値を保持する
  readonly handleDirectionY?: number;
}
```

- react persistence: `handleLengthRatio` を 0..4 で検証。欠落時は既定値 0.5 を補完（追加フィールドの補完は `spacingSizeCoupling` の前例に従う）
- web: DebugPanel の bristle 設定に「Handle length（柄の長さ）」スライダー（0..2）

## 描画の変更点（内部）

- `resolveSweepPoints`: emission ごとに `stableDirection` を求め、従来 `emission.direction` を使っていたフレーム・折返し判定・lag の目標角にはすべて `stableDirection` を使う。`ResolvedSweepPoint.directionX/Y`（進行方向、距離やセグメント用）は生の接線のまま
- L = 0 のとき `stableDirection = emission.direction` で完全に従来と一致（回帰テストで保証）

## 作業手順

- Phase 1: docs（types.md / brush-api.md）
- Phase 2: ユーザー承認済み（案 B、パラメータ 1 つ）。本ファイルの API を提示して完了とする
- Phase 3: codex 委譲 1 本（engine + react persistence + web スライダー。ファイル集合が重ならないので直列 1 本）。検収は Claude（フル + 実ブラウザで揺れ入力の比較）
- Phase 4: アーキテクトレビュー、agents-note 更新

## 設計の補足（2026-09-09、codex 指摘で修正）

前進中は柄が常に張っているため、横ブレは「消える」のではなく角度が `atan(δ / L)` に縮む。たるみで完全に止まるのは引き返す間だけ。内部の `frameX/Y` は長手軸（進行方向）で、横断軸は `(−frameY, frameX)`。docs の保証文とテスト条件をこれに合わせた。

たるみ中は方向を更新しないので、直前の stableDirection を flush をまたいで持ち越す保存先が要る（ペン先−柄の向きはたるみ中に変わり、`incoming` は平滑済み、`frameX/Y` は lag 適用後で代用できない。codex の診断: 一括 25.53° に対し incoming 代用の分割 26.14°）。`BristleBranchRenderState.handleDirectionX/Y` を追加して保持する。

## 完了条件

- `handleLengthRatio = 0` で従来と同一の掃引点列（フレーム・折返し・lag が byte 一致）
- L = 15 で 1px の縦ブレを含む横線を与えたとき、フレームが横軸から 5° 以内に収まる（従来は 90°）。L = 30 では 2.5° 以内（ブレの影響が δ / L で縮むことの確認）（単体テスト）
- 半円を描いたときフレームが滑らかに回り、途中で不連続がない（単体テスト）
- 折返し（180°）で従来どおり `frameSign` が反転し、横向きの一時的な回転が出ない（単体テスト）
- 実ブラウザ（CPU / WebGL2）で、1px の縦ブレを含む横線が従来より安定する
- フル検収 green
