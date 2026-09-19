import { readFile, writeFile } from "node:fs/promises";
const root = "work.local/bristle-coverage";
const before = JSON.parse(
  await readFile(`${root}/${process.argv[3] ?? "before"}/results.json`),
);
const after = JSON.parse(
  await readFile(`${root}/${process.argv[2] ?? "after"}/results.json`),
);
const report = [];
for (let i = 0; i < before.length; i++) {
  const b = before[i],
    a = after[i],
    ref = after.find(
      (c) =>
        c.backend === a.backend &&
        c.kind === a.kind &&
        c.substrate === a.substrate &&
        !c.mixing,
    );
  const stroke = Buffer.from(
    after.find(
      (c) =>
        c.backend === a.backend &&
        c.kind === a.kind &&
        !c.substrate &&
        !c.mixing,
    ).pixels,
    "base64",
  );
  const old = Buffer.from(b.pixels, "base64"),
    now = Buffer.from(a.pixels, "base64"),
    off = Buffer.from(ref.pixels, "base64");
  let holesBefore = 0,
    holesAfter = 0,
    mae = 0,
    large = 0,
    common = 0,
    alphaChanges = 0;
  for (let p = 0; p < old.length; p += 4) {
    if (off[p + 3] > 250) {
      if (old[p + 3] < 128) holesBefore++;
      if (now[p + 3] < 128) holesAfter++;
    }
    if (now[p + 3] !== old[p + 3]) alphaChanges++;
    if (stroke[p + 3] > 250 && old[p + 3] > 250 && now[p + 3] > 250) {
      common++;
      let max = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(old[p + c] - now[p + c]);
        mae += d;
        max = Math.max(max, d);
      }
      if (max > 20) large++;
    }
  }
  const item = {
    backend: a.backend,
    kind: a.kind,
    substrate: a.substrate,
    mixing: a.mixing,
    beforeMs: b.median,
    afterMs: a.median,
    changePercent: 100 * (a.median / b.median - 1),
    callP95Before: b.callP95,
    callP95After: a.callP95,
    holesBefore,
    holesAfter,
    alphaChanges,
    rgbMAE: mae / (common * 3),
    rgbLargePercent: (100 * large) / common,
  };
  report.push(item);
  if (a.mixing) console.log(JSON.stringify(item));
}
await writeFile(
  `${root}/${process.argv[2] ?? "after"}/comparison.json`,
  JSON.stringify(report, null, 2),
);
