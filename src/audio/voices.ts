import type { AudioEngine } from './context';

export const midiToFreq = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/**
 * 절차적으로 합성하는 악기 보이스 모음.
 * 모든 보이스는 "예약된 절대 시각(t)"을 받아 그 시점에 정확히 울린다.
 */
export class Voices {
  constructor(
    private readonly e: AudioEngine,
    private readonly bus: GainNode,
  ) {}

  private env(t: number, attack: number, decay: number, peak: number): GainNode {
    const g = this.e.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  kick(t: number, gain = 1, punch = 1): void {
    const ctx = this.e.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170 * punch, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.085);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    // 클릭 트랜지언트
    const click = ctx.createBufferSource();
    click.buffer = this.e.noise;
    click.playbackRate.value = 1.6;
    const cf = ctx.createBiquadFilter();
    cf.type = 'highpass';
    cf.frequency.value = 1400;
    const cg = this.env(t, 0.001, 0.02, 0.25 * gain);
    click.connect(cf).connect(cg).connect(this.bus);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.34);
    click.start(t);
    click.stop(t + 0.04);
  }

  snare(t: number, gain = 0.7): void {
    const ctx = this.e.ctx;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = this.env(t, 0.002, 0.16, gain);
    n.connect(bp).connect(g).connect(this.bus);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, t);
    body.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const bg = this.env(t, 0.002, 0.09, gain * 0.5);
    body.connect(bg).connect(this.bus);
    n.start(t);
    n.stop(t + 0.2);
    body.start(t);
    body.stop(t + 0.14);
  }

  clap(t: number, gain = 0.6): void {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.011;
      const n = this.e.noiseSource();
      const bp = this.e.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 1.4;
      const g = this.env(tt, 0.001, i === 2 ? 0.14 : 0.03, gain * (i === 2 ? 1 : 0.6));
      n.connect(bp).connect(g).connect(this.bus);
      n.start(tt);
      n.stop(tt + 0.18);
    }
  }

  hat(t: number, open = false, gain = 0.3): void {
    const n = this.e.noiseSource();
    const hp = this.e.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = this.env(t, 0.001, open ? 0.16 : 0.028, gain);
    n.connect(hp).connect(g).connect(this.bus);
    n.start(t);
    n.stop(t + (open ? 0.22 : 0.06));
  }

  bass(t: number, freq: number, dur: number, gain = 0.5, type: OscillatorType = 'sawtooth'): void {
    const ctx = this.e.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq / 2, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 7 + 180, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, 90), t + dur * 0.9);
    lp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp);
    sub.connect(g);
    lp.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    sub.start(t);
    sub.stop(t + dur + 0.02);
  }

  /** 디튠 리즈 베이스 (드럼앤베이스용) */
  reese(t: number, freq: number, dur: number, gain = 0.42): void {
    const ctx = this.e.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 4 + 120, t);
    lp.frequency.linearRampToValueAtTime(freq * 9 + 200, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(freq * 3 + 100, t + dur);
    lp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.setValueAtTime(gain, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const det of [-9, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    lp.connect(g).connect(this.bus);
  }

  pluck(t: number, freq: number, dur: number, gain = 0.22): void {
    const ctx = this.e.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(freq * 10 + 2000, 12000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, 300), t + dur);
    lp.Q.value = 3;
    const g = this.env(t, 0.004, dur, gain);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    lp.connect(g).connect(this.bus);
  }

  pad(t: number, freqs: number[], dur: number, gain = 0.1): void {
    const ctx = this.e.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of freqs) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    lp.connect(g).connect(this.bus);
  }

  stab(t: number, freqs: number[], dur: number, gain = 0.16): void {
    const ctx = this.e.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    const g = this.env(t, 0.003, dur, gain);
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    hp.connect(g).connect(this.bus);
  }

  /** 크래시 심벌. 섹션이 바뀌는 순간(코러스 진입 등)에 한 방 터뜨린다. */
  crash(t: number, gain = 0.32): void {
    const ctx = this.e.ctx;
    const n = this.e.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(hp).connect(g).connect(this.bus);
    n.start(t);
    n.stop(t + 1.7);
    // 배음 몇 개를 살짝 섞어 순수 노이즈보다 금속성이 나게 한다
    for (const ratio of [2.4, 3.7, 5.1]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 900 * ratio;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(gain * 0.15, t + 0.006);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(og).connect(this.bus);
      o.start(t);
      o.stop(t + 1.0);
    }
  }

  /** 라이드 심벌. 코러스 구간에서 하이햇 대신 은은하게 지속시켜 공간을 채운다. */
  ride(t: number, gain = 0.14): void {
    const ctx = this.e.ctx;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t);
    n.stop(t + 0.55);
    const bell = ctx.createOscillator();
    bell.type = 'triangle';
    bell.frequency.value = 5200;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(gain * 0.3, t + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    bell.connect(bg).connect(this.bus);
    bell.start(t);
    bell.stop(t + 0.45);
  }

  /**
   * 리드 신스. 아르페지오(pluck)보다 오래 끌고 유니즌을 더 두껍게 쌓아
   * 코러스에서 실제 멜로디 훅을 노래하듯 들려준다.
   */
  lead(t: number, freq: number, dur: number, gain = 0.2): void {
    const ctx = this.e.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 3 + 1200, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.4, 500), t + dur);
    lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.setValueAtTime(gain, t + Math.max(0, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const det of [-10, -3, 3, 10]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.08);
    }
    lp.connect(g).connect(this.bus);
  }

  /** 순수 사인 서브베이스. 코러스에서 저음을 두껍게 받쳐 준다. */
  subBass(t: number, freq: number, dur: number, gain = 0.3): void {
    const ctx = this.e.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq / 2, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.setValueAtTime(gain, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 상승 노이즈 스윕 (드롭 직전 빌드업) */
  sweep(t: number, dur: number, gain = 0.2): void {
    const n = this.e.noiseSource();
    const bp = this.e.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = this.e.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t);
    n.stop(t + dur + 0.1);
  }
}
