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
