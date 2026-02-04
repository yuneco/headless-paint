# ストローク補正（スムージング）機能 + アーキテクチャ再設計

## 背景と課題

### きっかけ

ストローク補正（スムージング）機能を追加しようとした際、現在のアーキテクチャでは対応が困難であることが判明した。

### 発見した課題

1. **expandとfilterの本質的な違い**
   - expand（対称変換）: 1点→N点、即時確定、ステートレス
   - filter（スムージング）: N点→M点、遅延確定、ステートフル
   - 現在のパイプラインはexpand専用設計であり、filterを同列に扱えない

2. **pending点の描画問題**
   - スムージングでは直近の数点が「未確定」（後から座標が変わる）
   - 未確定点を描画しないと、ペン位置より手前までしか線が出ず「もっさり」する
   - 未確定点は座標変更時に再描画が必要 → 追加描画だけでは対応不可

3. **expandをinput層でやる複雑さ**
   - 1つの入力が複数ストロークに展開される
   - 各ストロークの確定/未確定を個別管理する必要がある
   - セッション管理が不必要に複雑化する

4. **historyパッケージの位置付け**
   - ストロークセッションと履歴は密接に関連（セッション終了→履歴追加）
   - 別パッケージにする必然性が薄い

### 根本原因

- **expandの適用タイミングが早すぎる**: 入力時ではなく描画時に適用すべき
- **責務の分離が不適切**: 入力処理・セッション管理・描画処理の境界が曖昧

---

## 目指す状態

### アーキテクチャ目標

1. **ストローク管理は常に1本**
   - expandは描画時に適用するので、セッション管理では1本のストロークのみ扱う
   - 一般的なペイントアプリと同じシンプルな構造

2. **確定/未確定の明確な分離**
   - committed: 座標確定済み、確定レイヤーに永続描画
   - pending: 座標変更の可能性あり、作業レイヤーに毎回再描画
   - 将来の直線ツール・ベジェツールでも同じモデルが適用可能

3. **入力と描画の責務分離**
   - input: ブラウザ/デバイス/DOMの都合を閉じ込める。座標のフィルタ処理
   - engine: 描画処理。expandの適用（描画時展開）
   - stroke: 両者を繋ぐセッション管理と履歴管理

4. **遅延のない描画体験**
   - 入力からpending描画までの遅延がない
   - ユーザーのペン位置に追従した線が即座に表示される

### ユーザー体験目標

- スムージングON/OFFで滑らかさの違いが体感できる
- 対称変換と組み合わせても遅延なく描画される
- Undo/Redoが正しく動作する

---

## アプローチ

### コアアイデア: expandの描画時適用

```
【現在】入力点 → expand → 複数ストローク → 描画
                 ↑ ここで展開するから複雑

【目指す】入力点 → filter → 1ストローク → 描画時にexpand
                                          ↑ ここで展開
```

WebGLで言う「頂点シェーダー」と「フラグメントシェーダー」の関係：
- filter: 入力点の前処理（頂点シェーダー的）
- expand: 描画時の展開（描画パイプライン内で処理）

### 二層構造

```
入力 (x, y)
    ↓
[Filter層 - input] スムージング等
    → { committed, pending } (1本のストローク)
    ↓
[セッション層 - stroke] 進捗管理、差分計算
    → RenderUpdate { newlyCommitted, currentPending }
    ↓
[描画層 - engine] expand適用 → 描画
    - 確定レイヤー: 追加描画
    - 作業レイヤー: クリア→再描画→合成
```

---

## 達成基準

### アーキテクチャ視点（リード判断用）

| 基準 | 判断方法 |
|------|---------|
| **input層の独立性** | input がengine/strokeに依存していないこと。ブラウザ/デバイスの都合がinput以外に漏れていないこと |
| **1ストローク原則** | strokeパッケージのセッション管理が複数ストロークを扱っていないこと |
| **expand遅延適用** | expandがengineの描画関数内で初めて適用されていること |
| **pending即時描画** | 入力イベントからpending描画までのパスに不要な遅延がないこと |
| **確定/未確定分離** | committed/pendingが型レベルで区別され、描画処理が分かれていること |
| **設計原則遵守** | プラグインパターン、配列処理、ドキュメントファーストが守られていること |

### 機能視点（実装者確認用）

- [ ] スムージングON/OFFで描画の滑らかさが変わる
- [ ] 対称変換との組み合わせで正しく動作する
- [ ] Undo/Redoが正しく動作する
- [ ] pending点が遅延なく表示される

### コード品質視点

- [ ] 各パッケージのユニットテストが通る
- [ ] 型チェックが通る
- [ ] 新しいフィルタ追加時にplugins/へのファイル追加+登録のみで対応可能

---

## 前提

- `plans/2026-02-03-23-30_smoothing-filter.md` の計画は破棄
- 新しいアーキテクチャで再設計

---

## 設計方針

### パッケージ構成と責務

| パッケージ | 責務 | やってはいけないこと |
|-----------|------|---------------------|
| input | ブラウザ/デバイス/DOMの境界、filter処理 | 描画処理、履歴操作、expand処理 |
| stroke | セッション管理、進捗管理、履歴管理 | 直接の描画（engineに委譲）、入力デバイス処理 |
| engine | 描画処理、expand適用、レイヤー操作 | 入力処理、履歴管理 |
| app | UI・状態管理 | ビジネスロジックの詳細実装 |

```
input（残す）
  - ブラウザ/デバイス/DOMの都合を閉じ込める境界
  - filter処理のみ（スムージング等）
  - expand処理は削除
  - 出力: { committed, pending } (1本のストローク)
  - 残す機能: transform.ts, coordinate.ts, sampling.ts（DOM/デバイス関連）

stroke（新規、historyを吸収）
  - セッション管理（1本のストロークのみ）
  - 進捗管理（lastRenderedCommitIndex）
  - 履歴管理（undo/redo）
  - StrokeCommand生成

engine（拡張）
  - 描画処理
  - expand適用（描画時に、確定/pending両方）
  - 差分描画API
  - レイヤー合成

history（削除）
  - strokeに統合
```

### データフロー

```
入力 (x, y)
    ↓
input: filter処理（スムージング）
    → { committed: Point[], pending: Point[] }
    ↓
stroke: セッション管理
    - 前回からの差分計算
    → RenderUpdate { newlyCommitted, currentPending, style, expand }
    ↓
engine: 描画
    - expand適用（確定/pending両方）
    - 確定レイヤー: newlyCommittedを追加描画
    - 作業レイヤー: currentPendingをクリア→再描画
    - 合成（2回のCanvas to Canvas転写）
```

### 設定の分離

- **FilterConfig**: スムージング等（input層）
- **ExpandConfig**: 対称変換等（engine層で描画時に適用）

### expandの位置付け

- WebGLで言う「頂点シェーダー」と「フラグメントシェーダー」の関係
- filterは入力点の処理（N点→M点）
- expandは描画時の展開（1点→K点、行列変換）
- 両者は根本的に異なる処理モデル

### パッケージ依存関係

```
engine（依存なし）
  - 独自の Point, Color, Layer
  - expand処理、描画処理

input（依存なし）
  - 独自の Point
  - filter処理

stroke（input, engine に依存）
  - InputPoint は input から
  - ExpandConfig, Layer, Color は engine から

app（全てに依存）
```

### 汎用型の扱い

- `Point`, `Color` 等の汎用型は**各パッケージで独自に定義**
- パッケージ間でimport/exportしない
- 型ミスマッチはコンパイラが検知、ランタイムには影響なし
- 将来、同様のものが増えたら共通パッケージを再検討

---

## 設計原則（曲げてはならない）

1. **パイプラインは変換の詳細を知らない**
   - 各変換がインターフェースを実装
   - filter-pipeline.ts は変換タイプごとの分岐を持たない
   - 全て `getFilterPlugin()` 経由でプラグインに委譲

2. **配列は配列として処理する**
   - `filters` 配列を順番にループで処理
   - 中身が1つでもループで処理
   - 「1つしかないから特別扱い」は禁止

3. **プラグインパターン**
   - 新しいフィルタ追加時は `plugins/` にファイル追加 + レジストリ登録のみ
   - filter-pipeline.ts の変更不要

4. **「今動くから最低限で良い」はNG**
   - 必要な仕組みは最初から明確に作る
   - 将来の拡張性を「後で対応」は技術的負債の言い訳

5. **ドキュメントファースト**
   - 実装はドキュメントをコードに落とすだけ
   - ドキュメントなしにコードを書かない

---

## 実装手順

### Phase 0: ドキュメント更新（設計の確定）

**読むべきドキュメント:**

| ドキュメント | 確認する点 |
|------------|-----------|
| `packages/engine/docs/README.md` | 現在のAPI、拡張ポイント |
| `packages/engine/docs/layer-api.md` | レイヤー操作の仕様 |
| `packages/engine/docs/draw-api.md` | 描画関数の仕様 |
| `packages/input/docs/README.md` | 現在のAPI、変更箇所の特定 |
| `packages/input/docs/types.md` | 現在の型定義 |
| `packages/input/docs/pipeline-api.md` | 現在のパイプライン仕様（削除対象） |
| `packages/history/docs/README.md` | 移行対象の機能確認 |
| `packages/history/docs/types.md` | 移行対象の型定義 |

**書くべきドキュメント:**

| ドキュメント | 内容 |
|------------|------|
| `packages/engine/docs/README.md` | 更新: expand, incremental-render 追加を反映 |
| `packages/engine/docs/types.md` | 更新: ExpandConfig, ExpandMode, CompiledExpand 追加 |
| `packages/engine/docs/expand-api.md` | 新規: compileExpand, expandPoint, expandStroke |
| `packages/engine/docs/incremental-render-api.md` | 新規: 差分描画API、レイヤー合成 |
| `packages/input/docs/README.md` | 更新: filter-pipeline 追加、expand関連削除を反映 |
| `packages/input/docs/types.md` | 更新: InputPoint, FilterPlugin, FilterState, FilterResult, FilterPipelineConfig 追加、expand関連削除 |
| `packages/input/docs/filter-pipeline-api.md` | 新規: compileFilterPipeline, processPoint, finalizePipeline |
| `packages/stroke/docs/README.md` | 新規: パッケージ概要、責務 |
| `packages/stroke/docs/types.md` | 新規: StrokeSessionState, RenderUpdate, StrokeCommand, HistoryState（ExpandConfigはengineからimport） |
| `packages/stroke/docs/session-api.md` | 新規: startStrokeSession, addPointToSession, endStrokeSession |
| `packages/stroke/docs/history-api.md` | 新規: createHistoryState, pushCommand, undo, redo |

**注意: ExpandConfig は engine で定義し、stroke は engine から import する**

**セルフレビュー（Phase 0完了時）:**
- [x] 提供されるAPI体系で課題（スムージング、pending描画、expand）が解決できること
- [x] パッケージの責務とアーキテクチャ原則に反していないこと
- [x] クライアント（App.tsx）から見た仕様と利用方法が明確であること
- [x] 型定義が一貫していること（パッケージ間の境界が明確）

**Phase 0 完了: 2026-02-04**

### Phase 1: engine パッケージ拡張

1. `src/types.ts` - 型定義追加
   - `ExpandMode`, `ExpandConfig`, `CompiledExpand`

2. `src/expand.ts` - expand処理（inputから移動）
   - `compileExpand(config): CompiledExpand`
   - `expandPoint(point, compiled): Point[]`
   - `expandStroke(points, compiled): Point[][]`

3. `src/incremental-render.ts` - 差分描画API
   - `appendToCommittedLayer()` - 確定レイヤーへの追加描画
   - `renderPendingLayer()` - 作業レイヤーの再描画
   - `composeLayers()` - レイヤー合成

4. `src/index.ts` - エクスポート追加

5. テストを書いて通す
   - `src/expand.test.ts`
   - `src/incremental-render.test.ts`

6. **セルフレビュー**
   - [ ] engine が input/stroke に依存していないこと
   - [ ] expand関数がドキュメント通りの入出力であること
   - [ ] incremental-render が確定/未確定を正しく分離して扱えること

### Phase 2: input パッケージ再設計

1. `src/types.ts` - 型定義更新
   - `InputPoint` 追加（pressure, timestamp）
   - `FilterPlugin`, `FilterState`, `FilterResult`
   - `FilterPipelineConfig`, `FilterOutput`
   - expand関連を削除

2. `src/filter-pipeline.ts` - フィルタパイプライン（新規）
   - `compileFilterPipeline()`
   - `createFilterPipelineState()`
   - `processPoint()` → `{ state, newlyCommitted }`
   - `finalizePipeline()`
   - `processAllPoints()` - リプレイ用

3. `src/plugins/smoothing-plugin.ts` - スムージング（新規）
   - FilterPlugin実装
   - 移動平均アルゴリズム

4. `src/plugins/index.ts` - プラグインレジストリ更新
   - `getFilterPlugin()`, `registerFilterPlugin()`

5. テストを書いて通す
   - `src/filter-pipeline.test.ts`
   - `src/plugins/smoothing-plugin.test.ts`

6. 削除（テスト通過後）
   - `src/pipeline.ts`
   - `src/pipeline.test.ts`
   - `src/session.ts`
   - `src/symmetry.ts`
   - `src/symmetry.test.ts`
   - `src/plugins/symmetry-plugin.ts`
   - `docs/pipeline-api.md`

7. `src/index.ts` - エクスポート更新

8. **セルフレビュー**
   - [ ] input が engine/stroke に依存していないこと
   - [ ] FilterPlugin インターフェースでプラグインパターンが実現できていること
   - [ ] filter-pipeline.ts にフィルタタイプ固有の分岐がないこと
   - [ ] processPoint が committed/pending を正しく分離して返すこと

### Phase 3: stroke パッケージ作成

1. パッケージ初期化
   - `package.json`, `tsconfig.json`, `vite.config.ts`
   - peerDependencies: `@headless-paint/input`, `@headless-paint/engine`

2. `src/types.ts`
   - `StrokeSessionState`, `RenderUpdate`
   - `StrokeCommand`
   - `HistoryState`, `Checkpoint`, `HistoryConfig`
   - ※ExpandConfig は `@headless-paint/engine` から import

3. `src/session.ts` - セッション管理
   - `startStrokeSession()`
   - `addPointToSession()` → `{ state, renderUpdate }`
   - `endStrokeSession()` → `StrokeCommand`

4. `src/history.ts` - 履歴管理（historyから移動）
   - `createHistoryState()`, `pushCommand()`
   - `undo()`, `redo()`, `canUndo()`, `canRedo()`

5. `src/checkpoint.ts` - チェックポイント（historyから移動）

6. `src/replay.ts` - リプレイ（historyから移動、engine連携）
   - `applyCommand()` - engineのexpandを使用
   - `rebuildLayerState()`

7. `src/index.ts` - エクスポート

8. テストを書いて通す
   - `src/session.test.ts`
   - `src/history.test.ts`（既存テストを移動・更新）
   - `src/replay.test.ts`（既存テストを移動・更新）

9. **セルフレビュー**
   - [ ] session.ts が `Point[][]` ではなく `Point[]` を扱っていること（1ストローク原則）
   - [ ] RenderUpdate に newlyCommitted/currentPending が分離されていること
   - [ ] replay.ts が engine の expand を使用していること
   - [ ] ExpandConfig は engine から import していること

### Phase 4: 統合・クリーンアップ

1. `packages/history/` を完全削除
   - src/, docs/, package.json, 全て

2. `apps/web/package.json` 依存関係更新
   - `@headless-paint/history` 削除
   - `@headless-paint/stroke` 追加

3. `apps/web/src/App.tsx` 更新
   - インポート変更（history → stroke）
   - 作業レイヤー導入（committedLayer, pendingLayer）
   - 新API対応（FilterPipelineConfig, ExpandConfig分離）

4. 手動テストで動作確認
   - スムージングON/OFFで描画の滑らかさを確認
   - 対称変換との組み合わせ
   - Undo/Redoが正しく動作
   - pending点が正しく表示される（遅延なし）

5. 旧ドキュメントの削除
   - `packages/input/docs/pipeline-api.md`（Phase 2で削除済みを確認）

6. **セルフレビュー（最終確認）**

   **アーキテクチャ視点:**
   - [ ] input/package.json の dependencies に engine/stroke がないこと
   - [ ] expand関数の呼び出しが engine/ 内のみであること
   - [ ] App.tsx の onStrokeMove から pending 描画までのパスに不要な遅延がないこと

   **機能視点:**
   - [ ] スムージングON/OFFで描画の滑らかさが変わること
   - [ ] 対称変換との組み合わせで正しく動作すること
   - [ ] Undo/Redoが正しく動作すること
   - [ ] pending点が遅延なく表示されること

   **コード品質視点:**
   - [ ] 全パッケージのユニットテストが通ること
   - [ ] 型チェックが通ること
   - [ ] 新しいフィルタ追加時に plugins/ へのファイル追加+登録のみで対応可能なこと

---

## 主要な型定義

```typescript
// input: フィルタ出力
interface FilterOutput {
  committed: InputPoint[];  // 確定済み
  pending: InputPoint[];    // 未確定（座標変更の可能性あり）
}

// stroke: 描画更新
interface RenderUpdate {
  newlyCommitted: Point[];   // 今回新たに確定した点
  currentPending: Point[];   // 現在のpending全体
  style: StrokeStyle;
  expand: ExpandConfig;
}

// stroke: コマンド
interface StrokeCommand {
  type: "stroke";
  inputPoints: InputPoint[];
  filterPipeline: FilterPipelineConfig;
  expand: ExpandConfig;
  color: Color;
  lineWidth: number;
  timestamp: number;
}
```

---

## ファイル変更一覧

### 新規作成

| ファイル | 説明 |
|---------|------|
| `packages/engine/docs/expand-api.md` | expand API仕様 |
| `packages/engine/docs/incremental-render-api.md` | 差分描画API仕様 |
| `packages/engine/src/expand.ts` | expand処理 |
| `packages/engine/src/expand.test.ts` | テスト |
| `packages/engine/src/incremental-render.ts` | 差分描画API |
| `packages/engine/src/incremental-render.test.ts` | テスト |
| `packages/input/docs/filter-pipeline-api.md` | フィルタパイプライン仕様 |
| `packages/input/src/filter-pipeline.ts` | フィルタパイプライン |
| `packages/input/src/filter-pipeline.test.ts` | テスト |
| `packages/input/src/plugins/smoothing-plugin.ts` | スムージング |
| `packages/input/src/plugins/smoothing-plugin.test.ts` | テスト |
| `packages/stroke/*` | 新パッケージ全体 |

### 変更

| ファイル | 変更内容 |
|---------|---------|
| `packages/engine/src/index.ts` | expand, incremental-render エクスポート追加 |
| `packages/input/docs/types.md` | InputPoint, FilterPlugin等追加、expand関連削除 |
| `packages/input/src/types.ts` | 同上 |
| `packages/input/src/plugins/index.ts` | FilterPlugin登録追加、TransformPlugin削除 |
| `packages/input/src/index.ts` | FilterPipelineエクスポート、旧API削除 |
| `apps/web/src/App.tsx` | 新API対応、作業レイヤー導入 |
| `apps/web/package.json` | 依存パッケージ変更 |

### 削除

| ファイル | 理由 |
|---------|------|
| `packages/input/src/pipeline.ts` | filter-pipelineに置き換え |
| `packages/input/src/pipeline.test.ts` | 同上 |
| `packages/input/src/session.ts` | strokeへ移動 |
| `packages/input/src/symmetry.ts` | engineへ移動 |
| `packages/input/src/symmetry.test.ts` | 同上 |
| `packages/input/src/plugins/symmetry-plugin.ts` | engineへ移動 |
| `packages/input/docs/pipeline-api.md` | filter-pipeline-api.mdに置き換え |
| `packages/history/` | strokeに統合 |

---

## 検証方法

### 各Phase完了時

1. **ユニットテスト**: `pnpm test`
2. **型チェック**: `pnpm typecheck`

### Phase 4完了時（統合検証）

**機能検証（手動テスト）:**
- スムージングON/OFFで描画の滑らかさを確認
- 対称変換との組み合わせ
- Undo/Redoが正しく動作
- pending点が正しく表示される（遅延なし）

**アーキテクチャ検証（コードレビュー）:**

| 基準 | 確認箇所 |
|------|---------|
| input層の独立性 | input/package.json の dependencies に engine/stroke がないこと |
| 1ストローク原則 | stroke/session.ts が `Point[][]` ではなく `Point[]` を扱っていること |
| expand遅延適用 | expand関数の呼び出しが engine/ 内のみであること |
| pending即時描画 | App.tsx の onStrokeMove から pending 描画までのパスを確認 |
| 確定/未確定分離 | RenderUpdate 型に newlyCommitted/currentPending が分離されていること |
| 設計原則遵守 | filter-pipeline.ts にフィルタタイプ固有の分岐がないこと |
