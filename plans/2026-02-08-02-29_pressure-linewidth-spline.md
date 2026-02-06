# ペンの太さ・筆圧・スプライン補間の追加

## Context

ペイントライブラリに以下を追加する:
1. **ペンの太さ変更** - Debug PanelでlineWidthを動的に変更
2. **筆圧対応** - PointerEvent.pressureを取得し、筆圧に応じた可変太さで描画
3. **スプライン補間** - ポイント間をCatmull-Romスプラインで補間し、滑らかな線を実現

## 実装結果

全フェーズ完了。既存テスト81件パス、ビルド成功。

## 変更方針

### 描画方式: Circle + Trapezoid fill

各ポイントにpressure対応の円を描画し、隣接点間を台形ポリゴンで接続する。

- **利点**: committed/pending差分描画と互換性が高い、品質が高い、既存drawPathを壊さない
- 常にdrawVariableWidthPathを使用。pressureSensitivity=0でも均一太さになるため分岐不要

### スプライン補間: Catmull-Rom

描画前にポイント列をCatmull-Romスプラインで補間し、密度を上げる。pressureも線形補間する。

- 描画関数の内部処理として実装（FilterPipelineではなく描画時に適用）
- 補間はdrawVariableWidthPathの内部で実行。入力ポイント配列は変えず、描画品質のみ向上

### StrokeStyle統合

stroke/types.tsの`StrokeStyle`をengineからre-exportに統合。

## 影響ファイルと変更内容

### packages/engine

| ファイル | 変更 |
|---|---|
| types.ts | `StrokeStyle`に`pressureSensitivity?: number`追加 |
| draw.ts | `drawVariableWidthPath`, `calculateRadius`, `interpolateStrokePoints`追加 |
| expand.ts | `expandStrokePoints`(StrokePoint版)追加 |
| incremental-render.ts | `appendToCommittedLayer`/`renderPendingLayer`をStrokePoint対応に |
| index.ts | 新関数エクスポート追加 |

### packages/stroke

| ファイル | 変更 |
|---|---|
| types.ts | `StrokeStyle`をengineからre-export。`RenderUpdate`をStrokePoint[]に。`StrokeCommand`に`pressureSensitivity?`追加 |
| session.ts | `toPoints`→`toStrokePoints`(pressure保持)。`buildPendingWithOverlap`もStrokePoint対応 |
| replay.ts | `replayStrokeCommand`で可変太さ描画対応 |

### apps/web

| ファイル | 変更 |
|---|---|
| usePointerHandler.ts | コールバック型をPoint→InputPointに変更。pressure取得 |
| App.tsx | PEN_WIDTH除去、usePenSettings統合、コールバック型変更 |
| DebugPanel.tsx | "Pen Settings"フォルダ追加(lineWidth, pressureSensitivity) |
| 新規: usePenSettings.ts | lineWidth/pressureSensitivityのstate管理フック |

### packages/input

変更なし（InputPoint.pressure?は定義済み、smoothing-pluginもpressure対応済み）

## 型設計

### StrokeStyle拡張 (engine/src/types.ts)

```typescript
export interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number; // 0.0=均一, 1.0=最大感度。デフォルト0
}
```

### StrokeCommand拡張 (stroke/src/types.ts)

```typescript
export interface StrokeCommand {
  // ...既存フィールド
  readonly pressureSensitivity?: number; // optional: 後方互換
}
```

### RenderUpdate変更 (stroke/src/types.ts)

```typescript
export interface RenderUpdate {
  readonly newlyCommitted: readonly StrokePoint[]; // Point[] → StrokePoint[]
  readonly currentPending: readonly StrokePoint[];
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
}
```

## API設計

詳細は `packages/engine/docs/draw-api.md`, `packages/engine/docs/expand-api.md` を参照。

### 新規エクスポート

- `calculateRadius(pressure, baseLineWidth, pressureSensitivity): number` - 筆圧から描画半径を計算
- `interpolateStrokePoints(points): StrokePoint[]` - Catmull-Romスプラインで補間
- `drawVariableWidthPath(layer, points, color, baseLineWidth, pressureSensitivity): void` - 可変太さパス描画
- `expandStrokePoints(points, compiled): StrokePoint[][]` - StrokePoint版ストローク展開

### シグネチャ変更

- `appendToCommittedLayer` / `renderPendingLayer`: `Point[]` → `StrokePoint[]`

## 描画の詳細設計

### calculateRadius

```
pressure未定義 → DEFAULT_PRESSURE=0.5
sensitivity=0 → radius = baseLineWidth / 2（均一）
sensitivity=1 → radius = baseLineWidth * pressure（0〜baseLineWidth）
中間値 → 線形補間: uniformRadius * (1 - s) + pressureRadius * s
```

### drawVariableWidthPath

1. ポイント列をCatmull-Romスプラインで補間（pressureも補間）
2. 補間後の各ポイントにcalculateRadiusで半径を計算
3. 各ポイントに円を描画（fill）
4. 隣接ポイント間を台形ポリゴンで接続（fill）

### Expand統合

`expandStrokePoints`: expandPointで座標変換し、元のpressure値をそのままコピー。

### 差分描画の接続

`buildPendingWithOverlap`が最後のcommittedポイントをpendingの先頭に付与する仕組みはStrokePointでもそのまま機能。pressureが引き継がれるため接続部の太さが一致。

## 後方互換性

- `pressureSensitivity`はoptional。既存StrokeCommandでは`undefined`→`0`扱い
- 既存InputPointのpressure=undefined → DEFAULT_PRESSURE=0.5で均一描画
- 分岐なし: 常にdrawVariableWidthPathを使用。sensitivity=0なら結果は均一太さで従来と同等

## 実装時の調整内容（補足）

### 付帯作業: planning-flowスキル・CLAUDE.mdの改善

planning-flowスキルとplan modeの競合を解消するため、SKILL.mdとCLAUDE.mdを改善した。

- **SKILL.md**: plan mode時の統合方法を明記
- **CLAUDE.md**: planning-flowがplan modeの進め方を規定する旨を強調
