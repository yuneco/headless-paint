# PoC: スタンプ方式ドライメディアブラシ

## Context

[brush-extension計画](2026-02-12-18-47_brush-extension.md)で提案したスタンプ方式ブラシの実効性を検証する。ゴール: チョーク/パステル風のドライメディアブラシ1つで描画できることを確認。PoC完了後コードは破棄。

**検証したい核心的な問い:**
1. スタンプ配置の spacing 制御が committed/pending 境界をまたいで機能するか
2. ドライメディアの質感（grain + jitter）が Canvas2D で実用レベルで表現できるか
3. pending レイヤーの毎フレーム再描画でスタンプが「踊らない」（決定論的か）

## 設計判断

| 判断項目 | 決定 | 理由 |
|---------|------|------|
| チップ生成 | 手続き的 (radial gradient + pixel dropout) | 外部アセット不要、パラメータで即調整可 |
| カラー適用 | チップに色を焼き込み | PoC最簡。色変更時にチップ再生成 |
| PRNG | mulberry32 + 位置ベースシード | committed/pending を独立に描画しても同一結果を保証（後述） |
| seed | ストローク開始座標からハッシュ | セッション単位で一意 |
| spacing境界 | accumulatedDistance を session ref に保持 | committed→pending間で距離引き継ぎ |
| spacing計算 | `baseLineWidth * spacing`（定数） | 筆圧非依存で蓄積計算が単純 |
| overlap | 補間にはoverlapポイントを使い、スタンプ配置はaccumulatedDistanceで暗黙スキップ | 二重スタンプ回避 |
| StampConfig配置 | `types.ts` に定義 | StrokeStyle が参照するため stamp.ts に置くと循環依存 |
| Undo/Redo | スキップ | PoC範囲外 |
| Expand(対称) | そのまま動作 | expandStrokePointsの後にスタンプ描画するだけ |
| 既存round-pen | 残す（`brushType`で分岐） | 比較用 |

## 実装結果

### 核心的な問いへの回答

| # | 問い | 回答 | 詳細 |
|---|------|------|------|
| 1 | spacing 制御が committed/pending 境界をまたいで機能するか | **Yes** | `accumulatedDistance` を session ref に保持し引き継ぐことで、境界をまたいだ連続配置を実現。二重スタンプやギャップなし |
| 2 | ドライメディアの質感が Canvas2D で実用レベルか | **Yes** | radial gradient + pixel dropout で grain/softness パラメータが視覚的に明確。8パラメータ全て効果を確認 |
| 3 | pending レイヤーの再描画でスタンプが決定論的か | **Yes（設計上）** | 位置ベースシード `hashSeed(seed, round(distance * 100))` により、committed/pending 独立でも同一距離位置のスタンプは同一 jitter |

### 変更ファイル一覧

| ファイル | 変更種別 |
|---------|---------|
| `packages/engine/src/types.ts` | StampConfig + DEFAULT_STAMP_CONFIG 追加、StrokeStyle 拡張 |
| `packages/engine/src/stamp.ts` | **新規**: PRNG, チップ生成, drawStampStroke |
| `packages/engine/src/index.ts` | export 追加 |
| `packages/engine/src/incremental-render.ts` | stamp 分岐、戻り値 void→number |
| `packages/react/src/usePenSettings.ts` | brushType, stampConfig state 追加 |
| `packages/react/src/useStrokeSession.ts` | stamp 距離追跡 + tip 生成統合 |
| `packages/react/src/index.ts` | StampConfig re-export |
| `apps/web/src/components/DebugPanel.tsx` | Stamp Brush フォルダ追加 |

### 実装時の調整内容（補足）

| 項目 | 計画 | 実際 | 理由 |
|------|------|------|------|
| StampConfig 配置 | `stamp.ts` | `types.ts` | StrokeStyle が参照するため stamp.ts に置くと循環依存 |
| PRNG方式 | sequential（ストローク単位シード） | 位置ベース `hashSeed(seed, distance)` | sequential だと pending 再描画時に committed スタンプ数を復元する必要があり複雑。位置ベースなら independent に描画可能 |
| spacing 計算 | 直径比率（筆圧で変動） | `baseLineWidth * spacing`（定数） | 筆圧連動 spacing は蓄積計算が非線形で PoC では複雑すぎた |
| `drawStampStroke` の `color` 引数 | 使用前提 | 未使用（`_color`） | チップに色を焼き込む設計のため関数内では不要。シグネチャは将来用に維持 |
| `App.tsx` 変更 | 配線修正 | **変更不要** | strokeStyle に brushType/stampConfig が含まれ、既存のデータフローで自動的に伝播 |

### 本実装に向けた改善点

- **Undo/Redo**: StrokeCommand に stampConfig + stampSeed を保存してリプレイ対応
- **tipCanvas キャッシュ**: 同一パラメータでのストローク開始時に再生成を避ける
- **筆圧連動 spacing**: 定数 spacing でも視覚的に問題なかったが、本実装では検討の余地あり
- **`color` パラメータ設計**: drawStampStroke に color を渡す代わりに、tip 生成を呼び出し側の責務にする（現在の設計で正解）
- **型配置ルール**: interface は参照元（types.ts）に置き、実装のみ機能モジュール（stamp.ts）に置く

## Doc-First Phase 作業手順

> PoC（破棄前提）のため API ドキュメントの正式更新はスキップ。
> Phase 1 で型設計を固め、Phase 2 で利用イメージを確認してから実装した。

### Phase 1-2: 型設計 + 利用イメージ

**StampConfig**: spacing, opacityJitter, sizeJitter, rotationJitter, scatter, flow, grain, softness の8パラメータ。
**StrokeStyle 拡張**: `brushType?: "default" | "stamp"`, `stampConfig?: StampConfig`。
**新規関数**: `createDryMediaTip`, `drawStampStroke`, `createStampSeed`（いずれも `stamp.ts`）。
**既存関数変更**: `appendToCommittedLayer` / `renderPendingLayer` に stamp 引数追加、戻り値 void→number。

利用フロー: DebugPanel → usePenSettings（state管理）→ strokeStyle → useStrokeSession（tip生成 + 距離追跡）→ incremental-render（stamp分岐）。

### Phase 3: 実装

Step 1（型 + コア）→ Step 2（レンダリング統合）→ Step 3（UI配線）の順で実施。
App.tsx の変更は不要だった（strokeStyle の自動伝播で対応）。

### Phase 4: 検証

全 Checkpoint 通過: ビルド成功、237テスト通過、DebugPanel 表示、描画確認、パラメータ応答確認。
