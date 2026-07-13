import { DEFAULT_SOFTNESS, paramsFromSoftness, type MochiParams } from './config';

export type Mode = 'empty' | 'paint' | 'play';
export type RecFormat = 'video' | 'gif';

export interface LoadedImage {
  /** リサイズ済み画像（テクスチャ元 & contextlost復帰用バックアップ） */
  source: HTMLCanvasElement;
  width: number;
  height: number;
  aspect: number; // w/h
  /** つかみ判定用の縮小ImageData（透明部分はつかめない） */
  alpha: ImageData;
}

type Listener = () => void;
export type AppEvent = 'mode' | 'image' | 'params' | 'recording';

class Emitter {
  private map = new Map<AppEvent, Set<Listener>>();
  on(e: AppEvent, fn: Listener): void {
    let set = this.map.get(e);
    if (!set) this.map.set(e, (set = new Set()));
    set.add(fn);
  }
  emit(e: AppEvent): void {
    this.map.get(e)?.forEach((fn) => fn());
  }
}

export const events = new Emitter();

export const state = {
  mode: 'empty' as Mode,
  image: null as LoadedImage | null,
  /** false = ぜんぶもちもち（マスク無視） */
  maskEnabled: true,
  softness: DEFAULT_SOFTNESS,
  params: paramsFromSoftness(DEFAULT_SOFTNESS) as MochiParams,
  volume: 0.7,
  muted: false,
  haptics: true,
  recFormat: 'video' as RecFormat,
  recording: false,
};

export function setMode(m: Mode): void {
  if (state.mode === m) return;
  state.mode = m;
  document.body.dataset.mode = m;
  events.emit('mode');
}
