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

out vec2 vUV;

// quintic smootherstepの補関数: 中心は平坦（指に完全追従）、境界はC2連続でもちっと減衰
float falloff(float t) {
  float s = 1.0 - t;
  return s * s * s * (6.0 * t * t + 3.0 * t + 1.0);
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
  float m = uMaskEnabled > 0.5 ? textureLod(uMask, aRest, 0.0).r : 1.0;
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

out vec4 outColor;

void main() {
  vec4 c = texture(uTex, vUV);
  if (uMaskView > 0.5) {
    float m = texture(uMask, vUV).r;
    c *= 0.45 + 0.4 * m;                          // 未塗り部分を減光
    c += vec4(1.0, 0.55, 0.68, 1.0) * (0.35 * m); // 塗った部分をピンクに
  } else if (uPass < 0.5) {
    if (c.a < 0.95) discard;
  } else {
    if (c.a >= 0.95) discard;
  }
  outColor = c;
}
`;
