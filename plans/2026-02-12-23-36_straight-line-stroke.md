# 直線ストローク機能

## Context

Shift+ドラッグで直線を描画する機能を追加する。ストローク開始時にモードが決定され、描画中は常に開始点→現在点の直線がプレビューされ、離した時点で確定する。筆圧・Expandは既存の仕組みで有効。筆圧は「ストローク中の筆圧の中央値」を線全体に適用し、外れ値に強い一定幅の線を実現する。

## 設計方針

**FilterPlugin として実装。** 既存の committed/pending モデルに自然に乗り、Session・Rendering・Replay すべてが変更なしで動作する。

### straight-line フィルタの動作

| フェーズ | committed | pending | 説明 |
|----------|-----------|---------|------|
| 1点目 | `[]` | `[p1']` | 点をpendingに保持 |
| N点目 | `[]` | `[start', pN']` | 開始点→現在点の直線プレビュー |
| finalize | `[start', end']` | `[]` | 2点をcommit、直線確定 |

- `p'` = 筆圧を中央値に置換した点
- Replay: StrokeCommand に raw inputPoints + straight-line フィルタ設定を保存。`processAllPoints` で再生

---

## 実装結果

### 変更ファイル

| パッケージ | ファイル | 内容 |
|---|---|---|
| input | `src/types.ts` | `StraightLineConfig` 型、`FilterType` に `"straight-line"` 追加、`FilterConfig` に readonly 付与 |
| input | `src/plugins/straight-line-plugin.ts` | 新規：直線フィルタプラグイン |
| input | `src/plugins/straight-line-plugin.test.ts` | 新規：テスト12件 |
| input | `src/plugins/index.ts` | プラグインレジストリに登録 |
| input | `src/index.ts` | `StraightLineConfig` 型を export |
| react | `src/useStrokeSession.ts` | `StrokeStartOptions` 型追加、`onStrokeStart` シグネチャ変更、直線パイプライン切替 |
| react | `src/useTouchGesture.ts` | `onStrokeStart` シグネチャ変更 |
| react | `src/usePaintEngine.ts` | `PaintEngineResult.onStrokeStart` 型変更 |
| react | `src/index.ts` | `StrokeStartOptions`, `StraightLineConfig` を export |
| web | `src/App.tsx` | `handleStrokeStart` ラッパーで `{ straightLine: shiftHeld.current }` 注入 |
| web | `src/hooks/useKeyboardShortcuts.ts` | `shiftHeldRef` 追加、`KeyboardShortcutsResult` で返却 |

### ドキュメント更新

| ファイル | 内容 |
|---|---|
| `packages/input/docs/filter-pipeline-api.md` | straight-line フィルタセクション、型定義セクション追加 |
| `packages/input/docs/types.md` | `FilterType`・`FilterConfig` 更新、`StraightLineConfig` 追加 |
| `packages/input/docs/README.md` | 型テーブルに `FilterType`・`SmoothingConfig`・`StraightLineConfig` 追加 |
| `packages/react/docs/README.md` | `onStrokeStart` シグネチャ変更、`StrokeStartOptions` 追加 |

### 設計ポイント

- **`onStrokeStart` シグネチャ統一**: `pendingOnly?: boolean` → `StrokeStartOptions` object に変更。拡張性向上
- **`usePointerHandler` は変更なし**: モディファイアキーの判定はアプリ側の責務
- **`useStrokeSession` 内で straight-line パイプラインを `useMemo` で事前コンパイル**: ストローク開始時に `options?.straightLine` で切替
- **Shift キー追跡は `useKeyboardShortcuts` に集約**: 当初 App.tsx に個別実装したが、デモアプリのキーボード状態管理を一元化するフックに移動

---

## 実装時の調整内容（補足）

- Phase 1 で API 設計を計画ファイルに書いただけで完了と誤認し、実際の `packages/*/docs/` への書き込みを忘れた。Phase 1 は docs ファイルへの反映までが作業範囲
- `FilterConfig` のバリアントに `readonly` 修飾子が欠落していたため、セルフレビュー時に追加修正

---

## ペンディング事項

- Phase 1 のドキュメント書き込み忘れ防止: planning-flow スキルの Phase 1 説明に「計画ファイルへの設計記述」と「docs への反映」を明確に区別する記述の追加を検討する
