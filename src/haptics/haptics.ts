import { state } from '../state';

// 振動フィードバック。多段フォールバック:
// 1) navigator.vibrate（Android Chrome等。強弱つき）
// 2) iOS Safari 17.4+ の <input type="checkbox" switch> トグルの副作用ハック
//    （固定ティックのみ。iOS 26.5で塞がれたため、その場合は無害なno-opになる）
// 3) どちらも無ければ何もしない
export class Haptics {
  private mode: 'vibrate' | 'ios' | 'none' = 'none';
  private iosLabel: HTMLLabelElement | null = null;

  init(): void {
    if ('vibrate' in navigator) {
      this.mode = 'vibrate';
      return;
    }
    // タッチ端末（=iOS想定）のみswitchハックを仕込む
    if ('ontouchend' in window) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      const label = document.createElement('label');
      label.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
      label.appendChild(input);
      document.body.appendChild(label);
      this.iosLabel = label;
      this.mode = 'ios';
    }
  }

  /** 軽いティック（つまんだ時・ボタン押下時）。ユーザージェスチャ内で呼ぶこと */
  tick(): void {
    const s = state.hapticsStrength;
    if (s <= 0) return;
    if (this.mode === 'vibrate') {
      navigator.vibrate(Math.round(20 * s)); // 既定0.5で10ms
    } else if (this.mode === 'ios') {
      this.iosLabel?.click();
    }
  }

  /** 強さつきの振動（離した時）。iOSは固定ティックになる */
  impact(strength: number): void {
    const s = state.hapticsStrength;
    if (s <= 0) return;
    if (this.mode === 'vibrate') {
      const base = 10 + 45 * Math.min(1, Math.max(0, strength));
      navigator.vibrate(Math.round(base * 2 * s)); // 既定0.5で従来通り
    } else if (this.mode === 'ios') {
      this.iosLabel?.click();
    }
  }
}
