import type { Vec2 } from '../interaction/coords';
import type { MaskLayer } from './maskCanvas';

// ブラシストローク。サンプル点間を距離補間してスタンプを敷き詰める。
export class MaskTool {
  /** ブラシ半径（×S iso単位） */
  brushRadius = 0.07;
  erasing = false;
  private last: Vec2 | null = null;

  strokeTo(layer: MaskLayer, u: number, v: number, S: number): void {
    const r = this.brushRadius * S;
    if (!this.last) {
      layer.stamp(u, v, r, this.erasing);
    } else {
      const dx = u - this.last.x;
      const dy = v - this.last.y;
      // rest UVはx方向が縮んでいるのでiso距離で刻む（v基準=高さ1）
      const dist = Math.hypot(dx, dy);
      const spacing = Math.max(r * 0.4, 1e-4);
      const steps = Math.min(200, Math.ceil(dist / spacing));
      for (let i = 1; i <= steps; i++) {
        layer.stamp(this.last.x + (dx * i) / steps, this.last.y + (dy * i) / steps, r, this.erasing);
      }
    }
    this.last = { x: u, y: v };
  }

  endStroke(): void {
    this.last = null;
  }
}
