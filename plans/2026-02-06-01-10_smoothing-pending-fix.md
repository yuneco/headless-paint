# スムージング committed/pending 境界バグの調査・修正

## 問題報告

スムージングをアプリから有効にして描画すると、ストローク途中にキンク（折れ）が発生する。
committed layer と pending layer の接続部分で位置が一致しない。

---

## 調査結果

### 発見したバグ（3層）

#### 1. session.ts: committed の累積 vs 追記問題

`filter-pipeline.ts` の `processPoint` は `output.committed` を**累積的**（全committed点のリスト）に返すが、`addPointToSession` はこれを既存の `allCommitted` に**追記**していた。

```
期待: allCommitted = filterOutput.committed（置換）
実際: allCommitted = [...state.allCommitted, ...filterOutput.committed]（二重追加）
```

→ committed が二次的に増大し、描画が壊れる。

**修正**: `addPointToSession` で committed を置換方式に変更。オーバーラップ1点を含めてバッチ間のパス連続性を確保。

#### 2. session.ts: pending が committed と未接続

pending layer は committed layer と独立に描画されるため、接続点がないと隙間が空く。

**修正**: `startStrokeSession` と `addPointToSession` で、最後の committed 点を pending の先頭に付与（オーバーラップ）。

#### 3. smoothing-plugin.ts: committed/pending 境界の位置不一致（根本原因）

これが視覚的なキンクの真の原因。3つのサブ問題:

**a) pending に既 commit 点が含まれる**

バッファサイズは常に `windowSize`。commit+shift 後、バッファ先頭の `halfWindow` 個は既に committed 済み。しかし pending は全バッファ点を再計算して返していた。committed 時とは異なるウィンドウで計算されるため、同じ論理点でも位置が異なる。

```
例: windowSize=5, buffer=[P3,P4,P5,P6,P7]
- P3: committed 時は [P1,P2,P3,P4,P5] の中央（5点窓）
- P3: pending では [P3,P4,P5] の先頭（3点窓）← 位置が違う！
```

session のオーバーラップ（committed の P4）→ pending の P3 で急激な位置変化 → キンク。

**b) ストローク冒頭の点が消失**

windowSize=5 の場合、P1・P2 はバッファの中央（center）になれないため streaming 中に commit されない。最初の commit で P1 が shift out されると、P1・P2 は committed にも pending にも存在しなくなる。

**c) finalize が commit 済み点を再 commit**

finalize はバッファ全体を commit するが、先頭 `halfWindow` 個は既に streaming 中に commit 済み。重複が発生する。

---

## 修正内容

### packages/stroke/src/session.ts

- `addPointToSession`: committed を累積値で**置換**（`[...filterOutput.committed]`）
- `newlyCommitted` の開始位置に前回描画済み点を含める（オーバーラップ）
- pending の先頭に最後の committed 点を付与

### packages/input/src/plugins/smoothing-plugin.ts

`SmoothingState` に `hasCommitted: boolean` フラグを追加。

**process() の修正:**
- **初回 commit**: center 以前のエッジ点も一括 commit（P1, P2, P3 を同時に確定）
  - エッジ点は `finalize` と同じ縮小ウィンドウで計算
  - ストローク冒頭が消失しない
- **pending 出力範囲**: commit 後は `halfWindow` 以降のみ
  - center 位置の点はフルウィンドウで計算 → commit 時と同一位置
  - 既 commit 点を含めないため位置不一致が起きない
- **通常 commit**: 従来通り center の1点のみ

**finalize() の修正:**
- `hasCommitted` が true なら `halfWindow` 以降のみ commit
- 既 commit 済み点の重複を防止
- `hasCommitted` が false（短いストローク）なら全点を commit

### apps/web/src/App.tsx

- `onStrokeEnd`: `finalizePipeline` の結果を `addPointToSession` に通し、`appendToCommittedLayer` で描画
  - 以前は finalize 結果が committed layer に描画されていなかった

---

## 設計の要点

### commit 後のバッファ構造（windowSize=5, halfWindow=2）

```
buffer = [P(n-1), P(n), P(n+1), P(n+2), P(n+3)]
           ^^^^^^  ^^^^   ^^^^^^^^^^^^^^^^^^^^
           committed済み   pending（halfWindow以降）
           (0..1)         center=P(n+1) が次の commit 対象
```

### pending の最初の点が commit 値と一致する理由

pending の先頭 = buffer[halfWindow] = center。center はバッファ全体をウィンドウとして使うため、commit 時のフルウィンドウ計算と**完全に同一**の結果になる。

### session オーバーラップとの連携

```
committed layer: ...P(n-1), P(n)  ← incremental append
pending layer:   P(n), P(n+1), P(n+2), P(n+3)  ← clear+redraw
                 ^^^^
                 session が付与するオーバーラップ点
```

P(n) の位置は committed / pending 両方で同一 → キンクなし。

---

## テスト結果

- `@headless-paint/input`: 19/19 passed
- `@headless-paint/stroke`: 20/20 passed
- `pnpm build`: 全パッケージ成功
