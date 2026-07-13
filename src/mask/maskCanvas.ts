import { CONFIG } from '../config';

// ほっぺ領域マスク。オフスクリーン2D canvas（黒=固定、白=もちもち）。
// 赤チャンネルをR8テクスチャとしてGPUへ、ImageDataキャッシュでCPUサンプル。
export class MaskLayer {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  /** 変形weight用のぼかし済みマスク（塗りの角を丸めて輪郭を円形に保つ） */
  private blurCanvas = document.createElement('canvas');
  private blurCtx: CanvasRenderingContext2D;
  private blurDirty = true;
  /** テクスチャ再アップロードが必要 */
  dirty = false;
  /** ブラシで一度でも塗られたか（「あそぶ！」時の空マスク判定用） */
  painted = false;
  private data: ImageData | null = null;

  constructor() {
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    this.blurCtx = this.blurCanvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  }

  /** 画像ロード時に呼ぶ。長辺 = CONFIG.maskSize、アスペクト一致 */
  setup(aspect: number): void {
    const size = CONFIG.maskSize;
    const w = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect));
    const h = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;
    this.canvas.width = w;
    this.canvas.height = h;
    this.blurCanvas.width = w;
    this.blurCanvas.height = h;
    this.clear();
  }

  private ensureBlur(): void {
    if (!this.blurDirty) return;
    const { width: w, height: h } = this.canvas;
    const r = Math.max(2, Math.round(Math.max(w, h) * CONFIG.maskBlur));
    const ctx = this.blurCtx;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.filter = `blur(${r}px)`;
    ctx.drawImage(this.canvas, 0, 0);
    ctx.filter = 'none';
    this.blurDirty = false;
  }

  /** GPUへアップロードするテクスチャ元（ぼかし済み） */
  textureSource(): HTMLCanvasElement {
    this.ensureBlur();
    return this.blurCanvas;
  }

  clear(): void {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.painted = false;
    this.snap = null;
    this.invalidate();
  }

  private snap: ImageData | null = null;
  private snapPainted = false;

  /** ストローク開始時のスナップショット（2本指ジェスチャ化した時の取り消し用） */
  beginStroke(): void {
    this.snap = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.snapPainted = this.painted;
  }

  /** 塗りかけのストロークをなかったことにする */
  cancelStroke(): void {
    if (this.snap) {
      this.ctx.putImageData(this.snap, 0, 0);
      this.painted = this.snapPainted;
      this.snap = null;
      this.invalidate();
    }
  }

  /**
   * ブラシスタンプ。
   * - くっきり: 不透明グレースケール + lighten/darken（=max/min）。常に最大値で塗る
   * - ふんわり: 低アルファの加算（フロー型エアブラシ）。塗り重ねるほど徐々に濃くなり、
   *   くっきりの最大値へ漸近する
   * @param u,v rest UV
   * @param radiusIso iso空間での半径（高さ=1基準）
   * @param soft true=ふんわり / false=くっきり
   */
  stamp(u: number, v: number, radiusIso: number, erase: boolean, soft = false): void {
    const { width: w, height: h } = this.canvas;
    const cx = u * w;
    const cy = v * h;
    const r = Math.max(1, radiusIso * h);
    const ctx = this.ctx;
    if (soft) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const color = erase ? '0,0,0' : '255,255,255';
      const flow = 0.12; // 1スタンプあたりの最大アルファ。小さいほど「じわっと」育つ
      const stops: [number, number][] = [
        [0, 1],
        [0.4, 0.65],
        [0.7, 0.3],
        [1, 0],
      ];
      for (const [pos, shape] of stops) {
        grad.addColorStop(pos, `rgba(${color},${(flow * shape).toFixed(4)})`);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    } else {
      // 円の全域をまるまる最大値でベタ塗り（縁のフェードなし）
      ctx.globalCompositeOperation = erase ? 'darken' : 'lighten';
      ctx.fillStyle = erase ? '#000' : '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!erase) this.painted = true;
    this.invalidate();
  }

  private invalidate(): void {
    this.dirty = true;
    this.blurDirty = true;
    this.data = null;
  }

  /** rest UVでのマスク値(0..1)。シェーダと同じぼかし済みマスクを読む */
  sample = (u: number, v: number): number => {
    if (!this.data) {
      this.ensureBlur();
      this.data = this.blurCtx.getImageData(0, 0, this.blurCanvas.width, this.blurCanvas.height);
    }
    const { data, width, height } = this.data;
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    return data[(y * width + x) * 4] / 255;
  };

  /**
   * プリセット塗り（rest UV座標）。フチが滑らかな円スポットの集合。
   * @param spots value=塗りの強さ(0..1)、core=この割合までベタでその先フェード
   */
  preset(spots: { u: number; v: number; r: number; value: number; core: number }[]): void {
    this.clear();
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighten';
    for (const s of spots) {
      const cx = s.u * w;
      const cy = s.v * h;
      const r = Math.max(1, s.r * h);
      const c = Math.round(255 * s.value);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgb(${c},${c},${c})`);
      grad.addColorStop(s.core, `rgb(${c},${c},${c})`);
      grad.addColorStop(1, '#000');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.painted = true;
    this.invalidate();
  }

  /** プリセット用の楕円リング塗り（体の輪郭などに使う）。preset()の後に呼ぶ */
  presetRing(
    u: number,
    v: number,
    rx: number,
    ry: number,
    widthIso: number,
    value: number,
  ): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    const c = Math.round(255 * value);
    ctx.globalCompositeOperation = 'lighten';
    ctx.strokeStyle = `rgb(${c},${c},${c})`;
    ctx.lineWidth = Math.max(1, widthIso * h);
    ctx.beginPath();
    ctx.ellipse(u * w, v * h, rx * h, ry * h, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    this.painted = true;
    this.invalidate();
  }
}
