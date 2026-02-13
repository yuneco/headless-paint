/**
 * プロシージャルテクスチャ生成
 * Math.random() 不使用 — 座標ハッシュベースで決定論的
 */

/** 座標ハッシュ: 整数座標 → 0〜0xFFFFFFFF の擬似乱数 */
function coordHash(x: number, y: number): number {
  return ((x * 374761393 + y * 668265263) ^ 0x12345678) >>> 0;
}

/**
 * 鉛筆グレインテクスチャを生成
 * - 硬い円に座標ハッシュでノイズ穴を開けてざらつき感を表現
 * - 2段階のグレイン（粗い塊 + 細かい粒）で鉛筆らしい質感を再現
 * - 縁は distance falloff でフェード
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

  // グレインのセルサイズ（size に対する比率で粗さを決定）
  // 128px テクスチャが tipSize(24px) に縮小されるため、
  // 縮小後も視認できる十分に大きなセルが必要
  // coarse: size/3 ≈ 43px → 縮小後 ~8px（はっきり見える帯状のムラ）
  // fine: size/8 ≈ 16px → 縮小後 ~3px（ディテール）
  const coarseCell = Math.max(4, Math.round(size / 3));
  const fineCell = Math.max(2, Math.round(size / 8));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) continue;

      // distance falloff: 外縁でフェード
      const falloff =
        dist < radius * 0.5
          ? 1.0
          : 1.0 - (dist - radius * 0.5) / (radius * 0.5);

      // 粗いグレイン: 大きなセル単位でハッシュ → 紙の凹凸の塊感
      const cx = Math.floor(x / coarseCell);
      const cy = Math.floor(y / coarseCell);
      const coarseNoise = (coordHash(cx, cy) & 0xff) / 255;

      // 細かいグレイン: 中間セル単位でハッシュ → ディテール
      const fx = Math.floor(x / fineCell);
      const fy = Math.floor(y / fineCell);
      const fineNoise = (coordHash(fx + 997, fy + 1013) & 0xff) / 255;

      // 粗いノイズで大きな穴（40%が穴）、細かいノイズで追加の穴（25%）
      const coarsePass = coarseNoise > 0.4;
      const finePass = fineNoise > 0.25;
      // バイナリアルファ: 穴は完全透明、それ以外は falloff のみ
      // 中途半端な半透明を避け、flow × spacing で重ね塗りの濃淡を制御
      const grainAlpha = coarsePass && finePass ? falloff * 255 : 0;

      const idx = (y * size + x) * 4;
      data[idx] = 255; // R
      data[idx + 1] = 255; // G
      data[idx + 2] = 255; // B
      data[idx + 3] = Math.round(grainAlpha);
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
