Start a repo-root dev server: `pnpm exec vite --host 127.0.0.1 --port 5183`.
Run either browser: `ENGINE=webkit node tools/bench/benchmark-bridge.mjs` or `ENGINE=chromium node tools/bench/benchmark-bridge.mjs`.
Read the JSON in `tools/bench/results/bridge-<engine>.json`; the runner also prints warm-p95 tables.
