# headless-paint

ヘッドレス環境で動作するCanvas2Dベースのペイントライブラリです。

## 特徴

- **ヘッドレス対応**: OffscreenCanvas を使用し、Node.js や Worker でも動作
- **関数型設計**: Layer を受け取る純粋関数として設計
- **座標変換対応**: パン・ズーム・回転のビュー変換をサポート
- **入力処理**: ポインターイベントの座標変換と間引き処理

## パッケージ構成

| パッケージ | 説明 |
|-----------|------|
| [@headless-paint/engine](./packages/engine/docs/README.md) | 描画エンジン。レイヤー管理・描画API |
| [@headless-paint/input](./packages/input/docs/README.md) | 入力処理。座標変換・ビュー変換・間引き |

## セットアップ

```bash
# リポジトリのクローン
git clone https://github.com/user/headless-paint.git
cd headless-paint

# 依存関係のインストール
pnpm install

# ビルド
pnpm build

# テスト
pnpm test
```

## 座標系

本ライブラリでは2つの座標系を使用します。

| 座標系 | 英語名 | 説明 |
|--------|--------|------|
| スクリーン座標系 | Screen Space | 出力先Canvas要素内の座標。入出力の共通座標系 |
| 論理座標系 | Layer Space | レイヤー固有座標。ストローク記録先 |

座標変換は `@headless-paint/input` パッケージの `screenToLayer` / `layerToScreen` 関数で行います。

## 基本的な使い方

```typescript
import { createLayer, drawPath } from "@headless-paint/engine";
import { createViewTransform, screenToLayer, pan, zoom } from "@headless-paint/input";

// レイヤーとビュー変換を初期化
const layer = createLayer(1920, 1080);
let viewTransform = createViewTransform();

// ビュー操作
viewTransform = pan(viewTransform, 100, 50);
viewTransform = zoom(viewTransform, 1.5, 960, 540);

// ポインターイベント処理
function onPointerMove(e: PointerEvent) {
  const screenPoint = { x: e.offsetX, y: e.offsetY };
  const layerPoint = screenToLayer(screenPoint, viewTransform);
  if (layerPoint) {
    // layerPoint をストロークに追加して描画
  }
}
```

## ライセンス

MIT
