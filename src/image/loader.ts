import { CONFIG } from '../config';
import type { LoadedImage } from '../state';

function capSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

async function decodeViaImg(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeToCanvas(blob: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement;
  if (blob.type === 'image/svg+xml') {
    // SVGはcreateImageBitmap非対応のブラウザがあるため<img>経由で確実にラスタライズ
    source = await decodeViaImg(blob);
  } else {
    try {
      source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      source = await decodeViaImg(blob);
    }
  }

  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!sw || !sh) throw new Error('empty image');

  const { w, h } = capSize(sw, sh, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  if ('close' in source) source.close();
  return canvas;
}

export async function loadFromBlob(blob: Blob): Promise<LoadedImage> {
  if (!blob.type.startsWith('image/')) throw new Error('not an image');
  const canvas = await decodeToCanvas(blob, CONFIG.imageMaxSide);

  // つかみ判定用の縮小ImageData
  const a = capSize(canvas.width, canvas.height, CONFIG.alphaSampleMaxSide);
  let alpha: ImageData;
  if (a.w === canvas.width && a.h === canvas.height) {
    alpha = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  } else {
    const small = document.createElement('canvas');
    small.width = a.w;
    small.height = a.h;
    const sctx = small.getContext('2d')!;
    sctx.drawImage(canvas, 0, 0, a.w, a.h);
    alpha = sctx.getImageData(0, 0, a.w, a.h);
  }

  return {
    source: canvas,
    width: canvas.width,
    height: canvas.height,
    aspect: canvas.width / canvas.height,
    alpha,
  };
}

/** rest UV → アルファ値(0..1)のサンプラを作る */
export function makeAlphaSampler(img: LoadedImage): (u: number, v: number) => number {
  const { data, width, height } = img.alpha;
  return (u, v) => {
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    return data[(y * width + x) * 4 + 3] / 255;
  };
}
