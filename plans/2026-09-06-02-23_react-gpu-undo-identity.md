# React GPU undo-1 同一性修正（spike・コミットしない）

## Phase 1: 内部設計

useStrokeSession の DTO 変換 → usePaintEngine の createStrokeCommand が同一性を失う箇所。公開 API / persisted 形式 / 既存テスト期待値は変更しない。内部 onStrokeCommit で元 command を渡し、command.layerId の entry に push する。内部設計は packages/react/docs/INTERNALS.md に記載。

## Phase 2: 利用経路レビュー

ユーザー指定の方針 a を採用。apps/web の usePaintEngine 呼び出しは変更不要。runtime retain → 内部 callback → pushCommand bind → handleUndo executor の同一 command を維持する。キーの新設や内容照合より変更範囲が小さく、公開 onStrokeComplete は維持する。

## Phase 3: 実装・検証

React hook 経由の GPU undo ヒット回帰テストを追加。既存 byte parity 12 ケースを含む全テスト、build、lint を実行する。

## Phase 4: レビュー

API 活用、一貫性、ドキュメント整合性、検証結果を確認して記録する。

## 実装結果・検証

- useStrokeSessionWithAccelerator に非公開 onStrokeCommit を追加。usePaintEngine は再生成せず command.layerId の entry に同一 command を push。
- usePaintEngine.test.ts に StrictMode + 実 WebGL2 の bitmap/direct 2 ケースを追加。accelerator 生成 hook のみ差し替え、runtime / history / executor は実装を使用。3 stroke の retain / bind の同一性、undo restore=true、別 accelerator の rebuild との byte 一致を検証する。React DOM のテスト用 devDependencies を追加。
- `pnpm run build` 成功（typecheck、全 package / web build、publish artifact 検証を含む）。`pnpm lint` 成功。
- `pnpm exec vitest run --browser.enabled=false packages/stroke/src/gpu-undo-cache.test.ts packages/engine/src/brush/gpu/accelerator.test.ts`: 44/44 成功。
- `pnpm run test --run` と追加テスト単独実行はブラウザサーバー起動の `listen EPERM ::1:63315` で停止（テスト実行 0）。追加 2 ケース、既存 byte parity 12 ケースを含む実ブラウザ検収は未完了。全テスト green とは報告しない。
- セルフレビュー: engine/input/stroke README、history API、React README / INTERNALS と利用箇所を確認。公開型・export、persisted 形式、既存テスト期待値は変更なし。変更した内部 callback と command identity の契約を INTERNALS に反映。静的レビュー上の追加指摘なし。
- コミットしていない。
