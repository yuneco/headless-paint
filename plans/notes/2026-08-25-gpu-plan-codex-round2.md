# codex review round 2 (2026-08-25) — revised plan check
# Round 2レビュー

## 総評

前回指示の大半は反映されています。E0aへ進む前に、以下の重要点だけ修正すべきです。

### Section 4 / 5.2（C7）: `fused final RGBA`をRGBA8 MAX blendで蓄積 → maskとinkの蓄積規則を分離

現行は、maskが`max(alpha)`、inkがsegmentごとの`source-over`です（`bristle-mask.ts:53-60`、`bristle.ts:358-366`）。最終premultiplied RGBA全体をMAX blendすると、inkの重なりがreferenceと一致しません。

**修正案:** 「GPU内でmaskをMAX蓄積、inkをsource-over蓄積し、最終passで合成してCanvas2Dへ1回bridge」とする。`fused`は「1 pass」ではなく「CPUへ戻さないGPU-resident pipeline」の意味に弱める。

### Section 4（C14）: branchごとにdeposit前capture＋Expand fixture → 全branch共通のstroke-start viewから先行capture

注意書き自体は正しいですが、対称展開fixtureを追加するだけでは不十分です。

- 初回captureはdeposit後に呼ばれるものの、`sourceLayer`から読むため内容はstroke開始前です（`mixing.ts:140-147`、`stamp.ts:217-253`）。
- Expand branchは逐次描画されます（`incremental-render.ts:42-60`）。
- `state.ts`はcheckpointをbranch別に保持しますが、共通のstroke-start画像は保持しません。

したがって、branch 1を直前にtargetからcaptureすると、既に描かれたbranch 0を拾います。

**修正案:** Acrylic最初のemissionを全branch分preflightし、**どのbranchも描画する前に**各bounded tileを同じtarget状態から取得してbranch stateへ格納する、と実装不変条件を明記する。fixtureは実際に初回tileが重なるExpandを必須にする。

### Section 4 / 6（C15）: `samplePressure`のspan補間をbyte-identical扱い → 演算順を変える最適化は分離

前回レビューは`samplePressure`の呼び出し頻度を指摘しましたが、span補間をbyte-identical候補としては承認していません。増分補間は浮動小数点の演算順を変え、contact境界のbooleanが変化し得ます。

**修正案:** C15 Tier Aはtrial seed hoist、fixed hash cache、同じ式のinline化までとする。span補間はbyte parity確認後にTier Aへ入れるか、C4/C18側のTier B候補へ分離する。

### Section 6 / 8.3（C12）: C12はTier一覧外だがE4aでTier B metricを要求 → C12をTier Bへ追加

**修正案:** Section 6のTier BへC12を追加し、cadence変更はmetric通過に加えて官能差なしを要求する。

### Section 8.3: Go/No-go間の空白とC6/C8の依存混在 → Hold規則追加・E3'分割

- E0aはGoが`≤3%`、No-goが`≥3%`で3%ちょうどが重複しています。No-goを`>3%`にする。
- E0bの20–30%、E1aの5–10%、E1bの10–20%、E2の25–30%、E3の15–25%は判定不能です。
- C6はE2/E3に依存せず、C2とmicrokernelに依存します。C8と同じE3'へ置くのは順序誤りです。

**修正案:** 「GoとNo-goの間はHold（記録し、後段結果後に再判定）」という共通規則を追加する。C6はC18後の独立実験へ移し、`C2予測≥20% + kernel≥2.5×`を着手条件、統合後20%を採用条件とする。E3'はC8専用とし、E2の20%差は着手条件、実装後のend-to-end 20%差を採用条件に分ける。

## Section 8.3（E0a/E0b）: 新規harness作成 → 既存2スクリプトをvariant runnerとして流用

### Rough

`benchmark-rough-production-capture.mjs`を主runnerにするのが最小です。

- `endpoints`をprimaryにする（実captureの65 native batch＋coalesced pointsを再現）。`all-accepted`は感度確認のみ。
- 既存のbatch wallとdouble RAFを維持し、最後に表示canvasの1×1 `getImageData`をdrainとして追加。
- 一時的な内部debug globalで`baseline / instrumented / null-field / null-contact / null-raster / null-drawSweep`を切り替え、同じfixtureをA/B/B/Aで実行する。
- `benchmark-rough-production.mjs`は入力fixtureに使わず、Undo/Redo操作だけ移植する。2 stroke後のUndoでreplay 1、10 stroke後のUndoでreplay 9を作り、page内のclick開始から2 RAF＋drainまでを測る。

### Acrylic

`benchmark-acrylic-backlog.mjs`をそのままlong-stroke runnerにする。

- 既存のCanvas prototype wrapperはsync charge計測として維持するが、ON/OFF可能にして3% overheadを検証する。
- 同じsynthetic往復strokeで`baseline / null-full-copy / cached-checkpoint-pixels / null-field / null-upload`を切り替える。
- null checkpointは`getImageData`だけをcached同寸ImageDataへ置換し、sampling・field update・uploadは残す。
- raw `dispatchMs/frameMs/canvasPerf`にengine側stage count、full-copy pixel数、checkpoint回数を追加する。新しい統合benchmark runnerは作らない。

この修正後であればE0a開始可能です。
