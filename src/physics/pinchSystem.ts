import { CONFIG } from '../config';
import type { Vec2 } from '../interaction/coords';
import { state } from '../state';
import { stepSpring } from './spring';

export interface Grab {
  pointerId: number;
  /** つかんだ点（rest iso空間。以後固定） */
  anchor: Vec2;
  /** 現在のポインタ位置（iso空間） */
  pointer: Vec2;
  /** 現在の引っ張りベクトル（スプリング状態） */
  pull: Vec2;
  vel: Vec2;
  /** つかみイーズイン 0→1 */
  ease: number;
  /** anchor位置のマスク×アルファ重み（焼き込み） */
  weight: number;
  released: boolean;
}

// シェーダと同じ式（CPUミラー。逆変形・つかみ判定に使う）
function falloff(t: number): number {
  const s = 1 - t;
  return s * s * s * (6 * t * t + 3 * t + 1);
}
function ring(t: number): number {
  return 6.75 * t * (1 - t) * (1 - t);
}

export class PinchSystem {
  grabs: Grab[] = [];
  aspect = 1;
  /** rest UVでのマスク値サンプラ（マスク無効時は1を返すこと） */
  maskSample: (u: number, v: number) => number = () => 1;
  /** rest UVでの画像アルファサンプラ */
  alphaSample: (u: number, v: number) => number = () => 1;

  private grabA = new Float32Array(CONFIG.maxGrabs * 4);
  private grabPull = new Float32Array(CONFIG.maxGrabs * 2);

  get S(): number {
    return Math.min(1, this.aspect);
  }

  private lmax(): number {
    return state.params.stretch * state.params.radius * this.S;
  }

  private radiusEff(g: Grab): number {
    const base = state.params.radius * this.S;
    const mag = Math.hypot(g.pull.x, g.pull.y);
    return base * (1 + CONFIG.radiusGrow * Math.min(1, mag / this.lmax()));
  }

  private strengthOf(g: Grab): number {
    return Math.min(1, (g.ease * 1000) / CONFIG.grabEaseMs) * g.weight;
  }

  /** rest UV点の変位（iso空間）。シェーダの式のミラー */
  displacementAt(u: number, v: number): Vec2 {
    const ix = u * this.aspect;
    const iy = v;
    let dx = 0;
    let dy = 0;
    let wsum = 0;
    const bulge = state.params.bulge;
    for (const g of this.grabs) {
      const strength = this.strengthOf(g);
      if (strength <= 0) continue;
      const relX = ix - g.anchor.x;
      const relY = iy - g.anchor.y;
      const d = Math.hypot(relX, relY);
      const R = this.radiusEff(g);
      const t = Math.min(1, d / R);
      const w = falloff(t) * strength;
      const pullMag = Math.hypot(g.pull.x, g.pull.y);
      const dirX = d > 1e-5 ? relX / d : 0;
      const dirY = d > 1e-5 ? relY / d : 0;
      dx += w * g.pull.x + bulge * pullMag * ring(t) * dirX * strength;
      dy += w * g.pull.y + bulge * pullMag * ring(t) * dirY * strength;
      wsum += w;
    }
    const m = state.maskEnabled ? this.maskSample(u, v) : 1;
    const norm = m / Math.max(1, wsum);
    return { x: dx * norm, y: dy * norm };
  }

  /** 変形後iso点 → rest UV（固定点反復による逆変形。揺れ中の再つかみでもズレない） */
  invert(isoX: number, isoY: number): Vec2 {
    let u = isoX / this.aspect;
    let v = isoY;
    for (let i = 0; i < 3; i++) {
      const d = this.displacementAt(u, v);
      u = (isoX - d.x) / this.aspect;
      v = isoY - d.y;
    }
    return { x: u, y: v };
  }

  tryGrab(pointerId: number, iso: Vec2): Grab | null {
    if (this.grabs.length >= CONFIG.maxGrabs) {
      // 揺れ戻り中のスロットを回収して空ける
      const idx = this.grabs.findIndex((g) => g.released);
      if (idx < 0) return null;
      this.grabs.splice(idx, 1);
    }
    const rest = this.invert(iso.x, iso.y);
    if (rest.x < 0 || rest.x > 1 || rest.y < 0 || rest.y > 1) return null;
    if (this.alphaSample(rest.x, rest.y) < 0.05) return null; // 透明部分はつかめない
    const weight = state.maskEnabled ? this.maskSample(rest.x, rest.y) : 1;
    if (weight < 0.05) return null;

    const grab: Grab = {
      pointerId,
      anchor: { x: rest.x * this.aspect, y: rest.y },
      pointer: { ...iso },
      pull: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      ease: 0,
      weight,
      released: false,
    };
    this.grabs.push(grab);
    return grab;
  }

  move(pointerId: number, iso: Vec2): void {
    const g = this.grabs.find((g) => g.pointerId === pointerId && !g.released);
    if (g) {
      g.pointer.x = iso.x;
      g.pointer.y = iso.y;
    }
  }

  release(pointerId: number): Grab | null {
    const g = this.grabs.find((g) => g.pointerId === pointerId && !g.released);
    if (g) g.released = true;
    return g ?? null;
  }

  releaseAll(): void {
    this.grabs.length = 0;
  }

  update(dtRaw: number): void {
    if (this.grabs.length === 0) return;
    const dt = Math.min(dtRaw, CONFIG.maxDt);
    const p = state.params;
    const relOmega = 2 * Math.PI * p.releaseFreq;
    const L = this.lmax();
    const settleP = CONFIG.settlePos * this.S;
    const settleV = CONFIG.settleVel * this.S;

    for (let i = this.grabs.length - 1; i >= 0; i--) {
      const g = this.grabs[i];
      g.ease += dt;

      // 目標: ドラッグ中=飽和済み指ベクトル（抵抗感）、リリース後=0（揺れ戻り）
      let tx = 0;
      let ty = 0;
      if (!g.released) {
        const dx = g.pointer.x - g.anchor.x;
        const dy = g.pointer.y - g.anchor.y;
        const mag = Math.hypot(dx, dy);
        if (mag > 1e-9) {
          const eff = L * Math.tanh(mag / L);
          tx = (dx / mag) * eff;
          ty = (dy / mag) * eff;
        }
      }
      const omega = g.released ? relOmega : CONFIG.dragOmega;
      const zeta = g.released ? p.releaseZeta : CONFIG.dragZeta;

      // サブステップ積分（フレームレート非依存）
      const n = Math.max(1, Math.ceil(dt / CONFIG.substep));
      const h = dt / n;
      for (let s = 0; s < n; s++) stepSpring(g.pull, g.vel, tx, ty, omega, zeta, h);

      // 収束したスロットを解放
      if (
        g.released &&
        Math.hypot(g.pull.x, g.pull.y) < settleP &&
        Math.hypot(g.vel.x, g.vel.y) < settleV
      ) {
        this.grabs.splice(i, 1);
      }
    }
  }

  get active(): boolean {
    return this.grabs.length > 0;
  }

  /** 揺れの強さ（0..1）。効果音の音量スケールに使う */
  intensityOf(g: Grab): number {
    return Math.min(1, Math.hypot(g.pull.x, g.pull.y) / this.lmax());
  }

  fillUniforms(): { grabCount: number; grabA: Float32Array; grabPull: Float32Array } {
    const n = Math.min(this.grabs.length, CONFIG.maxGrabs);
    for (let i = 0; i < n; i++) {
      const g = this.grabs[i];
      this.grabA[i * 4] = g.anchor.x;
      this.grabA[i * 4 + 1] = g.anchor.y;
      this.grabA[i * 4 + 2] = this.radiusEff(g);
      this.grabA[i * 4 + 3] = this.strengthOf(g);
      this.grabPull[i * 2] = g.pull.x;
      this.grabPull[i * 2 + 1] = g.pull.y;
    }
    return { grabCount: n, grabA: this.grabA, grabPull: this.grabPull };
  }
}
