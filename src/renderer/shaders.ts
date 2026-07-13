import { CONFIG } from '../config';

// 変形はすべて頂点シェーダで解析的に計算する（CPU側はgrab状態の積分のみ）。
// 座標系: rest UV [0,1]² → iso空間 (u*aspect, v)。距離はiso空間で測る。

export const VERTEX_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aRest; // rest UV [0,1]

uniform float uAspect;              // w/h
uniform mat3 uView;                 // iso → clip
uniform int uGrabCount;
uniform vec4 uGrabA[${CONFIG.maxGrabs}]; // anchor.xy(iso), radiusEff, strength(ease×mask焼き込み)
uniform vec2 uGrabPull[${CONFIG.maxGrabs}]; // pull.xy(iso)
uniform float uBulge;               // ぷっくり量 κ
uniform sampler2D uMask;
uniform float uMaskEnabled;
uniform vec2 uMaskCell; // メッシュ1セルのrest UVサイズ（マスク平滑サンプル用）

out vec2 vUV;

// quintic smootherstepの補関数: 中心は平坦（指に完全追従）、境界はC2連続でもちっと減衰
float falloff(float t) {
  float s = 1.0 - t;
  return s * s * s * (6.0 * t * t + 3.0 * t + 1.0);
}

// マスクを半セルずらしの4タップ平均で読む。
// くっきりマスクの境界が頂点解像度で折れて（ガビガビに）見えるのを防ぐ
float maskAt(vec2 uv) {
  vec2 h = uMaskCell * 0.5;
  return (textureLod(uMask, uv + vec2(-h.x, -h.y), 0.0).r +
          textureLod(uMask, uv + vec2(h.x, -h.y), 0.0).r +
          textureLod(uMask, uv + vec2(-h.x, h.y), 0.0).r +
          textureLod(uMask, uv + vec2(h.x, h.y), 0.0).r) * 0.25;
}

// t=1/3でピーク1のリング形状（anchor周囲の外向き膨張＝体積感）
float ring(float t) {
  return 6.75 * t * (1.0 - t) * (1.0 - t);
}

void main() {
  vec2 iso = vec2(aRest.x * uAspect, aRest.y);
  vec2 disp = vec2(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${CONFIG.maxGrabs}; i++) {
    if (i >= uGrabCount) break;
    float strength = uGrabA[i].w;
    if (strength <= 0.0) continue;
    vec2 rel = iso - uGrabA[i].xy;
    float d = length(rel);
    float t = clamp(d / uGrabA[i].z, 0.0, 1.0);
    float w = falloff(t) * strength;
    vec2 pull = uGrabPull[i];
    vec2 dir = d > 1e-5 ? rel / d : vec2(0.0);
    disp += w * pull + uBulge * length(pull) * ring(t) * dir * strength;
    wsum += w;
  }

  // 頂点位置のマスク重み + grab重なり時の過剰変位の正規化
  float m = uMaskEnabled > 0.5 ? maskAt(aRest) : 1.0;
  disp *= m / max(1.0, wsum);

  // 引っ張られている部分ほど手前に描く。
  // メッシュが折り重なった時に、静止部分が伸びたほっぺの上に被らないようにする
  float lift = clamp(wsum, 0.0, 1.0) * m;

  vec3 clip = uView * vec3(iso + disp, 1.0);
  gl_Position = vec4(clip.xy, -0.5 * lift, 1.0);
  vUV = aRest;
}
`;

export const FRAGMENT_SRC = /* glsl */ `#version 300 es
precision mediump float;

in vec2 vUV;
uniform sampler2D uTex;   // premultiplied alpha
uniform sampler2D uMask;
uniform float uMaskView;  // 1 = ぬりぬりモードのオーバーレイ表示
// 透過素材対応の2パス描画:
// 0 = 不透明パス（深度書き込みあり。半透明フリンジは捨てる）
// 1 = フリンジパス（深度書き込みなしでブレンド。半透明のフチが下の絵を消さない）
uniform float uPass;
uniform vec2 uTexSize;
uniform float uBicubic;   // 1 = 拡大表示中（低解像度画像やズーム時）はバイキュービック補間

out vec4 outColor;

// cubic B-spline 重み
vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

// バイキュービック補間（4回のbilinearフェッチで実装）
vec4 sampleImage(vec2 uv) {
  if (uBicubic < 0.5) return texture(uTex, uv);
  vec2 invSize = 1.0 / uTexSize;
  vec2 coord = uv * uTexSize - 0.5;
  vec2 fxy = fract(coord);
  coord -= fxy;
  vec4 xcubic = cubicW(fxy.x);
  vec4 ycubic = cubicW(fxy.y);
  vec4 c = coord.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xcubic.xz + xcubic.yw, ycubic.xz + ycubic.yw);
  vec4 offset = (c + vec4(xcubic.yw, ycubic.yw) / s) * invSize.xxyy;
  vec4 s0 = texture(uTex, offset.xz);
  vec4 s1 = texture(uTex, offset.yz);
  vec4 s2 = texture(uTex, offset.xw);
  vec4 s3 = texture(uTex, offset.yw);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

void main() {
  vec4 c = sampleImage(vUV);
  if (uMaskView > 0.5) {
    float m = texture(uMask, vUV).r;
    // 4段階に量子化して表示: ふんわり=同心の帯、くっきり=単一のベタ縁として見分けられる
    float mq = floor(m * 4.0 + 0.5) / 4.0;
    c *= 0.45 + 0.4 * mq;                          // 未塗り部分を減光
    c += vec4(1.0, 0.55, 0.68, 1.0) * (0.35 * mq); // 塗った部分をピンクに
  } else if (uPass < 0.5) {
    if (c.a < 0.95) discard;
  } else {
    if (c.a >= 0.95) discard;
  }
  outColor = c;
}
`;
