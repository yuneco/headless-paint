# ブラシ透明度の調査・設計候補

2026-09-08。調査のみ。未コミット変更を含む現 working tree を参照した。production 実装・公開 API ドキュメントは変更していない。以下は採用前の候補で、Procreate の内部実装を再現・確認したものではない。

## 結論

要求は「stroke 全体の alpha 上限」ではなく、**一度の通過で付着する色の不透明度を制御し、再通過ではさらに重ねること**。同じ通過を描くための dab / triangle / chunk の重複と、本当に塗り直した重複を区別する必要がある。

- stamp: dab 密度に応じた alpha 正規化が第一候補。MyPaint に同じ原理の公開実装がある。既存 CPU/GPU の deposit 経路を活用でき、自己交差検出は不要。ただし直線の定常部を基準とする近似であり、全画素・全形状を厳密に設定値にするものではない。
- round-pen / bristle: 現在の図形重複をそのまま半透明にできない。通過に対応する coverage と、描画分割に由来する重複の管理が別途必要。
- spray: 粒子の重なりと静止吹き付けによる蓄積が表現の本体。共通の opacity UI は設けられるが、定速直線の通過濃度と粒子の透明度をどう対応させるか、別の意味論が必要。

「全ブラシに globalAlpha を追加」だけで要求が満たせる、とは判断しない。

## 他製品で確認できたこと

1. [Procreate Brush Studio Settings](https://help.procreate.com/procreate/handbook/5.2/brushes/brush-studio-settings): Rendering mode は Light Glaze / Uniformed Glaze / Intense Glaze / Heavy Glaze / Uniform Blending / Intense Blending に分かれ、Flow、Apple Pencil の Opacity、ブラシの opacity limits などを持つ。透明度 UI があっても全ブラシの合成則が同一とは限らない。公開説明に自己交差の判定法や dab alpha の計算式はない。今回の調査では実機比較をしていない。
2. [Krita Opacity and Flow](https://docs.krita.org/en/reference_manual/brushes/brush_settings/opacity_and_flow.html): flow は dab、opacity は stroke の透明度と説明。Wash と Build-up があり、後者では opacity を flow として扱う。したがって「opacity と名付けた設定を追加」だけでは今回の要求を定義できない。
3. [MyPaint brushsettings.json](https://github.com/mypaint/libmypaint/blob/master/brushsettings.json): `opaque_linearize` は重ねた dab の非線形性を補正する設定。0 は dab 単位、1 は推定重なり数に基づく stroke の濃度を表す。scatter や時間 dab では調整が必要と明記されている。
4. [MyPaint mypaint-brush.c](https://github.com/mypaint/libmypaint/blob/master/mypaint-brush.c#L961): `prepare_and_draw_dab` で半径あたりの dab 数から画素あたりの重なり数を推定し、`1 - (1 - opacity)^(1/N)` へ変換している。コード自身も半径変化時の重なり数は概算としている。参照は調査時の master で、将来の実装時は revision を固定する。

## 現実装

| 対象 | 確認箇所 | 透明度追加時の問題 |
|---|---|---|
| 公開 style | `packages/engine/src/types.ts` の `StrokeStyle` | 独立した opacity はない。`Color.a` は存在するが通過濃度を表さない |
| stamp | `brush/stamp.ts` の `stampAt` | `pressureFlow × opacityJitter` を Canvas `globalAlpha` / GPU dab alpha に渡す。密な dab は source-over で飽和する |
| tip | `brush/tip.ts` | circle の radial gradient / image alpha に色の alpha が入る。柔らかい tip は画素ごとの mask が異なる |
| scheduler | `brush/scheduler.ts`、`stamp.ts` | 距離・時間 emission、可変 spacing がある。サイズ計算には平滑化した筆圧、可変 spacing には補間点の筆圧を使うので、正規化が同じ実効径を仮定できるとは限らない |
| round-pen | `draw.ts` の `drawVariableWidthPath` | 円と台形を個別に fill。連続部分にも人工的な多重描画がある |
| bristle CPU | `brush/bristle.ts` の `renderSweepRun`、`bristle-mask.ts` | run 内 mask は max alpha、run の ink をレイヤーへ source-over。run/chunk 境界の overlap を持つ |
| bristle GPU | `brush/gpu/bristle-pass.ts` | mask は `gl.MAX`、chunk composite は source-over。CPU と同じ境界問題がある |
| spray | `brush/spray.ts` | flow は各粒子の alpha。粒子密度と時間 emission が濃度に影響する |
| 増分・再生 | `incremental-render.ts`、engine / stroke docs | branch ごとの状態、pending の clone、混色 checkpoint、replay と整合する必要がある |

参照 docs: `packages/engine/docs/{brush-api,types,draw-api,incremental-render-api,gpu-acceleration}.md`、`packages/stroke/docs/command-executor.md`。brush-api は bristle の半透明 paint を初期対象外とし、chunk overlap が見える可能性を明示している。

GPU stamp は既に instance ごとの alpha を持つ。ただし現 GPU 適格条件は mixing stamp または bristle、source-over、alpha lock 無効など。非混色 stamp / spray は CPU のみであり、「全ブラシが既に GPU 対応」とは扱わない。

## 候補 A: 通過濃度から dab alpha を逆算する

同色・通常合成で、ある画素に alpha `a` の dab が N 個重なると:

```
A = 1 - (1 - a)^N
a = 1 - (1 - T)^(1/N)
```

T は一度の通過で目標とする不透明度。50% にしたいとき、N=10 なら dab alpha は約 6.697%。もう一度同じ条件で通れば `1 - (1 - 0.5)^2 = 0.75`。ペンを離したかどうかには依存しない。透明レイヤーでは出力 alpha、不透明下地では新しい色の寄与率の話であり、下地の alpha が 75% になるという意味ではない。

Python の浮動小数点計算で確認した値（Canvas/GPU 実描画テストではない）:

| 重なり数 N | dab を直接50%にした結果 | 正規化後の dab alpha | 一通過 | 二通過 |
|---|---:|---:|---:|---:|
| 4 | 93.7500% | 15.9104% | 50% | 75% |
| 10 | 99.9023% | 6.6967% | 50% | 75% |
| 20 | 99.9999% | 3.4064% | 50% | 75% |

hard circle・一定径 D・一定間隔 s なら中心線の重なり数はおよそ D/s。入力イベント数や flush 数ではなく、実際の距離 spacing と tip 径から決める。

### 柔らかい tip と較正

実際には画素でサンプルする tip mask を `m_i` として:

```
A(a) = 1 - product(1 - a * m_i)
```

になる。一つの固定 N で任意の T に厳密一致はできない。mask 列 `[.2,.4,.6,.8,1,.8,.6,.4,.2]` を例に、T=.5 で N を合わせると N≈4.88657。T=.1 では .10186、T=.9 では .88687 になった。これは簡単な数式実験で、実ブラシの誤差見積もりではない。

既存 agents-note の「直線を一度描いて N を較正すればよい」は近似案としては妥当だが、正確な較正には補足が必要。alpha=1 で飽和した一本から N は復元できない。より正確にするなら tip alpha を元に複数位相・方向の基準直線を評価し、目標 T ごとに上式を数値的に逆算した LUT を作る。tip / hardness / spacing / 実効サイズ比の変更で再評価が必要。tip に穴がある場合など、達成不能な目標は最も濃くできる状態までとする。

### flow と opacity の共存案

既存 flow を黙って別の意味に変えず、opacity=1 で既存結果を維持する案を優先する。例えば flow=1 の基準通過について求めた係数を `k(opacity, tip, spacing, size)` とし、既存の pressureFlow・jitter に掛ける。k(1)=1 を契約にすれば従来互換を保てる。

この場合「opacity は flow=1 の基準通過の目標、flow が低ければそれより薄い」と明記する。flow と opacity をともに同じ scalar alpha へ反映する以上、両者が完全に独立した視覚効果になるわけではない。Wash のような厳密な濃度上限とも違う。opacity の筆圧応答を追加する場合、flow の筆圧応答との二重適用は意識して設計する。

### 限界

- タップ・始終端は N 個そろわず薄くなる。タップも50%にするには別の端点処理が必要。最初の dab を安易に強くすると線の始点が濃い塊になる。
- 急な太さ・筆圧変化は過去 dab の寄与を含むため、現在の径だけで厳密補正できない。
- 急カーブの内側、小さなループ、折り返し直近は通常の直線より接触密度が増す。濃くなること自体は自然だが、全域を常に「50%、交差だけ75%」に区切る方式ではない。
- scatter / 回転 / size jitter / 画像 tip は方向と確率に依存する。過剰な補償でテクスチャの意図を消さない。
- 時間 emission まで速度で相殺すると吹き付けが濃くならなくなる。距離通過と静止蓄積の契約を分ける。
- 低 alpha・密な spacing では RGBA8 の繰り返し丸め誤差を実機評価する。係数の式だけを正しくしても画素結果の一致は保証されない。
- opacity=0/1 の端値、tip の元 alpha、色の alpha、混色 material alpha の乗算順を定義する。

## 候補 B: 一度の通過の coverage を管理する

round-pen / bristle で境界まで均一な半透明を求めるなら、隣接図形を一度の通過として処理し、後から戻ってきた通過だけ source-over する。

候補は sweep の隣接区間の重複を取り除いた geometry、または局所 coverage と接触履歴を持つ合成器。単に全 stroke の mask を max にすると自己交差も消える。逆に chunk ごとに max にして半透明で転写すると chunk 境界が濃くなる。単一 Canvas path の一括 fill も自己交差で二回の塗りを保証しない。

接触履歴方式でも「画素から離れて再進入」を再通過とするだけでは、太いブラシが画素を覆ったまま折り返すケースを区別できない。向き・軌道の進行・sweep の枝を含めて通過を定義する必要がある。cusp で全域を一括区切りするだけでは接合部分に継ぎ目を作り得る。

bristle では紙目への再接触による着彩面積の増加と、着彩片の半透明の積み重ねを別に維持する。さらに run 内の自己交差も max に潰れ得るので、CPU/GPU とも run の中と境界を扱う必要がある。これは既存メモの「composite に係数を掛けるだけ」より大きい変更。

混色がある場合、coverage の更新を透明度の差分だけで済ませる方法は単色時ほど単純ではない。以前の色の寄与・新しい material field・順序を保持しないと誤る。実際に下地へ deposit した半透明結果を pickup checkpoint に反映する必要があり、表示後だけ薄くする方法では筆の色が不整合になる。

この案はより厳密な挙動を目指せるが、追加 mask / 局所 tile / branch state と GPU 常駐管理、CPU fallback のコストがある。設計と試作検証なしに完成方式とは扱わない。

## 推奨する進め方

まず stamp で候補 A の近似が描き味として十分か評価する。Procreate 同一実装の主張ではなく、要求に適する既知の実装原理を使う。round-pen / bristle の完成条件は別に置き、stamp の結果だけで「全ブラシ対応」としない。厳密なタップ濃度・折り返し濃度まで必須なら、候補 B の検証を優先する。

将来の実装計画は planning-flow に従う:

1. Phase 1: `StrokeStyle` の共通 `readonly opacity`（0〜1、1は不透明というUI規約）と brush ごとの意味論、筆圧応答、既存 `Color.a` / flow との関係を設計し、engine / stroke / react の docs に記載する。共通項目は候補であり、今回 API を追加していない。
2. Phase 2: アプリのスライダーと50%での直線・ループ・Uターン・タップの利用イメージを提示し、目標値の精度と許容する自然な濃淡をレビューする。
3. Phase 3: 合意した方式を実装。engine が正規化/coverage、stroke が状態と replay、react が設定/永続化、web が UI を担当する。既存 command の style 複製や保存形式の変換で設定を落とさない。
4. Phase 4: API利用・ドキュメント整合のセルフレビューとアーキテクトレビュー。ブラウザ含む必要な検収を経て完了とする。

評価項目:

- 不透明単色・透明下地の直線で設定25/50/75%、spacing .05/.1/.25、hard/soft/image tip を比較。芯と縁を区別して測る。
- 交差点が十分始終端から離れた二通過で、50%→75%相当を確認。小ループ・Uターン・画素を覆ったままの折返しは別評価。
- タップ、短線、静止吹き付け、筆圧一定/急変、サイズ追従あり/なし、jitter を比較。
- 描画の都合で分割しただけの境界に濃い線を出さない。既存 bristle の意味を持つ perFlush 境界は維持し、live と replay は同じ canonical flush 列で比較する。
- CPU/GPU、pending→committed、Undo/Redo、Expand branch の交差、wrap、消しゴム、alpha lock の対象経路を確認。
- 混色 ON/OFF、透明境界 pickup、低 opacity の量子化と大径性能を確認。

今回の検証範囲はソース・docs・外部一次資料の調査と上記の数式計算のみ。描画試作、実ブラウザ比較、Procreate 実機比較、性能測定は未実施。
