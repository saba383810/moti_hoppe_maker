import { CONFIG } from '../config';

// ほっぺ領域マスク。オフスクリーン2D canvas（黒=固定、白=もちもち）。
// 赤チャンネルをR8テクスチャとしてGPUへ、ImageDataキャッシュでCPUサンプル。
export class MaskLayer {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  /** テクスチャ再アップロードが必要 */
  dirty = false;
  /** ブラシで一度でも塗られたか（「あそぶ！」時の空マスク判定用） */
  painted = false;
  private data: ImageData | null = null;

  constructor() {
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  }

  /** 画像ロード時に呼ぶ。長辺 = CONFIG.maskSize、アスペクト一致 */
  setup(aspect: number): void {
    const size = CONFIG.maskSize;
    const w = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect));
    const h = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;
    this.canvas.width = w;
    this.canvas.height = h;
    this.clear();
  }

  clear(): void {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.painted = false;
    this.invalidate();
  }

  /**
   * ソフトブラシスタンプ。
   * @param u,v rest UV
   * @param radiusIso iso空間での半径（高さ=1基準）
   */
  stamp(u: number, v: number, radiusIso: number, erase: boolean): void {
    const { width: w, height: h } = this.canvas;
    const cx = u * w;
    const cy = v * h;
    const r = Math.max(1, radiusIso * h);
    const ctx = this.ctx;
    const color = erase ? '0,0,0' : '255,255,255';
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(${color},1)`);
    grad.addColorStop(0.5, `rgba(${color},1)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (!erase) this.painted = true;
    this.invalidate();
  }

  private invalidate(): void {
    this.dirty = true;
    this.data = null;
  }

  /** rest UVでのマスク値(0..1) */
  sample = (u: number, v: number): number => {
    if (!this.data) {
      this.data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
    const { data, width, height } = this.data;
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    return data[(y * width + x) * 4] / 255;
  };

  /** サンプル用のほっぺプリセット（rest UV座標） */
  presetCheeks(cheeks: { u: number; v: number; r: number }[]): void {
    this.clear();
    for (const c of cheeks) this.stamp(c.u, c.v, c.r, false);
    this.painted = true;
  }
}
