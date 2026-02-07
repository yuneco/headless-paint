# ショートカットキー機能の追加

計画ファイル: `/plans/2026-02-07-18-52_keyboard-shortcuts.md`

## Context

現在キーボードショートカットはApp.tsxのuseEffect内にCmd+Z(Undo/Redo)のみ存在。ツール切り替え・対称設定・ペン太さの変更をキーボードで素早く行えるようにする。キー制御ロジックは`useKeyboardShortcuts`という1つのhookに全て集約する。

## 変更ファイル

| ファイル | 操作 |
|---|---|
| `apps/web/src/hooks/useKeyboardShortcuts.ts` | **新規作成** |
| `apps/web/src/App.tsx` | **修正** (hook追加 + 旧useEffect削除) |

パッケージAPI変更なし → `packages/*/docs/` の更新不要。

---

## Phase 1: API設計

### `useKeyboardShortcuts` hook

```typescript
interface KeyboardShortcutsDeps {
  tool: ToolType;
  setTool: (tool: ToolType) => void;
  sessionRef: MutableRefObject<unknown | null>;
  onUndo: () => void;
  onRedo: () => void;
  expandMode: ExpandMode;
  setExpandMode: (mode: ExpandMode) => void;
  expandDivisions: number;
  setExpandDivisions: (n: number) => void;
  lineWidth: number;
  setLineWidth: (w: number) => void;
}

function useKeyboardShortcuts(deps: KeyboardShortcutsDeps): void
```

戻り値なし。提供されたsetterを通じてAppの状態を駆動する。

### キーマッピング

**ツールhold-switch** (押している間だけ切替、離すと元に戻る):

| キー | ツール |
|---|---|
| Space | scroll |
| Space + Shift | offset |
| Space + Cmd/Ctrl | zoom |
| Space + Alt/Option | rotate |
| `s` | scroll |
| `o` | offset |
| `z` (修飾キーなし) | zoom |
| `r` | rotate |

**ツール切替** (押したら切り替わる、ホールド不要):

| キー | ツール |
|---|---|
| `b` | pen |

**トグル/増減** (即座に反映):

| キー | 動作 |
|---|---|
| `k` | symmetryモード切替: none → radial → kaleidoscope → none |
| ← → | divisions ±1 (範囲: 2〜12) |
| ↑ ↓ | lineWidth ±1 (範囲: 1〜50) |

**既存移植**:

| キー | 動作 |
|---|---|
| Cmd/Ctrl + Z | Undo |
| Cmd/Ctrl + Shift + Z | Redo |

### 設計方針

- **内部状態はすべてuseRef**: `toolRef`, `baseToolRef`(hold-switch前のツール), `spaceHeldRef`, 各値のref。Reactの再レンダリングを最小限にする
- **useEffect([], ...)内に全ハンドラ定義**: 値はrefで読む。既存のref-syncパターンと一貫
- **keydownハンドラの優先順位**:
  1. `isInputFocused()` ガード (input/textarea/contentEditable時は無視)
  2. Cmd+Z → undo/redo (最優先)
  3. k, 矢印キー → トグル/増減
  4. `isStrokeActive()` ガード (ストローク中はツール切替を抑止)
  5. Space/修飾キー → hold-switch
  6. 単キー(s,o,z,r) → hold-switch
  7. `b` → ペンに切替 (ホールド不要)
- **Space+修飾キーの階層**: `resolveSpaceTool(e)` で解決。Alt > Cmd/Ctrl > Shift > bare Space
- **window blur**: 全hold-switch状態をリセットしてbaseToolに復帰
- **preventDefault**: Space (ブラウザスクロール防止), 矢印キー (ページスクロール防止)

### 競合回避

| シナリオ | 解決 |
|---|---|
| `z` vs `Cmd+Z` | Cmd+Zを先にチェック→returnで消費。修飾キーなしの`z`だけがhold-switchに到達 |
| Space vs ブラウザスクロール | `e.preventDefault()` |
| ストローク中のツール切替 | `sessionRef.current !== null` で抑止 |

---

## Phase 2: 利用イメージ

### App.tsx での利用

```typescript
// import追加
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

// hook呼び出し (既存hook群の後に追加)
useKeyboardShortcuts({
  tool,
  setTool,
  sessionRef,
  onUndo: handleUndo,
  onRedo: handleRedo,
  expandMode: expand.config.mode,
  setExpandMode: expand.setMode,
  expandDivisions: expand.config.divisions,
  setExpandDivisions: expand.setDivisions,
  lineWidth: penSettings.lineWidth,
  setLineWidth: penSettings.setLineWidth,
});

// 既存のkeydown useEffect (L319-334) は削除
```

### ユーザー操作シナリオ

1. **ペンで描画中にスクロールしたい**: Space長押し → scrollモードに切替 → ドラッグでスクロール → Space離す → penに自動復帰
2. **Space+Shiftでオフセット調整**: Space押下→scroll → Shift追加→offset → Shift離す→scroll → Space離す→元のツール
3. **対称モード切替**: k押す → none→radial → k押す → radial→kaleidoscope → k押す → kaleidoscope→none
4. **ストローク太さ調整**: ↑↓で1刻みで変更、DebugPanelの値もリアクティブに更新される
5. **ペンに戻りたい**: `b`を1回押す → penに切替（離しても戻らない）
6. **描画中にうっかりキーを押す**: sessionRefがnullでないのでツール切替は無視される

---

## Phase 3: 実装

1. `apps/web/src/hooks/useKeyboardShortcuts.ts` を新規作成
   - Phase 1の設計に沿ってhookを実装
   - ref-syncパターンで全依存値をrefに同期
   - useEffect([], ...) 内にkeydown/keyup/blurハンドラを定義
2. `apps/web/src/App.tsx` を修正
   - import追加
   - hook呼び出し追加
   - 旧keydown useEffect (L319-334) 削除
3. `pnpm lint` 通過確認

## Phase 4: アーキテクトレビュー

1. hook実装がPhase 1の設計と一致しているか確認
2. 全キーマッピングが要求通り動作するか手動テスト
3. 既存のUndo/Redo動作が壊れていないか確認
4. DebugPanelとの同期（値変更がGUIに反映される）確認

---

## 検証方法

`pnpm dev` でWebデモ起動し以下を手動テスト:
- Space長押し → scroll、離すとpen復帰
- Space+Shift → offset、Shift離す→scroll、Space離す→pen
- Space+Cmd → zoom、Space+Alt → rotate
- s, o, z, r の各単キーhold-switch
- b → ペンに切替（離しても戻らない）
- k連打でsymmetryモード切替 (none→radial→kaleidoscope→none)
- ←→でdivisions変化 (2〜12で制限確認)
- ↑↓でlineWidth変化 (1〜50で制限確認)
- Cmd+Z / Cmd+Shift+Z でundo/redo動作
- DebugPanelの入力欄フォーカス中はショートカット無効
- ストローク描画中はツール切替されない
- Alt-Tab→戻っても状態がリセットされている
- `pnpm lint` 通過
