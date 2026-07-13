import { state } from '../state';

// 効果音はすべてWebAudioで合成（素材ファイル不要）。
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** ユーザージェスチャ内で呼ぶこと（autoplay制限対策） */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master!.gain.value = state.muted ? 0 : state.volume;
    return this.ctx;
  }

  /**
   * iOS Safariの音声アンロック。touchend/click系のジェスチャ内で一度呼ぶ。
   * （pointerdown起点のresumeだけだと最初の音が鳴らないことがある）
   */
  unlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    // 無音バッファを1発再生して確実に解禁する（定番のiOS対策）
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  /** つまんだ時の「むに」 */
  grab(): void {
    const ctx = this.ensure();
    if (!ctx || state.muted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(185, t);
    osc.frequency.exponentialRampToValueAtTime(130, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.3, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.14);

    // ローパスノイズで「むにっ」の質感
    const noise = this.noiseSource(ctx, 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.1, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    noise.connect(lp).connect(ng).connect(this.master!);
    noise.start(t);
  }

  /**
   * 離した時の「ぷるん」。揺れ周波数に連動したトレモロ減衰。
   * @param intensity 0..1（引っ張りの強さ）
   * @param freqHz 揺れ戻り周波数
   */
  release(intensity: number, freqHz: number): void {
    const ctx = this.ensure();
    if (!ctx || state.muted || intensity < 0.05) return;
    const t = ctx.currentTime;
    const amp = 0.12 + 0.3 * intensity;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(165, t + 0.3);

    const env = ctx.createGain();
    env.gain.setValueAtTime(amp, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    // 揺れと同じ周波数のトレモロ = 音がぷるぷるする
    const trem = ctx.createGain();
    trem.gain.setValueAtTime(1, t);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = freqHz;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(trem.gain);

    osc.connect(env).connect(trem).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.45);
    lfo.start(t);
    lfo.stop(t + 0.45);
  }

  private noiseSource(ctx: AudioContext, seconds: number): AudioBufferSourceNode {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
}
