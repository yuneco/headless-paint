Acrylic mixing の CPU と WebGL2 async GPU を、赤青境界・同一 stroke 3 往復・spot pickup の固定入力で比較する。
Playwright: `ENGINE=webkit node tools/bench/benchmark-acrylic-parity.mjs`（`ENGINE=chromium` も可、結果は `tools/bench/results/parity-<engine>/`）。
Safari MCP: `python3 tools/bench/benchmark-acrylic-stp.py --parity`（結果は `tools/bench/results/parity-safari-stp/`）。
