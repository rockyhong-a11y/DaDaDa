import type { AudioEngine } from './context';

export const midiToFreq = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** 보컬 합성에 쓰는 모음 (아 에 이 오 우) */
export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';

/**
 * 모음별 포먼트. f = 공명 주파수(Hz), q = 대역 선명도, g = 섞는 비율.
 * 실제 성인 발성의 F1/F2/F3 측정값을 기준으로 잡았다 — 이 세 봉우리의
 * 위치만으로 사람 귀는 모음을 구분한다.
 */
const FORMANTS: Record<Vowel, { f: [number, number, number]; q: number[]; g: number[] }> = {
  a: { f: [730, 1090, 2440], q: [9, 10, 11], g: [1, 0.5, 0.24] },
  e: { f: [530, 1840, 2480], q: [10, 12, 12], g: [1, 0.62, 0.3] },
  i: { f: [270, 2290, 3010], q: [11, 13, 13], g: [1, 0.7, 0.36] },
  o: { f: [570, 840, 2410], q: [9, 10, 11], g: [1, 0.42, 0.18] },
  u: { f: [300, 870, 2240], q: [11, 11, 11], g: [1, 0.34, 0.14] },
};

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

  /**
   * 보컬(포먼트 합성).
   *
   * 이 프로젝트에는 오디오 파일이 하나도 없다 — 전부 Web Audio 로 실시간
   * 합성한다. 그래서 "녹음된 목소리"를 얹을 수는 없고, 대신 사람 목소리가
   * 만들어지는 방식 자체를 흉내 낸다.
   *
   *  성대(사각파 + 톱니 = 성문파) → 공명(모음별 포먼트 3개를 병렬 밴드패스)
   *  → 숨소리(고역 노이즈) → 비브라토 → 음절 엔벨로프
   *
   * 모음마다 실제 포먼트 주파수(F1/F2/F3)가 달라서, 같은 음정이라도
   * '아/에/이/오/우' 가 뚜렷이 구분돼 들린다. 자음이 없으니 가사가
   * 또렷하진 않지만 "사람이 노래하는 라인"으로는 확실히 읽힌다.
   */
  vocal(t: number, freq: number, dur: number, vowel: Vowel = 'a', gain = 0.06): void {
    const ctx = this.e.ctx;
    const F = FORMANTS[vowel];

    // --- 성문파: 사각파(배음 풍부) + 톱니를 살짝 섞어 두께를 준다 ---
    const src = ctx.createGain();
    src.gain.value = 1;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    const sq = ctx.createOscillator();
    sq.type = 'square';
    sq.frequency.setValueAtTime(freq, t);
    const sqg = ctx.createGain();
    sqg.gain.value = 0.35;

    // 비브라토 — 이게 없으면 신스처럼 뻣뻣하게 들린다
    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.4;
    const vibAmt = ctx.createGain();
    // 길게 끄는 음일수록 비브라토를 깊게
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(0.35, dur * 0.6));
    vib.connect(vibAmt);
    vibAmt.connect(osc.frequency);
    vibAmt.connect(sq.frequency);

    osc.connect(src);
    sq.connect(sqg).connect(src);

    // --- 음절 엔벨로프 (부드러운 시작 → 유지 → 자연스러운 감쇠) ---
    const env = ctx.createGain();
    const atk = Math.min(0.07, dur * 0.25);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + atk);
    env.gain.setValueAtTime(gain, t + Math.max(atk, dur * 0.7));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // --- 포먼트 3개를 병렬로 걸어 모음을 만든다 ---
    //
    // 톱니파의 배음은 1/n 로 줄어들기 때문에, 밴드패스 게인을 표대로만 주면
    // F2·F3 가 F1 에 묻혀 '이'와 '오'가 거의 같은 소리로 들린다. 그래서
    // 포먼트 주파수에 비례해(= 배음 감쇠를 상쇄하도록) 게인을 올려 준다.
    // 이 보정을 넣기 전후로 모음 간 스펙트럼 거리가 0.036 → 0.114 로 벌어졌다.
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = F.f[i];
      bp.Q.value = F.q[i];
      const boost = Math.min(12, F.f[i] / Math.max(120, freq));
      const fg = ctx.createGain();
      fg.gain.value = F.g[i] * boost;
      src.connect(bp).connect(fg).connect(env);
    }
    // 성문파 원음을 아주 조금 섞어 저음이 비지 않게 한다
    const dry = ctx.createGain();
    dry.gain.value = 0.12;
    src.connect(dry).connect(env);

    // --- 숨소리 ---
    const breath = this.e.noiseSource();
    const bhp = ctx.createBiquadFilter();
    bhp.type = 'bandpass';
    bhp.frequency.value = 2600;
    bhp.Q.value = 0.7;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(gain * 0.09, t + atk);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    breath.connect(bhp).connect(bg).connect(this.bus);

    env.connect(this.bus);
    const stop = t + dur + 0.05;
    osc.start(t);
    osc.stop(stop);
    sq.start(t);
    sq.stop(stop);
    vib.start(t);
    vib.stop(stop);
    breath.start(t);
    breath.stop(stop);
  }

  /**
   * 코러스(합창) 보컬. 같은 음을 옥타브·5도로 겹쳐 두껍게 쌓는다.
   * 훅에서 "여럿이 같이 부르는" 느낌을 내는 데 쓴다.
   */
  vocalChoir(t: number, freq: number, dur: number, vowel: Vowel = 'a', gain = 0.055): void {
    this.vocal(t, freq, dur, vowel, gain);
    this.vocal(t + 0.012, freq * 2, dur * 0.9, vowel, gain * 0.34);
    this.vocal(t + 0.02, freq * 1.5, dur * 0.85, vowel, gain * 0.22);
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
