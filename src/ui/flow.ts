import type { App } from '../app';
import { events, state } from '../state';

// 動線UI（ステップバー・空状態・ぬりぬりバー・あそぶツールバー）の配線。
export function initFlow(app: App): void {
  const $ = (id: string) => document.getElementById(id)!;
  const stepLoad = $('stepLoad') as HTMLButtonElement;
  const stepPaint = $('stepPaint') as HTMLButtonElement;
  const stepPlay = $('stepPlay') as HTMLButtonElement;
  const emptyState = $('emptyState');
  const paintUi = $('paintUi');
  const toolbar = $('toolbar');

  stepLoad.addEventListener('click', () => app.pickImage());
  stepPaint.addEventListener('click', () => app.enterPaint());
  stepPlay.addEventListener('click', () => app.enterPlay());

  $('btnPick').addEventListener('click', () => app.pickImage());
  $('btnSample').addEventListener('click', () => void app.loadSample());

  // ぬりぬりバー
  const btnBrush = $('btnBrush');
  const btnEraser = $('btnEraser');
  const setEraser = (erasing: boolean) => {
    app.maskTool.erasing = erasing;
    btnBrush.classList.toggle('active', !erasing);
    btnEraser.classList.toggle('active', erasing);
  };
  btnBrush.addEventListener('click', () => setEraser(false));
  btnEraser.addEventListener('click', () => setEraser(true));
  const brushSize = $('brushSize') as HTMLInputElement;
  brushSize.addEventListener('input', () => {
    app.maskTool.brushRadius = parseFloat(brushSize.value);
    app.updateBrushCursorSize();
  });
  const brushType = $('brushType');
  brushType.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.maskTool.brushType = btn.dataset.type === 'soft' ? 'soft' : 'hard';
      brushType.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  $('btnClearMask').addEventListener('click', () => app.clearMask());
  $('btnAllMochi').addEventListener('click', () => app.enterPlay(true));
  $('btnPlay').addEventListener('click', () => app.enterPlay());

  // あそぶツールバー
  $('btnChangeImage').addEventListener('click', () => app.pickImage());
  $('btnRepaint').addEventListener('click', () => app.enterPaint());
  const btnSound = $('btnSound');
  btnSound.addEventListener('click', () => {
    state.muted = !state.muted;
    btnSound.classList.toggle('muted', state.muted);
  });
  const btnRecord = $('btnRecord');
  btnRecord.addEventListener('click', () => app.toggleRecord());
  $('btnOptions').addEventListener('click', () => app.openPanel(true));

  events.on('recording', () => {
    btnRecord.classList.toggle('recording', state.recording);
  });

  const sync = () => {
    const m = state.mode;
    emptyState.hidden = m !== 'empty';
    paintUi.hidden = m !== 'paint';
    toolbar.hidden = m !== 'play';
    const has = !!state.image;
    stepPaint.disabled = !has;
    stepPlay.disabled = !has;
    stepLoad.classList.toggle('active', m === 'empty');
    stepPaint.classList.toggle('active', m === 'paint');
    stepPlay.classList.toggle('active', m === 'play');
  };
  events.on('mode', sync);
  events.on('image', sync);
  sync();
}
