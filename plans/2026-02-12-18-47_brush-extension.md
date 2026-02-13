# ブラシ拡張システム

## Context

従来の描画は `drawVariableWidthPath()`（circle + trapezoid fill）による単一方式で、全ストロークが同じ見た目だった。エアブラシ・鉛筆・マーカー等の多様なブラシタイプを実現するための拡張アーキテクチャを設計・実装した。

## 調査・設計方針

### スタンプ方式の採用

プロ向けペイントソフト（Krita, Photoshop, Procreate）の 90%以上がスタンプ方式を採用。ブラシチップ画像をストロークパスに沿って一定間隔で配置する方式で、spacing / scatter / rotation / opacity jitter 等のパラメータで多様な質感を実現する。`drawImage` は GPU アクセラレートされるため高速。

既存ライブラリは OffscreenCanvas + ヘッドレス要件に対応するものがなく、自前実装とした。

### アーキテクチャ

`BrushConfig` 判別共用体 + `renderBrushStroke` ディスパッチ方式。

- **`BrushConfig`**: `RoundPenBrushConfig | StampBrushConfig` の判別共用体
- **`renderBrushStroke`**: `style.brush.type` で round-pen / stamp を切り替えるディスパッチ関数
- **`StrokeStyle`**: 全フィールド required 化 + `brush: BrushConfig` 追加
- **`StrokeCommand`**: 個別フィールド展開を廃止し `style: StrokeStyle` に集約 + `brushSeed: number`
- **チップ生成**: `generateBrushTip()` で `hardness` に応じた radialGradient チップを生成。呼び出し側（useStrokeSession）の責務
- **PRNG**: 位置ベースシード `hashSeed(globalSeed, round(distance * 100))` で committed/pending 独立描画でも同一 jitter を保証
- **committed/pending 境界**: `BrushRenderState.accumulatedDistance` を session ref に保持し引き継ぐことで、スタンプの二重配置やギャップを防止

詳細は以下のドキュメントを参照:
- 型定義: `packages/engine/docs/types.md`
- Brush API: `packages/engine/docs/brush-api.md`
- 差分描画: `packages/engine/docs/incremental-render-api.md`

### 設計上のトレードオフ

| 判断 | 選択 | 理由 |
|------|------|------|
| round-pen の扱い | 独立 variant として残す（案A） | trapezoid 接続の品質はスタンプ方式では再現困難。2コードパスの維持コストより品質を優先 |
| 画像チップの保存方式 | `imageId` 参照 + `BrushTipRegistry` | base64 埋め込みはコマンド履歴が肥大化するため、ランタイム解決 |
| jitter の決定論性 | 位置ベース seeded PRNG | undo/redo で同一結果を保証。committed/pending 独立描画でも一貫 |
| spacing 計算 | 定数 spacing（`baseLineWidth * spacing`） | PoC で視覚的に問題なし。動的 spacing は将来検討（→ P6） |

### PoC 検証で確認した事項

→ [PoC 報告](2026-02-13-20-43_stamp-brush-poc.md)

- accumulatedDistance による committed/pending 境界の完全対応
- 位置ベース PRNG が sequential PRNG より優れている
- 型定義は `types.ts` に集約（循環依存回避）
- チップへの色焼き込み + 呼び出し側でのチップ生成が自然な責務分離
- 既存データフロー（penSettings → strokeStyle → usePaintEngine → useStrokeSession）で自動伝播し、App.tsx の変更は最小限

## 実装結果

### 進捗

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | API設計・ドキュメント作成 | **完了** |
| Phase 2 | 利用イメージレビュー | **完了** |
| Phase 3-1 | 型定義 + リファクタ（挙動変更なし） | **完了** |
| Phase 3-2 | スタンプブラシ実装 | **完了** |
| Phase 3-3 | プリセット + デモUI | **完了**（一部スキップ→ペンディング参照） |
| Phase 4 | アーキテクトレビュー | **完了** |

### 新規・変更ファイル

**新規ファイル**:
- `packages/engine/src/brush-tip.ts` — チップ生成（`generateBrushTip`）、`BrushTipRegistry`
- `packages/engine/src/brush-render.ts` — `renderBrushStroke` ディスパッチ、`renderStampBrushStroke`、PRNG ユーティリティ
- `packages/engine/src/brush-tip.test.ts` — チップ生成テスト（9 tests）
- `packages/engine/src/brush-render.test.ts` — スタンプブラシ描画テスト（15 tests）
- `apps/web/src/components/BrushPanel.tsx` — サイドバーのブラシ選択 UI

**変更ファイル**:

| ファイル | 変更内容 |
|---------|---------|
| `packages/engine/src/types.ts` | BrushConfig 型群、StrokeStyle 全 required 化、DEFAULT 定数、プリセット定数 |
| `packages/engine/src/incremental-render.ts` | `drawVariableWidthPath` → `renderBrushStroke` 置換、`BrushRenderState` 引数・戻り値追加 |
| `packages/engine/src/index.ts` | 新 API・定数のエクスポート |
| `packages/stroke/src/types.ts` | `StrokeCommand` を `style: StrokeStyle` に集約 + `brushSeed` 追加 |
| `packages/stroke/src/session.ts` | StrokeCommand 構築を style 集約に変更 |
| `packages/stroke/src/replay.ts` | stamp ブラシリプレイ時の tipCanvas 再生成 |
| `packages/react/src/usePenSettings.ts` | `brush` / `setBrush` 追加、StrokeStyle 全 required 構築 |
| `packages/react/src/useStrokeSession.ts` | `BrushRenderState` 管理、tipCanvas 生成 |
| `packages/react/src/usePaintEngine.ts` | `brushSeed` を `createStrokeCommand` に渡す |
| `packages/react/src/index.ts` | 型・定数の再エクスポート |
| `apps/web/src/config.ts` | `initialBrush: ROUND_PEN` 追加 |
| `apps/web/src/components/SidebarPanel.tsx` | BrushPanel 統合 |
| `apps/web/src/components/DebugPanel.tsx` | Brush Dynamics フォルダ追加 |
| `apps/web/src/App.tsx` | brush props 接続 |

### プリセットブラシ

`packages/engine/src/types.ts` にエクスポートされた定数。`@headless-paint/react` からも再エクスポート。

| 定数 | チップ | 特徴 |
|------|--------|------|
| `ROUND_PEN` | — | 従来の circle+trapezoid 方式（デフォルト） |
| `AIRBRUSH` | circle, hardness=0.0 | 密間隔（0.05）・低フロー（0.1）。ソフトな噴射効果 |
| `PENCIL` | circle, hardness=0.95 | spacing=0.1、sizeJitter=0.05、scatter=0.02 |
| `MARKER` | circle, hardness=0.7 | spacing=0.15、flow=0.8。マーカー的な塗り |

### デモ UI

- **BrushPanel**: サイドバーの Minimap〜Layers 間に AccordionPanel で配置。2x2 グリッドのボタンでプリセットを選択。アクティブブラシは青ハイライト
- **DebugPanel**: Pen Settings の下に "Brush Dynamics" フォルダ。stamp ブラシ選択時のみ表示。spacing / flow / opacityJitter / sizeJitter / rotationJitter / scatter のスライダーで微調整可能
- **データフロー**: `penSettings.setBrush()` → `strokeStyle.brush` → 既存パイプラインで自動伝播。App.tsx への変更は props 追加のみ

### 検証結果

- `pnpm build` — 全パッケージビルド成功
- `pnpm test` — 261 tests 全パス（新規 24 tests 含む）
- `pnpm lint` — エラーなし
- デモアプリで round-pen / airbrush / pencil / marker の切り替え・描画動作を確認

## 実装時の調整内容（補足）

- **PoC → 本実装での型配置変更**: PoC では `brush.ts` に型定義を置いたが循環依存が発生。本実装では型は `types.ts` に集約し、`brush.ts` を `brush-render.ts` + `brush-tip.ts` に分割
- **accumulatedDistance**: PoC で検証した accumulatedDistance による committed/pending 境界対応をそのまま採用。`BrushRenderState` として incremental-render の引数・戻り値に組み込み
- **`appendToCommittedLayer` / `renderPendingLayer`**: 戻り値を `void` → `BrushRenderState` に変更

## ペンディング事項

### P0: スタンプブラシ incremental vs replay のスタンプ配置差異（高優先度）

**症状**: スタンプブラシ（特に Star scatter）で長いストロークを描いた後 Undo すると、残るストロークのスタンプ散布位置が微妙に変わる。2回目以降の Undo/Redo では安定する。つまり初回の incremental 描画と replay 描画で結果が異なる。

**根本原因**: Catmull-Rom 補間のチャンク境界クランプ。

incremental 描画はストロークを複数チャンクに分割し、overlap 付きで逐次描画する。各チャンク末尾では Catmull-Rom の p3 制御点がクランプされる（未来の点がまだ来ていないため最後の点を繰り返す）。一方 replay は全点を一括で補間するため正確な制御点を使う。この差により補間曲線が微小に異なり、accumulated distance が乖離する。

**定量データ（デバッグログで計測済み）**:

| ストローク長 | incremental stamps | replay stamps | dist 差 | spacingPx |
|---|---|---|---|---|
| ~1679px（短） | 175 | 175 | 1.13px | 9.6 |
| ~3381px（長） | 352 | 353 | 4.88px | 9.6 |

短いストロークでは stampCount 一致、長いストローク（~3000px+）では距離誤差が spacingPx を超え stampCount が1つズレる。stampCount が異なると stamp index ベースの PRNG シードもズレ、以降のスタンプ全ての jitter が異なる。

**これまでの修正済み事項**:
1. ~~overlap 区間の距離二重カウント~~ → `interpolateStrokePoints(points, overlapCount)` で round-pen と同じパターンに統一
2. ~~distance ベース PRNG~~ → `hashSeed(seed, stampIndex)` に変更。stampCount 一致時は jitter 完全一致
3. `BrushRenderState` に `stampCount` フィールド追加

**推奨修正アプローチ: ストローク完了時にレイヤーを replay で再構築**

incremental 描画は近似であり Catmull-Rom の差異は構造的に避けられない。そのため、スタンプブラシのストローク完了時に committed layer を replay で上書きする。

```
onStrokeComplete → pushCommand → rebuildLayerFromHistory (stamp ブラシのみ)
```

**実装箇所**: `packages/react/src/usePaintEngine.ts` の `onStrokeComplete` コールバック（L161-186）

```typescript
// pushCommand の後に追加（stamp ブラシのみ）
if (data.strokeStyle.brush.type === "stamp") {
  // setHistoryState の後で最新 historyState を使って rebuild
  // setState updater 内で行うか、useEffect で行うか要検討
  rebuildLayerFromHistory(currentEntry.committedLayer, newState, registryRef.current);
  bumpRenderVersion();
}
```

**注意点**:
- `setHistoryState` は functional updater を使っているため、updater 内で `rebuildLayerFromHistory` を呼ぶことで最新の historyState を確実に参照できる
- `rebuildLayerFromHistory` は checkpoint を活用するため、大量ストロークでも効率的
- round-pen は影響なし（PRNG 不使用・曲線差異は視認不能レベル）
- rebuild のコストはストローク完了時の一回限り（描画中のリアルタイム性に影響なし）

**デバッグログの削除**: `brush-render.ts:181-184` の `console.log` を削除すること

**関連ドキュメント更新**: `BrushRenderState.stampCount` の追加に対して以下のドキュメントを更新済み:
- `packages/engine/docs/types.md` — BrushRenderState 型定義、設計意図、使用例
- `packages/engine/docs/brush-api.md` — overlapCount の stamp 説明、BrushRenderState リテラル、hashSeed の説明
- `packages/engine/docs/incremental-render-api.md` — BrushRenderState 戻り値
- `packages/engine/docs/README.md` — BrushRenderState サマリ

**テスト**: `brush-render.test.ts` に追加済みの "incremental（overlap 付き）と replay で stampCount が一致する" テスト（262 tests 全パス）は現状維持。rebuild 導入後は、ストローク完了時にレイヤー内容が replay と一致することを確認する E2E 的なテストがあると理想的。

### Phase 3-3 でスキップ・簡略化した項目

| # | 項目 | 説明 | 優先度 |
|---|------|------|--------|
| P1 | **PASTEL プリセット定数** | `ImageTipConfig` (`imageId: "pastel-grain"`) を使用するため、image tip 基盤（P2）が前提。circle tip のプリセット（AIRBRUSH, PENCIL, MARKER）のみ実装済み | 中 |
| P2 | **Image tip アセット・読み込み機構** | テクスチャ画像ファイルの作成・バンドル、およびデモアプリでの画像読み込み→ `BrushTipRegistry` への登録フローが未実装。`createBrushTipRegistry()` API は存在するがデモ内で未使用。PASTEL のような乾燥メディア風ブラシには grain テクスチャ画像が必要 | 中 |
| P3 | **BrushPanel のチップ視覚プレビュー** | 現在はテキストラベル（"Pen", "Airbrush" 等）のみ。各ブラシの `generateBrushTip()` 結果を小さな canvas でプレビュー表示すると直感性が向上する | 低 |
| P4 | **Tip hardness の UI 調整** | DebugPanel に dynamics パラメータ（spacing, flow, jitter 等）は追加したが、tip の `hardness` を調整するスライダーがない。プリセット選択→dynamics 微調整のフローでは tip 形状（エッジの柔らかさ）の調整ができない | 低 |
| P5 | **カスタムブラシの保持** | DebugPanel で dynamics を調整した後にプリセットを切り替えると調整値がリセットされる。「カスタム」ブラシスロットやプリセットの上書き保存機能がない | 低 |
| P6 | **動的 spacing（筆圧連動）** | 現在は `baseLineWidth * spacing` の定数 spacing。筆圧で太さが大きく変わる場合（筆圧高→太い部分）でスタンプ密度が低く見える課題がある。`calculateRadius() * 2 * spacing` でセグメントごとに計算する動的 spacing は未実装。ただし蓄積が非線形になるため、距離ベース PRNG シードとの整合性に注意が必要 | 低 |

依存関係: P1 は P2 が前提。P3〜P6 は独立。P0 は全てと独立。

### ドキュメント整合性チェック（残存）

| ドキュメント | 確認ポイント |
|---|---|
| `packages/engine/docs/draw-api.md` | `drawVariableWidthPath` の引数が旧 StrokeStyle の optional フィールド（`pressureCurve?`, `compositeOperation?`）を個別に受け取っている。StrokeStyle 全 required 化に伴い、引数の説明やデフォルト値の記述が整合しているか |
| `packages/engine/docs/render-api.md` | `renderLayers` が `LayerMeta.compositeOperation?` を参照する。今回 LayerMeta はスコープ外だが、StrokeStyle の `compositeOperation` が required になった影響で説明の整合性が取れているか |
| `packages/engine/docs/types.md` | `LayerMeta.compositeOperation?` は今回変更しない。将来的に required 化するか判断が必要 |
| `packages/stroke/docs/README.md` | StrokeCommand のフィールドリストが存在する場合、`style: StrokeStyle` 集約に合わせて更新されているか |
| `packages/input/docs/` | FilterPipeline 関連は今回影響なし。ただし StrokeCommand の構造変更が input パッケージのドキュメントに波及していないか念のため確認 |
