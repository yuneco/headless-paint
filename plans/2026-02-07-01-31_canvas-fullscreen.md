# キャンバス全画面化・レイヤーサイズ調整

## 概要

アプリを全画面化し、1024x1024の論理レイヤーがビュー中央にフィットするよう調整する。

## 要件

1. 論理レイヤーサイズを 1920x1080 → 1024x1024 に変更
2. ビューサイズを固定 800x600 → 全画面（100vw x 100vh）に変更
3. ウィンドウリサイズ時は自動で再描画
4. アプリタイトル「Headless Paint」を削除
5. ツールバーを Canvas 上にオーバーレイ配置
6. 初期表示時: ビュー中央 = レイヤー中央、レイヤー全体が収まるスケール

---

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `apps/web/index.html` | グローバルスタイル追加 |
| `apps/web/src/hooks/useWindowSize.ts` | **新規作成** |
| `apps/web/src/hooks/useViewTransform.ts` | 初期フィット機能追加 |
| `apps/web/src/App.tsx` | レイアウト・定数変更 |
| `apps/web/src/components/PaintCanvas.tsx` | border削除 |

---

## 実装手順

### Step 1: index.html - グローバルスタイル追加

```html
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #root { width: 100%; height: 100%; overflow: hidden; }
</style>
```

### Step 2: useWindowSize.ts - 新規作成

- `window.innerWidth` / `window.innerHeight` を追跡
- resize イベントで更新（debounce 100ms）

### Step 3: useViewTransform.ts - 初期フィット機能追加

`setInitialFit(viewW, viewH, layerW, layerH)` を追加:
- scale = min(viewW / layerW, viewH / layerH)
- offsetX = (viewW - layerW * scale) / 2
- offsetY = (viewH - layerH * scale) / 2

### Step 4: App.tsx

- 定数: `LAYER_WIDTH=1024, LAYER_HEIGHT=1024`（CANVAS_* は削除）
- `useWindowSize()` でビューサイズ取得
- 初回マウント時に `setInitialFit` 呼び出し
- タイトル `<h1>` 削除
- ツールバーを absolute + 中央配置でオーバーレイ
- ルートを `100vw x 100vh` に

### Step 5: PaintCanvas.tsx

- `border: "1px solid #ccc"` 削除
- `display: "block"` 追加

---

## 検証方法

1. `pnpm dev` でアプリ起動
2. キャンバスが全画面、レイヤーが中央にフィット
3. ツールバーが上部中央にオーバーレイ
4. リサイズで自動再描画
5. ペンツールで描画確認

---

## 実装結果

計画通り全5ステップを実装完了。追加で以下を変更:

- リセットボタンの動作を identity transform → `fitToView`（フィット状態に戻る）に変更。全画面レイアウトではこちらが自然なUX

### ペンディング事項

なし
