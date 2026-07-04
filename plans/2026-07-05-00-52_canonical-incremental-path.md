# canonical incremental path 実装計画

## 前提

- 承認済み設計は `packages/stroke/docs/stroke-machine.md` の「live≠replay 統一: canonical incremental path」節。
- `StrokeCommand` の JSON 形状、`history.ts` / `types.ts` のコマンド型、`session.ts` の committed/pending 分割ロジックは変更しない。
- pending preview は live 専用のまま runtime に残す。

## Phase 1: API確認

- `packages/stroke/src/incremental-stroke.ts` を追加し、canonical なステッパーを定義する。
- IF は `createIncrementalStrokeRenderer(config)` から `{ feed(point), finalize() }` を返す形にする。
- ステッパーは filter/session/brush state と mixing 用 sampling layer を所有し、committed layer への append 呼び出し列を live/replay で統一する。

## Phase 2: 利用イメージ確認

- runtime: `start` の初回点、`move` の単一点、`finalize-commit` の最終 flush を同じステッパーに流す。
- replay: `command.inputPoints` を先頭から `feed` し、最後に `finalize` する。
- parity helper: 本物の `createStrokeRuntime` 経由に切り替え、live parity が runtime path を通ることを確認する。

## Phase 3: 実装

- 新規ステッパーを実装する。
- `stroke-runtime.ts` の committed append 実装をステッパーへ置換し、pending render は既存 session state を参照して維持する。
- `replay.ts` の stroke replay をステッパーに置換する。
- `parity.test.ts` の live vs replay を通常 `it` に昇格し、expected fail suppression を削除する。
- mock ベースの `replay.test.ts` を新しい呼び出しパターンに追随させる。

## Phase 4: 検証

- `pnpm build`
- `pnpm test`
- `pnpm lint`
- expected fail が 0 になり、parity (a)(b)(c) が全て green であることを確認する。

## 実装結果

- `packages/stroke/src/incremental-stroke.ts` に canonical incremental renderer を追加した。
- live の committed append は `stroke-runtime.ts` から renderer へ委譲した。pending preview 用の filter/session state は runtime 側に残した。
- replay の stroke 処理は `inputPoints` を1点ずつ `feed` し、最後に `finalize` する経路に変更した。
- parity helper は `createStrokeRuntime` 経由の live 実行に変更した。
- `parity.test.ts` の live vs replay 7ケースは通常 `it` に昇格した。

## 検証結果

- `pnpm build`: 成功
- `pnpm test`: 成功（32 files / 408 tests passed、expected fail なし）
- `pnpm lint`: 成功
