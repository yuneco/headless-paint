# Pressure Dynamics Plan

## 背景

現在の筆圧設定は `StrokeStyle.pressureSensitivity` と `pressureCurve` に集約され、描画時には主にサイズへ反映される。スタンプブラシでは `dynamics.flow` が 1 stamp あたりの不透明度に相当するが、筆圧は flow に反映されていない。

今後はブラシごとに「筆圧で太さを変える」「筆圧で濃さを変える」「両方」「どちらもなし」を表現したい。丸ペンは透明度筆圧を扱わず、スタンプブラシだけ flow 筆圧を対象にする。

## 方針

- `pressureDynamics: { size: number; flow: number }` をブラシ設定に持たせる。
- `size` は筆圧によるサイズ変化の強さ、`flow` は筆圧による flow 変化の強さを表す。
- `pressureCurve` は筆圧入力の変換として `StrokeStyle` に残す。
- `pressureSensitivity` は新APIでは廃止し、互換読み込み時だけ `pressureDynamics.size` へ補完する。
- `round-pen` も型としては `pressureDynamics` を持つが、描画では `flow` を無視する。
- UIでは `round-pen` 選択時に flow 筆圧コントロールを表示しない。
- 既存データ互換は「古い設定を開いてもエラーにならない」レベルに限定し、旧設定の replay 等価性は保証しない。

## Doc-First Phase

### Phase 1: API設計・ドキュメント作成

- [x] 既存のブラシ型、描画、永続化、UI参照箇所を確認する
- [x] `packages/engine/docs/` に `PressureDynamics` とブラシ設定の新IFを記載する
- [x] `packages/stroke/docs/` に `StrokeStyle` / command 保存時の扱いを記載する
- [x] `packages/react/docs/` に pen settings / import 互換の扱いを記載する
- [x] 設計意図、制約、UI表示ルールを記載する

### Phase 2: 利用イメージレビュー

- [x] `apps/web` の利用イメージを示す
- [x] プリセットごとの `pressureDynamics` 設定例を示す
- [ ] ユーザー確認を受け、必要ならPhase 1へ戻す

### Phase 3: 実装

- [x] `engine` の型・定数・描画処理を実装する
- [x] `stroke` の command/replay 型と生成処理を更新する
- [x] `react` の hooks / persistence を更新する
- [x] `apps/web` のUIを更新し、round-penでは flow 筆圧を隠す
- [x] テストを追加・更新する
- [x] `pnpm build` / 対象テストを実行する

### Phase 4: アーキテクトレビュー

- [x] 実装とドキュメントの双方向一致を確認する
- [x] 要求充足を確認する
- [x] パッケージ責務分離と既存パターンへの適合を確認する
- [x] review-library-usage skillでセルフレビューする

## 実装結果

- `PressureDynamics` / `DEFAULT_PRESSURE_DYNAMICS` を追加し、`BrushConfig` に `pressureDynamics` を持たせた
- `StrokeStyle.pressureSensitivity` を廃止し、サイズ筆圧は `brush.pressureDynamics.size` から参照するよう変更した
- スタンプブラシでは `brush.pressureDynamics.flow` で `dynamics.flow` を筆圧変化させるよう変更した
- `round-pen` は `pressureDynamics.size` のみ描画に使い、`flow` は無視する
- `react` の `usePenSettings` は `setBrushPressureDynamics` を提供し、古いブラシ設定には `pressureDynamics` を補完する
- persistence は旧 `pen.pressureSensitivity` と旧 `BrushConfig` を読み込み時に補完する。新形式では `pressureSensitivity` を保存しない
- web の DebugPanel は `Size Pressure` を常時表示し、`Flow Pressure` は stamp 用の Brush Dynamics 内に表示する

## 検証

- `pnpm lint`
- `pnpm build`
- `pnpm vitest run packages/engine/src/draw.test.ts packages/engine/src/brush-render.test.ts packages/engine/src/incremental-render.test.ts packages/react/src/persistence.test.ts`
- `pnpm --filter @headless-paint/stroke test`

## 設計メモ

### 新しい外部IF案

```typescript
interface PressureDynamics {
  readonly size: number;
  readonly flow: number;
}

const DEFAULT_PRESSURE_DYNAMICS: PressureDynamics = {
  size: 1,
  flow: 0,
};

interface RoundPenBrushConfig {
  readonly type: "round-pen";
  readonly pressureDynamics: PressureDynamics;
}

interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
  readonly pressureDynamics: PressureDynamics;
  readonly mixing?: BrushMixing;
}
```

### 描画ルール

- サイズは現在の `calculateRadius` 相当の式を `pressureDynamics.size` で計算する。
- スタンプブラシの flow は `dynamics.flow` を基準値にし、`pressureDynamics.flow` で筆圧反映後の stamp alpha を決める。
- `round-pen` は `pressureDynamics.size` だけを使い、`pressureDynamics.flow` は無視する。
- `opacityJitter` は筆圧反映後の flow に対して従来どおりランダム変動を掛ける。

### 互換方針

- `{ type: "round-pen" }` や `stamp.pressureDynamics` 欠落は import/normalize 時に `DEFAULT_PRESSURE_DYNAMICS` で補完する。
- 旧 `pen.pressureSensitivity` があれば `pressureDynamics.size` の補完値として使う。
- 旧 `pen.pressureCurve` はそのまま維持する。
- 新形式では `pen.pressureSensitivity` を保存しない。

## 利用イメージ

### apps/web の設定更新

```typescript
const updatePressureDynamics = (
  field: keyof PressureDynamics,
  value: number,
) => {
  setBrush({
    ...brush,
    pressureDynamics: {
      ...brush.pressureDynamics,
      [field]: value,
    },
  });
};
```

UI表示:

- すべてのブラシで Size Pressure を表示する
- `brush.type === "stamp"` のときだけ Flow Pressure を表示する
- Flow 自体のスライダーも `stamp` の Brush Dynamics にだけ表示する

### プリセット例

```typescript
const pen = {
  type: "round-pen",
  pressureDynamics: { size: 1, flow: 0 },
} satisfies RoundPenBrushConfig;

const airbrush = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.05, flow: 0.1 },
  pressureDynamics: { size: 0, flow: 1 },
} satisfies StampBrushConfig;

const pencil = {
  type: "stamp",
  tip: { type: "image", imageId: "pencil-grain" },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.2, flow: 0.45 },
  pressureDynamics: { size: 1, flow: 0 },
} satisfies StampBrushConfig;
```
