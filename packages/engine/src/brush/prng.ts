/**
 * 32bit シードから [0,1) の疑似乱数列を生成する（mulberry32）
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * グローバルシードと通し番号から emission 固有のシードを生成する。
 */
export function hashSeed(globalSeed: number, index: number): number {
  const quantized = Math.round(index * 100);
  // FNV-1a inspired hash
  let h = (globalSeed ^ quantized) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
