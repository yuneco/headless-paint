/**
 * プロシージャルテクスチャ生成
 * Math.random() 不使用 — 座標ハッシュベースで決定論的
 */

/** 座標ハッシュ: 整数座標 → 0〜0xFFFFFFFF の擬似乱数 */
function coordHash(x: number, y: number): number {
  return ((x * 374761393 + y * 668265263) ^ 0x12345678) >>> 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** ハッシュ値を 0..1 の浮動小数に変換 */
function hash01(x: number, y: number, seed: number): number {
  return (coordHash(x + seed * 131, y - seed * 173) & 0xffff) / 0xffff;
}

/**
 * 2D value noise（格子点ランダム値を双線形補間）
 * cellSize を大きくすると低周波、小さくすると高周波の凹凸になる
 */
function valueNoise2D(
  x: number,
  y: number,
  cellSize: number,
  seed: number,
): number {
  const gx = x / cellSize;
  const gy = y / cellSize;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);

  const n00 = hash01(x0, y0, seed);
  const n10 = hash01(x0 + 1, y0, seed);
  const n01 = hash01(x0, y0 + 1, seed);
  const n11 = hash01(x0 + 1, y0 + 1, seed);

  const nx0 = lerp(n00, n10, sx);
  const nx1 = lerp(n01, n11, sx);
  return lerp(nx0, nx1, sy);
}

/**
 * fBm (fractal brownian motion): 複数スケールの value noise を合成
 * 紙の凹凸のような有機的な連続濃淡を作るために使用
 */
function fractalNoise2D(
  x: number,
  y: number,
  baseCellSize: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  seed: number,
): number {
  let amplitude = 1;
  let amplitudeSum = 0;
  let cellSize = baseCellSize;
  let result = 0;

  for (let i = 0; i < octaves; i++) {
    result += valueNoise2D(x, y, cellSize, seed + i * 977) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= persistence;
    cellSize /= lacunarity;
  }

  return amplitudeSum > 0 ? result / amplitudeSum : 0;
}

/**
 * 鉛筆グレイン生成の調整パラメータ
 * 値を変更して手動チューニングしやすいよう、用途ごとに分離している
 */
const PENCIL_TEXTURE_PARAMS = {
  // 外縁の硬さ。1.0 に近いほど縁ギリギリまで不透明を保ちハードになる。
  edgeHardnessStart: 0.85,
  // edgeHardnessStart 以降のフェード幅。小さいほどエッジが硬い。
  edgeSoftness: 0.15,

  // 紙地の大きなうねり（低周波）: 大きいほど塊が大きくなる。
  macroCellRatio: 0.5,
  // 紙地の中域ディテール（中周波）: 大きいほど模様がゆるやか。
  midCellRatio: 0.4,
  // 微細な紙目（高周波）: 小さいほどザラつきが細かくなる。
  microCellRatio: 0.1,

  // fBm の合成バランス（有機的な濃淡変化の滑らかさを決める）。
  fbmOctaves: 3,
  fbmPersistence: 0.55,
  fbmLacunarity: 2.0,

  // ドメインワープ量。紙目の境界を歪ませて人工的な格子感を減らす。
  warpCellRatio: 0.7,
  warpStrengthRatio: 0.08,

  // 鉛筆芯の付きやすさ（紙の凸部で濃くなる度合い）。
  toothContrast: 1.9,
  toothInfluence: 0.68,
  // 中域ディテールの寄与。増やすと内部の濃淡が増える。
  midInfluence: 0.3,
  // 微細紙目の寄与。増やすと細かなザラつきが増える。
  microInfluence: 0.6,
  // 全体濃度のオフセット。上げると全体が濃くなる。
  baseCoverage: 0.16,

  // 局所的な欠け（紙の谷）を作るパラメータ。
  voidCellRatio: 0.13,
  voidThreshold: 0.72,
  voidSoftness: 0.12,
  voidStrength: 0.68,

  // 最終アルファカーブ。1 より大きいと薄部が減り芯の強さが出る。
  alphaGamma: 4.5,
} as const;

/**
 * 鉛筆グレインテクスチャを生成
 * - エッジは硬め、内部は紙目に沿った有機的な濃淡にする
 * - 低/中/高周波ノイズ + ドメインワープで実紙の凹凸に近づける
 * - 局所的な欠けを入れて「芯が乗らない谷」を表現する
 */
export async function generatePencilGrainBitmap(
  size: number,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const center = size / 2;
  const radius = size / 2;
  const p = PENCIL_TEXTURE_PARAMS;

  const macroCell = Math.max(3, size * p.macroCellRatio);
  const midCell = Math.max(2, size * p.midCellRatio);
  const microCell = Math.max(1, size * p.microCellRatio);
  const warpCell = Math.max(2, size * p.warpCellRatio);
  const warpStrength = size * p.warpStrengthRatio;
  const voidCell = Math.max(1, size * p.voidCellRatio);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) continue;

      // 半径正規化。外縁の狭い帯だけフェードさせて硬いエッジを維持する。
      const radial = dist / radius;
      const edgeAlpha =
        1 -
        smoothstep(
          p.edgeHardnessStart,
          p.edgeHardnessStart + p.edgeSoftness,
          radial,
        );

      // ドメインワープ: ノイズ座標を歪ませ、タイル状の見え方を抑える。
      const warpX =
        (valueNoise2D(x + 41.3, y - 19.7, warpCell, 811) - 0.5) * warpStrength;
      const warpY =
        (valueNoise2D(x - 73.1, y + 57.9, warpCell, 997) - 0.5) * warpStrength;
      const nx = x + warpX;
      const ny = y + warpY;

      // 紙の凹凸（低/中/高周波）を個別に評価。
      const macro = fractalNoise2D(
        nx,
        ny,
        macroCell,
        p.fbmOctaves,
        p.fbmPersistence,
        p.fbmLacunarity,
        101,
      );
      const mid = fractalNoise2D(
        nx + 137.7,
        ny - 59.2,
        midCell,
        p.fbmOctaves,
        p.fbmPersistence,
        p.fbmLacunarity,
        211,
      );
      const micro = valueNoise2D(nx - 211.4, ny + 89.6, microCell, 307);

      // 凸部ほど濃く乗るようにコントラストを付ける。
      const tooth = clamp01((macro - 0.5) * p.toothContrast + 0.5);
      let graphite =
        p.baseCoverage +
        tooth * p.toothInfluence +
        mid * p.midInfluence +
        micro * p.microInfluence;

      // 紙の谷で芯が乗らない「欠け」を局所的に作る。
      const voidNoise = valueNoise2D(nx + 311.2, ny - 151.9, voidCell, 419);
      const voidMask = smoothstep(
        p.voidThreshold,
        p.voidThreshold + p.voidSoftness,
        voidNoise,
      );
      graphite *= 1 - voidMask * p.voidStrength;

      const alpha = edgeAlpha * clamp01(graphite) ** p.alphaGamma;
      const grainAlpha = Math.round(clamp01(alpha) * 255);

      const idx = (y * size + x) * 4;
      data[idx] = 255; // R
      data[idx + 1] = 255; // G
      data[idx + 2] = 255; // B
      data[idx + 3] = grainAlpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

/**
 * 星型テクスチャを生成
 * - 極座標で星型境界を計算
 * - 中心からの falloff とエッジのアンチエイリアス付き
 */
export async function generateStarBitmap(
  size: number,
  points = 5,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const center = size / 2;
  const outerRadius = size / 2 - 1; // 1px margin for AA
  const innerRadius = outerRadius * 0.4;

  const n = points;
  const sectorAngle = (2 * Math.PI) / n;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let theta = Math.atan2(dy, dx);
      if (theta < 0) theta += 2 * Math.PI;

      // 星型境界の計算: セクター内の角度に基づく
      const sectorTheta = theta % sectorAngle;
      const halfSector = sectorAngle / 2;
      // 各セクターの前半は外→内、後半は内→外
      const t =
        sectorTheta < halfSector
          ? sectorTheta / halfSector
          : (sectorAngle - sectorTheta) / halfSector;
      const starRadius = innerRadius + (outerRadius - innerRadius) * t;

      if (dist > starRadius + 1) continue; // AA 余白含む

      // アンチエイリアス: エッジの1px幅でフェード
      let edgeAlpha = 1.0;
      if (dist > starRadius) {
        edgeAlpha = 1.0 - (dist - starRadius);
      }

      // 中心からの微弱 falloff (中心明るく)
      const centerFalloff = 1.0 - dist / (outerRadius * 1.5);
      const alpha = Math.max(0, Math.min(1, edgeAlpha * centerFalloff)) * 255;

      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}
