import type { AudioEngine } from './context';
import { Voices, midiToFreq } from './voices';

export type Judgement = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

/**
 * 게임 효과음.
 *
 * 판정음은 태고의 달인 방식이다 — 노트 종류로 소리가 갈리고(스윙=면을 치는 "둥",
 * 에어=테를 치는 "딱"), 판정 정확도는 음정이 아니라 **밝기와 몸통**으로 표현한다.
 * 잘 맞을수록 채가 닿는 순간이 밝고 울림이 길다.
 */
export class Sfx {
  private readonly voices: Voices;

  constructor(private readonly e: AudioEngine) {
    this.voices = new Voices(e, e.sfxBus);
  }

  private get t(): number {
    return this.e.now;
  }

  /**
   * @param heavy 스윙 노트면 true — 면을 치는 "둥", 에어 노트면 false — 테를 치는 "딱".
   */
  judge(kind: Judgement, combo: number, heavy = true): void {
    const t = this.t + 0.001;
    if (kind === 'MISS') {
      this.miss(t);
      return;
    }
    // 판정이 좋을수록 채가 밝게 닿고 울림이 길어진다
    const tone = kind === 'PERFECT' ? 1 : kind === 'GREAT' ? 0.7 : 0.42;
    if (heavy) this.don(t, tone, combo);
    else this.ka(t, tone, combo);
  }

  /** 효과음 하나를 묶어 낼 출력단. 개별 레이어 게인을 여기서 한 번에 눌러 준다. */
  private bus(gain: number): GainNode {
    const g = this.e.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.e.sfxBus);
    return g;
  }

  /**
   * 면치기 "둥". 큰북의 몸통 있는 저음.
   * 막(피치가 뚝 떨어지는 사인) + 통 공명(트라이앵글) + 채가 닿는 "탁"(노이즈) 3겹.
   */
  private don(t: number, tone: number, combo: number): void {
    const ctx = this.e.ctx;
    // 콤보가 쌓일수록 가죽을 조인 것처럼 기음이 살짝 올라간다 (최대 +20%)
    const f0 = 94 * (1 + Math.min(combo / 60, 0.2));
    const dur = 0.22 + tone * 0.14;
    const out = this.bus(0.62);

    // 1) 막 — 때리는 순간 3옥타브 위에서 기음까지 50ms 만에 떨어진다. 북의 정체.
    const head = ctx.createOscillator();
    head.type = 'sine';
    head.frequency.setValueAtTime(f0 * 3.2, t);
    head.frequency.exponentialRampToValueAtTime(f0, t + 0.05);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    head.connect(hg).connect(out);
    head.start(t);
    head.stop(t + dur + 0.02);

    // 2) 나무통 공명 — 저음을 받쳐 "퉁" 이 아니라 "둥" 으로 들리게 한다
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(f0 * 1.9, t);
    body.frequency.exponentialRampToValueAtTime(f0 * 0.64, t + 0.09);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.16 + tone * 0.1, t + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    body.connect(bg).connect(out);
    body.start(t);
    body.stop(t + dur);

    // 3) 채가 닿는 순간 — 판정이 좋을수록 밝게 열린다
    const n = this.e.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700 + tone * 2800, t);
    lp.frequency.exponentialRampToValueAtTime(340, t + 0.05);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.26 * tone, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(lp).connect(ng).connect(out);
    // 매번 같은 구간을 쓰면 기계적으로 들려 노이즈 버퍼의 시작 위치를 흩어 준다
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.07);
  }

  /**
   * 테치기 "딱". 마르고 짧고 높다 — 면치기와 확실히 갈려야 연타가 리듬으로 들린다.
   */
  private ka(t: number, tone: number, combo: number): void {
    const ctx = this.e.ctx;
    const f = 1280 * (1 + Math.min(combo / 60, 0.18));
    const dur = 0.07 + tone * 0.03;
    const out = this.bus(0.66);

    // 테를 때리는 마른 소리 — 좁은 밴드패스 노이즈가 순식간에 꺼진다
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(2300 + tone * 2500, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3 * (0.55 + tone * 0.45), t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.02);

    // 나무테의 짧은 음정감 — 이게 없으면 그냥 노이즈 잡음처럼 들린다
    const w = ctx.createOscillator();
    w.type = 'square';
    w.frequency.setValueAtTime(f, t);
    w.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.03);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.14 * tone, t + 0.003);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    w.connect(wg).connect(out);
    w.start(t);
    w.stop(t + 0.06);
  }

  /** 헛침. 음정 없이 먹먹하게 죽는 소리 — 맞았을 때와 즉시 구분된다. */
  private miss(t: number): void {
    const ctx = this.e.ctx;
    const out = this.bus(0.6);

    const n = this.e.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(430, t);
    lp.frequency.exponentialRampToValueAtTime(150, t + 0.14);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.28, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(lp).connect(ng).connect(out);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.18);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(118, t);
    o.frequency.exponentialRampToValueAtTime(56, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.24, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.2);
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
    // 북의 어택을 덮지 않도록 예전보다 눌러 둔다 (0.16 -> 0.1)
    g.gain.setValueAtTime(0.1, t);
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
