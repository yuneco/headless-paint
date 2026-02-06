# 筆圧カーブ（Pressure Curve）の追加

## 要件

- 入力筆圧(0-1)→出力筆圧(0-1)のマッピングをcubic-bezier曲線で調整可能にする
- SVGベースのBezierCurveEditorコンポーネントで制御点をドラッグ編集
- engine層に `PressureCurve` 型と `applyPressureCurve` を追加
- 将来的にx座標も公開すればCSS `cubic-bezier(x1,y1,x2,y2)` 相当に拡張可能

---

## 設計方針

### パラメトリック cubic-bezier

入力 pressure を t として、1次元 cubic bezier で output を計算。端点 (0,0)→(1,1) は固定、2つの制御点の y 座標のみ調整。x 座標は 1/3, 2/3 で固定。

```
applyPressureCurve(pressure, { y1, y2 }):
  t = pressure, mt = 1 - t
  return 3 * mt² * t * y1 + 3 * mt * t² * y2 + t³
```

- y1=1/3, y2=2/3 → output = t（線形）
- y1=1, y2=1（柔らかい）→ 軽いタッチでも太くなる
- y1=0, y2=1/3（硬い）→ 強く押さないと太くならない

### pressureSensitivity との関係

```
入力pressure → PressureCurve変換 → pressureSensitivity計算 → radius
```

PressureCurveは筆圧の「感触」を変える前処理。pressureSensitivityは筆圧の「影響度」を制御。

---

## API設計

### 型定義（engine）

```typescript
interface PressureCurve {
  readonly y1: number;
  readonly y2: number;
}
const DEFAULT_PRESSURE_CURVE: PressureCurve = { y1: 1 / 3, y2: 2 / 3 };
```

`StrokeStyle` に `readonly pressureCurve?: PressureCurve` を追加。

### 関数（engine）

- `applyPressureCurve(pressure, curve)` — 筆圧カーブを適用
- `calculateRadius(pressure, baseLineWidth, pressureSensitivity, pressureCurve?)` — 第4引数追加
- `drawVariableWidthPath(layer, points, color, baseLineWidth, pressureSensitivity, pressureCurve?)` — 第6引数追加

詳細は `packages/engine/docs/draw-api.md` を参照。

### StrokeCommand（stroke）

`readonly pressureCurve?: PressureCurve` を追加。Undo/Redoリプレイ時にカーブが再現される。

詳細は `packages/stroke/docs/types.md` を参照。

### BezierCurveEditor（app）

```tsx
<BezierCurveEditor value={pressureCurve} onChange={setPressureCurve} />
```

SVGベースの自己完結コンポーネント（150x150）。2つの制御点をドラッグで編集（y座標のみ）。

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `packages/engine/src/types.ts` | `PressureCurve`, `DEFAULT_PRESSURE_CURVE`, `StrokeStyle` 拡張 |
| `packages/engine/src/draw.ts` | `applyPressureCurve` 追加、`calculateRadius`/`drawVariableWidthPath` 拡張 |
| `packages/engine/src/index.ts` | エクスポート追加 |
| `packages/engine/src/incremental-render.ts` | `drawVariableWidthPath` 呼び出し更新 |
| `packages/engine/src/draw.test.ts` | applyPressureCurve/calculateRadius テスト追加（7件） |
| `packages/stroke/src/types.ts` | `StrokeCommand` に `pressureCurve` 追加 |
| `packages/stroke/src/session.ts` | `endStrokeSession`, `createStrokeCommand` 拡張 |
| `packages/stroke/src/replay.ts` | `replayStrokeCommand` で pressureCurve を渡す |
| `apps/web/src/hooks/usePenSettings.ts` | `pressureCurve` state 追加 |
| `apps/web/src/components/BezierCurveEditor.tsx` | **新規**: SVGベースのcubic-bezierエディタ |
| `apps/web/src/components/DebugPanel.tsx` | BezierCurveEditor を配置 |
| `apps/web/src/App.tsx` | `createStrokeCommand` に pressureCurve 追加 |

ドキュメント更新: `engine/docs/types.md`, `engine/docs/draw-api.md`, `engine/docs/README.md`, `stroke/docs/types.md`

---

## テスト

全88テストパス。追加テスト:
- `applyPressureCurve`: デフォルトで線形、soft/hardカーブ、端点不変
- `calculateRadius`: pressureCurve適用後のradius変化

---

## 将来の拡張性

- 制御点のx座標も編集可能にすれば CSS `cubic-bezier(x1,y1,x2,y2)` 相当の完全な自由度
- プリセット（Linear, Soft, Hard, S-Curve等）のドロップダウン追加も容易

---

## 実装結果

Phase 1〜5 完了。ビルド・テスト・lint全てパス。セルフレビュー済み。
既存の `pressureSensitivity` パターンに沿った一貫性のある拡張。全パラメータoptionalで後方互換性あり。
