# ストローク変換パイプライン リファクタリング

## 背景と課題

### 本質的な認識

対称ペイントを「特殊な機能」として実装していたが、本質的には：

1. **全てのペイント操作は座標変換のバリエーション**
   - 通常ペイント = identity変換（変換なし）
   - 対称ペイント = 1入力 → N出力の変換
   - スムージング、パターン描画も同様

2. **多段変換パイプライン**
   - 入力 → 補正 → 対称 のように直列適用可能であるべき

3. **変換ごとにAPIを分けるのは不適切**
   - クライアントは変換設定後、描画するだけ
   - 変換の種類が増えてもApp側コードは変わるべきではない

### 解決した問題

| 問題 | Before | After |
|------|--------|-------|
| App.tsxの責務過多 | `expandSymmetry()`直接呼び出し、ストローク配列手動管理、分岐ロジック | セッションAPIに委譲、常にStrokeCommand |
| 履歴の非効率性 | 展開後の全点を保存（6分割なら6倍） | 入力点+設定のみ保存、リプレイ時に展開 |
| 拡張性の欠如 | 変換追加のたびにApp層変更 | プラグインとして追加、App層変更不要 |

---

## 設計

### アプローチ: Config-based Pipeline

| 候補 | 利点 | 欠点 |
|-----|------|------|
| Transformer Chain (OOP) | 直感的 | inputパッケージの設計と不整合 |
| **Config-based Pipeline** | シリアライズ可能、履歴保存に適合 | - |
| Functional Composition | 純粋関数 | 設定のシリアライズが複雑 |

**選択理由:**
- `PipelineConfig` はJSONシリアライズ可能 → 履歴に保存可能
- 既存の `SymmetryConfig → CompiledSymmetry` パターンを踏襲
- `compilePipeline()` で事前計算、`expandPoint()` は高速

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
   StrokeCommand (履歴保存: 入力点 + 設定のみ)
```

### 型設計

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

// プラグインインターフェース
interface TransformPlugin<TConfig, TCompiled> {
  readonly type: string;
  compile(config: TConfig): TCompiled;
  expand(points: readonly Point[], compiled: TCompiled): Point[];
  getOutputCount(config: TConfig): number;
}

// 履歴に保存されるコマンド
interface StrokeCommand {
  type: "stroke"
  inputPoints: readonly Point[]    // 変換前の入力（軽量）
  pipeline: PipelineConfig         // { transforms: [...] }
  color: Color
  lineWidth: number
  timestamp: number
}
```

---

## 実装結果

### 成果物

| パッケージ | 追加・変更 |
|-----------|-----------|
| `@headless-paint/input` | Pipeline API、Session API、プラグインシステム |
| `@headless-paint/history` | StrokeCommand、リプレイ対応 |
| `apps/web` | 新APIを使用したApp.tsx |

### ファイル構成

```
packages/input/src/
├── types.ts              # PipelineConfig, CompiledPipeline, TransformPlugin
├── pipeline.ts           # compilePipeline, expandPoint, expandStroke
├── session.ts            # startStrokeSession, addPointToSession, endStrokeSession
├── symmetry.ts           # 既存（プラグインから使用）
├── plugins/
│   ├── index.ts          # プラグインレジストリ
│   └── symmetry-plugin.ts
└── index.ts

packages/history/src/
├── types.ts              # StrokeCommand追加
├── command.ts            # createStrokeCommand追加
├── replay.ts             # strokeケース追加
└── index.ts
```

### App.tsx の最終形

```typescript
// パイプライン設定（対称設定からPipelineConfigを生成）
const compiledPipeline = useMemo(() => {
  if (symmetry.config.mode === "none") {
    return compilePipeline({ transforms: [] });
  }
  return compilePipeline({
    transforms: [{ type: "symmetry", config: symmetry.config }],
  });
}, [symmetry.config]);

// セッション管理
const sessionRef = useRef<StrokeSessionState | null>(null);

const onStrokeStart = (point) => {
  const result = startStrokeSession(point, compiledPipelineRef.current);
  sessionRef.current = result.state;
};

const onStrokeMove = (point) => {
  const result = addPointToSession(sessionRef.current, point, compiledPipelineRef.current);
  sessionRef.current = result.state;
  // 描画...
};

const onStrokeEnd = () => {
  const { inputPoints, pipelineConfig } = endStrokeSession(sessionRef.current);
  const command = createStrokeCommand(inputPoints, pipelineConfig, color, width);
  pushCommand(state, command, layer, config);
};
```

---

## 原理原則

### 設計原則

1. **パイプラインは変換の詳細を知らない**
   - 各変換がインターフェースを実装
   - pipeline.ts は変換タイプごとの分岐を持たない
   - 全て `getPlugin()` 経由でプラグインに委譲

2. **配列は配列として処理する**
   - `transforms` 配列を順番に直列適用
   - 中身が1つでもループで処理
   - 「1つしかないから特別扱い」は禁止

3. **プラグインパターン**
   - 新しい変換追加時は `plugins/` にファイル追加 + レジストリ登録のみ
   - pipeline.ts の変更不要

### パッケージ責務

| パッケージ | 責務 | やってはいけないこと |
|-----------|------|---------------------|
| input | 入力処理・変換 | 描画処理、履歴操作 |
| history | 履歴管理・リプレイ | 直接の描画（engineに委譲） |
| engine | 描画処理 | 入力処理、履歴管理 |
| app | UI・状態管理 | ビジネスロジックの詳細実装 |

### 教訓

> **「今動くから最低限で良い」はNG。必要な仕組みは最初から明確に作る。**

実装初期に以下の設計違反があり、修正が必要になった：

```typescript
// NG: symmetryだけを探している（配列なのに1つしか処理しない）
const symmetryTransform = config.transforms.find((t) => t.type === "symmetry");

// NG: 特定の変換を直接参照している
readonly _compiledSymmetry: CompiledSymmetry | null;
```

**違反した原則:**
- 1つしか中身がなくても、概念として配列なら配列として実装する
- 概念やアーキテクチャの理論に反する実装は、暗黙的・暫定的を理由に行ってはならない
- 将来の拡張性を「後で対応」とするのは技術的負債の言い訳に過ぎない

---

## 将来の拡張

パイプラインは以下の変換を追加可能：

```typescript
compilePipeline({
  transforms: [
    { type: "smoothing", config: { strength: 0.5 } },  // 1. まず平滑化
    { type: "symmetry", config: symmetryConfig },       // 2. 次に対称展開
  ]
});
```

新しい変換を追加する手順：
1. `plugins/` に新しいプラグインファイルを作成
2. `TransformPlugin` インターフェースを実装
3. `plugins/index.ts` でレジストリに登録
4. `TransformConfig` 型に追加

pipeline.ts の変更は不要。
