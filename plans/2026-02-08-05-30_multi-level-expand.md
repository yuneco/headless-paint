# 多段対称展開 (Multi-Level Expand)

> 保存先: `/plans/2026-02-08-05-30_multi-level-expand.md`

## Context

現在の Expand は単一レベル（1つの origin + mode + divisions）のみ。[symmpaint](https://github.com/yuneco/symmpaint) のように対称軸を多段に適用する機能を追加する。例: 親 radial 3分割 × 子 kaleido 4分割 = 24コピー。

### 設計方針

- **データモデルは N 段対応**、UI は 2 段まで
- **子の offset は親からの相対座標** (Cartesian `Point`)
- **auto-angle**: 子の T_child 内の回転 = `atan2(offset.y, offset.x) + ownAngle`。これは親のローカル空間内の角度であり、親の angle は `T_root = translate(root.offset) * rotate(root.angle)` として行列合成で自動的に反映される。つまりワールド空間での子の実効方向 = `root.angle + autoAngle + ownAngle`。親を回せば子の位置・方向も追従する
- **CompiledExpand の出力は従来通りフラットな行列配列** → 下流（描画・セッション・ヒストリ）は変更不要
- **第一出力 = 入力座標** の不変条件を維持（正規化で保証）
- **子のガイド線は1セットのみ表示**。描画される位置は `T_root * T_child` で計算される子の絶対位置（正規化前の第一セクター相当）。ユーザーは子をドラッグで自由に移動できるため、見かけ上は親の任意のセクター上にあるように見えることがある。対称性により描画結果はどのセクターでも等価なので問題ない
- **ガイド線の色**: 親・子それぞれの色を `ExpandGuideStyle` として configurable に保持

---

## Phase 1: API設計

### 1-1. Engine: 型定義の変更

**[types.ts](packages/engine/src/types.ts)**

```typescript
// ExpandMode は変更なし
export type ExpandMode = "none" | "axial" | "radial" | "kaleidoscope";

// 新規: 1レベル分の設定
export interface ExpandLevel {
  readonly mode: ExpandMode;
  readonly offset: Point;     // root: 絶対座標, child: 親からの相対座標
  readonly angle: number;     // root: モード固有角度, child: autoAngle に加算される自前角度
  readonly divisions: number;
}

// 変更: levels 配列に
export interface ExpandConfig {
  readonly levels: readonly ExpandLevel[];
}

// CompiledExpand は変更なし
export interface CompiledExpand {
  readonly config: ExpandConfig;
  readonly matrices: readonly Float32Array[];
  readonly outputCount: number;
}
```

### 1-2. Engine: 行列合成アルゴリズム

**[expand.ts](packages/engine/src/expand.ts)**

コア概念: 各レベルを **T_level（位置+回転）** と **ローカル回転/反射行列** に分離し、ツリー走査で合成。

```
M(i, j) = T_root * R_root_i * T_child * R_child_j
```

- `T_root = translate(root.offset) * rotate(root.angle)` — 親の位置+角度。**root.angle はここに含まれるため、子の位置・方向に自動反映される**
- `R_root_i` = ローカル回転/反射（mode/divisions で決定、angle 不使用）
- `T_child = translate(child.offset) * rotate(autoAngle + child.angle)` — 親ローカル空間内での子の位置+方向。autoAngle = `atan2(offset.y, offset.x)`
- `R_child_j` = ローカル回転/反射

ワールド空間での子の実効方向 = `root.angle + autoAngle + child.angle`（行列合成で自動計算）。親の angle を変更すると子の位置・方向も連動する。

正規化: `M_norm(i,j) = M(i,j) * inverse(M(0,0))` → 第一出力 = identity

**ローカル回転/反射 `compileLocalTransforms(mode, divisions)`**:

| mode | 出力 |
|------|------|
| none | `[identity]` |
| radial | `[rotate(2πi/n)]` for i=0..n-1 |
| axial | `[identity, reflect_axis(0)]` |
| kaleidoscope | for i=0..n-1: `[rotate(2πi/n), reflect_axis(2πi/n + π/n)]` |

angle パラメータを使わない（angle は T_level 側で処理される）。

**再帰合成 `buildExpandMatrices(levels, depth, accumulated)`**:

```typescript
function buildExpandMatrices(
  levels: readonly ExpandLevel[],
  depth: number,
  accumulated: mat3,
): mat3[] {
  const level = levels[depth];

  // T_level: 位置 + 角度
  const T = mat3.create();
  mat3.translate(T, T, [level.offset.x, level.offset.y]);
  const effectiveAngle = depth === 0
    ? level.angle
    : Math.atan2(level.offset.y, level.offset.x) + level.angle;
  mat3.rotate(T, T, effectiveAngle);

  const base = mat3.multiply(mat3.create(), accumulated, T);
  const localTransforms = compileLocalTransforms(level.mode, level.divisions);

  if (depth === levels.length - 1) {
    // リーフ: base * R をそのまま返す
    return localTransforms.map(R => mat3.multiply(mat3.create(), base, R));
  }

  // 非リーフ: 各 R について再帰
  return localTransforms.flatMap(R => {
    const composed = mat3.multiply(mat3.create(), base, R);
    return buildExpandMatrices(levels, depth + 1, composed);
  });
}
```

**公開API**:

| 関数 | 説明 |
|------|------|
| `compileExpand(config: ExpandConfig): CompiledExpand` | シグネチャ維持、内部で多段対応 |
| `createDefaultExpandConfig(w, h): ExpandConfig` | 1レベル none を返す |
| `compileLocalTransforms(mode, divisions): mat3[]` | 内部ヘルパー（テスト用にエクスポート可） |
| `expandPoint`, `expandStroke`, `expandStrokePoints` | **変更なし** |

### 1-3. Stroke: 型参照の更新

`ExpandConfig` の型が変わるため、以下のファイルで型参照を更新:

- **[types.ts](packages/stroke/src/types.ts)**: `StrokeCommand.expand`, `RenderUpdate.expand` — 型は `ExpandConfig` のまま（形が変わる）
- **[session.ts](packages/stroke/src/session.ts)**: `startStrokeSession`, `endStrokeSession` の引数型
- **[replay.ts](packages/stroke/src/replay.ts)**: `replayStrokeCommand` の `compileExpand` 呼び出し

**実質的なロジック変更はなし**。型の形状が変わるだけ。

### 1-4. Web: useExpand hook の拡張

**[hooks/useExpand.ts](apps/web/src/hooks/useExpand.ts)**

```typescript
export interface UseExpandResult {
  config: ExpandConfig;
  compiled: CompiledExpand;
  // Root level
  setMode: (mode: ExpandMode) => void;
  setDivisions: (divisions: number) => void;
  setAngle: (angle: number) => void;
  // Sub level (child)
  subEnabled: boolean;
  setSubEnabled: (enabled: boolean) => void;
  setSubMode: (mode: ExpandMode) => void;
  setSubDivisions: (divisions: number) => void;
  setSubAngle: (angle: number) => void;
  setSubOffset: (offset: Point) => void;
}
```

- `subEnabled = false` → `config.levels` は1要素（root のみ）
- `subEnabled = true` → `config.levels` は2要素（root + child）
- child のデフォルト offset: `{ x: 0, y: -80 }` （親の12時方向）
- child のデフォルト mode: root と同じ

### 1-5. Web: SymmetryOverlay の拡張

**[components/SymmetryOverlay.tsx](apps/web/src/components/SymmetryOverlay.tsx)**

props に `ExpandGuideStyle` を追加:

```typescript
export interface ExpandGuideStyle {
  readonly rootColor: string;   // 親ガイドの色 (default: UI_SYMMETRY_GUIDE_COLOR)
  readonly subColor: string;    // 子ガイドの色 (default: 親より薄い色)
}
```

子レベルのガイド描画:
- 子の絶対位置: `T_root * T_child` の translation 成分で計算。正規化前の第一親回転（R_root_0 = identity）に対応する位置に表示される。ユーザーが子を自由にドラッグできるため、見かけ上は親のどのセクターにでも配置可能。対称性により描画結果は等価
- 子のガイド線は短く（親の半分程度）、色は `guideStyle.subColor` で描画
- 子の原点に塗り潰し円を描画
- 子の原点円はドラッグ可能（`pointerEvents: "auto"` に変更）

ドラッグ操作:
- 子原点の円をドラッグ → screen座標の差分を layer 座標に変換 → child.offset を更新
- ドラッグ中は他のポインターイベントを抑制（描画と競合しない）
- ドラッグ判定: 子原点の円の当たり判定（半径16px程度）

### 1-6. Web: DebugPanel の拡張

**[components/DebugPanel.tsx](apps/web/src/components/DebugPanel.tsx)**

既存の Symmetry フォルダー内に追加:

```
▼ Symmetry
  Mode: [radial ▼]
  Divisions: [6 ───●───]
  Angle (deg): [0 ───●───]
  ▼ Sub Symmetry
    Enabled: [✓]
    Mode: [kaleidoscope ▼]
    Divisions: [4 ───●───]
    Angle (deg): [0 ───●───]
    Offset X: [0 ───●───]
    Offset Y: [-80 ───●───]
```

---

## Phase 2: 利用イメージレビュー

### 基本描画フロー（変更なし）

```typescript
// App.tsx での使用は既存と同じ
const expand = useExpand(LAYER_WIDTH, LAYER_HEIGHT);
// expand.compiled がそのまま appendToCommittedLayer / renderPendingLayer に渡る
// CompiledExpand の中身が多段対応になるだけで、呼び出し側コードの変更なし
```

### 二段対称の設定例

```typescript
// 親: radial 3分割、子: kaleido 4分割
const config: ExpandConfig = {
  levels: [
    { mode: "radial", offset: { x: 400, y: 300 }, angle: 0, divisions: 3 },
    { mode: "kaleidoscope", offset: { x: 0, y: -80 }, angle: 0, divisions: 4 },
  ],
};

const compiled = compileExpand(config);
// compiled.outputCount === 3 * 8 = 24
// compiled.matrices[0] === identity (第一出力 = 入力)
```

### ガイド線の見え方

```
親 radial 3分割 + 子 kaleido 4分割:

            ╱│╲          ← 子のガイド（短い線、8本: 実線+点線交互）
           ╱ │ ╲
          ╱  ●  ╲        ← 子の原点（ドラッグ可能）
         ╱   │   ╲
────────╱────●────╲──────  ← 親のガイド（長い線、3本: 実線）
         ╲       ╱         ← 親の原点
          ╲     ╱
           ╲   ╱
            ╲ ╱
```

- 親のガイド: 従来通り（長い線、全分割分、`guideStyle.rootColor`）
- 子のガイド: 1セットのみ表示。位置は `T_root * T_child` で計算される絶対位置（`guideStyle.subColor`）。ユーザーがドラッグで自由に移動できるため画面上の任意の場所に配置可能
- 子の原点: ドラッグで移動 → offset が更新される → auto-angle で方向が自動追従

---

## Phase 3: 実装

### Step 3-1: Engine — 型定義と compileExpand

1. **[types.ts](packages/engine/src/types.ts)**: `ExpandLevel` 新規追加、`ExpandConfig` を levels 配列に変更
2. **[expand.ts](packages/engine/src/expand.ts)**:
   - `compileLocalTransforms(mode, divisions)` 新規追加
   - `buildExpandMatrices(levels, depth, accumulated)` 新規追加
   - `compileExpand(config)` を多段対応に書き換え
   - `createDefaultExpandConfig` を新 ExpandConfig 形状に更新
   - `expandPoint`, `expandStroke`, `expandStrokePoints` は変更なし
3. **[index.ts](packages/engine/src/index.ts)**: `ExpandLevel` エクスポート追加
4. **テスト ([expand.test.ts](packages/engine/src/expand.test.ts))**:
   - 既存テストを新 ExpandConfig 形状に移行（1レベルで同じ結果になること）
   - 多段テスト追加:
     - 2レベル: outputCount が親×子になること
     - 2レベル: 第一出力 = 入力の不変条件
     - 親 radial 3 × 子 kaleido 4 = 24 コピー
     - 子 mode "none" → 親のみと等価
     - 子 offset (0,0) でも動作すること（auto-angle = 0）
     - 子 offset を回転させても第一出力 = 入力
5. **ドキュメント更新**: [expand-api.md](packages/engine/docs/expand-api.md)

### Step 3-2: Stroke — 型参照の更新

1. **[types.ts](packages/stroke/src/types.ts)**: ExpandConfig の import 確認（engine から re-export されるので自動追従）
2. **[session.ts](packages/stroke/src/session.ts)**: `createStrokeCommand` 等のExpandConfig 生成箇所を新形状に
3. **[replay.ts](packages/stroke/src/replay.ts)**: 変更なし（compileExpand を呼ぶだけ）
4. **テスト**: 既存テストの ExpandConfig リテラルを新形状に更新

### Step 3-3: Web — useExpand hook

1. **[hooks/useExpand.ts](apps/web/src/hooks/useExpand.ts)**: 1-4 の設計に基づき拡張
2. 内部状態: `rootLevel: ExpandLevel`, `subLevel: ExpandLevel | null`
3. `config` は `useMemo` で `{ levels: [root, ...(sub ? [sub] : [])] }` を構築

### Step 3-4: Web — DebugPanel

1. **[components/DebugPanel.tsx](apps/web/src/components/DebugPanel.tsx)**: Sub Symmetry フォルダー追加
2. Enabled トグル、Mode、Divisions、Angle、Offset X/Y

### Step 3-5: Web — SymmetryOverlay (ガイド線 + ドラッグ)

1. **[components/SymmetryOverlay.tsx](apps/web/src/components/SymmetryOverlay.tsx)**:
   - props に `guideStyle: ExpandGuideStyle` 追加（親色・子色を外部指定）
   - 親ガイド線: `guideStyle.rootColor` で描画（従来の固定色を置換）
   - 子ガイド線: `guideStyle.subColor` で描画（短い線、子の絶対位置から放射）
   - 子原点の円描画
   - `pointerEvents` を条件付きで `"auto"` に変更（子レベルが有効な時）
   - PointerDown/Move/Up ハンドラ追加: 子原点の当たり判定 → ドラッグで offset 更新
   - `screenToLayer` で screen 座標差分を layer 座標に変換

### Step 3-6: Web — App.tsx 統合

1. **[App.tsx](apps/web/src/App.tsx)**:
   - `useExpand` の戻り値から sub 関連の props を DebugPanel と SymmetryOverlay に渡す
   - SymmetryOverlay に `onSubOffsetChange` コールバック追加
   - 既存の描画フロー自体は変更なし（CompiledExpand がそのまま流れる）

---

## Phase 4: 検証

### 4-1. 自動テスト

```bash
pnpm --filter @headless-paint/engine test   # expand 多段テスト
pnpm --filter @headless-paint/stroke test   # 型更新後のテスト
pnpm build                                  # 全パッケージビルド
pnpm lint                                   # lint
```

### 4-2. 手動検証 (`pnpm dev`)

**基本動作**:
- [ ] 単一レベル（Sub disabled）で従来通り動作する
- [ ] Sub Symmetry を有効にすると出力数が増える
- [ ] 親 radial 3 × 子 kaleido 4 で 24 コピーが描画される
- [ ] 描画ストロークが必ず入力位置に1つ存在する

**ガイド線**:
- [ ] 親のガイド線が従来通り表示される
- [ ] 子のガイド線が子の位置に表示される（短い線）
- [ ] 子の原点円が表示される

**ドラッグ操作**:
- [ ] 子の原点をドラッグで移動できる
- [ ] 移動時に auto-angle で子のガイド線の方向が自動追従する
- [ ] ドラッグ中は描画が発生しない

**DebugPanel**:
- [ ] Sub Symmetry の Enabled トグルが機能する
- [ ] Mode / Divisions / Angle / Offset X / Offset Y がスライダーで変更できる
- [ ] パネルの値変更がガイド線と描画にリアルタイム反映される

**履歴**:
- [ ] 多段 expand で描画したストロークを Undo/Redo できる
- [ ] Undo 後に expand 設定を変更して Redo すると元の expand 設定で再描画される

### 4-3. セルフレビュー

review-library-usage スキルでセルフレビュー
