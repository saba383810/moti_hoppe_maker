import type { Vec2 } from '../interaction/coords';
import type { MaskLayer } from './maskCanvas';

/** くっきり=芯をきっちり塗る / ふんわり=フチを滑らかにぼかす */
export type BrushType = 'hard' | 'soft';

// ブラシストローク。サンプル点間を距離補間してスタンプを敷き詰める。
// 指のブレでフチがガビガビにならないよう、入力位置はEMAで手ブレ補正してから塗る。
export class MaskTool {
  /** ブラシ半径（×S iso単位） */
  brushRadius = 0.07;
  brushType: BrushType = 'hard';
  erasing = false;
  /** 手ブレ補正の強さ（1=補正なし、小さいほど滑らかで遅れる） */
  streamline = 0.35;
  private last: Vec2 | null = null;
  private smooth: Vec2 | null = null;
  private lastRaw: Vec2 | null = null;
  private pendingLayer: MaskLayer | null = null;
  private pendingS = 1;

  strokeTo(layer: MaskLayer, u: number, v: number, S: number): void {
    this.lastRaw = { x: u, y: v };
    this.pendingLayer = layer;
    this.pendingS = S;
    if (!this.smooth) {
      this.smooth = { x: u, y: v };
      layer.stamp(u, v, this.brushRadius * S, this.erasing, this.brushType === 'soft');
      this.last = { x: u, y: v };
      return;
    }
    // EMAで入力を平滑化（タッチのジッタを吸収）
    this.smooth.x += (u - this.smooth.x) * this.streamline;
    this.smooth.y += (v - this.smooth.y) * this.streamline;
    this.stampSegment(layer, this.smooth.x, this.smooth.y, S);
  }

  private stampSegment(layer: MaskLayer, u: number, v: number, S: number): void {
    const r = this.brushRadius * S;
    const soft = this.brushType === 'soft';
    if (!this.last) {
      layer.stamp(u, v, r, this.erasing, soft);
    } else {
      const dx = u - this.last.x;
      const dy = v - this.last.y;
      // rest UVはx方向が縮んでいるのでiso距離で刻む（v基準=高さ1）
      const dist = Math.hypot(dx, dy);
      const spacing = Math.max(r * 0.4, 1e-4);
      const steps = Math.min(200, Math.ceil(dist / spacing));
      for (let i = 1; i <= steps; i++) {
        layer.stamp(
          this.last.x + (dx * i) / steps,
          this.last.y + (dy * i) / steps,
          r,
          this.erasing,
          soft,
        );
      }
    }
    this.last = { x: u, y: v };
  }

  endStroke(): void {
    // 補正の遅れ分を指を離した位置まで描き切る
    if (this.pendingLayer && this.lastRaw && this.last) {
      this.stampSegment(this.pendingLayer, this.lastRaw.x, this.lastRaw.y, this.pendingS);
    }
    this.last = null;
    this.smooth = null;
    this.lastRaw = null;
    this.pendingLayer = null;
  }
}
