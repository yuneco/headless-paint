# updateDistanceRatio を updateDistancePx へ置き換える計画

## 背景

現在の `BrushMixing.updateDistanceRatio` は混色更新距離を `lineWidth * ratio` で決めている。これにより、小さいブラシでは更新間隔が極端に短くなって負荷が上がり、大きいブラシでは更新間隔が長くなって背景色を拾う頻度が不足する。

互換性は不要なため、`updateDistanceRatio` は外部IF・保存形式・UIから完全に削除し、絶対距離px指定の `updateDistancePx` へ置き換える。

## 調査結果

- 型定義: `packages/engine/src/types.ts`
  - `BrushMixing` に `readonly updateDistanceRatio: number`
  - `DEFAULT_BRUSH_MIXING.updateDistanceRatio = 0.5`
- 描画: `packages/engine/src/brush-render.ts`
  - `getActiveMixing` が `updateDistanceRatio` を正規化
  - `getMixingUpdateSpacing` が `Math.max(stampSpacing, lineWidth * ratio)` を返す
  - `ratio <= 0` は stamp ごとの更新として扱われる
- テスト: `packages/engine/src/brush-render.test.ts`
  - 更新頻度を下げられることを `updateDistanceRatio` の差で検証
- 永続化: `packages/react/src/persistence.ts`, `packages/react/src/persistence.test.ts`
  - 保存された `BrushConfig` の `mixing.updateDistanceRatio` を必須の finite number として検証
- UI: `apps/web/src/components/BrushPanel.tsx`
  - プリセット比較、mixing 更新、スライダー表示が `updateDistanceRatio` 前提
- プリセット: `apps/web/src/brush-presets/presets.ts`
  - `DEFAULT_BRUSH_MIXING` を展開しているため、デフォルト変更の影響を受ける
- docs:
  - `packages/engine/docs/brush-api.md`
  - `packages/engine/docs/types.md`
  - `packages/engine/docs/README.md`
  - `packages/react/docs/README.md`

## 仕様案

- `BrushMixing` から `updateDistanceRatio` を削除する。
- `BrushMixing` に `readonly updateDistancePx: number` を追加する。
  - 型レベルでは必須。元の `updateDistanceRatio` と同じく、通常の利用者は明示値または `DEFAULT_BRUSH_MIXING` 展開で値を持つ。
  - 未指定時の補完は、型を無視した入力や内部的な defensive fallback の安全策として扱う。
  - 推奨デフォルトは `8` px。
    - 小さいブラシで `lineWidth * 0.5` が 1px 未満に近づくケースを避ける。
    - 大きいブラシで 50px 以上の粗い更新になるケースを避ける。
    - `max(stampSpacing, updateDistancePx)` と組み合わせるため、スタンプ配置より高頻度にはならない。
- 混色更新間隔は `Math.max(stampSpacing, effectiveUpdateDistancePx)` とする。
- `updateDistancePx` が未指定または finite positive number でない場合は、描画時にデフォルト値へフォールバックする。
  - 互換変換はしない。`updateDistanceRatio` が入力されても読まない。
  - 永続化バリデーションでも `updateDistanceRatio` は許容・変換しない。
- `0` や負数で「stampごと更新」に戻す仕様は廃止候補。
  - 必要なら Phase 1 で `updateDistancePx: 0` を明示的な escape hatch として残すか判断する。
  - 現時点の推奨は、外部IFを単純にするため `> 0` のみ有効とし、無効値はデフォルトへ寄せる。

## 懸念点

- `updateDistancePx` は型レベルでは必須にするが、描画側の defensive fallback は残す。
  - 保存済みJSONは `updateDistancePx` を持つ形に統一する。
  - `updateDistancePx` が欠けた保存データは、互換不要の方針に従い invalid として扱う。
- デフォルト `8px` は実機負荷と描画追従のバランス値であり、最終的にはデモアプリで小ブラシ・大ブラシを触って確認したい。
- 既存の `ratio: 0` による stamp ごと更新がなくなると、最高忠実度の混色確認用設定が消える。
  - テストやデバッグ用途で必要なら `updateDistancePx` の最小値を `0` 許容にする案がある。
- `lineWidth` が筆圧で変化する場合でも、px指定は筆圧に追従しない。
  - 今回の要件は「ブラシサイズ依存をやめる」なので仕様として妥当。
- `stampSpacing` は現在どおり `lineWidth * dynamics.spacing` 由来のため、大ブラシで spacing が大きい設定では `updateDistancePx` より `stampSpacing` が優先される。
  - スタンプが存在しない地点で混色更新だけを行う設計ではないため、これは維持する。
  - `stampSpacing` は `packages/engine/src/brush-render.ts` で `spacingPx = style.lineWidth * dynamics.spacing` として計算され、ストローク上の累積距離と同じ座標系のpx値として扱われている。

## Doc-First Phase

### Phase 1: API設計・ドキュメント作成

1. `BrushMixing` の外部IFを設計する。
   - `readonly updateDistancePx: number`
   - `DEFAULT_BRUSH_MIXING.updateDistancePx = 8`
   - `updateDistanceRatio` は削除
2. `packages/engine/docs/types.md` を更新する。
   - 型定義、フィールド表、関連定数を `updateDistancePx` に変更
   - px単位、型上は必須、描画時の defensive fallback、`max(stampSpacing, updateDistancePx)` の意味を書く
3. `packages/engine/docs/brush-api.md` を更新する。
   - mixing 使用例を `updateDistancePx` に変更
   - 混色更新説明から lineWidth 比の説明と `ratio: 0` の説明を削除
4. `packages/engine/docs/README.md` と `packages/react/docs/README.md` の型説明を更新する。

### Phase 2: 利用イメージレビュー

1. `apps/web` での利用イメージを提示する。
   - mixing スライダーは `Mix Distance 8px` のように表示
   - 範囲案: `1` から `32` px、step `1`
   - ブラシ設定作成時は `DEFAULT_BRUSH_MIXING.updateDistancePx` を持つ
2. 保存形式の利用イメージを提示する。
   - 新規保存データは `mixing.updateDistancePx` を保存
   - `updateDistanceRatio` だけの旧データは invalid として扱う
3. ユーザー確認を取る。
   - デフォルト `8px` でよいか
   - `0` を stampごと更新として残す必要があるか
   - UIスライダー範囲 `1..32px` でよいか

### Phase 3: 実装

1. `packages/engine/src/types.ts`
   - `BrushMixing` と `DEFAULT_BRUSH_MIXING` を `updateDistancePx` に変更
2. `packages/engine/src/brush-render.ts`
   - `getActiveMixing` で `updateDistancePx` を正規化
   - `getMixingUpdateSpacing` を `Math.max(stampSpacing, updateDistancePx)` に変更
   - `updateDistanceRatio` 参照を削除
3. `packages/engine/src/brush-render.test.ts`
   - ratio比較テストを px比較テストへ更新
   - 小ブラシでも極端に更新頻度が上がらないことを確認できるケースを追加検討
   - 大ブラシでも更新間隔が lineWidth に引きずられないことを確認できるケースを追加検討
4. `packages/react/src/persistence.ts`
   - `mixing.updateDistancePx` を検証・復元対象へ変更
   - `updateDistanceRatio` 変換処理は追加しない
5. `packages/react/src/persistence.test.ts`
   - 有効ケースを `updateDistancePx` に更新
   - `updateDistanceRatio` のみのデータが valid にならないことをテストする
6. `apps/web/src/components/BrushPanel.tsx`
   - プリセット比較・更新関数・表示・スライダーを `updateDistancePx` に変更
   - 表示単位を px にする
7. 必要に応じて `apps/web/src/brush-presets/presets.ts` の acrylic プリセットに明示値を入れる。
   - デフォルトで十分なら `DEFAULT_BRUSH_MIXING` の展開に任せる
8. `rg updateDistanceRatio` で残存参照を確認し、現行計画メモ以外から削除する。
9. テスト・lint を実行する。
   - `pnpm --filter @headless-paint/engine test`
   - `pnpm --filter @headless-paint/react test` または該当パッケージ名確認後の react テスト
   - `pnpm build`
   - 必要なら `pnpm lint`

### Phase 4: アーキテクトレビュー

1. review-library-usage skill を使ってセルフレビューする。
2. 実装と docs の双方向整合性を確認する。
   - `BrushMixing` 型
   - `DEFAULT_BRUSH_MIXING`
   - persistence の保存形式
   - web UI 表示
3. アーキテクチャ適合を確認する。
   - engine は px距離の解釈のみ担当
   - react は保存形式の検証のみ担当
   - web はUI表示・入力範囲のみ担当
4. 残存参照確認。
   - `rg updateDistanceRatio packages apps docs`
   - `rg updateDistancePx packages apps docs`

## 完了条件

- `updateDistanceRatio` が外部IF・保存形式・UI・docs から削除されている。
- `updateDistancePx` が型レベルで必須になっている。
- 型を無視した `updateDistancePx` 未指定時にも描画側ではデフォルト値で混色更新される。
- 混色更新間隔がブラシサイズ比ではなく絶対pxを基準に決まる。
- 旧 `updateDistanceRatio` を換算する互換処理が存在しない。
- 関連テストと build/lint が通る。

## 実装結果

- `BrushMixing.updateDistanceRatio` を削除し、必須フィールド `updateDistancePx` に置き換えた。
- `DEFAULT_BRUSH_MIXING.updateDistancePx` は `8` にした。
- 混色更新間隔は `Math.max(stampSpacing, mixing.updateDistancePx)` に変更した。
- 型を無視して `updateDistancePx` が未指定・不正値になった場合は、描画時に `DEFAULT_BRUSH_MIXING.updateDistancePx` へフォールバックする。
- 永続化では `mixing.updateDistancePx` を必須として検証し、`updateDistanceRatio` の換算は行わない。
- web の Mix Distance UI は `1..32px` / step `1` の px スライダーに変更した。
- docs は `packages/engine/docs/` と `packages/react/docs/README.md` を更新した。
- 旧 `updateDistanceRatio` は本番コード・docs から削除済み。`packages/react/src/persistence.test.ts` に旧フィールドのみのデータを reject する回帰テストとして残している。

## 検証結果

- `pnpm exec vitest run packages/engine/src/brush-render.test.ts`: pass
- `pnpm exec vitest run packages/react/src/persistence.test.ts`: pass
- `pnpm run typecheck`: pass
- `pnpm lint`: pass
- `pnpm build`: pass
