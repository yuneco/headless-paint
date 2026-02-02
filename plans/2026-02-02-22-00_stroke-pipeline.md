# ストローク変換パイプライン リファクタリング計画

## 背景と課題認識

### ユーザーの課題感

対称ペイントを「特殊な機能」として実装しているが、本質的には：

1. **全てのペイント操作は座標変換のバリエーション**
   - 通常ペイント = 入力→出力で調整がほぼない変換（identity）
   - 対称ペイント = 1入力→N出力の変換
   - パターン描画、ストローク補正なども同様に変換

2. **多段変換パイプライン**
   - 入力 → 補正 → 対称 のように直列適用可能であるべき

3. **変換ごとにコマンド・ファサードを分けるのは不適切**
   - クライアントは変換設定後、描画するだけ
   - 変換の種類が増えてもApp側コードは変わるべきではない

### 現状の問題

**App.tsxの責務過多:**
- `expandSymmetry()` 呼び出し
- `symmetryStrokesRef` で複数ストローク配列を手動管理
- ストロークの有効性チェック（length >= 2）
- BatchCommand生成の分岐ロジック

**履歴の非効率性:**
- 展開後のポイントを保存（対称6分割なら6倍のデータ）
- 変換設定情報が欠落（再計算不可）

---

## 推奨アプローチ: Config-based Pipeline

### 選択理由

| 候補 | 利点 | 欠点 |
|-----|------|------|
| Transformer Chain (OOP) | 直感的 | inputパッケージの設計と不整合 |
| **Config-based Pipeline** | シリアライズ可能、履歴保存に適合 | - |
| Functional Composition | 純粋関数 | 設定のシリアライズが複雑 |

**Config-based Pipelineを選択:**
- `PipelineConfig` はJSONシリアライズ可能 → 履歴に保存可能
- 既存の `SymmetryConfig → CompiledSymmetry` パターンを踏襲
- `compilePipeline()` で事前計算、`expandPoint()` は高速

### 型設計（配列ベース）

```typescript
// 変換設定の Discriminated Union
type TransformConfig =
  | { type: "symmetry"; config: SymmetryConfig }
  | { type: "smoothing"; config: SmoothingConfig }  // 将来
  | { type: "pattern"; config: PatternConfig }      // 将来

// パイプライン設定（配列で順序を指定）
interface PipelineConfig {
  readonly transforms: readonly TransformConfig[]
}

// 使用例
compilePipeline({
  transforms: [
    { type: "smoothing", config: { strength: 0.5 } },
    { type: "symmetry", config: symmetryConfig },
  ]
})

// 通常ペイント（変換なし）
compilePipeline({ transforms: [] })
```

**配列ベースのメリット:**
- 変換の順序を自由に指定可能
- 同種の変換を複数回適用可能
- 新しい変換追加時は Union に型を追加するだけ

### 概念モデル

```
User Input (Point)
       │
       ▼
 ┌─────────────────────────────────────────────────┐
 │     Stroke Pipeline (transforms: [...])          │
 │  ┌─────────┐   ┌─────────┐   ┌─────────┐        │
 │  │ trans[0]│ → │ trans[1]│ → │ trans[2]│ → ...  │
 │  └─────────┘   └─────────┘   └─────────┘        │
 └─────────────────────────────────────────────────┘
       │
       ▼
   Point[][] (展開されたストローク群)
       │
       ▼
   StrokeSession (ストローク管理)
       │
       ▼
   StrokeCommand (履歴保存: 入力ストローク + 設定のみ)
```

---

## 実装計画

### Phase 1: inputパッケージ（コアロジック）

| ファイル | 変更 |
|---------|------|
| [types.ts](packages/input/src/types.ts) | `PipelineConfig`, `CompiledPipeline`, `StrokeSessionState` 型追加 |
| [pipeline.ts](packages/input/src/pipeline.ts) | **新規** - `compilePipeline`, `expandPoint`, `expandStroke` |
| [session.ts](packages/input/src/session.ts) | **新規** - `startStrokeSession`, `addPointToSession`, `endStrokeSession` |
| [index.ts](packages/input/src/index.ts) | エクスポート追加 |
| [pipeline.test.ts](packages/input/src/pipeline.test.ts) | **新規** - ユニットテスト |

**主要API:**
```typescript
// 設定変更時に1回
compilePipeline(config: PipelineConfig): CompiledPipeline

// ストローク中の各点で呼び出し
expandPoint(point: Point, compiled: CompiledPipeline): Point[]

// 履歴リプレイ時
expandStroke(inputPoints: Point[], compiled: CompiledPipeline): Point[][]

// セッション管理
startStrokeSession(point, compiled): StrokeSessionResult
addPointToSession(state, point, compiled): StrokeSessionResult
endStrokeSession(state): { inputPoints, validStrokes, pipelineConfig }
```

### Phase 2: historyパッケージ

| ファイル | 変更 |
|---------|------|
| [types.ts](packages/history/src/types.ts) | `StrokeCommand` 型追加、Command union更新 |
| [command.ts](packages/history/src/command.ts) | `createStrokeCommand` 関数追加 |
| [replay.ts](packages/history/src/replay.ts) | `StrokeCommand` のリプレイ対応 |

**新しいコマンド型:**
```typescript
interface StrokeCommand {
  type: "stroke"
  inputPoints: readonly Point[]    // 変換前の入力（軽量）
  pipeline: PipelineConfig         // { transforms: [...] }
  color: Color
  lineWidth: number
  timestamp: number
}

// 履歴に保存される例
{
  type: "stroke",
  inputPoints: [{ x: 100, y: 100 }, { x: 150, y: 120 }, ...],  // 元の入力のみ
  pipeline: {
    transforms: [{ type: "symmetry", config: { mode: "radial", divisions: 6, ... } }]
  },
  color: { r: 0, g: 0, b: 0, a: 1 },
  lineWidth: 3,
  timestamp: 1706841600000
}
// → リプレイ時に6本のストロークに展開される
```

### Phase 3: App.tsx リファクタリング

**Before（現状）:**
```typescript
// App.tsxが知りすぎている
const symmetryStrokesRef = useRef<Point[][]>([]);
const expandedPoints = expandSymmetry(point, compiledRef.current);
// ... 複雑なストローク管理ロジック
if (validStrokes.length === 1) { ... } else { ... }
```

**After（目標）:**
```typescript
// App.tsxはシンプルに
const compiled = useMemo(() => {
  const transforms: TransformConfig[] = [];
  if (symmetryConfig.mode !== "none") {
    transforms.push({ type: "symmetry", config: symmetryConfig });
  }
  return compilePipeline({ transforms });
}, [symmetryConfig]);

const onStrokeStart = (point) => {
  sessionRef.current = startStrokeSession(point, compiled).state;
};

const onStrokeMove = (point) => {
  const result = addPointToSession(sessionRef.current, point, compiled);
  // 描画
};

const onStrokeEnd = () => {
  const { inputPoints, pipelineConfig } = endStrokeSession(sessionRef.current);
  const command = createStrokeCommand(inputPoints, pipelineConfig, color, width);
  pushCommand(state, command, layer, config);
};
```

---

## 実装戦略

**段階的移行は不要。一気に書き換える。**

### Step 1: ドキュメント更新
各パッケージのdocs/のドキュメントを参照し、パッケージの責務と現在のAPI構成を把握。
Step2以降で追加変更予定の内容を必要なドキュメントに反映し、ゴール（新しいAPI体系）を明確にする。
Step5で削除するAPIは、廃止を明確にマークする。
更新後のドキュメント全体を確認し、提供されるAPI体系で課題の解決ができること、パッケージの責務とアーキテクチャの原則に反していないこと、
クライアントから見た仕様と利用方法が明確であることをセルフレビューする。
レビューで見つかった明確な問題は修正し、解決可能な問題がなくなるまで繰り返す。
潜在的な課題や将来への申し送り事項がある場合、該当するドキュメントに注記し、レビュー後に報告する。

### Step 2: inputパッケージ実装
- pipeline.ts, session.ts を実装
- types.ts に新型を追加
- テストを書いて通す
- （この時点でappは壊れてOK）

### Step 3: historyパッケージ実装
- StrokeCommand を追加
- replay.ts を更新
- テストを書いて通す
- （この時点でappは壊れてOK）

### Step 4: App修正
- 新APIを使うように書き換え
- useSymmetry.ts を usePipeline.ts に統合
- **ここで全て正しく動くべき**

### Step 5: クリーンアップ
- 不要になった旧API（BatchCommand関連、symmetryStrokesRef等）を削除
- 旧テストを削除/更新

---

## 検証方法

1. **ユニットテスト**: pipeline.ts, session.tsの各関数
2. **統合テスト**: 履歴のリプレイが正しく動作するか
3. **手動テスト**:
   - 各対称モードで描画が正しく動作
   - Undo/Redoが1操作で全ストローク戻る
   - 履歴データサイズが削減されている

---

## スコープ決定

- **スムージング**: 型定義と拡張ポイントのみ用意、実装は将来
- **useSymmetry.ts**: usePipeline.ts に統合（対称設定をPipelineConfigの一部として扱う）
- **BatchCommand**: StrokeCommandに置き換え、削除可能なら削除

---

## Step 1 完了時点の申し送り事項

### 進捗状況

- [x] Step 1: ドキュメント更新・セルフレビュー完了
- [ ] Step 2: inputパッケージ実装
- [ ] Step 3: historyパッケージ実装
- [ ] Step 4: App.tsx修正
- [ ] Step 5: クリーンアップ

### 参照すべきドキュメント

**実装前に必ず読むもの:**

| ドキュメント | 内容 |
|------------|------|
| [packages/input/docs/pipeline-api.md](packages/input/docs/pipeline-api.md) | 新Pipeline APIの仕様（Step 1で新規作成） |
| [packages/input/docs/types.md](packages/input/docs/types.md) | 新型定義の仕様（Step 1で追記） |
| [packages/history/docs/types.md](packages/history/docs/types.md) | StrokeCommand型の仕様（Step 1で追記） |
| [packages/history/docs/command-api.md](packages/history/docs/command-api.md) | createStrokeCommand仕様（Step 1で追記） |

**既存実装の参考:**

| ファイル | 参考にする点 |
|---------|-------------|
| [packages/input/src/symmetry.ts](packages/input/src/symmetry.ts) | `compileSymmetry()`, `expandSymmetry()` のパターン |
| [packages/history/src/replay.ts](packages/history/src/replay.ts) | `applyCommand()` のswitch文への追加方法 |
| [packages/history/src/command.ts](packages/history/src/command.ts) | コマンド作成関数のパターン |

### Step 2 実装時の注意点

**inputパッケージ:**

1. **既存のsymmetry.tsは変更しない** - pipeline.tsから内部的に使用
2. **CompiledPipelineの内部構造**:
   - `config: PipelineConfig` を保持（履歴保存用にStrokeCommandへ渡す）
   - `outputCount: number` を計算して保持
   - 内部的に `CompiledSymmetry` を保持（非公開）
3. **セッション管理の責務**:
   - 入力点の蓄積
   - 展開されたストローク群の追跡
   - 有効性判定（2点以上）
4. **テスト**: `pnpm --filter @headless-paint/input test`

### Step 3 実装時の注意点

**historyパッケージ:**

1. **PipelineConfigの依存**: `@headless-paint/input` から型をインポート
2. **replay.tsの変更**:
   - `applyCommand()` に `case "stroke":` を追加
   - `compilePipeline()`, `expandStroke()` をinputからインポートして使用
3. **getCommandLabel()** の更新も忘れずに
4. **テスト**: `pnpm --filter @headless-paint/history test`

### Step 4 実装時の注意点

**App.tsx:**

1. **useSymmetry.ts** → 削除 or usePipeline.tsに統合
2. **symmetryStrokesRef** → 削除（セッション管理に置き換え）
3. **BatchCommand生成ロジック** → 削除（常にStrokeCommand）
4. **間引き(shouldAcceptPoint)** は引き続きApp層で呼び出す

### Step 5 クリーンアップ対象

**コード:**
- `createBatchCommand()` 関数
- `BatchCommand` 型（残す場合は非推奨マーク維持）
- App.tsxの旧ストローク管理コード
- useSymmetry.ts（統合した場合）

**ドキュメント:**
新APIが「あるべき姿」として記載されるべき。以下の移行関連記載を削除:
- `packages/input/docs/pipeline-api.md`: 「従来の方式では」「BatchCommand」との比較表
- `packages/history/docs/types.md`: 「BatchCommand（廃止予定）」セクション、StrokeCommand説明内の比較
- `packages/history/docs/command-api.md`: 「従来のDrawPathCommandとの違い」表、`createBatchCommand（廃止予定）`セクション

### 責務の原則（違反に注意）

| パッケージ | 責務 | やってはいけないこと |
|-----------|------|---------------------|
| input | 入力処理・変換 | 描画処理、履歴操作 |
| history | 履歴管理・リプレイ | 直接の描画（engineに委譲） |
| engine | 描画処理 | 入力処理、履歴管理 |
| app | UI・状態管理 | ビジネスロジックの詳細実装 |

### テスト実行コマンド

```bash
# 個別パッケージ
pnpm --filter @headless-paint/input test
pnpm --filter @headless-paint/history test

# 全体
pnpm test

# アプリ起動（手動テスト）
pnpm --filter app dev
```
