# 線対称・点対称・万華鏡ペイント機能 実装計画

## 概要

1入力から複数のストロークを生成する対称ペイント機能を追加。

| モード | 生成数 | 説明 |
|--------|--------|------|
| none | 1 | 既存動作 |
| axial（線対称） | 2 | 任意の対称軸で反射 |
| radial（点対称） | N | 原点を中心にN分割回転 |
| kaleidoscope（万華鏡） | N×2 | 点対称 + 各セグメント線対称 |

---

## アーキテクチャ

```
Screen Space (入力)
    ↓ screenToLayer(transform)
Layer Space (1点)
    ↓ expandSymmetry(point, compiled)
Layer Space[] (N点)
    ↓ drawPath() × N (リアルタイム描画)
    ↓ onStrokeEnd時: BatchCommand として履歴に追加
```

**対称変換ロジックは `@headless-paint/input` パッケージに配置**
- 既存の座標変換と同じ場所に配置
- gl-matrix の mat3 で行列演算
- app側は `expandSymmetry()` を呼ぶだけ

**履歴統合（@headless-paint/history）**
- 対称描画の複数ストロークは `BatchCommand` として1つにまとめる
- 1回のUndoで対称描画全体が戻る

---

## 実装ファイル

### Phase 1: inputパッケージ（コアロジック）

| ファイル | 変更内容 |
|----------|----------|
| [types.ts](packages/input/src/types.ts) | SymmetryConfig等の型定義を追加 |
| [symmetry.ts](packages/input/src/symmetry.ts) | **新規** - 対称変換ロジック |
| [index.ts](packages/input/src/index.ts) | エクスポート追加 |
| [symmetry.test.ts](packages/input/src/symmetry.test.ts) | **新規** - ユニットテスト |

**主要API:**
```typescript
// 設定変更時に1回だけ呼び出し（行列をキャッシュ）
compileSymmetry(config: SymmetryConfig): CompiledSymmetry

// ストローク中の各点で呼び出し（高速）
expandSymmetry(point: Point, compiled: CompiledSymmetry): Point[]
```

### Phase 1.5: historyパッケージ（BatchCommand追加）

| ファイル | 変更内容 |
|----------|----------|
| [types.ts](packages/history/src/types.ts) | `BatchCommand` 型を追加 |
| [command.ts](packages/history/src/command.ts) | `createBatchCommand` 関数を追加 |
| [replay.ts](packages/history/src/replay.ts) | BatchCommand の再生対応 |

### Phase 2: app側Hook

| ファイル | 変更内容 |
|----------|----------|
| [useSymmetry.ts](apps/web/src/hooks/useSymmetry.ts) | **新規** - 対称状態管理Hook |
| [App.tsx](apps/web/src/App.tsx) | onStrokeMove/Endで対称描画 + BatchCommand生成 |

### Phase 3: UI（段階的実装）

| ファイル | 変更内容 |
|----------|----------|
| [SymmetryOverlay.tsx](apps/web/src/components/SymmetryOverlay.tsx) | **新規** - ガイド線表示のみ（ドラッグは後日） |
| [DebugPanel.tsx](apps/web/src/components/DebugPanel.tsx) | 対称モード・設定の操作UIを追加 |

**デフォルト設定:**
- 線対称: レイヤー中央で垂直軸（左右対称）
- 点対称: 6分割
- 万華鏡: 4分割

---

## パフォーマンス最適化

1. **行列キャッシュ**: `compileSymmetry()` で事前計算、設定変更時のみ再計算
2. **vec2.transformMat3直接使用**: 軽量な座標変換
3. **描画呼び出し最小化**: 対称ストロークごとに1回のdrawPath

---

## UI設計

### Phase 1 構成（今回実装）

```
<div style="position: relative">
  <PaintCanvas />                    <!-- 既存 -->
  <SymmetryOverlay>                  <!-- 新規 -->
    <canvas pointer-events="none" /> <!-- ガイド線のみ -->
  </SymmetryOverlay>
  <DebugPanel />                     <!-- 対称設定UIを追加 -->
</div>
```

**DebugPanelに追加するUI:**
- モード選択（none / axial / radial / kaleidoscope）
- 分割数スライダー（radial / kaleidoscope時）
- 角度オフセットスライダー

**ガイド線表示:**
- 線対称: 対称軸を実線で描画
- 点対称: 原点を丸で表示 + 分割線を実線で描画
- 万華鏡: 原点 + 分割線（実線）+ 反射軸（点線）

---

## 変換数学

### 線対称（axial）
```
R = T(origin) × Rotate(-θ) × FlipY × Rotate(θ) × T(-origin)
```

### 点対称（radial）
```
R_i = T(origin) × Rotate(2πi/N + offset) × T(-origin)
```

### 万華鏡（kaleidoscope）
```
偶数i: 純粋回転
奇数i: 回転 + 反射
```

---

## 検証方法

1. **ユニットテスト**: 既知の座標で変換結果を検証
2. **手動テスト**:
   - 各モードで描画が正しく対称になるか
   - ガイド線がViewTransformに追従するか
   - **Undo/Redo で対称ストローク全体が1操作で戻る/進むか**
3. **パフォーマンス**: N=12の万華鏡で滑らかに描画できるか

---

## 実装順序

1. inputパッケージ: 型定義追加（types.ts）
2. inputパッケージ: 対称変換ロジック実装（symmetry.ts）+ テスト
3. historyパッケージ: BatchCommand追加（types.ts, command.ts, replay.ts）
4. app: useSymmetry Hook実装
5. app: App.tsxで対称描画 + 履歴統合
6. app: SymmetryOverlay実装（ガイド線表示のみ）
7. app: DebugPanelに対称設定UI追加

**将来拡張（別タスク）:**
- 対称軸ドラッグ操作
- 専用ツールバー

---

## 実装結果（2026-02-02）

### 完了した項目

| パッケージ | ファイル | 内容 |
|-----------|---------|------|
| input | types.ts | `SymmetryMode`, `SymmetryConfig`, `CompiledSymmetry` 型 |
| input | symmetry.ts | `compileSymmetry`, `expandSymmetry`, `getSymmetryCount` |
| input | symmetry.test.ts | 13テスト（全パス） |
| history | types.ts | `BatchCommand` 型 |
| history | command.ts | `createBatchCommand` 関数 |
| history | replay.ts | BatchCommand の再生対応 |
| app | useSymmetry.ts | 対称状態管理Hook |
| app | SymmetryOverlay.tsx | ガイド線表示 |
| app | App.tsx | 対称描画 + BatchCommand履歴統合 |
| app | DebugPanel.tsx | 対称設定UI（モード/分割数/角度） |

### 動作確認結果

- ビルド: 全パッケージ成功
- テスト: 71テスト全パス
- 手動テスト:
  - axial（線対称）: batch (2 commands) ✓
  - radial（点対称 6分割）: batch (6 commands) ✓
  - Undo/Redo: 対称描画全体が1操作で戻る/進む ✓

---

## ペンディング事項・リファクタリング課題

### 課題1: App側への責務漏れ

**現状の問題:**
```
現在の App.tsx は以下の詳細な責務を負っている:
- symmetryStrokesRef で対称展開した座標配列を管理
- onStrokeMove で expandSymmetry() を呼び出し、各対称ストロークにポイント追加
- onStrokeEnd で validStrokes の数に応じて Command / BatchCommand を分岐生成
```

**あるべき姿:**
```
App は以下のみに関心を持つべき:
- 対称設定（mode, divisions, angle）
- 入力ストローク（元の1本のポイント列）
- 描画完了イベント

対称展開・マルチストローク管理・履歴コマンド生成はライブラリ側で隠蔽
```

**背景:**
ライブラリパッケージ側にステートを持たせないクリーンな設計を維持するための制約。ステートレスな関数群として提供しているため、App側でステート管理が必要になっている。

**検討すべきアプローチ:**
1. **Facade関数の提供**: 複数の操作をまとめたヘルパー関数を提供
   ```typescript
   // 例: useSymmetryStroke() Hook
   const { startStroke, moveStroke, endStroke } = useSymmetryStroke(config, layer)
   ```
2. **コールバックベースAPI**: ストローク管理ロジックを引数で受け取る高階関数
3. **ミドルウェアパターン**: 入力→対称展開→描画のパイプラインを構築

### 課題2: 履歴コマンドのデータ肥大化と情報欠落

**現状の問題:**
```typescript
// 現在の保存形式（radial 6分割の例）
BatchCommand {
  type: "batch",
  commands: [
    DrawPathCommand { points: [...100点...] },  // 展開後ストローク1
    DrawPathCommand { points: [...100点...] },  // 展開後ストローク2
    DrawPathCommand { points: [...100点...] },  // 展開後ストローク3
    DrawPathCommand { points: [...100点...] },  // 展開後ストローク4
    DrawPathCommand { points: [...100点...] },  // 展開後ストローク5
    DrawPathCommand { points: [...100点...] },  // 展開後ストローク6
  ]
}
// → 600点のデータを保持（6倍に肥大化）
// → 対称設定の情報が欠落（後から変更不可）
```

**あるべき姿:**
```typescript
// 理想の保存形式
SymmetricDrawPathCommand {
  type: "symmetricDrawPath",
  sourcePoints: [...100点...],  // 元のストロークのみ
  symmetryConfig: { mode: "radial", origin, angle, divisions: 6 },
  color, lineWidth,
}
// → 100点 + 設定のみ保持（1/6のサイズ）
// → 対称設定を保持（後から再計算可能）
```

**メリット:**
- データサイズ削減（N分割なら1/Nに）
- 対称設定の保持（将来的に対称設定の事後変更が可能に）
- 再生時に動的に展開（`expandSymmetry` を使用）

**検討事項:**
- 新しい `SymmetricDrawPathCommand` 型の追加
- replay.ts での対称展開処理の追加
- 既存の BatchCommand との互換性

### 優先度

| 課題 | 優先度 | 理由 |
|-----|-------|------|
| 課題1: App責務漏れ | 中 | 機能は動作する。API改善はユーザビリティ向上 |
| 課題2: データ肥大化 | 高 | ストローク数増加でメモリ使用量が顕著に増加 |

### 次のアクション

1. 課題2を先に対応: `SymmetricDrawPathCommand` の設計・実装
2. 課題1は課題2の設計を踏まえて再検討（両者は関連する可能性）
