// 座標変換の一元管理。
// iso空間: 画像のrest空間をアスペクト補正したもの（x∈[0,aspect], y∈[0,1], y下向き）。
// screen(css px) ↔ canvas(px) ↔ iso ↔ rest UV の変換をここに集約する。

export interface Vec2 {
  x: number;
  y: number;
}

export class ViewTransform {
  aspect = 1;
  canvasW = 1;
  canvasH = 1;
  /** px per iso unit */
  k = 1;
  ox = 0;
  oy = 0;
  private mat = new Float32Array(9);

  update(canvasW: number, canvasH: number, aspect: number, fitRatio: number): void {
    this.aspect = aspect;
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.k = fitRatio * Math.min(canvasW / aspect, canvasH);
    this.ox = (canvasW - this.k * aspect) / 2;
    this.oy = (canvasH - this.k) / 2;
  }

  /** iso → clip のmat3（column-major） */
  matrix(): Float32Array {
    const { k, ox, oy, canvasW: w, canvasH: h } = this;
    // px = ox + k*x, py = oy + k*y → clip
    this.mat.set([
      (2 * k) / w, 0, 0,
      0, (-2 * k) / h, 0,
      (2 * ox) / w - 1, 1 - (2 * oy) / h, 1,
    ]);
    return this.mat;
  }

  isoFromClient(clientX: number, clientY: number, canvas: HTMLCanvasElement): Vec2 {
    const rect = canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) * this.canvasW) / rect.width;
    const py = ((clientY - rect.top) * this.canvasH) / rect.height;
    return { x: (px - this.ox) / this.k, y: (py - this.oy) / this.k };
  }

  /** iso長さ → css px長さ */
  isoToCssLength(len: number, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return len * this.k * (rect.width / this.canvasW);
  }

  restUvFromIso(iso: Vec2): Vec2 {
    return { x: iso.x / this.aspect, y: iso.y };
  }
}
