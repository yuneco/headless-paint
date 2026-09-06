# tools/bench — ブラシ性能・parity 計測ハーネス

ライブラリ本体・テストとは独立した、手動実行用の計測装置。CI では走らせない。
数値の採否基準や過去の計測結果は `plans/2026-08-25-00-29_brush-gpu-acceleration-investigation.md` と
`plans/2026-08-30-02-00_gpu-brush-accelerator-formal.md` を参照。

| ファイル | 用途 |
|---|---|
| `benchmark-acrylic-backlog.mjs` | Playwright(WebKit/Chromium) で録画済み入力を再生し、dispatch p50/p95・undo 時間を計測。`ENGINE=webkit GPU_BACKEND=webgl2 node tools/bench/benchmark-acrylic-backlog.mjs` |
| `benchmark-acrylic-parity.mjs` | 同じ入力を CPU / GPU で描いて画素比較（MAE・|Δ|>0.1 率・bbox）。詳細は `README-parity.md` |
| `benchmark-acrylic-stp.py` + `safari-mcp-client.py` | Safari Technology Preview（`safaridriver --mcp`）で実 Safari 計測。詳細は `README-stp.md` |
| `acrylic-*.page.js` | ブラウザ内で実行する側（入力再生・計測）。上記ランナーから読み込まれる |
| `undo-warm.mjs` | undo 直後の warmUp 挙動確認用の小スクリプト |
| `benchmark-bridge.mjs` + `bridge-bench/` | Canvas2D↔WebGL 往復コストの単体ベンチ（探索初期の E0） |

前提: `pnpm dev`（既定 `https://127.0.0.1:5174`、`BASE_URL` で変更可）でアプリを起動しておく。`playwright` はルートの devDependency を使う。
結果は `tools/bench/results/`（gitignore 済み）に出る。

| `benchmark-rough-capture.mjs` + `fixtures-rough-comb06-input.json` | Rough bristle の production 入力（461点）を再生し Call p50/p95・batch wall・undo1/undo9 を計測。`ENGINE=webkit GPU_BACKEND=webgl2 PERF_VARIANT=baseline REPEATS=4 node tools/bench/benchmark-rough-capture.mjs endpoints` |
