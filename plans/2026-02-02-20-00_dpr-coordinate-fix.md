# DPR対応座標変換バグの調査・修正

## 問題報告

直近の変更でCanvasへの出力が壊れた:
- スクリーン座標とレイヤー座標の対応が取れていない
- ドラッグ位置とずれた場所に線が引かれる
- スクロールやズームで引いた線の位置がずれる

---

## 調査結果

### 原因特定

`renderLayerWithTransform`内で`ctx.setTransform()`を使用すると、呼び出し側で設定したDPRスケーリング（`ctx.scale(dpr, dpr)`）がリセットされてしまう。

**問題の流れ:**
```
1. ctx.scale(dpr, dpr)  // DPRスケーリング設定
2. ctx.fillRect(...)    // 背景描画 - DPRスケーリング適用 ✓
3. renderLayerWithTransform() 内で:
   ctx.setTransform(transform)  // DPRスケーリングがリセット ✗
4. レイヤーがDPRスケーリングなしで描画される
   → 座標がずれて見える
```

### 座標変換ロジック自体は正常

ユニットテストで確認:
- `screenToLayer()` / `layerToScreen()` は正しく動作
- identity transform、zoom、pan すべてのケースで正しい結果

---

## 修正内容

### PaintCanvas.tsx

DPRを考慮した変換行列を作成してから`renderLayerWithTransform`に渡す:

```typescript
// DPRを考慮した変換行列を作成
const dprTransform = new Float32Array(transform) as ViewTransform;
dprTransform[0] *= dpr;
dprTransform[1] *= dpr;
dprTransform[3] *= dpr;
dprTransform[4] *= dpr;
dprTransform[6] *= dpr;
dprTransform[7] *= dpr;

renderLayerWithTransform(layer, ctx, dprTransform);
```

### render.ts

コメント更新のみ:
- `setTransform`を使用し、呼び出し側でDPRスケーリングを含めた変換行列を渡すことを期待する設計

---

## 検証結果

- ビルド: 成功
- テスト: 71テスト全パス
- 手動テスト:
  - identity transform: ドラッグ位置に正確に描画 ✓
  - ズーム後: 正しい位置に描画 ✓
  - スクロール後: 正しい位置に描画 ✓

---

## ペンディング事項・リファクタリング課題

### 課題: クライアント側でのDPR処理の責務漏れ

**現状の問題:**

クライアントアプリ側（PaintCanvas.tsx）で以下の具体的なDPR操作を行っている:
```typescript
// 変換行列の各要素にDPRを手動で掛ける
dprTransform[0] *= dpr;
dprTransform[1] *= dpr;
// ...
```

**なぜ問題か:**
1. **一般的なニーズ**: DPRに合わせた描画はごく一般的な要件
2. **知識の要求**: クライアント側がmat3の内部構造を理解する必要がある
3. **エラーの温床**: 各アプリが独自に実装すると、バグが混入しやすい
4. **責務の漏れ**: 座標変換・描画はライブラリの責務であるべき

**あるべき姿:**

ライブラリ側でDPR対応を隠蔽する:

```typescript
// 案1: renderLayerWithTransform に dpr オプションを追加
renderLayerWithTransform(layer, ctx, transform, { dpr: window.devicePixelRatio });

// 案2: DPR対応専用関数を提供
renderLayerWithTransformDPR(layer, ctx, transform, dpr);

// 案3: 変換行列にDPRを適用するユーティリティ
const dprTransform = applyDPR(transform, dpr);
renderLayerWithTransform(layer, ctx, dprTransform);
```

**推奨アプローチ:**

案3が最もシンプルで破壊的変更が少ない:
- `@headless-paint/input` に `applyDPR(transform, dpr)` を追加
- 既存APIは変更なし
- クライアントは1行の呼び出しで対応可能

### 優先度

| 課題 | 優先度 | 理由 |
|-----|-------|------|
| DPR処理のライブラリ移管 | 中 | 機能は動作する。API改善でユーザビリティ向上 |

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| [PaintCanvas.tsx](apps/web/src/components/PaintCanvas.tsx) | DPR考慮した変換行列を生成して渡す |
| [render.ts](packages/engine/src/render.ts) | コメント更新（DPR期待の明記） |
| [render-api.md](packages/engine/docs/render-api.md) | DPR対応セクション追加 |
