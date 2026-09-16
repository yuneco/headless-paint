# Paper tooth textures (bundled for the web demo)

Rough bristle の紙目（`surfaceGrain.heightMapId`）用に同梱する高さマップの元画像。
デモアプリ（ライブラリ実装者向け）専用で、engine パッケージには含まれない。

## Source

All three are from [ambientCG](https://ambientcg.com/), licensed **CC0 1.0 Universal (Public Domain)**
(https://docs.ambientcg.com/license/). Attribution is not required by the license; this file records
provenance for maintainers.

| File | ambientCG asset | Original | Original zip SHA-256 |
|------|-----------------|----------|----------------------|
| `fabric-031-displacement-512.jpg` | [Fabric031](https://ambientcg.com/view?id=Fabric031) | `Fabric031_1K-JPG_Displacement.jpg` (1024×1024) | `66a14ac501a3c238be3fca856415fc02a9e6e061478632fb597d14df8d003b92` |
| `fabric-036-displacement-512.jpg` | [Fabric036](https://ambientcg.com/view?id=Fabric036) | `Fabric036_1K-JPG_Displacement.jpg` (1024×1024) | `a06c291bcbf46fc0167fac74345dfe6af5e3ed3d3595644fa1067d191b5595ec` |
| `fabric-061-displacement-512.jpg` | [Fabric061](https://ambientcg.com/view?id=Fabric061) | `Fabric061_1K-JPG_Displacement.jpg` (1024×1024) | `537a84d3a91d50bc907d2e86f4f024041643eb6a04c10b115cdf308f29508eb2` |

Downloaded 2026-09-08 from `https://ambientcg.com/get?file=<ID>_1K-JPG.zip`.

## Processing

- Extracted the Displacement map from each zip (no other maps are bundled)
- Resized 1024 → 512 px and converted to grayscale JPEG (quality 85) with macOS `sips` on 2026-09-16
- Height conversion at registration: `createHeightMapFromImageData` with `invert: false`, `contrast: 1`,
  `normalize: true` for Fabric031 only (036 / 061 use `normalize: false`)
- Default `surfaceGrain.scalePx` for these maps is `2` (1 texel = 2 px), so the tile period matches the
  1024 px source at scale 1

## Registered IDs

| ID | File |
|----|------|
| `paper-fabric-031` | `fabric-031-displacement-512.jpg` |
| `paper-fabric-036` | `fabric-036-displacement-512.jpg` |
| `paper-fabric-061` | `fabric-061-displacement-512.jpg` |
