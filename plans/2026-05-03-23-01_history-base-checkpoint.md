# 履歴再構築の checkpoint ベースUndo設計

## 背景

保存済みドキュメントを開いた直後、レイヤーには復元済みピクセルが存在する一方で `HistoryState` は空から開始する。現在の `rebuildLayerFromHistory()` は対象レイヤーの checkpoint が見つからない場合に `clearLayer(layer)` してから残存コマンドを replay するため、復元済みピクセルを履歴再構築の起点として扱えない。

同じ問題は `maxHistorySize` による DrawCommand trimming でも起きる。古い DrawCommand や対応 checkpoint が履歴から落ちた後、再構築の起点が「現在キャンバスに残る非undo対象ピクセル」ではなく「空 + 残存コマンド」になる。

## 問題の不変条件

`rebuildLayerFromHistory(layer, state)` が安全に動くためには、対象レイヤーについて以下のいずれかが必要。

- `currentIndex` 以下の通常 checkpoint がある
- 履歴が本当に空白キャンバスから始まったことを明示できる

現在は2つ目を暗黙前提にしているため、復元ドキュメントや trim 済み履歴で破綻する。新設計では、戻せる範囲を checkpoint が残る範囲に制限し、checkpoint がない地点へ Undo させない。

## 現在の合意案

Undo保持範囲は操作数ではなく checkpoint を基準にする。`maxHistorySize` は廃止し、`maxCheckpoints` と `checkpointInterval` で「どこまで戻れるか」と「最大replay数」を決める。

1. 履歴対象の書き込み直前に `beginHistoryMutation` を呼び、影響レイヤーの有効 checkpoint がなければ pre-write checkpoint を作る。
2. `stroke` / `clear` / `transform-layer` は対象レイヤー1枚だけを checkpoint 対象にする。
3. `wrap-shift` は全レイヤーへの書き込みとして扱い、checkpoint がない全レイヤーへ pre-write checkpoint を作る。
4. checkpoint を eviction する時、その checkpoint 以前に依存する履歴も Undo 不可として捨てる。
5. `rebuildLayerFromHistory()` は checkpoint がない対象レイヤーを黙って `clearLayer()` しない。戻せない場合は Undo 不可境界より前へ戻らせない設計にする。
6. `maxCheckpoints` は全体上限のままにし、内部の実効上限は `Math.max(config.maxCheckpoints, layerCount)` とする。
7. checkpoint圧縮は内部実装に隠蔽し、同期APIを維持できる codec として導入する。初期実装から `fflate` を内部依存として導入し、デフォルトで圧縮を有効化する。

決定済み:

- `maxHistorySize` は廃止する
- `pushCommand` の第3引数は `PushCommandOptions` に統一し、旧 `Layer | null` 形式は残さない
- `beginHistoryMutation` は独立APIとして提供する
- `pushCommand` 時に begin忘れを検出した場合は `console.warn` 固定で診断し、その command は undoable として追加せず、現在状態へ吸収して Undo 不可境界を更新する
- `checkpointInterval` はレイヤー単位で判定する
- `rebuildLayerFromHistory()` は `RebuildLayerResult` を返す
- checkpoint内部表現と圧縮ライブラリは公開APIへ出さず、`getHistoryMetrics()` で観測情報だけ提供する
- checkpoint圧縮はデフォルト `"fast"` とし、内部実装に fflate を使う
- `undoFloorIndex` は `HistoryState` に保持し、`canUndo(state)` は `state.currentIndex > state.undoFloorIndex` で判定する
- `historyStartIndex` を導入し、`undoFloorIndex` 以前の command prefix は安全に物理 pruning する
- `baseCumulativeOffset` を導入し、pruning 済み prefix の `wrap-shift` 累積値を保持する

この方式では、復元済みドキュメント読み込み時に全レイヤーの checkpoint を作らない。復元後に初めてそのレイヤーへ描く直前、その時点のピクセルを checkpoint 化するため、復元時点の線画が Undo で消える問題を防げる。

### pre-write checkpoint の責務とタイミング

`beginHistoryMutation` は「履歴対象の操作でピクセルまたはレイヤー存在が不可逆に変わる直前」に呼ぶ。低レベルAPI利用者は明示的に呼ぶ。React統合では hook 内で隠蔽する。

`beginHistoryMutation` は操作開始や操作意図の宣言ではなく、実書き込み直前の宣言として扱う。cancel や no-op で command が作られない操作が checkpoint だけを消費すると、本来Undoできた範囲を狭めるため。呼び出しタイミングは「この次の処理で実際に対象レイヤーを変更する」地点に揃える。

React統合では、pre-write checkpoint の作成を `setHistoryState(prev => ...)` の functional updater 内で行わない。React の batching や updater 実行タイミングにより、ピクセル変更後の snapshot になる危険があるため。

React側では `historyStateRef.current` を同期的な履歴状態の正本として扱う。ピクセル変更前に `beginHistoryMutation(historyStateRef.current, ...)` を同期実行し、返った state をただちに `historyStateRef.current` へ反映してからレイヤーを変更する。`setHistoryState(next)` はUI更新通知として同じ `next` を渡す。

ただし、begin 後に abort / cancel される可能性があるフローでは、`historyBeforeBegin` を保持する。begin 後に実書き込みが発生し、その後キャンセルでピクセルを元に戻す場合は、begin 済み state を破棄して `historyBeforeBegin` を `historyStateRef.current` と React state の両方へ戻す。これにより、command が push されない操作で checkpoint だけが残り続けることを防ぐ。abort しない非キャンセル操作は begin 済み state をそのまま使ってよい。

同様に、操作後の `pushCommand` も `historyStateRef.current` を入力にして同期実行し、返った state を `historyStateRef.current` と React state の両方へ反映する。

`beginHistoryMutation` は redo branch を破棄しない。begin 後に実書き込みが cancel / abort されてピクセルが元に戻る場合、ユーザーから見える新規操作は発生していないため、redo branch を失わせないため。

redo branch の破棄、checkpoint eviction、Undo不可境界の更新は、実際に command を確定する `pushCommand` 側で行う。`beginHistoryMutation` 単体は pre-write checkpoint を用意するだけで、履歴位置や Undo/Redo 可能範囲を変えない。

| 操作 | 呼ぶタイミング | 対象レイヤー |
|---|---|---|
| stroke | 最初の committed 点・線分を committedLayer に描く直前。`pendingOnly` のまま cancel された stroke では呼ばない | active layer |
| clear | `clearLayer()` の直前 | clear対象layer |
| transform-layer | `transformLayer()` の直前 | transform対象layer |
| wrap-shift | 非ゼロ移動を最初に `wrapShiftLayer()` へ適用する直前。総移動量0では呼ばない | 全レイヤー |
| remove-layer | レイヤー配列から削除する直前 | 削除対象layer |
| add-layer | add-layer command 自体ではcheckpoint不要。追加レイヤーへの最初のピクセル書き込み直前に空状態の pre-write checkpoint を作る | なし |
| reorder-layer | ピクセルは変わらないため不要 | なし |

現行実装では `remove-layer` push 時に第3引数の layer から強制checkpointを作る。新設計では責務を統一し、削除直前に `beginHistoryMutation(state, { affectedLayers: [removedLayer] })` を呼ぶ。`pushCommand` 側の remove-layer 特別扱いは廃止する。

`remove-layer` は DrawCommand ではないが、削除対象レイヤーのピクセル復元に pre-write checkpoint を必要とする structural command として扱う。削除対象レイヤーの checkpoint が eviction される場合、少なくとも対応する `remove-layer` command までは Undo 不可にする。そうしないと Undo でレイヤー枠だけ復活し、ピクセルを復元できない。

checkpoint eviction の依存範囲計算は DrawCommand だけを対象にしない。依存レイヤーは以下のように扱う。

| command | checkpoint依存 |
|---|---|
| stroke / clear / transform-layer | 対象レイヤー |
| remove-layer | 削除対象レイヤー |
| wrap-shift | 全レイヤー |
| add-layer | ピクセル復元CPには依存しない |
| reorder-layer | ピクセル復元CPには依存しない |

stroke は現在、描画完了時の `onStrokeComplete` で `pushCommand` される。一方で committedLayer への描画はストローク中に進むため、pre-write checkpoint は `onStrokeComplete` では遅い。かといって `onStrokeStart` で作ると、`pendingOnly` のまま cancel された場合に checkpoint だけが残る。新設計では、ストローク中に最初の committed 書き込みが発生する直前、または `onDrawConfirm` で初めて committed に焼く直前に確保する。

同一操作内では、最初の実書き込み直前に一度だけ `beginHistoryMutation` する。ストロークの後続 committed 追記や、wrap-shift 中の複数レイヤー処理では同じ操作内で二重に begin しない。

`pushCommand` は DrawCommand の追加時に、影響レイヤーへ有効checkpointがない状態を検出した場合、低レベルAPI利用者の `beginHistoryMutation` 呼び忘れとして診断情報を出す。warning には command type、layerId、currentIndex、推奨される `beginHistoryMutation` 呼び出しを含める。

`console.warn` は固定動作とし、設定項目は追加しない。ただし warning だけで undoable command として追加し続けると、履歴位置と実ピクセルが不一致になる危険がある。そのため begin 忘れの command は履歴に追加しない。既にピクセルは変更済みである前提で、redo branch を破棄し、`undoFloorIndex = currentIndex` まで進める。結果として過去操作へは戻れなくなるが、未記録のピクセル変更を replay 対象外として消してしまう破綻を避ける。

この挙動は低レベルAPIの誤用に対する安全側フォールバックであり、通常フローでは `beginHistoryMutation` を対象レイヤーの最初の書き込み直前に必ず呼ぶ。

`pushCommand` は「begin済みフラグ」を厳密に検証しない。correctness の基準は、command の影響レイヤーに Undo 起点として使える checkpoint coverage があることとする。

- `stroke` / `clear` / `transform-layer` / `remove-layer` は command の `layerId` から対象を導出する
- `wrap-shift` など全レイヤー影響の command は、`PushCommandOptions.affectedLayerIds` で検証対象レイヤーを受け取る
- 必要な layerId の checkpoint coverage が足りない場合、begin忘れ相当として warning を出し、command を追加しない

pending mutation scope を `beginHistoryMutation` 内に記録して `pushCommand` で消費する方式は採用しない。begin 後 cancel / abort で command が作られないケースと相性が悪く、transaction 管理が増えるため。低レベルAPIでは、begin済みかどうかではなく、push時点で安全にUndoできる coverage があるかを検証する。

### checkpointInterval の判定

現行実装の `drawsSinceCheckpoint` は履歴全体で1つのカウンタで、intervalに達した時の対象レイヤー1枚だけにcheckpointを作る。このルールをcheckpointベースUndoにそのまま持ち込むと、操作が偏った場合にUndo範囲が極端に縮む。

例: `checkpointInterval = 10` で `Layer A` に9本、`Layer B` に1本を繰り返すと、10操作目は常に `Layer B` になる。全体カウンタ方式では `Layer A` に定期checkpointが作られず、`Layer A` は初回のpre-write checkpointだけに依存し続ける。このcheckpointがevictされると、`Layer A` の未checkpoint範囲をUndo不可にする必要があり、最新の `Layer B` 付近まで `undoFloorIndex` が進む可能性がある。

新設計では `checkpointInterval` をレイヤー単位に解釈する。`beginHistoryMutation` 時に、対象レイヤーの最後のcheckpointから現在位置までの距離が `checkpointInterval` 以上なら、変更前状態で新しいcheckpointを作る。この方針で確定する。

判定式:

```typescript
state.currentIndex - lastCheckpoint.commandIndex >= config.checkpointInterval
```

`checkpointInterval` は「そのレイヤーへ何回 DrawCommand を追加したか」ではなく、「そのレイヤーの最後のcheckpointから現在の履歴位置まで何 command 離れているか」を表す。対象レイヤー以外の command が間に多数挟まった場合でも、この距離が interval に達していれば新しいcheckpointを作る。

例: `CP@A(commandIndex = 0)` の後に `Layer B` の command が5件続き、その後 `Layer A` に書き込む場合、`checkpointInterval = 5` なら `Layer A` 自体の追加操作がなくても新しい `CP@A` を作る。

- レイヤーごとにcheckpointが更新されるため、特定レイヤーが初回CPだけに依存し続ける状態を避ける
- Undo時の replay コストを対象レイヤーのDrawCommand数ではなく、履歴 command 数で抑えられる
- `wrap-shift` は全レイヤーが対象なので、各レイヤーについて同じ判定を行う
- これにより `drawsSinceCheckpoint` のグローバルカウンタは廃止する
- CP密度は増える可能性があるが、`getHistoryMetrics()` の基本情報から利用側で実ユースケース上の効率を評価する

## メモリ抑制方針

全レイヤーに full-layer `ImageData` の checkpoint を先行作成すると、`width * height * 4 * layerCount` の追加メモリが発生する。4kキャンバスかつ多レイヤーでは Safari の Canvas メモリ上限や低メモリ環境に耐えない可能性が高い。

checkpointは全レイヤーへ先行作成しない。新規ドキュメント・新規レイヤーの空状態は、必要に応じて `ImageData` を持たない empty checkpoint として表現する。

通常の stroke 追加ごとに full-layer snapshot を毎回取る設計は避ける。pre-write checkpoint が必要な場合だけ、コマンド適用前のレイヤー状態を snapshot する。

### pre-write checkpoint

レイヤーへの履歴対象書き込み直前に、そのレイヤーの有効 checkpoint が存在しなければ書き込み前状態で checkpoint を作る。

- 復元ドキュメント読み込み時には全レイヤー分の checkpoint を作らない
- 初回書き込み時にだけ `commandIndex = currentIndex` の checkpoint を作る
- 空の新規ドキュメント・新規レイヤーも、最初のピクセル書き込み直前に `{ type: "empty" }` 相当の checkpoint を作る。add-layer command 確定時には作らない
- checkpoint eviction で対象レイヤーの checkpoint がなくなっても、そのレイヤーに次回書き込む直前に現在ピクセルを checkpoint 化する
- Undo はその checkpoint 以前へは戻れないが、checkpoint 以後の新規書き込みは安全に戻せる

例:

1. `Layer A` に `A1`, `A2` を描く
2. `Layer B` に `B1` ... `B9` を描く
3. checkpoint eviction により古い `CP@A` とその依存履歴が trim され、`Layer A` の checkpoint がなくなる
4. その後 `Layer A` に `A3` を描く直前、現在の `Layer A` ピクセルを `CP@A(currentIndex)` として作る
5. `A3` の Undo では `CP@A` に戻せるため、trim 済みの `A1` / `A2` を replay できなくてもピクセルは失われない

この案では、操作前の checkpoint 確保を `beginHistoryMutation` に分離する。現状の `pushCommand(state, command, layer, config)` は操作後 checkpoint しか作れないため、API変更が必要。

`wrap-shift` も同じルールに乗せる場合、`wrap-shift` は全レイヤーへの履歴対象書き込みなので、実行直前に checkpoint を持たない全レイヤーへ pre-write checkpoint を作る。最悪 `width * height * 4 * layerCount` のコピーが発生するが、操作頻度が stroke より低く、モデルを単純化できる利点がある。

この場合、現在の `maxCheckpoints` が全レイヤー共通の固定上限である点は変更が必要。少なくとも `layerCount` 個の pre-write checkpoint を同時に保持できないと、`wrap-shift` 直前に作った checkpoint が同じ処理中に eviction される。

`maxCheckpoints` は従来どおり全体の checkpoint 予算として扱い、内部では `effectiveMaxCheckpoints = Math.max(config.maxCheckpoints, layerCount)` を使う。

pruning は checkpointベースで単純化する。古いcheckpointを捨てる場合、そのcheckpoint以前に依存する履歴も同時に捨て、その境界より前にはUndoできない。

これにより、20レイヤーで `maxCheckpoints = 10` の場合でも上限は20個に広がり、wrap-shift直前に作った全レイヤー分 checkpoint が同じ処理で eviction されない。protected checkpoint 別枠方式よりメモリ使用量を見積もりやすい。

大規模レイヤー数では、`wrap-shift` 等で `effectiveMaxCheckpoints` の大半を消費し、それ以前へ戻れなくなる場合がある。性能と保持範囲を優先するアプリは `maxCheckpoints` を `layerCount` より大きく設定する。

### 検討済み: Undo上限の基準

Undo 上限を何に依拠させるかを比較し、Bの checkpointベースを有力案とする。

#### A. 操作数ベース

`maxHistorySize` を「できる限り戻せる操作数」として維持する方式。

- まだUndo可能なコマンドについて、そのレイヤーの起点 checkpoint を保持する
- CPが古くても、対応するコマンドがUndo可能範囲に残る限り捨てない
- 操作数ベースのUndo可能数は安定する
- レイヤーが多い場合や `wrap-shift` 後は checkpoint 枠が起点保持に使われ、Undo時の replay 数が大きくなる可能性がある

#### B. checkpointベース

`maxHistorySize` を廃止し、checkpoint をUndo可能境界の基準にする方式。

- CPを捨てる時、そのCP以前に依存する履歴もUndo不可として捨てる
- CPが残っている範囲までしか戻れない
- 操作内容によってUndo可能数は変動する
- 戻れる範囲では replay 数を `checkpointInterval` 程度に抑えやすい
- 20レイヤーの `wrap-shift` のように一度に多数CPを消費する操作では、それ以前へ戻れなくなる可能性がある

論点は「固定操作数をできる限りUndoしたいか」か「Undo可能数が縮むケースを許容してでもUndo性能の上振れを避けたいか」。現状の問題（復元済みピクセル喪失）を最小メモリで防ぐだけなら、Bの checkpointベースの方がモデルは単純になる。

採用案は B。`maxHistorySize` を廃止し、CP数とCP間隔をUndo保持範囲の基準にする。CPをevictする時、そのCP以前に依存する履歴もUndo不可として捨てる。

### checkpoint eviction / Undo不可境界ルール

checkpoint eviction 時は安全側の単純ルールで Undo 不可境界を計算し、`undoFloorIndex` を前進させる。さらに `undoFloorIndex` 以前の command prefix は物理 pruning する。ただし、command index を単純に詰めるのではなく、絶対 index を保持する。

`HistoryState` には `historyStartIndex` を持たせる。`commands[0]` の絶対 command index は `historyStartIndex` であり、`currentIndex` / `undoFloorIndex` / checkpoint の `commandIndex` はすべて絶対 index として扱う。初期値は `historyStartIndex = 0`, `currentIndex = -1`, `undoFloorIndex = -1`。

絶対 index 化に伴い、commands 配列へ直接 `state.commands[state.currentIndex]` のようにアクセスしない。以下のヘルパーを導入し、`history.ts` 内部と React 統合の両方で使う。

- `getCommandOffset(state, absoluteIndex): number`
- `getCommandAt(state, absoluteIndex): Command<TCustom> | undefined`
- `getLastCommandIndex(state): number`
- `getCommandsInRange(state, fromAbsoluteIndex, toAbsoluteIndex): readonly Command<TCustom>[]`

適用範囲:

- `canRedo(state)` は `state.currentIndex < getLastCommandIndex(state)` で判定する
- `undo` / `redo` は絶対 `currentIndex` を前後させる
- `pushCommand` は `currentIndex` より後ろの redo branch を絶対 index から offset へ変換して削除する
- `findBestCheckpointForLayer` / replay 範囲 / affected layer 判定は絶対 index で比較し、command 取得は helper 経由にする
- React 統合で undo/redo 対象 command を読む箇所も `getCommandAt()` を使う

1. eviction 対象 checkpoint を選ぶ
2. evicted checkpoint と同じ layer の次checkpointを探す
3. 次checkpointがある場合、`dependencyEnd = nextCheckpoint.commandIndex`
4. 次checkpointがない場合、`dependencyEnd = evicted layer に依存する最後の command index`
5. `evictedCheckpoint.commandIndex + 1` から `dependencyEnd` の範囲に `wrap-shift` が含まれる場合、`dependencyEnd = currentIndex`
6. `undoFloorIndex = max(undoFloorIndex, dependencyEnd)`
7. `canUndo(state)` は `state.currentIndex > state.undoFloorIndex` で判定する
8. `historyStartIndex` を、保持中の checkpoint から到達可能な target index へ replay するために必要な最古 command index として再計算する
9. `historyStartIndex` より古い commands を配列から削除する
10. 不要になった checkpoints は削除する。ただし、保持中 suffix を rebuild する起点として必要な checkpoint は残す

`historyStartIndex` は、保持中の checkpoint から到達可能な任意の target index へ各レイヤーを rebuild するために必要な最古 command index である。`historyStartIndex` は `undoFloorIndex + 1` まで進められるとは限らない。`historyStartIndex <= index <= undoFloorIndex` の commands は Undo 不可だが、checkpoint から floor / suffix の状態を再構築するための replay-only prefix として保持される場合がある。

これにより、Undo不可になった `StrokeCommand.inputPoints` などは可能な範囲でメモリから解放できる。一方で、rebuild に必要な replay prefix は残るため、prefix pruning によって wrong pixels へ戻る問題を避けられる。

replay-only prefix の commands は Undo/Redo 可能数やユーザーに見える履歴件数には数えない。`canUndo(state)` は常に `currentIndex > undoFloorIndex` で判定し、`undoFloorIndex` 以下へは戻らない。

#### wrap-shift prefix の累積オフセット

command prefix を物理 pruning すると、pruned prefix 内の `wrap-shift` command も commands 配列から消える。そのままでは `computeCumulativeOffset()` が残存 commands の `wrap-shift` だけを合算し、実ピクセルに残っている累積シフトとズレる。

`HistoryState` に `baseCumulativeOffset` を追加し、`historyStartIndex` より前へ pruning される commands 内の `wrap-shift` 合計を取り込む。`historyStartIndex` 以降に replay-only prefix として残る `wrap-shift` は commands 側から合算する。

```typescript
interface HistoryState<TCustom = never> {
  readonly baseCumulativeOffset: {
    readonly x: number;
    readonly y: number;
  };
}
```

`computeCumulativeOffset(state)` は以下で計算する。

1. `baseCumulativeOffset` から開始する
2. `historyStartIndex` から `currentIndex` までの残存 command に含まれる `wrap-shift` を加算する
3. `layerWidth` / `layerHeight` で modulo 正規化して返す

これにより、古い `wrap-shift` command を pruning しても、reset offset やガイド表示が実ピクセルの累積シフトと一致する。

このルールは `wrap-shift` を含む依存区間では保守的に現在位置までUndo不可にする。Undo可能範囲が短くなる場合はあるが、実装と正しさを優先する。挙動はテストで担保する。

単純に `undoFloorIndex` 以前を削除して `currentIndex >= 0` へ正規化する実装は禁止する。物理 pruning 後も `currentIndex` / `undoFloorIndex` / checkpoint `commandIndex` は絶対 index のまま維持する。

`wrap-shift` は理論上、逆方向の `wrapShiftLayer()` を適用すれば、checkpoint がなくても戻せるケースがある。しかし初期実装では checkpoint eviction 後の wrap-shift 逆適用を最適化として扱わない。理由は、per-layer checkpoint eviction と全レイヤー変形が混在する区間で「どのレイヤーは逆適用で戻せるか」を追跡すると履歴モデルが複雑になり、missing checkpoint 時に一部レイヤーだけ履歴とピクセルがずれる危険が増えるため。

したがって、wrap-shift を含む依存区間の起点 checkpoint が evict された場合は、保守的に現在位置まで trim し、それ以前への Undo は不可にする。これは「本来戻せる可能性があるケースも Undo 範囲から落とす」トレードオフであり、実装単純性と安全性を優先する仕様として明記する。

### 採用しない別案: checkpoint group 方式

別案として、checkpoint を per-layer 単体ではなく「同一 commandIndex に複数レイヤー snapshot を持つ group」として扱う方式がある。

仕様案:

- `checkpointInterval` ごとに、前回checkpoint以降に変更された全レイヤーの snapshot を checkpoint group に保存する
- checkpoint group を捨てる時、次の group に snapshot がないレイヤーは、捨てるgroupから次groupへ snapshot を移管する
- 上限は group数ではなく、group内の layer snapshot 総数で管理する
- 上限超過時は、上限を下回るまで古い group から捨てる

メリット:

- 全レイヤーの「Undo可能な最古地点」が、残存する最古 checkpoint group の commandIndex に揃う
- Undo可能な最古地点の意味が明快になる
- per-layer checkpoint eviction 時の依存区間計算や、`wrap-shift` 特別扱いが単純になる

デメリット:

- CP作成時に、前回CP以降に変更された全レイヤーの現在 `Layer` 実体が必要になる
- 低レベルAPIでは dirty layer 管理と snapshot 対象レイヤーの受け渡し責務が重くなる
- 10枚のレイヤーを切り替えながら1ストロークずつ巡回するような操作では、CPごとに多数レイヤーのsnapshotが作られ、メモリ効率が下がる
- group eviction 時に snapshot移管が多いと、物理的に解放できるsnapshot数が少ない場合がある

今回は採用しない。理由は、低レベルAPIの責務を `beginHistoryMutation` / `pushCommand` の2段階に保ち、CP作成時に dirty layer 全体を集める要件を増やさないため。ただし、Undo可能地点の基準が明快になる点は魅力があるため、将来の別解として記録する。

### CP圧縮

現在の `Checkpoint` は `ImageData` を保持しており、OffscreenCanvas そのものは保持していない。checkpointベース案ではCPが基本的に「作成後は読み出し中心」になるため、CP圧縮を検討する。

概念上、CPは以下の状態を取りうる。

1. **未圧縮**: `ImageData` のみ。新規作成直後。
2. **圧縮状態**: 圧縮データのみ。通常の待機状態。

メモリ方針:

- `beginHistoryMutation` の実書き込み直前パスでは `getImageData` までに留め、同期deflateは実行しない
- 新しいCP作成時は raw `ImageData` として保持する
- 圧縮実行は `pushCommand` 後など、ピクセル書き込み直前ではないタイミングへ遅延する
- Undo/Redoで圧縮CPが必要になったら一時的にdecodeして使うが、decode結果を `HistoryState` へ永続キャッシュしない
- `HistoryState` は readonly object として扱い、`rebuildLayerFromHistory()` 内で hidden mutation により decode結果を永続cacheしない

圧縮方式候補:

1. PNG: 透明領域や線画に強い。ブラウザAPIでは encode/decode が async になりやすい。
2. Raw RGBA + Deflate/Zstd相当: 実装と復元パイプラインを制御しやすい。依存追加または利用環境APIの確認が必要。
3. tile/rect + 圧縮: 非空領域が小さいレイヤーでさらに効くが、実装複雑度は上がる。

ブラウザ標準の `CompressionStream` / `DecompressionStream` は Streams API ベースで async になる。同期 `rebuildLayerFromHistory()` の内部で透過的に使うのは難しい。同期CP圧縮を行う場合は、標準APIではなく `fflate` / `pako` 等の同期deflate実装を使う。

圧縮ライブラリの存在は公開APIから隠蔽し、内部 codec として差し替え可能にする。初期実装では `fflate` を使う。

現時点の同期圧縮ライブラリ候補:

1. **fflate**: 第一候補。pure JS、ESM、同期 `gzipSync` / `zlibSync` / `decompressSync` を持つ。README上の比較では pako より小さく高速。base bundle size は minified 8kB と説明されている。
2. **pako**: 安定した zlib port。同期 `deflate` / `inflate` を持つが、bundle size と速度面では fflate より不利。
3. **LZ4系**: decode/encode速度は期待できるが、圧縮率はdeflate/gzipより弱い可能性が高く、ブラウザ向けメンテナンス状況も弱め。
4. **Zstd WASM系**: 圧縮率と速度は魅力があるが、WASM初期化・bundle size・配布形態が重い。初期導入候補からは外す。

API影響:

- `rebuildLayerFromHistory()` は同期APIのまま維持する
- 圧縮/展開は同期codecで行う
- `checkpointCompression: "fast"` はデフォルト有効とするが、pre-write checkpoint 作成直前の同期圧縮は避ける
- 圧縮CPのdecode結果は transient に扱い、`HistoryState` に decoded cache として保存しない
- 圧縮CPの内部状態（未圧縮/展開/圧縮）は公開しない

## 利用者が設定するパラメータ

現在の `HistoryConfig`:

```typescript
interface HistoryConfig {
  readonly maxHistorySize: number;
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
}
```

合意案では `maxHistorySize` を廃止する。Undo保持範囲は checkpoint の個数と間隔で決まる。

候補:

```typescript
interface HistoryConfig {
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
  readonly checkpointCompression?: "none" | "fast";
}
```

- `checkpointInterval`: 対象レイヤーの最後のcheckpointから現在の履歴位置までの commandIndex 距離。小さいほどUndo時のreplayが少ないが、CP作成頻度が増える。
- `maxCheckpoints`: 保持するcheckpoint数の目標上限。内部では `Math.max(maxCheckpoints, layerCount)` が実効上限になる。
- `checkpointCompression`: CP圧縮を有効化するか。圧縮ライブラリ名は公開APIに出さず、`"fast"` は内部codecのプリセット名とする。デフォルトは `"fast"`。ただし pre-write checkpoint 作成直前には同期圧縮せず、圧縮は command 確定後のタイミングへ遅延する。

`layerCount` は React統合では `entries.length` からライブラリ側が渡すため、通常のReact利用者が直接設定しない。stroke単体APIを直接使う利用者は、`createHistoryState` または `pushCommand` の options で現在のレイヤー数を渡す必要がある。

設定例:

```typescript
const historyConfig = {
  checkpointInterval: 10,
  maxCheckpoints: 20,
  checkpointCompression: "fast",
} satisfies HistoryConfig;
```

この例では、レイヤー数が20以下なら最大20個を目標にCPを保持する。レイヤー数が50なら実効上限は50になり、wrap-shift直前に全レイヤーCPを作っても同じ処理中にevictionされない。

## 履歴メトリクス

checkpoint の内部表現（未圧縮 `ImageData`、圧縮bytes など）は通常利用の公開操作対象にしない。利用者には観測用APIとして `getHistoryMetrics()` を提供し、必要な内部情報はこのAPI経由で公開する。

候補:

```typescript
interface HistoryMetrics {
  readonly commandCount: number;
  readonly historyStartIndex: number;
  readonly currentIndex: number;
  readonly undoFloorIndex: number;
  readonly undoableCommandCount: number;
  readonly redoableCommandCount: number;
  readonly checkpointCount: number;
  readonly effectiveMaxCheckpoints: number;
  readonly rawCheckpointCount: number;
  readonly encodedCheckpointCount: number;
  readonly rawCheckpointBytes: number;
  readonly encodedCheckpointBytes: number;
  readonly totalCheckpointBytes: number;
  readonly checkpointsByLayer: readonly {
    readonly layerId: string;
    readonly count: number;
    readonly rawBytes: number;
    readonly encodedBytes: number;
  }[];
}

function getHistoryMetrics<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryMetrics;
```

`何操作戻れるか`、`redo可能数` は利用者も `HistoryState` から概算できるが、CP数、raw/encoded状態、実メモリ見積もりは内部表現に依存するためライブラリが提供する。

## API設計案

### 公開 checkpoint API の扱い

checkpoint 圧縮 payload は低レベル利用者が直接操作しない。`createCheckpoint` / `restoreFromCheckpoint` は public export しない。互換性は考慮しない方針なので deprecated ではなく削除する。

一方で `HistoryState` を plain readonly object として維持するため、`Checkpoint` / checkpoint payload の型は `@internal` として提供する。低レベル利用者が test/debug 用に state を構築・複製できる現実性を保つため。ただし、内部 payload の詳細は安定 public API ではなく、通常利用では `beginHistoryMutation()` / `pushCommand()` / `rebuildLayerFromHistory()` 経由で扱う。

低レベル利用者が checkpoint を直接作成・復元するのではなく、以下の public API 経由で履歴を操作する。

- `createHistoryState`
- `beginHistoryMutation`
- `getCommandAt`
- `getCommandOffset`
- `getCommandsInRange`
- `getLastCommandIndex`
- `pushCommand`
- `undo` / `redo`
- `rebuildLayerFromHistory`
- `getHistoryMetrics`

`HistoryState` はプロジェクト方針どおり、plain な readonly object のまま維持する。non-exported symbol 付き opaque state にはしない。

checkpoint の内部表現は `@internal` 型として `HistoryState.checkpoints` に含める。`ImageData` や圧縮bytesは型として存在するが、docs では内部実装として扱い、利用者に直接操作を推奨しない。decode結果は永続cacheとして `HistoryState` に持たせない。安定した観測情報は `getHistoryMetrics()` で提供する。

paint-app 互換確認:

- `/Users/yuki/dev/paint-app/packages/web/src/features/document/historyAtoms.ts` は現在 `createCheckpoint` / `restoreFromCheckpoint` / `state.checkpoints` の内部表現に直接依存している。
- `/Users/yuki/dev/paint-app/packages/web/src/features/document/documentDataAtoms.ts` は `createReplayBaseCheckpoints()` で `HistoryState.checkpoints` の内部表現を手動構築している。
- これらは現在の履歴モデルの不足をアプリ側で補う workaround であり、新APIで置き換え可能。
- 復元直後に全レイヤー base checkpoint を作る処理は削除できる。通常 reopen では Undo stack を空にしているため、初回書き込み直前の `beginHistoryMutation` が復元済みピクセルを snapshot する。
- IDB 由来の extra command を replay して Undo 可能にする crash-recovery 経路では、履歴を直接 `commands/currentIndex/checkpoints` の内部表現で組み立てず、空の `HistoryState` から各 command について「`beginHistoryMutation` → レイヤーへ replay → `pushCommand`」で再構築する。
- `remove-layer` Undo は `newState.checkpoints.find(...)` + `restoreFromCheckpoint(...)` を使わず、ライブラリ側の `rebuildLayerFromHistory()` と remove-layer checkpoint 依存管理に任せる。
- stroke / transform / wrap-shift / remove-layer など、paint-app 側で低レベルAPIを直接使う書き込み経路には、ピクセル変更直前の `beginHistoryMutation` 呼び出しを追加する必要がある。

### 型

```typescript
interface HistoryState<TCustom = never> {
  readonly commands: readonly Command<TCustom>[];
  readonly checkpoints: readonly Checkpoint[];
  readonly historyStartIndex: number;
  readonly currentIndex: number;
  readonly undoFloorIndex: number;
  readonly baseCumulativeOffset: {
    readonly x: number;
    readonly y: number;
  };
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly layerCount: number;
}

/** @internal */
type CheckpointPayload =
  | { readonly type: "empty" }
  | { readonly type: "raw"; readonly imageData: ImageData }
  | {
      readonly type: "encoded";
      readonly width: number;
      readonly height: number;
      readonly codec: "fflate";
      readonly bytes: Uint8Array;
    };

/** @internal */
interface Checkpoint {
  readonly id: string;
  readonly layerId: string;
  readonly commandIndex: number;
  readonly createdAt: number;
  readonly payload: CheckpointPayload;
}

interface PushCommandOptions {
  readonly afterLayer?: Layer;
  readonly affectedLayerIds?: readonly string[];
  readonly layerCount?: number;
}

interface HistoryMetrics {
  readonly commandCount: number;
  readonly historyStartIndex: number;
  readonly currentIndex: number;
  readonly undoFloorIndex: number;
  readonly undoableCommandCount: number;
  readonly redoableCommandCount: number;
  readonly checkpointCount: number;
  readonly effectiveMaxCheckpoints: number;
  readonly rawCheckpointCount: number;
  readonly encodedCheckpointCount: number;
  readonly rawCheckpointBytes: number;
  readonly encodedCheckpointBytes: number;
  readonly totalCheckpointBytes: number;
}

type RebuildLayerResult =
  | { readonly ok: true; readonly source: "checkpoint" | "empty" }
  | { readonly ok: false; readonly reason: "missing-checkpoint"; readonly layerId: string };
```

### 関数

候補:

```typescript
function createHistoryState<TCustom = never>(
  width: number,
  height: number,
  options?: {
    readonly layerCount?: number;
  },
): HistoryState<TCustom>;

function beginHistoryMutation<TCustom = never>(
  state: HistoryState<TCustom>,
  options: {
    readonly affectedLayers: readonly Layer[];
    readonly layerCount?: number;
  },
  config?: HistoryConfig,
): HistoryState<TCustom>;

function pushCommand<TCustom = never>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  options: PushCommandOptions,
  config?: HistoryConfig,
): HistoryState<TCustom>;

function getCommandOffset<TCustom = never>(
  state: HistoryState<TCustom>,
  absoluteIndex: number,
): number;

function getCommandAt<TCustom = never>(
  state: HistoryState<TCustom>,
  absoluteIndex: number,
): Command<TCustom> | undefined;

function getLastCommandIndex<TCustom = never>(
  state: HistoryState<TCustom>,
): number;

function getCommandsInRange<TCustom = never>(
  state: HistoryState<TCustom>,
  fromAbsoluteIndex: number,
  toAbsoluteIndex: number,
): readonly Command<TCustom>[];

function rebuildLayerFromHistory<TCustom = never>(
  layer: Layer,
  state: HistoryState<TCustom>,
  registry?: BrushTipRegistry,
): RebuildLayerResult;

function getHistoryMetrics<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryMetrics;
```

`pushCommand(state, command, layer, config)` の旧形式は廃止する。第3引数は必ず `PushCommandOptions` とし、履歴APIの呼び出し意図を明確にする。

`canRebuildLayerFromHistory()` / `canRebuildLayersFromHistory()` のような公開 preflight API は追加しない。`rebuildLayerFromHistory()` の `ok: false` は、通常の `canUndo` / `undo` / `redo` / `pushCommand` フローでは到達しない内部不変条件違反、または低レベルAPI利用者が壊れた `HistoryState` を渡したケースとして扱う。利用アプリ側の誤用を完全に rollback するために公開APIを増やしたり、複数レイヤー rebuild を一時レイヤーへ全量適用してから反映する仕組みは初期実装では採用しない。

防衛策は、`rebuildLayerFromHistory()` が missing checkpoint を検出した場合に対象レイヤーを変更せず `ok: false` を返すこと、および統合側が `ok: false` を受け取ったら history state を進めず warning を出すことに留める。複数レイヤー rebuild の途中で不整合が発覚した場合の完全 rollback はサポート対象外とし、その原因である coverage / `undoFloorIndex` / state 構築の不備をテストで潰す。

## Phase 1: API設計・ドキュメント作成

1. `packages/stroke/docs/types.md` に `HistoryState.historyStartIndex` / `undoFloorIndex` / `baseCumulativeOffset` / `layerCount`、plain readonly object としての `HistoryState`、`@internal` checkpoint payload、checkpointベース上限、`PushCommandOptions`、`HistoryMetrics`、`RebuildLayerResult` を追加する。
2. `packages/stroke/docs/history-api.md` に pre-write checkpoint、checkpoint eviction時の `undoFloorIndex` 更新、`rebuildLayerFromHistory()` の missing-checkpoint 時の挙動を記載する。
3. `packages/stroke/docs/README.md` の履歴API表とサンプルを更新する。
4. `packages/react/docs/README.md` と `packages/react/docs/INTERNALS.md` に、描画・clear・transform・wrap-shift直前に pre-write checkpoint を確保する責務を記載する。
5. `maxHistorySize` を廃止し、`maxCheckpoints` / `checkpointInterval` / `layerCount` / `historyStartIndex` / `undoFloorIndex` に基づくUndo保持範囲と command pruning を明文化する。`checkpointInterval` は DrawCommand 数ではなく commandIndex 距離として表現を統一する。

## Phase 2: 利用イメージレビュー

アプリ側の利用イメージを提示し、実装前に確認する。

```typescript
let history = createHistoryState(width, height, {
  layerCount: restoredEntries.length,
});

history = beginHistoryMutation(
  history,
  { affectedLayers: [activeLayer], layerCount: restoredEntries.length },
  historyConfig,
);
applyStrokeToLayer(activeLayer, stroke);

history = pushCommand(
  history,
  strokeCommand,
  { afterLayer: activeLayer, layerCount: restoredEntries.length },
  historyConfig,
);

const result = rebuildLayerFromHistory(activeLayer, history, registry);
if (!result.ok) {
  // 通常フローではここに来ない。防衛的に対象レイヤーを触らず、history state も進めない。
}
```

レビュー観点:

- 復元直後に1ストローク描いてUndoしても、復元時点のピクセルへ戻る
- `clear` / `transform-layer` / `wrap-shift` でも Undo の直前状態を失わない
- checkpoint eviction 後は、`undoFloorIndex` 以前にUndoできない
- checkpoint圧縮の有無に関わらず、圧縮ライブラリが公開APIへ露出しない

## Phase 3: 実装

1. `packages/stroke/src/types.ts` に型を追加する。
2. `packages/stroke/src/history.ts` を更新する。
   - `historyStartIndex` を導入し、command / checkpoint の `commandIndex` を絶対 index として扱う
   - `getCommandOffset` / `getCommandAt` / `getLastCommandIndex` / `getCommandsInRange` を追加し、絶対 index から配列 offset への変換を集約する
   - `undoFloorIndex` を `HistoryState` に導入する
   - `canUndo(state)` は `state.currentIndex > state.undoFloorIndex` で判定する
   - `canRedo(state)` は `state.currentIndex < getLastCommandIndex(state)` で判定する
   - `beginHistoryMutation` を追加する
   - `beginHistoryMutation` は redo branch を破棄せず、checkpoint eviction / Undo不可境界更新も行わない
   - cancel可能なフローでは begin 前 state を保持し、abort 時に begin 済み state を破棄して元の history state へ戻す利用パターンを docs と React 統合に反映する
   - `pushCommand` の第3引数を `PushCommandOptions` に統一する
   - `PushCommandOptions.affectedLayerIds` を追加し、`wrap-shift` など all-scope command の checkpoint coverage 検証に使う
   - begin忘れを検出した command は追加せず、redo branch を破棄し、`undoFloorIndex = currentIndex` まで進める
   - `pushCommand` で新規 command を確定する時に redo branch を破棄する
   - `effectiveMaxCheckpoints = Math.max(config.maxCheckpoints, layerCount)` を適用する
   - checkpoint eviction 時に依存履歴を調べ、`undoFloorIndex` を前進させる
   - `historyStartIndex` より古い command prefix を物理 pruning し、rebuild に必要な replay-only prefix と checkpoint は残す
   - pruning される prefix 内の `wrap-shift` を `baseCumulativeOffset` に取り込む
   - `computeCumulativeOffset` は `baseCumulativeOffset + suffix wrap-shift` で計算する
   - eviction の依存計算に `remove-layer` を含める
   - `getHistoryMetrics` を追加する
3. `packages/stroke/src/replay.ts` を更新する。
   - checkpoint/empty の起点を明示的に扱う
   - missing-checkpoint では clear しない
4. `packages/react/src/usePaintEngine.ts` を更新し、履歴対象書き込み直前に `beginHistoryMutation` を呼ぶ。
   - `historyStateRef.current` を同期的な正本として更新する
   - `setHistoryState(prev => ...)` の functional updater 内で pre-write checkpoint を作らない
   - checkpoint 作成結果を ref に反映してから `clearLayer` / `transformLayer` / `wrapShiftLayer` / レイヤー削除などのピクセル・構造変更を行う
   - stroke / wrap-shift では、操作開始時ではなく最初の実書き込み直前に一度だけ begin する
   - begin 後に stroke cancel 等でピクセルを復元する場合は、history state も `historyBeforeBegin` へ戻す
   - `rebuildLayerFromHistory()` が `ok: false` を返した場合は、history state を進めず、対象レイヤーを触らず、`console.warn` で診断する
5. `packages/stroke/src/index.ts` と `packages/core/src/index.ts` の export を更新する。
   - `createCheckpoint` / `restoreFromCheckpoint` は public export から外す
   - `beginHistoryMutation` / `getHistoryMetrics` / command absolute index helper を export する
   - `Checkpoint` / `CheckpointPayload` は `@internal` type として export する
6. checkpoint codec を内部実装として追加する。
   - default は `"fast"` とする
   - `"fast"` の内部実装は fflate
   - fflate は内部依存として隠蔽し、公開APIには出さない
   - pre-write checkpoint 作成直前には同期圧縮せず、圧縮は `pushCommand` 後などの安全なタイミングへ遅延する
7. `stroke` と `react` のテストを追加する。
   - 復元済みレイヤー + 空history + 新規stroke + Undo
   - checkpointなしの missing-checkpoint で clear されない
   - `wrap-shift` 直前に全レイヤー分の pre-write checkpoint を作る
   - canceled / pendingOnly stroke と総移動量0の wrap-shift では checkpoint だけが作られない
   - checkpoint eviction により `undoFloorIndex` が前進する
   - `undoFloorIndex` 前進後、Undo不可 command prefix が物理 pruning され、残る command/checkpoint は絶対 index で整合する
   - `remove-layer` 復元用checkpointがevictされたら、その `remove-layer` は undoable に残らない
   - begin忘れ時に warning を出し、unsafe command を undoable として残さない
   - checkpoint codec が同期圧縮/展開を内部に隠蔽し、pre-write直前には同期圧縮しない

### Phase 3 テスト計画詳細

| テスト対象 | ケース | 担保する仕様 |
|---|---|---|
| `rebuildLayerFromHistory()` | 復元済みピクセルがあるレイヤー、空history、新規stroke、Undo | 復元直後にbase checkpointがなくても、初回書き込み直前のCPに戻り、既存ピクセルを `clearLayer()` で消さない |
| `rebuildLayerFromHistory()` | checkpointがない地点への rebuild | missing checkpoint で黙ってclearせず、`RebuildLayerResult` で失敗を返す |
| `beginHistoryMutation()` | Undo後にbeginし、その後cancel/no-opでcommandをpushしない | begin単体では redo branch 破棄、checkpoint eviction、`undoFloorIndex` 更新が走らず、`commandCount` / `currentIndex` / `canUndo` / `canRedo` が変わらない |
| React / cancel ownership | begin後にcommitted書き込みが発生し、その後stroke cancel | ピクセルを snapshot へ戻すだけでなく、history state も `historyBeforeBegin` へ戻り、tentative checkpoint が残らない |
| `pushCommand()` | Undo後に新規操作を確定 | command確定時に redo branch の commands/checkpoints が破棄され、新規操作が古いredo branchに依存しない |
| React / stroke integration | `pendingOnly` stroke cancel | 操作開始だけではbeginせず、committed書き込みもcommandもない場合に checkpoint だけが作られない |
| React / wrap-shift integration | 総移動量0のwrap-shift | no-opでは begin も command も発生せず、履歴・checkpointを消費しない |
| `pushCommand()` | begin忘れのDrawCommand | `console.warn` を出し、unsafe command を undoable として残さず、redo branch を破棄し、`undoFloorIndex = currentIndex` へ進めて履歴とピクセルの不一致を防ぐ |
| `pushCommand()` | wrap-shift の all-scope coverage 検証 | `affectedLayerIds` 全レイヤーにUndo起点CPがあることを確認し、不足があれば begin忘れ相当で unsafe command を残さない |
| `pushCommand()` / empty checkpoint | add-layer後の新規空レイヤーへ最初のstroke | 最初のstrokeをUndoすると、追加レイヤーは存在したまま空ピクセルへ戻る。空状態CPを起点にできる |
| checkpoint eviction | remove-layer復元用CPがevictされる | 削除レイヤー復元に必要なCPが消えた後、対応する `remove-layer` command は undoable に残らず、空レイヤーだけ復活する状態にならない |
| checkpoint eviction | wrap-shiftを含む依存区間のCPがevictされる | 逆方向wrap-shiftで戻せる可能性があるケースも、仕様通り現在位置まで保守的にtrimされる |
| `undoFloorIndex` / `canUndo()` | checkpoint eviction後にUndo不可境界までUndo | `canUndo()` が `currentIndex > undoFloorIndex` を守り、evict済みCPに依存するcommandへ戻れないことを確認する |
| `historyStartIndex` / pruning | `undoFloorIndex` 前進後の command prefix pruning | Undo不可になった古い `StrokeCommand.inputPoints` が可能な範囲で commands から解放され、残る `currentIndex` / `undoFloorIndex` / checkpoint `commandIndex` が絶対 index として整合する |
| replay-only prefix | retained checkpoint から floor までの command が必要な状態 | `historyStartIndex <= undoFloorIndex` の replay-only commands はUndo不可だがrebuildに使われ、wrong pixels へ戻らない |
| absolute index helpers | pruning 後の undo/redo/replay/affected判定 | `getCommandAt` 等を経由して絶対 index から command を取得し、`state.commands[state.currentIndex]` 前提が残らない |
| `baseCumulativeOffset` | pruning 対象 prefix に wrap-shift が含まれる | 古い wrap-shift command を削除しても `computeCumulativeOffset()` が prefix + suffix の累積値を返し、reset offset が実ピクセルとズレない |
| checkpointInterval | 他レイヤーcommandが多数挟まった後に対象レイヤーへ書き込み | `currentIndex - lastCheckpoint.commandIndex >= checkpointInterval` でCPが作られ、対象レイヤーのDrawCommand数では判定しない |
| React integration | `rebuildLayerFromHistory()` が `ok: false` を返す | history state を進めず、対象レイヤーを変更せず、warning を出す |
| checkpoint codec | 圧縮有効時のUndo/Redo/rebuild | 圧縮・展開が同期的に内部で行われ、公開APIへ fflate や圧縮状態が露出しない。pre-write直前に同期圧縮せず、decode結果をHistoryStateへ永続cacheしない |

## Phase 4: アーキテクトレビュー

1. ドキュメントと実装のシグネチャ・型・デフォルト値が一致していることを確認する。
2. pre-write checkpoint と通常 interval checkpoint の責務が混ざっていないことを確認する。
3. checkpointベースUndoにより `maxHistorySize` 前提が残っていないことを確認する。
4. `stroke` 単体APIと `react` 統合APIの責務分離を確認する。
5. `review-library-usage` skill によるセルフレビューを行う。
6. `pnpm --filter @headless-paint/stroke test` と関連する `react` テストを実行する。

## 未決定事項

- なし

## 実装結果

checkpoint ベース Undo へ移行した。`maxHistorySize` と `drawsSinceCheckpoint` は廃止し、`HistoryState` に `historyStartIndex`、`undoFloorIndex`、`baseCumulativeOffset`、`layerCount` を追加した。command index は絶対 index とし、`getCommandAt` などの helper 経由で参照する。

外部 API は `beginHistoryMutation()` と `PushCommandOptions` ベースの `pushCommand()` に統一した。ピクセル変更直前に pre-write checkpoint を作り、command 確定時に coverage 検証、redo branch 破棄、checkpoint 圧縮、eviction、Undo 不可境界更新を行う。begin 忘れ時は `console.warn` を出し、unsafe command を undoable 履歴へ追加しない。

checkpoint payload は内部表現として `raw` / `encoded` を持つ。`checkpointCompression` のデフォルトは `"fast"` で、内部依存として `fflate` を使う。`createCheckpoint` / `restoreFromCheckpoint` は public export から外し、観測用に `getHistoryMetrics()` を追加した。

React 統合では `historyStateRef.current` を同期的な正本として扱い、stroke / transform / wrap-shift / remove-layer の実書き込み直前に `beginHistoryMutation()` を呼ぶ。cancel 可能な stroke / no-op wrap-shift では begin 前の state に戻し、checkpoint だけが残らないようにした。

`rebuildLayerFromHistory()` は `RebuildLayerResult` を返す。対象 checkpoint がない場合はレイヤーを clear せず `ok: false` を返す。

## 検証結果

- `pnpm --filter @headless-paint/stroke test`: pass
- `pnpm test`: pass（sandbox の local port bind 制限により初回失敗。権限付き再実行で 21 files / 283 tests pass）
- `pnpm lint`: pass
- `pnpm build`: pass
- `git diff --check`: pass

## 実装時の調整内容（補足）

当初の詳細テスト計画のうち、React 専用の追加テストは今回の差分では stroke 履歴モデルの単体テストと全体テストで担保した。React 統合は typecheck / build / 既存テストで検証している。
