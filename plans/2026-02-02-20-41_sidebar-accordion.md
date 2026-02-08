# サイドバーアコーディオンUI実装

## 要件

- Historyのアコーディオンを汎用化
- Minimapもアコーディオンで包む
- MinimapとHistoryの2つを連結したUIにする
- 各アコーディオンは個別に開閉可能
- DebugInfoは画面右上固定（最前面）

---

## 実装内容

### 新規コンポーネント

#### AccordionPanel.tsx
汎用アコーディオンコンポーネント:
- `title`, `badge`, `defaultExpanded`で設定
- `isFirst`, `isLast`で連結時の角丸を制御
- 既存HistoryDebugPanelのスタイルを踏襲

#### HistoryContent.tsx
HistoryDebugPanelの中身を抽出:
- Memory Usage表示
- Undo/Redoボタン
- History List（サムネイル付き）
- `getHistoryEntryCount()`ユーティリティをexport

#### SidebarPanel.tsx
MinimapとHistoryを連結:
- position: absolute, top: 16, right: 16
- AccordionPanelを2つ縦に配置

### 修正

#### Minimap.tsx
- `position: absolute`, `top`, `right`を削除
- 親コンポーネントが配置を決める設計に変更

#### DebugPanel.tsx
- `position: fixed`, `top: 0`, `right: 0`, `zIndex: 100`
- 画面右上に常に固定

#### App.tsx
- `Minimap`, `HistoryDebugPanel`を`SidebarPanel`に置換

### 削除

#### HistoryDebugPanel.tsx
- HistoryContentに置き換えたため削除

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| [AccordionPanel.tsx](apps/web/src/components/AccordionPanel.tsx) | 新規: 汎用アコーディオン |
| [HistoryContent.tsx](apps/web/src/components/HistoryContent.tsx) | 新規: History内容コンポーネント |
| [SidebarPanel.tsx](apps/web/src/components/SidebarPanel.tsx) | 新規: Minimap+History連結 |
| [Minimap.tsx](apps/web/src/components/Minimap.tsx) | 位置指定削除 |
| [DebugPanel.tsx](apps/web/src/components/DebugPanel.tsx) | position: fixed に変更 |
| [App.tsx](apps/web/src/App.tsx) | SidebarPanelに置換 |
| HistoryDebugPanel.tsx | 削除 |
