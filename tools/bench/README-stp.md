1. `pnpm dev -- --port 5183` でローカル Web アプリを起動する。
2. Safari Technology Preview の「Allow Remote Automation」を有効にし、前面表示できる状態にする。
3. `GPU_BACKEND=webgl2 BATCHES=240 SAMPLES=8 REPEATS=1 python3 tools/bench/benchmark-acrylic-stp.py` を実行する。parity は `python3 tools/bench/benchmark-acrylic-stp.py --parity` で CPU / WebGL2 を別ロードして比較する。
