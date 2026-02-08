# ストローク補正（スムージング）機能 実装計画

> **⚠️ この計画は破棄されました**
>
> 検討の結果、expandの適用タイミングやパッケージ構成に根本的な問題があることが判明したため、アーキテクチャを再設計しました。
>
> 後続の計画: [plans/2026-02-04-00-30_smoothing-and-architecture.md](./2026-02-04-00-30_smoothing-and-architecture.md)

---

## 背景

`plans/2026-02-02-22-00_stroke-pipeline.md` の実装が完了し、パイプラインシステムが動作している。
次のステップとして、ストローク補正（スムージング）を追加する。

### 設計思想（継承すべき）

- 変換の種類が増えてもアプリ層のコードは変わらない
- パイプラインは変換の詳細を知らない
- 配列は配列として処理する
- 「今動くから最低限で良い」はNG

---

## 問題分析

### 展開（expand）とフィルタ（filter）の本質的な違い

| 特性 | 展開（対称など） | フィルタ（スムージングなど） |
|-----|-----------------|---------------------------|
| 入出力 | 1点 → N点 | N点 → M点（M ≤ N） |
| 状態 | ステートレス | **ステートフル**（過去点参照） |
| 確定性 | 即時確定 | **遅延確定**（後の点で変わる） |
| 処理単位 | 点ごと独立 | ストローク全体 |

現在の `expand(points, compiled): Point[]` は展開専用であり、フィルタには対応できない。

### 将来の拡張も同様の問題を持つ

- **筆圧対応**: Point型の拡張（pressure, timestamp）+ 筆圧正規化フィルタ
- **直線モード**: 始点と終点のみを使用（中間点は無視）

---

## 設計方針

### 二層パイプラインの導入

```
入力点 → [Filter層] → 確定点 → [Expand層] → 出力
         (N点→M点)              (1点→K点)
```

```typescript
interface PipelineConfig {
  readonly filters: readonly FilterConfig[];  // スムージング、筆圧正規化等
  readonly expands: readonly ExpandConfig[];  // 対称変換等
}
```

**選択理由:**
- フィルタと展開は処理モデルが根本的に異なる
- 暗黙的な並べ替えより、明示的な分離が設計として正直
- 配列にすることで「筆圧正規化 → スムージング」のような直列処理が可能
- 後方互換性は不要（APIは変更可）

### FilterPlugin インターフェース

```typescript
interface FilterPlugin<TConfig, TCompiled> {
  readonly type: string;
  readonly kind: "filter";

  compile(config: TConfig): TCompiled;
  createState(compiled: TCompiled): FilterState;
  process(state: FilterState, point: InputPoint, compiled: TCompiled): FilterResult;
  finalize(state: FilterState, compiled: TCompiled): FilterResult;
  processAll(points: readonly InputPoint[], compiled: TCompiled): InputPoint[];
}

interface FilterState {
  readonly committed: readonly InputPoint[];  // 確定済み
  readonly pending: readonly InputPoint[];    // 未確定
  readonly internal: unknown;                 // プラグイン固有
}

interface FilterResult {
  readonly state: FilterState;
  readonly newlyCommitted: readonly InputPoint[];
}
```

### ExpandPlugin インターフェース（既存の TransformPlugin をリネーム）

```typescript
interface ExpandPlugin<TConfig, TCompiled> {
  readonly type: string;
  readonly kind: "expand";

  compile(config: TConfig): TCompiled;
  expand(points: readonly Point[], compiled: TCompiled): Point[];
  getOutputCount(config: TConfig): number;
}
```

### InputPoint 型（Point の拡張）

```typescript
interface InputPoint extends Point {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;    // 0.0 - 1.0
  readonly timestamp?: number;   // ms
}
```

---

## 原則

### 設計の基本理念（曲げてはならない）

1. **パイプラインは変換の詳細を知らない**
   - 各変換がインターフェースを実装
   - pipeline.ts は変換タイプごとの分岐を持たない
   - 全て `getPlugin()` 経由でプラグインに委譲

2. **配列は配列として処理する**
   - `filters` / `expands` 配列を順番に直列適用
   - 中身が1つでもループで処理
   - 「1つしかないから特別扱い」は禁止

3. **プラグインパターン**
   - 新しい変換追加時は `plugins/` にファイル追加 + レジストリ登録のみ
   - pipeline.ts の変更不要

4. **「今動くから最低限で良い」はNG**
   - 必要な仕組みは最初から明確に作る
   - 将来の拡張性を「後で対応」は技術的負債の言い訳

### パッケージ責務

| パッケージ | 責務 | やってはいけないこと |
|-----------|------|---------------------|
| input | 入力処理・変換 | 描画処理、履歴操作 |
| history | 履歴管理・リプレイ | 直接の描画（engineに委譲） |
| engine | 描画処理 | 入力処理、履歴管理 |
| app | UI・状態管理 | ビジネスロジックの詳細実装 |

---

## 実装戦略

**ドキュメントファースト。実装はドキュメントをコードに落とすだけ。**

### Step 1: ドキュメント更新（設計の確定）

**読むべきドキュメント:**

| ドキュメント | 確認する点 |
|------------|-----------|
| [packages/input/docs/pipeline-api.md](packages/input/docs/pipeline-api.md) | 現在のAPI仕様、変更箇所の特定 |
| [packages/input/docs/types.md](packages/input/docs/types.md) | 現在の型定義、追加・変更する型 |
| [packages/input/docs/README.md](packages/input/docs/README.md) | パッケージ概要、エクスポート一覧 |
| [packages/history/docs/types.md](packages/history/docs/types.md) | StrokeCommand、PipelineConfigの参照 |
| [packages/history/docs/command-api.md](packages/history/docs/command-api.md) | createStrokeCommand の仕様 |
| [plans/2026-02-02-22-00_stroke-pipeline.md](plans/2026-02-02-22-00_stroke-pipeline.md) | 設計原則、教訓の参照 |

**書くべきドキュメント:**

| ドキュメント | 更新内容 |
|------------|---------|
| `packages/input/docs/types.md` | InputPoint, FilterPlugin, ExpandPlugin, FilterConfig, ExpandConfig, 新PipelineConfig |
| `packages/input/docs/pipeline-api.md` | 二層パイプライン（filters → expands）、セッションAPI変更 |
| `packages/history/docs/types.md` | PipelineConfig の変更（transforms → filters/expands） |

**セルフレビュー:**
- 更新後のドキュメント全体を確認
- 提供されるAPI体系で課題が解決できること
- パッケージの責務とアーキテクチャ原則に反していないこと
- クライアントから見た仕様と利用方法が明確であること

### Step 2: inputパッケージ実装

1. `types.ts` - 新型定義（ドキュメント通り）
2. `plugins/symmetry-plugin.ts` - `kind: "expand"` 追加、型名変更
3. `plugins/smoothing-plugin.ts` - **新規** FilterPlugin実装
4. `plugins/index.ts` - プラグイン登録更新
5. `pipeline.ts` - 二層パイプライン
6. `session.ts` - フィルタ状態管理
7. `index.ts` - エクスポート更新
8. テストを書いて通す

### Step 3: historyパッケージ実装

1. `types.ts` - PipelineConfig の型変更（input からインポート）
2. `replay.ts` - 新PipelineConfig対応
3. テストを書いて通す

### Step 4: App修正

1. `apps/web/src/App.tsx` - 新API対応
2. 手動テストで動作確認

### Step 5: クリーンアップ

1. 旧APIの残骸を削除
2. ドキュメントから移行関連記述を削除（新APIが「あるべき姿」として記載）

---

## スムージングアルゴリズム（初期実装）

### 移動平均（Moving Average）

```typescript
interface SmoothingConfig {
  readonly algorithm: "movingAverage";  // 将来: "exponential" | "oneEuro" 等
  readonly windowSize: number;          // 参照する過去点数（デフォルト: 5）
  readonly strength: number;            // 強度 0.0 - 1.0（デフォルト: 0.5）
  readonly maxPending: number;          // 未確定点の最大数（デフォルト: 3）
}
```

**処理フロー:**
1. 新しい点を `pending` に追加
2. `pending.length > maxPending` なら先頭を確定
3. 確定時に `committed` の直近 `windowSize` 点と重み付き平均
4. `strength` で元座標との補間

**遡及変更の扱い:**
- 直近 `maxPending` 点は未確定として保持
- これより古い点は確定済み（変更不可）
- 描画側で確定/未確定を分けて処理（将来の最適化）

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `packages/input/src/types.ts` | InputPoint, FilterPlugin, ExpandPlugin, PipelineConfig変更 |
| `packages/input/src/pipeline.ts` | 二層パイプライン（filters → expands） |
| `packages/input/src/session.ts` | フィルタ状態管理追加 |
| `packages/input/src/plugins/symmetry-plugin.ts` | `kind: "expand"` 追加、型名変更 |
| `packages/input/src/plugins/smoothing-plugin.ts` | **新規** |
| `packages/input/src/plugins/index.ts` | プラグイン登録更新 |
| `packages/input/src/index.ts` | エクスポート更新 |
| `packages/input/docs/types.md` | 型定義を更新 |
| `packages/input/docs/pipeline-api.md` | 二層パイプラインの説明に更新 |
| `packages/history/src/replay.ts` | 新PipelineConfig対応 |
| `apps/web/src/App.tsx` | 新API対応 |

---

## 検証方法

1. **ユニットテスト**: `pnpm --filter @headless-paint/input test`
2. **手動テスト**:
   - スムージングON/OFFで描画の滑らかさを確認
   - 対称変換と組み合わせて動作確認
   - Undo/Redoが正しく動作することを確認

---

## 将来の拡張ポイント

- **アルゴリズム追加**: `algorithm: "exponential" | "oneEuro"` 等
- **描画最適化**: 確定/未確定の分離描画（一時レイヤー使用）
- **筆圧対応**: `InputPoint.pressure` の活用
- **直線モード**: `FilterPlugin` として実装可能
