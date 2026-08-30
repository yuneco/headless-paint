export const MAX_GPU_STROKE_BRANCHES = 64;
// uPreviousField and uFieldDimensions consume one default-block vector each.
export const FIELD_DIFFUSION_FIXED_FRAGMENT_UNIFORM_VECTORS = 2;
export const BRANCH_DATA_BINDING = 0;
export const BRANCH_DATA_VEC4S_PER_BRANCH = 4;
export const BRANCH_DATA_FLOATS =
  MAX_GPU_STROKE_BRANCHES * BRANCH_DATA_VEC4S_PER_BRANCH * 4;

export const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aUnitPosition;
layout(location = 1) in vec2 aCenter;
layout(location = 2) in float aSize;
layout(location = 3) in float aRotation;
layout(location = 4) in float aAlpha;
layout(location = 5) in float aBranchIndex;

uniform vec2 uSurfaceSize;

out vec2 vUv;
out float vAlpha;
flat out int vBranchIndex;

void main() {
  vec2 local = (aUnitPosition - vec2(0.5)) * aSize;
  float cosine = cos(aRotation);
  float sine = sin(aRotation);
  vec2 rotated = vec2(
    local.x * cosine - local.y * sine,
    local.x * sine + local.y * cosine
  );
  vec2 position = aCenter + rotated;
  vec2 clip = vec2(
    position.x / uSurfaceSize.x * 2.0 - 1.0,
    1.0 - position.y / uSurfaceSize.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aUnitPosition;
  vAlpha = aAlpha;
  vBranchIndex = int(aBranchIndex + 0.5);
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uTip;
uniform sampler2D uField;
uniform vec2 uFieldSize;
uniform vec2 uFieldTextureSize;
uniform float uFieldRowStride;

in vec2 vUv;
in float vAlpha;
flat in int vBranchIndex;
out vec4 outColor;

void main() {
  float mask = texture(uTip, vUv).a;
  // Preserve the Canvas2D / array-texture sampling footprint while clamping
  // LINEAR filtering to this branch's rows inside the packed strip.
  vec2 fieldTexel = vec2(
    clamp(vUv.x * uFieldSize.x - 0.5, 0.0, uFieldSize.x - 1.0),
    float(vBranchIndex) * uFieldRowStride +
      clamp(vUv.y * uFieldSize.y - 0.5, 0.0, uFieldSize.y - 1.0)
  );
  vec2 fieldUv = (fieldTexel + vec2(0.5)) / uFieldTextureSize;
  vec4 material = texture(uField, fieldUv);
  float alpha = material.a * mask * vAlpha;
  outColor = vec4(material.rgb * alpha, alpha);
}
`;

export const BRISTLE_MASK_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aFieldCoord;
layout(location = 2) in float aPressure;
layout(location = 3) in float aTrialId;

uniform vec2 uTargetSize;

out vec2 vFieldCoord;
out float vPressure;
flat out float vTrialId;

void main() {
  gl_Position = vec4(
    aPosition.x / uTargetSize.x * 2.0 - 1.0,
    1.0 - aPosition.y / uTargetSize.y * 2.0,
    0.0,
    1.0
  );
  vFieldCoord = aFieldCoord;
  vPressure = aPressure;
  vTrialId = aTrialId;
}
`;

export const BRISTLE_MASK_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uMaskField;
uniform sampler2D uTooth;
uniform ivec2 uFieldSize;
uniform ivec2 uMaskFieldTextureSize;
uniform vec2 uTargetSize;
uniform ivec2 uDocumentOrigin;
uniform float uDepositHardness;
uniform float uGrainAmount;
uniform float uGrainSoftness;
uniform uint uGrainSeed;
uniform uint uStrokeSeed;

in vec2 vFieldCoord;
in float vPressure;
flat in float vTrialId;
out vec4 outColor;

uint hashSeed(uint seed, int index) {
  int quantized = int(round(float(index) * 100.0));
  uint h = seed ^ uint(quantized);
  h = (h ^ (h >> 16u)) * 0x045d9f3bu;
  h = (h ^ (h >> 13u)) * 0x045d9f3bu;
  return h ^ (h >> 16u);
}

float hashUnit(uint seed, int x, int y) {
  return float(hashSeed(hashSeed(seed, x), y)) / 4294967296.0;
}

float sampleField(vec2 coord) {
  vec2 clamped = clamp(coord, vec2(0.0), vec2(uFieldSize - ivec2(1)));
  ivec2 p0 = ivec2(floor(clamped));
  ivec2 p1 = min(p0 + ivec2(1), uFieldSize - ivec2(1));
  vec2 fraction = clamped - vec2(p0);
  vec2 fieldUvScale = vec2(uFieldSize) / vec2(uMaskFieldTextureSize);
  vec2 p0Uv = (vec2(p0) + vec2(0.5)) / vec2(uFieldSize) * fieldUvScale;
  vec2 p1Uv = (vec2(p1) + vec2(0.5)) / vec2(uFieldSize) * fieldUvScale;
  return mix(
    mix(
      texture(uMaskField, p0Uv).r,
      texture(uMaskField, vec2(p1Uv.x, p0Uv.y)).r,
      fraction.x
    ),
    mix(
      texture(uMaskField, vec2(p0Uv.x, p1Uv.y)).r,
      texture(uMaskField, p1Uv).r,
      fraction.x
    ),
    fraction.y
  );
}

float activationFromDistance(float distance, float hardness) {
  float transition = 0.018 + 0.282 * pow(1.0 - clamp(hardness, 0.0, 1.0), 2.0);
  return smoothstep(0.0, 1.0, (distance + transition * 0.5) / transition);
}

bool hasSurfaceContact(ivec2 documentPixel, float pressure, int trialId) {
  if (uGrainAmount <= 0.0) return true;
  ivec2 tile = ivec2(
    ((documentPixel.x % 128) + 128) % 128,
    ((documentPixel.y % 128) + 128) % 128
  );
  float height = texelFetch(uTooth, tile, 0).r;
  float contact = clamp(pressure, 0.0, 1.0);
  float directCoverage = smoothstep(
    0.0,
    1.0,
    (contact - height + uGrainSoftness) / (uGrainSoftness * 2.0)
  );
  float directProbability =
    1.0 - uGrainAmount + uGrainAmount * directCoverage;
  if (
    hashUnit(uGrainSeed ^ 0x243f6a88u, documentPixel.x, documentPixel.y) <
    directProbability
  ) {
    return true;
  }
  float gap = max(0.0, height - contact);
  float rate = uGrainAmount * 0.75 * exp(-gap / 0.18);
  float probability = 1.0 - exp(-rate * 0.24);
  uint repeatSeed = hashSeed(uStrokeSeed ^ 0x85a308d3u, trialId);
  return hashUnit(repeatSeed, documentPixel.x, documentPixel.y) < probability;
}

void main() {
  float alpha = activationFromDistance(
    sampleField(vFieldCoord),
    uDepositHardness
  );
  ivec2 localPixel = ivec2(
    int(floor(gl_FragCoord.x)),
    int(uTargetSize.y) - 1 - int(floor(gl_FragCoord.y))
  );
  if (
    !hasSurfaceContact(
      uDocumentOrigin + localPixel,
      vPressure,
      int(vTrialId + 0.5)
    )
  ) {
    alpha = 0.0;
  }
  outColor = vec4(alpha);
}
`;

export const BRISTLE_INK_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUv;
uniform vec2 uTargetSize;
out vec2 vUv;

void main() {
  gl_Position = vec4(
    aPosition.x / uTargetSize.x * 2.0 - 1.0,
    1.0 - aPosition.y / uTargetSize.y * 2.0,
    0.0,
    1.0
  );
  vUv = aUv;
}
`;

export const BRISTLE_INK_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uProfile;
uniform vec2 uProfileScale;
in vec2 vUv;
out vec4 outColor;

void main() {
  float alpha = texture(uProfile, vUv * uProfileScale).a;
  outColor = vec4(alpha);
}
`;

export const BRISTLE_COMPOSITE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

void main() {
  vec2 position = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const BRISTLE_COMPOSITE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform sampler2D uField;
uniform ivec2 uSurfaceSize;
uniform ivec2 uTargetSize;
uniform ivec2 uChunkSize;
uniform ivec2 uDocumentOrigin;
uniform ivec2 uFieldSize;
uniform ivec2 uFieldTextureSize;
uniform int uFieldRowStride;
uniform int uBranchIndex;
uniform bool uUseField;
uniform vec4 uColor;
out vec4 outColor;

vec4 sampleMaterial(vec2 localPosition) {
  if (!uUseField) return uColor;
  vec2 normalized = clamp(
    localPosition / vec2(uChunkSize),
    vec2(0.0),
    vec2(1.0)
  );
  vec2 fieldTexel = vec2(
    clamp(normalized.x * float(uFieldSize.x) - 0.5, 0.0, float(uFieldSize.x - 1)),
    float(uBranchIndex * uFieldRowStride) +
      clamp(normalized.y * float(uFieldSize.y) - 0.5, 0.0, float(uFieldSize.y - 1))
  );
  return texture(uField, (fieldTexel + vec2(0.5)) / vec2(uFieldTextureSize));
}

void main() {
  vec2 documentPosition = vec2(
    gl_FragCoord.x,
    float(uSurfaceSize.y) - gl_FragCoord.y
  );
  vec2 localPosition = documentPosition - vec2(uDocumentOrigin);
  ivec2 localPixel = ivec2(floor(localPosition));
  ivec2 texturePixel = ivec2(
    localPixel.x,
    uTargetSize.y - 1 - localPixel.y
  );
  float mask = texelFetch(uAtlas, texturePixel, 0).a;
  float ink = texelFetch(
    uAtlas,
    texturePixel + ivec2(uTargetSize.x, 0),
    0
  ).a;
  vec4 material = sampleMaterial(localPosition);
  float alpha = material.a * mask * ink;
  outColor = vec4(material.rgb * alpha, alpha);
}
`;

export const FIELD_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

void main() {
  vec2 position = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const FIELD_MIX_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform highp sampler2DArray uCheckpoints;
uniform sampler2D uPreviousField;
uniform ivec2 uFieldDimensions;

layout(std140) uniform BranchData {
  vec4 uCheckpointRects[${MAX_GPU_STROKE_BRANCHES}];
  vec4 uGeometry[${MAX_GPU_STROKE_BRANCHES}];
  vec4 uBaseColors[${MAX_GPU_STROKE_BRANCHES}];
  vec4 uRates[${MAX_GPU_STROKE_BRANCHES}];
};

out vec4 outColor;

vec4 checkpointTexel(ivec2 tilePixel, int branchIndex) {
  ivec2 checkpointSize = ivec2(uCheckpointRects[branchIndex].zw);
  if (
    tilePixel.x < 0 || tilePixel.y < 0 ||
    tilePixel.x >= checkpointSize.x || tilePixel.y >= checkpointSize.y
  ) {
    return vec4(0.0);
  }
  vec4 premultiplied = texelFetch(
    uCheckpoints,
    ivec3(tilePixel.x, checkpointSize.y - 1 - tilePixel.y, branchIndex),
    0
  );
  if (premultiplied.a <= 0.0) return vec4(0.0);
  return vec4(premultiplied.rgb / premultiplied.a, premultiplied.a);
}

vec4 sampleCheckpointBilinear(vec2 documentPosition, int branchIndex) {
  vec2 samplePosition =
    documentPosition - uCheckpointRects[branchIndex].xy - vec2(0.5);
  ivec2 p0 = ivec2(floor(samplePosition));
  vec2 fraction = samplePosition - vec2(p0);
  return mix(
    mix(
      checkpointTexel(p0, branchIndex),
      checkpointTexel(p0 + ivec2(1, 0), branchIndex),
      fraction.x
    ),
    mix(
      checkpointTexel(p0 + ivec2(0, 1), branchIndex),
      checkpointTexel(p0 + ivec2(1, 1), branchIndex),
      fraction.x
    ),
    fraction.y
  );
}

void main() {
  ivec2 stripCoord = ivec2(gl_FragCoord.xy);
  int branchIndex = stripCoord.y / uFieldDimensions.y;
  ivec2 fieldCoord = ivec2(
    stripCoord.x,
    stripCoord.y - branchIndex * uFieldDimensions.y
  );
  vec4 geometry = uGeometry[branchIndex];
  vec3 rates = uRates[branchIndex].xyz;
  vec4 current = texelFetch(uPreviousField, stripCoord, 0);
  if (rates.z < 0.5) {
    outColor = current;
    return;
  }
  vec2 local = (
    (vec2(fieldCoord) + vec2(0.5)) / vec2(uFieldDimensions) - vec2(0.5)
  ) * geometry.w;
  float cosine = cos(geometry.z);
  float sine = sin(geometry.z);
  vec2 documentPosition = geometry.xy + vec2(
    local.x * cosine - local.y * sine,
    local.x * sine + local.y * cosine
  );
  vec4 sampled = sampleCheckpointBilinear(documentPosition, branchIndex);
  float pickupAmount = rates.x * sampled.a;
  vec3 picked = mix(current.rgb, sampled.rgb, pickupAmount);
  vec4 baseColor = uBaseColors[branchIndex];
  outColor = vec4(
    mix(picked, baseColor.rgb, rates.y),
    mix(current.a, baseColor.a, rates.y)
  );
}
`;

export function createFieldDiffusionFragmentShaderSource(
  maxBranchCount: number,
): string {
  return `#version 300 es
precision highp float;

uniform sampler2D uPreviousField;
uniform ivec2 uFieldDimensions;
uniform float uStrengths[${maxBranchCount}];

out vec4 outColor;

void main() {
  ivec2 stripCoord = ivec2(gl_FragCoord.xy);
  int branchIndex = stripCoord.y / uFieldDimensions.y;
  ivec2 coord = ivec2(
    stripCoord.x,
    stripCoord.y - branchIndex * uFieldDimensions.y
  );
  float strength = uStrengths[branchIndex];
  vec4 current = texelFetch(uPreviousField, stripCoord, 0);
  vec4 sum = current;
  float count = 1.0;
  if (coord.x > 0) {
    sum += texelFetch(uPreviousField, stripCoord + ivec2(-1, 0), 0);
    count += 1.0;
  }
  if (coord.x + 1 < uFieldDimensions.x) {
    sum += texelFetch(uPreviousField, stripCoord + ivec2(1, 0), 0);
    count += 1.0;
  }
  if (coord.y > 0) {
    sum += texelFetch(uPreviousField, stripCoord + ivec2(0, -1), 0);
    count += 1.0;
  }
  if (coord.y + 1 < uFieldDimensions.y) {
    sum += texelFetch(uPreviousField, stripCoord + ivec2(0, 1), 0);
    count += 1.0;
  }
  outColor = mix(current, sum / count, strength);
}
`;
}
