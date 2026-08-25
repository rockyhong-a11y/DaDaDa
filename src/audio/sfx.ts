import type { AudioEngine } from './context';
import { Voices, midiToFreq } from './voices';

export type Judgement = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

/** 게임 효과음. 판정음은 음정을 달리해 귀로도 정확도를 알 수 있게 했다. */
export class Sfx {
  private readonly voices: Voices;

  constructor(private readonly e: AudioEngine) {
    this.voices = new Voices(e, e.sfxBus);
  }

  private get t(): number {
    return this.e.now;
  }

  judge(kind: Judgement, combo: number): void {
    const t = this.t + 0.001;
    switch (kind) {
      case 'PERFECT': {
        // 콤보가 쌓일수록 음이 올라간다 (최대 1옥타브)
        const step = Math.min(Math.floor(combo / 8), 12);
        const base = 76 + step;
        this.voices.pluck(t, midiToFreq(base), 0.16, 0.3);
        this.voices.pluck(t + 0.012, midiToFreq(base + 7), 0.2, 0.18);
        break;
      }
      case 'GREAT':
        this.voices.pluck(t, midiToFreq(74), 0.14, 0.24);
        break;
      case 'GOOD':
        this.voices.pluck(t, midiToFreq(69), 0.12, 0.18);
        break;
      case 'MISS':
        this.voices.stab(t, [midiToFreq(43), midiToFreq(44)], 0.22, 0.2);
        break;
    }
  }

  /** 웹 발사음 */
  shoot(): void {
    const ctx = this.e.ctx;
    const t = this.t;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    n.connect(bp).connect(g).connect(this.e.sfxBus);
    n.start(t);
    n.stop(t + 0.18);
  }

  /** 스윙 도플러 바람소리 */
  whoosh(intensity = 1): void {
    const ctx = this.e.ctx;
    const t = this.t;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.linearRampToValueAtTime(1500 * intensity, t + 0.16);
    bp.frequency.linearRampToValueAtTime(260, t + 0.36);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1 * intensity, t + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(bp).connect(g).connect(this.e.sfxBus);
    n.start(t);
    n.stop(t + 0.42);
  }

  fail(): void {
    const t = this.t;
    const ctx = this.e.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(lp).connect(g).connect(this.e.sfxBus);
    o.start(t);
    o.stop(t + 1.25);
  }

  clear(): void {
    const t = this.t;
    const notes = [72, 76, 79, 84];
    notes.forEach((n, i) => {
      this.voices.pluck(t + i * 0.09, midiToFreq(n), 0.5, 0.26);
    });
    this.voices.pad(t, [midiToFreq(60), midiToFreq(64), midiToFreq(67)], 2.2, 0.14);
  }

  ui(kind: 'move' | 'select' | 'back' = 'move'): void {
    const t = this.t;
    const n = kind === 'select' ? 84 : kind === 'back' ? 62 : 74;
    this.voices.pluck(t, midiToFreq(n), 0.09, kind === 'select' ? 0.22 : 0.14);
  }
}
