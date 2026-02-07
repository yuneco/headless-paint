# Wrap Offset: ピクセルシフト案

## Context

パターン作成でタイルの繋ぎ目を編集しやすくするために、レイヤーの表示をオフセットする機能が必要。既存の表示オフセット案（`plans/2026-02-07-16-21_wrap-offset.md`）は visual/physical 座標分離、ストローク境界分割、4コピーレンダリングなど複雑だった。

本プランは **ピクセルシフト案** を採用。オフセット変更時に実際にピクセルを `drawImage` で移動（ラップ）させる。シンプルさ優先。

### 両案の比較

| 観点 | ピクセルシフト（本案） | 表示オフセット（既存案） |
|------|----------------------|------------------------|
| 変更ファイル数 | ~11 | ~16 |
| 新規概念 | `wrapShiftLayer` のみ | visual/physical分離、境界分割、4コピー合成、座標変換 |
| 座標系 | レイヤー座標のみ（変更なし） | visual + physical の2系統 |
| ストローク分割 | 不要 | ラップ境界で分割が必要 |
| オフセット変更コスト | drawImage x5/回（GPU加速） | ゼロ（表示のみ） |
| 履歴スロット | 使う（1ドラッグ=1コマンド） | 使わない |
| Expand相互作用 | 変更なし（端でクリップ=今と同じ） | wrapPointsToLayer + splitExpandedStroke |
| SymmetryOverlay | 変更なし | ガイド位置のオフセット対応が必要 |
| incremental-render | 変更なし | wrapOffset パラメータ追加 |
| render.ts | 変更なし | 4コピー合成追加 |
| input パッケージ | 変更なし | applyWrapOffset 追加 |

**トレードオフ**: ピクセルシフトはオフセット変更にGPUコストがかかるが、1024x1024で drawImage x5 @60fps は現代GPUでは問題にならない。代わりに座標系の複雑さを完全に回避。

## API設計

### engine パッケージ

`wrapShiftLayer(layer, dx, dy, temp?)` — レイヤー全ピクセルをラップシフト。GPU加速drawImage使用、整数シフトは完全可逆。内部でモジュロ正規化→tempコピー→4象限drawImage。詳細は `packages/engine/docs/README.md` 参照。

### stroke パッケージ

- `WrapShiftCommand { type: "wrap-shift", dx, dy, timestamp }` — Command union に追加
- `createWrapShiftCommand(dx, dy)` — コマンド生成ヘルパー
- `replayCommand` に `"wrap-shift"` case 追加
- `computeCumulativeOffset(state)` — 履歴中のwrap-shiftを合算して累積オフセットを返す

詳細は `packages/stroke/docs/README.md` 参照。

### web アプリ

- `usePointerHandler`: `"offset"` ツール追加。screenToLayerでレイヤー座標デルタを算出し、端数蓄積で整数デルタのみ適用
- `App.tsx`: tempキャンバス再利用、ドラッグ中即時シフト、ドラッグ終了時コマンド生成、リセット（逆シフト）
- `Toolbar`: offsetボタン追加
- `DebugPanel`: Layer Offsetフォルダ（累積オフセット表示+リセットボタン）
- `HistoryContent`: wrap-shiftコマンドのラベル表示
- `PaintCanvas`: offsetコールバック受け渡し、moveカーソル

## 実装結果

全Phase完了。テスト104件パス（engine 11件新規 + stroke 5件新規含む）、lint/format/buildパス。

## 変更対象ファイル一覧

| パッケージ | ファイル | 変更内容 |
|-----------|---------|---------|
| engine | `src/wrap-shift.ts` (新規) | `wrapShiftLayer` |
| engine | `src/wrap-shift.test.ts` (新規) | テスト |
| engine | `src/index.ts` | エクスポート |
| stroke | `src/types.ts` | `WrapShiftCommand`, `Command` union |
| stroke | `src/session.ts` | `createWrapShiftCommand` |
| stroke | `src/replay.ts` | replay対応 |
| stroke | `src/history.ts` | `computeCumulativeOffset` |
| stroke | `src/history.test.ts` | テスト |
| stroke | `src/index.ts` | エクスポート |
| web | `src/hooks/usePointerHandler.ts` | `"offset"` ツール |
| web | `src/components/Toolbar.tsx` | offset ボタン |
| web | `src/components/PaintCanvas.tsx` | コールバック・カーソル |
| web | `src/components/HistoryContent.tsx` | ラベル |
| web | `src/components/DebugPanel.tsx` | Layer Offset UI |
| web | `src/App.tsx` | 統合配線 |

## パフォーマンス分析

1024x1024キャンバスでのドラッグ中:
- `wrapShiftLayer`: drawImage x5（1 to temp, 4 back）@60fps = 300 drawImage/sec
- drawImage(OffscreenCanvas→OffscreenCanvas) はGPU加速
- tempキャンバスは `useMemo` で1回だけ生成、再利用
- `computeCumulativeOffset`: 最大100コマンドのイテレーション = 無視できるコスト

4096x4096キャンバスでも GPU メモリ帯域内（64MB x 5 x 60fps ≈ 19 GB/s、現代GPUは十分）。

## 設計メモ

- **完全可逆性**: 整数シフト + モジュロ演算 → shift(+a) then shift(-a) = identity。drawImage の整数座標コピーは補間なし＝ロスレス
- **端数蓄積**: screenToLayer 変換後のデルタが小数になりうる。`fractionalShiftRef` で端数を蓄積し、整数デルタだけを適用
- **ドラッグ中のキャンセル**: 明示的なキャンセル機構は不要（Undoで対応）
- **ストローク中のオフセット変更**: ツールが排他なので起きない（pen中はoffset不可）
- **チェックポイント**: checkpoint ImageData はシフト済みピクセルを含む → rebuildLayerState で自然に動作
- **Pattern Preview**: 物理キャンバスからタイル生成 → シフト済みピクセルを自動反映、変更不要
- **SymmetryOverlay**: 対称軸はレイヤー座標系の性質 → ピクセルが動いてもガイドは不変、変更不要

## 設計判断（2026-02-08 議論結果）

### 採用決定: 本案（ピクセルシフト）を先に実装する

**理由**:
- 既存概念（座標系、描画パイプライン）への汚染が最小限
- 今後の拡張において負債となる懸念が少ない — WrapShiftCommandは局所的な追加であり、使わないアプリケーションには影響しない
- このライブラリはパターン生成専用ではない。一部のユースケースのみで利用する機能は、第一級の概念として全体に織り込むより局所的に閉じ込めるべき
- 表示オフセット案は概念的に美しいが、visual/physical座標の二重化がコードベース全体に波及する

### 認識済みの未検討事項

| 論点 | 詳細 | 対応方針 |
|------|------|----------|
| Expand端クリップ | 対称コピーがキャンバス端で切れる（表示オフセット案ならラップされる） | 許容: ユーザーは繋ぎ目を中央に持ってきてから描画するため端付近での描画は少ない。将来必要なら部分的にラップ描画を追加可能 |
| Undo UX汚染 | WrapShiftとStrokeが交互に積まれ、Undo回数が期待と合わない | 連続WrapShiftCommandのマージで緩和。将来的にUndo時のスキップオプションも検討 |
| drawImageのアルファ丸め誤差 | 半透明ピクセルの繰り返しシフトでの劣化リスク | 実装後に実測で確認。clearRect後のdrawImage（空キャンバスへのコピー）は実質ロスレスのはず |
| マルチレイヤーのドラッグコスト | レイヤー数増加時の drawImage x5/レイヤー が重くなる可能性 | debounce/スロットリングで緩和可能。1024x1024で実用上問題ないことを確認 |

### 表示オフセット案との比較で本案が劣る点（認識済み）

- **Expandのシームレスラップ**: 表示オフセット案はExpand出力もmodulo正規化でシームレスにラップ。本案はクリップのみ
- **オフセット変更コスト**: 表示オフセット案はゼロ、本案はdrawImage x5/レイヤー
- **将来のGPU/WebGL移行**: 表示オフセット案はシェーダのmodulo演算で自然に実装可能。本案はテクスチャ書き換えが必要

これらは現時点では許容範囲と判断。将来パターン生成が主要ユースケースとなった場合、表示オフセット案への移行を再検討する。
