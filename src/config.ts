// チューニング定数を1箇所に集約する。
// 長さ系のパラメータはすべて「画像の短辺 S」相対（iso空間: 高さ1・幅aspect）。

export const CONFIG = {
  maxGrabs: 8,
  meshShortSegs: 128,
  meshMaxSegs: 192,
  imageMaxSide: 2048,
  alphaSampleMaxSide: 1024,
  fitRatio: 0.76, // キャンバスに対する画像のフィット率。残りが伸びしろマージン
  dprCap: 3, // DPR3端末（iPhone等）で縮小→拡大のボケ/ジャギーを出さない
  maskSize: 512,
  // 変形weight用マスクのぼかし（長辺比）。メッシュ折返しのギザつき防止の最小限に留め、
  // 塗った範囲の精度は守る（滑らかさはふんわりブラシで意図的に付ける）
  maskBlur: 0.008,

  // ドラッグ追従スプリング（固定。質量感＋リリース時の速度連続のため）
  dragOmega: 80, // rad/s ≒ 25msの遅れ
  dragZeta: 0.85,
  grabEaseMs: 60, // つかんだ瞬間の吸い付きイーズイン
  radiusGrow: 0.35, // 引くほど実効半径が広がる（餅の粘り）

  // 積分
  substep: 1 / 240,
  maxDt: 1 / 30,
  settlePos: 1e-3, // ×S
  settleVel: 1e-2, // ×S /s

  // 録画
  gifMaxSeconds: 6,
  gifFps: 30,
  gifMaxSide: 480,
} as const;

export interface MochiParams {
  radius: number; // つまみ範囲 ×S
  stretch: number; // 伸び上限 L_max = stretch × radius
  releaseFreq: number; // 揺れ戻り周波数 Hz
  releaseZeta: number; // 減衰比（小さいほどよく揺れる）
  bulge: number; // ぷっくり量 κ
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 「やわらかさ」スライダー1本 → 物理パラメータへのマッピング
export function paramsFromSoftness(s: number): MochiParams {
  return {
    radius: 0.22,
    stretch: lerp(0.44, 0.66, s),
    releaseFreq: lerp(12, 6, s),
    releaseZeta: lerp(0.28, 0.1, s),
    bulge: 0.1,
  };
}

// 「ゆれの回数」スライダー(0..1) ↔ 減衰比
export function zetaFromWobble(w: number): number {
  return lerp(0.35, 0.1, w);
}
export function wobbleFromZeta(z: number): number {
  return Math.min(1, Math.max(0, (0.35 - z) / 0.25));
}

export const DEFAULT_SOFTNESS = 0.5;
