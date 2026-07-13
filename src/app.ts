import { Sfx } from './audio/sfx';
import { Recorder } from './capture/recorder';
import { CONFIG } from './config';
import { loadFromBlob, makeAlphaSampler } from './image/loader';
import { ViewTransform } from './interaction/coords';
import { attachPointer, type PointerHandlers } from './interaction/pointer';
import { MaskLayer } from './mask/maskCanvas';
import { MaskTool } from './mask/maskTool';
import { PinchSystem } from './physics/pinchSystem';
import { createGL } from './renderer/gl';
import { Renderer } from './renderer/renderer';
import { events, setMode, state, type LoadedImage } from './state';
import { setupImageInputs } from './ui/dropzone';
import { initFlow } from './ui/flow';
import { initPanel, type PanelControl } from './ui/panel';
import { showToast } from './ui/toast';

// public/sample.svg のほっぺ位置（rest UV）
const SAMPLE_CHEEKS = [
  { u: 0.322, v: 0.586, r: 0.12 },
  { u: 0.678, v: 0.586, r: 0.12 },
];

export class App {
  readonly maskTool = new MaskTool();

  private canvas = document.getElementById('gl') as HTMLCanvasElement;
  private stage = document.getElementById('stage')!;
  private brushCursor = document.getElementById('brushCursor')!;
  private fileInput = document.getElementById('fileInput') as HTMLInputElement;
  private view = new ViewTransform();
  private pinch = new PinchSystem();
  private mask = new MaskLayer();
  private sfx = new Sfx();
  private recorder = new Recorder();
  private renderer: Renderer | null = null;
  private panelCtl: PanelControl;

  private needsRender = true;
  private lastT = 0;
  private paintPointers = new Set<number>();
  private debug = new URLSearchParams(location.search).has('debug');
  private fpsEl = document.getElementById('fps')!;
  private frames = 0;
  private fpsT = 0;

  constructor() {
    const gl = createGL(this.canvas);
    if (!gl) {
      document.getElementById('fatalCard')!.hidden = false;
      document.getElementById('emptyState')!.hidden = true;
      this.panelCtl = { open: () => {} };
      return;
    }
    this.renderer = new Renderer(gl, this.view);
    if (this.debug) this.fpsEl.hidden = false;

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(this.stage);
    this.onResize();

    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.canvas.addEventListener('webglcontextrestored', () => this.restoreGL());

    attachPointer(this.canvas, () => this.currentHandlers());
    setupImageInputs((b) => void this.loadBlob(b));
    initFlow(this);
    this.panelCtl = initPanel();

    this.recorder.onStatus = (m) => showToast(m);
    this.recorder.onStopped = () => {
      state.recording = false;
      events.emit('recording');
    };

    events.on('mode', () => {
      this.brushCursor.hidden = state.mode !== 'paint';
      this.needsRender = true;
    });
    events.on('params', () => (this.needsRender = true));

    requestAnimationFrame((t) => {
      this.lastT = t;
      requestAnimationFrame(this.tick);
    });
  }

  // ---- 画像ロード ----

  pickImage(): void {
    this.fileInput.click();
  }

  async loadBlob(blob: Blob): Promise<void> {
    try {
      const img = await loadFromBlob(blob);
      this.setImage(img);
    } catch {
      showToast('画像を読み込めませんでした……別のファイルで試してみてください');
    }
  }

  async loadSample(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample.svg`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const img = await loadFromBlob(
        blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }),
      );
      this.setImage(img);
      this.mask.presetCheeks(SAMPLE_CHEEKS);
      setMode('play');
      showToast('ほっぺは塗ってあるよ。つまんで引っぱってみて！');
    } catch {
      showToast('サンプルを読み込めませんでした');
    }
  }

  private setImage(img: LoadedImage): void {
    state.image = img;
    this.renderer?.setImage(img.source, img.aspect);
    this.pinch.releaseAll();
    this.pinch.aspect = img.aspect;
    this.pinch.alphaSample = makeAlphaSampler(img);
    this.mask.setup(img.aspect);
    this.pinch.maskSample = this.mask.sample;
    state.maskEnabled = true;
    events.emit('image');
    setMode('paint');
    this.updateBrushCursorSize();
    this.needsRender = true;
  }

  // ---- モード遷移 ----

  enterPaint(): void {
    if (!state.image) return;
    this.pinch.releaseAll();
    state.maskEnabled = true;
    setMode('paint');
  }

  enterPlay(allMochi = false): void {
    if (!state.image) return;
    if (allMochi || (state.maskEnabled && !this.mask.painted)) {
      state.maskEnabled = false;
      if (!allMochi) showToast('なにも塗ってないので、ぜんぶもちもちにしたよ');
    }
    setMode('play');
  }

  clearMask(): void {
    this.mask.clear();
    this.needsRender = true;
  }

  // ---- ツールバー ----

  toggleRecord(): void {
    if (state.recording) {
      this.recorder.stop();
      return;
    }
    if (!state.image || state.mode !== 'play') {
      showToast('「あそぶ」画面で録画できます');
      return;
    }
    if (!this.recorder.start(this.canvas, state.recFormat)) {
      showToast('この環境では録画できませんでした');
      return;
    }
    state.recording = true;
    events.emit('recording');
    showToast(
      state.recFormat === 'gif'
        ? `GIF録画中！（最長${CONFIG.gifMaxSeconds}秒）`
        : '録画中！もういちど押すと停止して保存',
    );
  }

  openPanel(v: boolean): void {
    this.panelCtl.open(v);
  }

  updateBrushCursorSize(): void {
    const d = this.view.isoToCssLength(this.maskTool.brushRadius * this.pinch.S, this.canvas) * 2;
    this.brushCursor.style.width = `${d}px`;
    this.brushCursor.style.height = `${d}px`;
  }

  // ---- 毎フレーム ----

  private tick = (t: number): void => {
    const dt = (t - this.lastT) / 1000;
    this.lastT = t;
    this.pinch.update(dt);

    if (this.mask.dirty && this.renderer) {
      this.renderer.updateMask(this.mask.canvas);
      this.mask.dirty = false;
      this.needsRender = true;
    }

    if (this.renderer && (this.needsRender || this.pinch.active || state.recording)) {
      const g = this.pinch.fillUniforms();
      this.renderer.draw({
        grabCount: g.grabCount,
        grabA: g.grabA,
        grabPull: g.grabPull,
        bulge: state.params.bulge,
        maskEnabled: state.maskEnabled,
        maskView: state.mode === 'paint',
      });
      this.needsRender = false;
    }

    if (state.recording) this.recorder.tick(t);

    if (this.debug) {
      this.frames++;
      if (t - this.fpsT > 1000) {
        this.fpsEl.textContent = `${this.frames}fps / grabs:${this.pinch.grabs.length}`;
        this.frames = 0;
        this.fpsT = t;
      }
    }
    requestAnimationFrame(this.tick);
  };

  // ---- 入力 ----

  private currentHandlers(): PointerHandlers | null {
    if (!state.image) return null;
    if (state.mode === 'play') return this.playHandlers;
    if (state.mode === 'paint') return this.paintHandlers;
    return null;
  }

  private playHandlers: PointerHandlers = {
    down: (e) => {
      const iso = this.view.isoFromClient(e.clientX, e.clientY, this.canvas);
      if (this.pinch.tryGrab(e.pointerId, iso)) this.sfx.grab();
    },
    move: (e) => {
      this.pinch.move(e.pointerId, this.view.isoFromClient(e.clientX, e.clientY, this.canvas));
    },
    up: (e) => {
      const g = this.pinch.grabs.find((g) => g.pointerId === e.pointerId && !g.released);
      if (!g) return;
      const intensity = this.pinch.intensityOf(g);
      this.pinch.release(e.pointerId);
      this.sfx.release(intensity, state.params.releaseFreq);
    },
  };

  private paintHandlers: PointerHandlers = {
    down: (e) => {
      this.paintPointers.add(e.pointerId);
      this.moveBrushCursor(e);
      this.paintAt(e);
    },
    move: (e) => {
      this.moveBrushCursor(e);
      if (this.paintPointers.has(e.pointerId)) this.paintAt(e);
    },
    up: (e) => {
      if (this.paintPointers.delete(e.pointerId)) this.maskTool.endStroke();
    },
  };

  private paintAt(e: PointerEvent): void {
    const iso = this.view.isoFromClient(e.clientX, e.clientY, this.canvas);
    const uv = this.view.restUvFromIso(iso);
    const u = Math.min(1, Math.max(0, uv.x));
    const v = Math.min(1, Math.max(0, uv.y));
    this.maskTool.strokeTo(this.mask, u, v, this.pinch.S);
  }

  private moveBrushCursor(e: PointerEvent): void {
    const rect = this.stage.getBoundingClientRect();
    this.brushCursor.style.left = `${e.clientX - rect.left}px`;
    this.brushCursor.style.top = `${e.clientY - rect.top}px`;
  }

  // ---- リサイズ / contextlost ----

  private onResize(): void {
    if (!this.renderer) return;
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.resize(w, h);
      this.needsRender = true;
      this.updateBrushCursorSize();
    }
  }

  private restoreGL(): void {
    const gl = createGL(this.canvas);
    if (!gl) return;
    this.renderer = new Renderer(gl, this.view);
    this.renderer.resize(this.canvas.width, this.canvas.height);
    if (state.image) {
      this.renderer.setImage(state.image.source, state.image.aspect);
      this.renderer.updateMask(this.mask.canvas);
    }
    this.needsRender = true;
  }
}
