import { CONFIG } from '../config';
import type { RecFormat } from '../state';

const VIDEO_MIMES = [
  'video/webm;codecs=vp9',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4',
];

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// キャンバス録画。動画=MediaRecorder、GIF=フレームキャプチャ+Worker encodeの2系統。
export class Recorder {
  recording = false;
  onStopped: (() => void) | null = null;
  onStatus: ((msg: string) => void) | null = null;

  private format: RecFormat = 'video';
  private source: HTMLCanvasElement | null = null;
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private frames: ArrayBuffer[] = [];
  private cap = document.createElement('canvas');
  private capCtx = this.cap.getContext('2d', { willReadFrequently: true })!;
  private startedAt = 0;
  private lastCapture = 0;

  start(canvas: HTMLCanvasElement, format: RecFormat): boolean {
    if (this.recording) return false;
    this.source = canvas;
    this.format = format;
    this.startedAt = performance.now();

    if (format === 'video') {
      const mime = VIDEO_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) return false;
      try {
        const stream = canvas.captureStream(60);
        this.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      } catch {
        return false;
      }
      this.chunks = [];
      this.mr.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.mr.onstop = () => {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        download(new Blob(this.chunks, { type: mime }), `motihoppe.${ext}`);
        this.onStatus?.('保存しました');
      };
      this.mr.start();
    } else {
      const scale = Math.min(1, CONFIG.gifMaxSide / Math.max(canvas.width, canvas.height));
      this.cap.width = Math.max(2, Math.round(canvas.width * scale) & ~1);
      this.cap.height = Math.max(2, Math.round(canvas.height * scale) & ~1);
      this.frames = [];
      this.lastCapture = 0;
    }
    this.recording = true;
    return true;
  }

  /** RAFループから毎フレーム呼ぶ（GIFのフレームキャプチャ＋上限監視） */
  tick(now: number): void {
    if (!this.recording || !this.source) return;
    if (this.format === 'gif') {
      if (now - this.lastCapture >= 1000 / CONFIG.gifFps) {
        this.lastCapture = now;
        const ctx = this.capCtx;
        // 透過GIFのギザギザ回避のため背景色に合成する
        ctx.fillStyle = '#fff4f6';
        ctx.fillRect(0, 0, this.cap.width, this.cap.height);
        ctx.drawImage(this.source, 0, 0, this.cap.width, this.cap.height);
        const img = ctx.getImageData(0, 0, this.cap.width, this.cap.height);
        this.frames.push(img.data.buffer);
      }
      if (now - this.startedAt >= CONFIG.gifMaxSeconds * 1000) this.stop();
    }
  }

  stop(): void {
    if (!this.recording) return;
    this.recording = false;

    if (this.format === 'video') {
      this.mr?.stop();
      this.mr = null;
    } else if (this.frames.length > 0) {
      this.onStatus?.('GIFに変換中…');
      const worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Uint8Array<ArrayBuffer>>) => {
        download(new Blob([e.data], { type: 'image/gif' }), 'motihoppe.gif');
        this.onStatus?.('保存しました');
        worker.terminate();
      };
      worker.postMessage(
        {
          width: this.cap.width,
          height: this.cap.height,
          delayMs: Math.round(1000 / CONFIG.gifFps),
          buffers: this.frames,
        },
        this.frames,
      );
      this.frames = [];
    }
    this.onStopped?.();
  }

  get elapsedSec(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }
}
