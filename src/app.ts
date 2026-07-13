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

// public/sample.svg のプリセットマスク（rest UV）。
// 体ぜんたい薄め → 顔まわり中くらい → ほっぺ全力、の3段階もちもち
const SAMPLE_MASK = [
  { u: 0.5, v: 0.55, r: 0.45, value: 0.35, core: 0.6 },
  { u: 0.5, v: 0.57, r: 0.3, value: 0.6, core: 0.5 },
  { u: 0.322, v: 0.586, r: 0.12, value: 1, core: 0.55 },
  { u: 0.678, v: 0.586, r: 0.12, value: 1, core: 0.55 },
];

export class App {
  readonly maskTool = new MaskTool();

  private canvas = document.getElementById('gl') as HTMLCanvasElement;
  private stage = document.getElementById('stage')!;
  private brushCursor = document.getElementById('brushCursor')!;
  private brushPreview = document.getElementById('brushPreview')!;
  private brushPreviewTimer = 0;
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
  /** アクティブポインタ（canvas px）。2本指でジェスチャ判定に使う */
  private pointers = new Map<number, { x: number; y: number }>();
  private gestureActive = false;
  private btnResetView = document.getElementById('btnResetView') as HTMLButtonElement;
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
    // ホイール/トラックパッドでズーム（カーソル位置固定）
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!state.image) return;
        e.preventDefault();
        const p = this.view.canvasPxFromClient(e.clientX, e.clientY, this.canvas);
        this.view.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
        this.afterViewChange();
      },
      { passive: false },
    );
    this.btnResetView.addEventListener('click', () => {
      this.view.resetUser();
      this.afterViewChange();
    });
    setupImageInputs((b) => void this.loadBlob(b));
    initFlow(this);
    this.panelCtl = initPanel();

    // 最初のタップ/クリックで音声をアンロック（iOS対策。touchend/click系でしか確実に効かない）
    const unlockAudio = () => this.sfx.unlock();
    window.addEventListener('pointerup', unlockAudio, { once: true });
    window.addEventListener('touchend', unlockAudio, { once: true });

    this.recorder.onStatus = (m) => showToast(m);
    this.recorder.onStopped = () => {
      state.recording = false;
      events.emit('recording');
    };

    events.on('mode', () => {
      this.brushCursor.hidden = state.mode !== 'paint';
      // 表示用（生）と変形用（ぼかし）でマスクテクスチャを切り替えるため再アップロード
      this.mask.dirty = true;
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
      this.mask.preset(SAMPLE_MASK);
      // 体+耳の実シルエットに沿った縁取りを最大でもちもちに
      this.mask.presetOutline((ctx, w, h) => {
        ctx.beginPath();
        ctx.ellipse(0.5 * w, 0.5547 * h, 0.3887 * h, 0.3438 * h, 0, 0, Math.PI * 2);
        ctx.moveTo(0.3184 * w + 0.084 * h, 0.2461 * h);
        ctx.arc(0.3184 * w, 0.2461 * h, 0.084 * h, 0, Math.PI * 2);
        ctx.moveTo(0.6816 * w + 0.084 * h, 0.2461 * h);
        ctx.arc(0.6816 * w, 0.2461 * h, 0.084 * h, 0, Math.PI * 2);
        ctx.fill();
      }, 0.07, 1);
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
    this.view.resetUser();
    events.emit('image');
    setMode('paint');
    this.afterViewChange();
  }

  private afterViewChange(): void {
    this.needsRender = true;
    this.updateBrushCursorSize();
    this.btnResetView.hidden = !this.view.isTransformed();
  }

  // ---- モード遷移 ----

  enterPaint(): void {
    if (!state.image) return;
    this.pinch.releaseAll();
    state.maskEnabled = true;
    this.resetGesture();
    setMode('paint');
  }

  private resetGesture(): void {
    this.pointers.clear();
    this.gestureActive = false;
  }

  /** 2本指ジェスチャの共通move処理（ぬり/あそぶ両モード） */
  private handleGestureMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const pts = [...this.pointers.entries()];
    if (pts.length < 2) return;
    const [id1, p1] = pts[0];
    const [id2, p2] = pts[1];
    const q = this.view.canvasPxFromClient(e.clientX, e.clientY, this.canvas);
    if (e.pointerId === id1) this.view.applyGesture(p1, p2, q, p2);
    else if (e.pointerId === id2) this.view.applyGesture(p1, p2, p1, q);
    else return;
    this.pointers.set(e.pointerId, q);
    this.afterViewChange();
  }

  enterPlay(allMochi = false): void {
    if (!state.image) return;
    if (allMochi || (state.maskEnabled && !this.mask.painted)) {
      state.maskEnabled = false;
      if (!allMochi) showToast('なにも塗ってないので、ぜんぶもちもちにしたよ');
    }
    this.resetGesture();
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

  /** ふとさ調整中、画面中央に実寸プレビューを出す（追従カーソルは重複するので消す） */
  showBrushPreview(): void {
    const d = this.view.isoToCssLength(this.maskTool.brushRadius * this.pinch.S, this.canvas) * 2;
    this.brushPreview.style.width = `${d}px`;
    this.brushPreview.style.height = `${d}px`;
    this.brushPreview.hidden = false;
    this.brushCursor.hidden = true;
    window.clearTimeout(this.brushPreviewTimer);
    this.brushPreviewTimer = window.setTimeout(() => this.hideBrushPreview(), 800);
  }

  private hideBrushPreview(): void {
    window.clearTimeout(this.brushPreviewTimer);
    this.brushPreview.hidden = true;
    this.brushCursor.hidden = state.mode !== 'paint';
  }

  // ---- 毎フレーム ----

  private tick = (t: number): void => {
    const dt = (t - this.lastT) / 1000;
    this.lastT = t;
    this.pinch.update(dt);

    if (this.mask.dirty && this.renderer) {
      // ぬりモード中は「塗った通り」の生マスクを表示（ぼかしは変形計算専用）
      this.renderer.updateMask(
        state.mode === 'paint' ? this.mask.canvas : this.mask.textureSource(),
      );
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
      const p = this.view.canvasPxFromClient(e.clientX, e.clientY, this.canvas);
      this.pointers.set(e.pointerId, p);
      if (this.gestureActive) return;
      const iso = this.view.isoFromClient(e.clientX, e.clientY, this.canvas);
      if (this.pinch.tryGrab(e.pointerId, iso)) {
        this.sfx.grab();
      } else if (this.pointers.size >= 2) {
        // つかめない場所に2本目 → ジェスチャモード。つまみ中のほっぺは離す
        this.gestureActive = true;
        for (const g of this.pinch.grabs) {
          if (!g.released) this.pinch.release(g.pointerId);
        }
      }
    },
    move: (e) => {
      if (this.gestureActive) {
        this.handleGestureMove(e);
        return;
      }
      if (this.pointers.has(e.pointerId)) {
        this.pointers.set(
          e.pointerId,
          this.view.canvasPxFromClient(e.clientX, e.clientY, this.canvas),
        );
      }
      this.pinch.move(e.pointerId, this.view.isoFromClient(e.clientX, e.clientY, this.canvas));
    },
    up: (e) => {
      this.pointers.delete(e.pointerId);
      if (this.gestureActive) {
        if (this.pointers.size === 0) this.gestureActive = false;
        return;
      }
      const g = this.pinch.grabs.find((g) => g.pointerId === e.pointerId && !g.released);
      if (!g) return;
      const intensity = this.pinch.intensityOf(g);
      this.pinch.release(e.pointerId);
      this.sfx.release(intensity, state.params.releaseFreq);
    },
  };

  private paintHandlers: PointerHandlers = {
    down: (e) => {
      if (!this.brushPreview.hidden) this.hideBrushPreview();
      const p = this.view.canvasPxFromClient(e.clientX, e.clientY, this.canvas);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 1 && !this.gestureActive) {
        this.mask.beginStroke();
        this.moveBrushCursor(e);
        this.paintAt(e);
      } else if (this.pointers.size === 2 && !this.gestureActive) {
        // 2本目の指が来たらジェスチャモードへ。塗りかけの線は取り消す
        this.gestureActive = true;
        this.maskTool.endStroke();
        this.mask.cancelStroke();
        this.brushCursor.hidden = true;
      }
    },
    move: (e) => {
      if (this.gestureActive) {
        this.handleGestureMove(e);
        return;
      }
      this.moveBrushCursor(e);
      if (this.pointers.has(e.pointerId)) {
        this.pointers.set(
          e.pointerId,
          this.view.canvasPxFromClient(e.clientX, e.clientY, this.canvas),
        );
        // タッチはイベントが間引かれるので、coalescedイベントで細かくなぞる
        const coalesced =
          typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ce of coalesced.length > 0 ? coalesced : [e]) this.paintAt(ce);
      }
    },
    up: (e) => {
      if (this.pointers.delete(e.pointerId)) {
        if (!this.gestureActive) this.maskTool.endStroke();
        if (this.pointers.size === 0) {
          // 全部の指が離れるまで塗りは再開しない（誤爆防止）
          this.gestureActive = false;
          this.brushCursor.hidden = state.mode !== 'paint';
        }
      }
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
      this.renderer.updateMask(this.mask.textureSource());
    }
    this.needsRender = true;
  }
}
