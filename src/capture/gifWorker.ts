import { applyPalette, GIFEncoder, quantize } from 'gifenc';

export interface GifJob {
  width: number;
  height: number;
  delayMs: number;
  /** RGBAフレーム（transferされたArrayBuffer） */
  buffers: ArrayBuffer[];
}

self.onmessage = (e: MessageEvent<GifJob>) => {
  const { width, height, delayMs, buffers } = e.data;
  const enc = GIFEncoder();
  for (const buf of buffers) {
    const rgba = new Uint8Array(buf);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    enc.writeFrame(index, width, height, { palette, delay: delayMs });
  }
  enc.finish();
  const bytes = enc.bytes();
  (self as unknown as Worker).postMessage(bytes, [bytes.buffer]);
};
