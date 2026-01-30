# Headless Paint - 段階的実装計画

## 目標
シンプルな単色ブラシでの描画機能（最初のマイルストーン）を達成する。

## 設計方針
- **早期に視覚的フィードバック**: ステップ2で画面に線が見える
- エンジンとUIの分離
- テスタビリティ（DOM非依存でユニットテスト可能）
- 各ステップは小さく、達成基準を明確に
- **関数型アプローチ**: クラスではなく関数とデータ構造で構成
- **Canvas2Dベース**: パフォーマンスのため内部でCanvas2D APIを使用

---

## ステップ 1: 基礎型定義 + 最小レイヤー ✅ 完了

**ゴール**: 型定義とレイヤー操作の基盤を作る

**成果物**:
- `packages/engine/src/types.ts`
- `packages/engine/src/layer.ts`
- `packages/engine/src/layer.test.ts`
- `packages/engine/src/index.ts`

**実装内容**:
- 基本型: `Point`, `Color`, `StrokePoint`, `LayerMeta`, `Layer`
- Layer操作関数: `createLayer()`, `getPixel()`, `setPixel()`, `getImageData()`, `clearLayer()`
- LayerはOffscreenCanvas + Canvas2D contextを持つデータ構造

**達成基準**:
- [x] `pnpm test` でレイヤーテストが通る
- [x] `pnpm build` が成功

---

## ステップ 2: 最小描画 + Web表示 ✅ 完了

**ゴール**: 画面に線が表示できる

**成果物**:
- `packages/engine/src/draw.ts` - 描画関数（Canvas2D API使用）
- `packages/engine/src/draw.test.ts`
- `apps/web/src/App.tsx`（更新）
- `apps/web/src/components/Canvas.tsx`

**実装内容**:
- `drawLine(layer, from, to, color, lineWidth?)` - Canvas2D lineToで直線描画
- `drawCircle(layer, center, radius, color)` - Canvas2D arcで円描画
- `drawPath(layer, points, color, lineWidth?)` - 点列を描画
- `Canvas` コンポーネント - ImageDataをcanvasに表示
- ハードコードしたストロークを描画して表示確認

**達成基準**:
- [x] `pnpm test` で描画テストが通る
- [x] `pnpm dev` で画面に線が表示される
- [x] **視覚確認**: ブラウザで線が見える

---

## ステップ 3: シンプルブラシ

**ゴール**: 単色の円形ブラシで描画

**成果物**:
- `packages/engine/src/brush.ts`
- `packages/engine/src/brush.test.ts`

**実装内容**:
- `BrushParams` 型（size, color）
- `stampBrush(layer, point, params)` - 円形スタンプ（drawCircle使用）
- `drawStroke(layer, points, params)` - 点列を描画（補間なし、スタンプ連打）

**達成基準**:
- [ ] `pnpm test` でブラシテストが通る
- [ ] Webで円形ブラシの跡が表示される

---

## ステップ 4: マウス入力でお絵描き

**ゴール**: マウスで実際に描ける

**成果物**:
- `apps/web/src/hooks/usePointerStroke.ts`
- `apps/web/src/App.tsx`（更新）

**実装内容**:
- `usePointerStroke` hook - pointerdown/move/upでStrokePoint[]を収集
- マウス操作 → ブラシ描画 → canvas更新のループ

**達成基準**:
- [ ] `pnpm dev` でマウスで線が描ける
- [ ] **視覚確認**: フリーハンドで絵が描ける

---

## ステップ 5: エンジン統合（単一レイヤー）

**ゴール**: 描画フローを統合するファサード関数群

**成果物**:
- `packages/engine/src/engine.ts`
- `packages/engine/src/engine.test.ts`
- `apps/web/src/hooks/usePaintEngine.ts`

**実装内容**:
- ファサード関数群（状態管理はアプリ側）:
  - `createPaintState(width, height)` - 初期状態作成
  - `beginStroke(state, point, brushParams)` - ストローク開始
  - `continueStroke(state, point)` - ストローク継続
  - `endStroke(state)` - ストローク終了

**達成基準**:
- [ ] `pnpm test` でエンジンテストが通る
- [ ] Webアプリがエンジン経由で描画

---

## ステップ 6: レイヤー合成（複数レイヤー）

**ゴール**: 複数レイヤーをNormal合成

**成果物**:
- `packages/engine/src/composite.ts`
- `packages/engine/src/composite.test.ts`

**実装内容**:
- `compositeLayers(layers)` → `ImageData`
- 状態に複数レイヤーを持てるように拡張

**達成基準**:
- [ ] `pnpm test` で合成テストが通る
- [ ] 複数レイヤーが正しく重なる

---

## ステップ 7: 入力抽象化（inputパッケージ）

**ゴール**: 入力処理をengineから分離

**成果物**:
- `packages/input/src/types.ts`
- `packages/input/src/pointer.ts`
- `packages/input/src/pointer.test.ts`
- `packages/input/src/index.ts`

**実装内容**:
- `StrokeEvent` 型（start/move/end）
- `createPointerHandler()` - イベント変換
- 筆圧・傾き情報の正規化

**達成基準**:
- [ ] `pnpm test` で入力テストが通る
- [ ] Webアプリがinputパッケージ経由で動作

---

## ステップ 8: ストローク補間

**ゴール**: 滑らかな線を描けるようにする

**成果物**:
- `packages/engine/src/stroke.ts`
- `packages/engine/src/stroke.test.ts`

**実装内容**:
- `interpolateStroke(from, to, spacing)` - 距離ベースのサンプリング
- `drawStroke` に補間を組み込み

**達成基準**:
- [ ] `pnpm test` でストロークテストが通る
- [ ] 高速に動かしても線が途切れない

---

## ステップ 9: E2Eテストと仕上げ

**ゴール**: マイルストーン1の完成確認

**成果物**:
- `apps/web/e2e/draw.spec.ts`
- `README.md`（セットアップ手順）

**達成基準**:
- [ ] E2Eテストが通る
- [ ] 全ユニットテストが通る
- [ ] `pnpm lint && pnpm build` が成功

---

## 検証方法

各ステップ完了時:
```bash
pnpm lint      # Biomeチェック
pnpm test      # Vitestユニットテスト
pnpm build     # 全パッケージビルド
```

ステップ2以降:
```bash
pnpm dev       # 開発サーバー起動、ブラウザで描画確認
```

---

## 足回り整備ルール

### トリガーとアクション

| トリガー | アクション |
|---------|-----------|
| ステップ1完了 | GitHub Actions CI設定を追加（lint, test, build） |
| ステップ3完了 | テストカバレッジ計測を追加、70%以上を目標 |
| ステップ5完了 | `CLAUDE.md` にプロジェクトルール追記 |
| ステップ9完了 | README完成、アーキテクチャドキュメント更新 |
| テスト追加時 | 新機能には必ずテストを書く（PR時にチェック） |
| lint警告発生時 | その場で修正、無視しない |

### 定期レビュー（各ステップ完了時）

1. **依存関係**: 不要なdependencyがないか
2. **型安全性**: any使用箇所がないか
3. **テスト品質**: エッジケースをカバーしているか
4. **ドキュメント**: コードと設計の乖離がないか

---

## 将来のステップ（マイルストーン1以降）

- Undo/Redo（command.ts）
- レイヤーUI（パネル、追加/削除/並び替え）
- ブラシUI（サイズスライダー、カラーピッカー）
- ブレンドモード対応
- ソフトエッジブラシ（hardnessパラメータ）
- 筆圧対応（サイズ/不透明度変化）
- パフォーマンス最適化（ダーティ矩形）

---

## 重要ファイル

| ファイル | 役割 |
|---------|------|
| `packages/engine/src/types.ts` | 全体の型定義基盤 |
| `packages/engine/src/layer.ts` | レイヤー操作関数 |
| `packages/engine/src/draw.ts` | 描画関数（Canvas2D API） |
| `apps/web/src/components/Canvas.tsx` | 表示の要 |
