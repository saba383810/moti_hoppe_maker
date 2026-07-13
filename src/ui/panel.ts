import {
  DEFAULT_SOFTNESS,
  paramsFromSoftness,
  wobbleFromZeta,
  zetaFromWobble,
} from '../config';
import { events, state, type RecFormat } from '../state';

export interface PanelControl {
  open(v: boolean): void;
}

// せっていパネル。スライダー ↔ state.params のバインド。
export function initPanel(): PanelControl {
  const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
  const panel = document.getElementById('panel')!;
  const backdrop = document.getElementById('panelBackdrop')!;

  const open = (v: boolean) => {
    panel.hidden = !v;
    backdrop.hidden = !v;
  };
  document.getElementById('btnClosePanel')!.addEventListener('click', () => open(false));
  backdrop.addEventListener('click', () => open(false));

  const pSoftness = $('pSoftness');
  const pRadius = $('pRadius');
  const pStretch = $('pStretch');
  const pFreq = $('pFreq');
  const pWobble = $('pWobble');
  const pBulge = $('pBulge');
  const pVolume = $('pVolume');

  const syncSliders = () => {
    const p = state.params;
    pSoftness.value = String(state.softness);
    pRadius.value = String(p.radius);
    pStretch.value = String(p.stretch);
    pFreq.value = String(p.releaseFreq);
    pWobble.value = String(wobbleFromZeta(p.releaseZeta));
    pBulge.value = String(p.bulge);
    pVolume.value = String(state.volume);
  };

  pSoftness.addEventListener('input', () => {
    state.softness = parseFloat(pSoftness.value);
    state.params = paramsFromSoftness(state.softness);
    syncSliders();
    events.emit('params');
  });
  const bind = (el: HTMLInputElement, apply: (v: number) => void) => {
    el.addEventListener('input', () => {
      apply(parseFloat(el.value));
      events.emit('params');
    });
  };
  bind(pRadius, (v) => (state.params.radius = v));
  bind(pStretch, (v) => (state.params.stretch = v));
  bind(pFreq, (v) => (state.params.releaseFreq = v));
  bind(pWobble, (v) => (state.params.releaseZeta = zetaFromWobble(v)));
  bind(pBulge, (v) => (state.params.bulge = v));
  bind(pVolume, (v) => (state.volume = v));
  bind($('pHapticsStrength'), (v) => (state.hapticsStrength = v));

  document.getElementById('btnResetParams')!.addEventListener('click', () => {
    state.softness = DEFAULT_SOFTNESS;
    state.params = paramsFromSoftness(DEFAULT_SOFTNESS);
    syncSliders();
    events.emit('params');
  });

  // 録画形式
  const seg = document.getElementById('recFormat')!;
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.recFormat = (btn.dataset.fmt as RecFormat) ?? 'video';
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  syncSliders();
  return { open };
}
