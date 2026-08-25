import type { AudioEngine } from './context';
import type { Conductor } from './conductor';
import { Voices, midiToFreq } from './voices';
import type { StageDef } from '../data/types';

/**
 * 스타일 프리셋. 16분음표 16칸(=1마디) 문자열 패턴으로 리듬을 기술한다.
 *   x = 강타, o = 약타, - = 쉼
 */
interface StylePreset {
  kick: string;
  snare: string;
  hat: string;
  openHat: string;
  /** 베이스: r=근음, 5=5도, 8=옥타브, -=쉼 */
  bass: string;
  /** 아르페지오/플럭 발음 위치 */
  arp: string;
  /** 4마디 코드 진행 (자연단음계 도수의 반음 오프셋) */
  chords: number[];
  padGain: number;
  bassGain: number;
  arpOctave: number;
  useReese: boolean;
  clapInsteadOfSnare: boolean;
}

const PRESETS: Record<StageDef['musicStyle'], StylePreset> = {
  citypop: {
    kick: 'x-------o-------',
    snare: '----x-------x---',
    hat: '--x---x---x---x-',
    openHat: '------------x---',
    bass: 'r---r---5---8---',
    arp: '--x-x---x-x---x-',
    chords: [0, 8, 3, 10],
    padGain: 0.11,
    bassGain: 0.4,
    arpOctave: 1,
    useReese: false,
    clapInsteadOfSnare: false,
  },
  synthwave: {
    kick: 'x---x---x---x---',
    snare: '----x-------x---',
    hat: '--x---x---x---x-',
    openHat: '--------------x-',
    bass: 'r-r-r-r-8-8-r-r-',
    arp: 'x-x-x-x-x-x-x-x-',
    chords: [0, 10, 8, 10],
    padGain: 0.12,
    bassGain: 0.42,
    arpOctave: 2,
    useReese: false,
    clapInsteadOfSnare: false,
  },
  kpop: {
    kick: 'x-----x-x-------',
    snare: '----x-------x---',
    hat: 'x-x-x-x-x-x-xxx-',
    openHat: '----------x-----',
    bass: 'r---r-r-5---8-r-',
    arp: 'x-xx-x-xx-x-x-xx',
    chords: [0, 8, 3, 10],
    padGain: 0.09,
    bassGain: 0.44,
    arpOctave: 2,
    useReese: false,
    clapInsteadOfSnare: true,
  },
  dnb: {
    kick: 'x------x--x-----',
    snare: '----x-------x-x-',
    hat: 'xxxxxxxxxxxxxxxx',
    openHat: '------x-------x-',
    bass: 'r-------8-----5-',
    arp: '--x---x-----x---',
    chords: [0, 10, 8, 7],
    padGain: 0.07,
    bassGain: 0.46,
    arpOctave: 2,
    useReese: true,
    clapInsteadOfSnare: false,
  },
  hardcore: {
    kick: 'x---x---x---x---',
    snare: '----x-------x---',
    hat: '--x---x---x-x-x-',
    openHat: '------------x---',
    bass: 'r-r-r-r-r-r-r-r-',
    arp: 'x-x-x-x-x-x-x-x-',
    chords: [0, 8, 5, 10],
    padGain: 0.08,
    bassGain: 0.5,
    arpOctave: 2,
    useReese: false,
    clapInsteadOfSnare: false,
  },
};

/** 자연단음계에서 각 도수의 3화음 구성음 (반음) */
function triad(rootOffset: number): number[] {
  const major = [3, 8, 10].includes(((rootOffset % 12) + 12) % 12);
  return major ? [0, 4, 7] : [0, 3, 7];
}

const LOOKAHEAD = 0.22; // 초. 이 시간만큼 미리 스케줄한다.

/**
 * 스테이지 BGM 시퀀서.
 * Conductor 의 박자 좌표계 위에서 16분음표 단위로 이벤트를 예약한다.
 * 노트 차트와 같은 시계를 쓰므로 음악과 노트는 구조적으로 절대 어긋나지 않는다.
 */
export class MusicPlayer {
  private readonly voices: Voices;
  private readonly preset: StylePreset;
  private nextStep: number;
  private readonly endStep: number;
  private readonly root: number;
  private stopped = false;
  /** 마지막으로 발음된 박 (시각 이펙트용) */
  lastBeatHit = -1;

  constructor(
    private readonly engine: AudioEngine,
    private readonly conductor: Conductor,
    stage: StageDef,
    totalBeats: number,
    leadInBeats: number,
  ) {
    this.voices = new Voices(engine, engine.musicBus);
    this.preset = PRESETS[stage.musicStyle];
    this.root = stage.rootNote;
    this.nextStep = -Math.round(leadInBeats * 4);
    this.endStep = Math.round((totalBeats + 8) * 4);
  }

  /** 매 프레임 호출. 다가오는 스텝들을 미리 예약한다. */
  update(): void {
    if (this.stopped || !this.conductor.isRunning) return;
    const beatDur = this.conductor.beatDur;
    const horizon = this.engine.now + LOOKAHEAD;
    while (this.nextStep <= this.endStep) {
      const songTime = (this.nextStep / 4) * beatDur;
      const at = this.conductor.toAudioTime(songTime);
      if (at > horizon) break;
      if (at > this.engine.now - 0.05) this.scheduleStep(this.nextStep, at, beatDur);
      this.nextStep++;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private scheduleStep(step: number, at: number, beatDur: number): void {
    const p = this.preset;
    const inBar = ((step % 16) + 16) % 16;
    const bar = Math.floor(step / 16);
    const isLeadIn = step < 0;
    const stepDur = beatDur / 4;

    // --- 리드인: 카운트인 클릭과 상승 스윕만 ---
    if (isLeadIn) {
      if (inBar % 4 === 0) this.voices.hat(at, false, 0.35);
      if (step === -4) this.voices.sweep(at, beatDur, 0.22);
      if (inBar === 0 && step >= -16) this.voices.kick(at, 0.5);
      return;
    }
    if (step > this.endStep - 16) {
      // 아웃트로: 심벌 한 방과 패드만 남긴다
      if (step === this.endStep - 15) {
        this.voices.hat(at, true, 0.4);
        const chordRoot = this.root + p.chords[0];
        this.voices.pad(at, triad(p.chords[0]).map((s) => midiToFreq(chordRoot + s + 12)), beatDur * 8, 0.14);
      }
      return;
    }

    // 16마디 주기 구성: 12~13마디는 빌드업, 14~15마디는 풀 드롭
    const phase = ((bar % 16) + 16) % 16;
    const build = phase === 15;
    const sparse = phase === 8 || phase === 9;

    // --- 드럼 ---
    if (!build) {
      if (p.kick[inBar] === 'x') this.voices.kick(at, sparse ? 0.7 : 1.0);
      else if (p.kick[inBar] === 'o') this.voices.kick(at, 0.6, 0.9);
      if (p.snare[inBar] === 'x') {
        if (p.clapInsteadOfSnare) this.voices.clap(at, 0.62);
        else this.voices.snare(at, sparse ? 0.5 : 0.72);
      }
      if (p.hat[inBar] === 'x') this.voices.hat(at, false, sparse ? 0.18 : 0.26);
      if (p.openHat[inBar] === 'x') this.voices.hat(at, true, 0.22);
    } else {
      // 스네어 롤 빌드업
      const density = inBar < 8 ? 2 : 1;
      if (inBar % density === 0) this.voices.snare(at, 0.3 + (inBar / 16) * 0.5);
      if (inBar === 0) this.voices.sweep(at, beatDur * 4, 0.26);
    }

    // --- 화성 ---
    const chordIdx = ((bar % 4) + 4) % 4;
    const chordOffset = p.chords[chordIdx];
    const chordRoot = this.root + chordOffset;
    const tones = triad(chordOffset);

    if (inBar === 0 && !build) {
      this.voices.pad(
        at,
        tones.map((s) => midiToFreq(chordRoot + s + 12)),
        beatDur * 4,
        sparse ? p.padGain * 1.4 : p.padGain,
      );
    }

    // --- 베이스 ---
    if (!build && !sparse) {
      const c = p.bass[inBar];
      if (c !== '-') {
        const semi = c === 'r' ? 0 : c === '5' ? 7 : 12;
        const f = midiToFreq(chordRoot + semi - 12);
        const dur = stepDur * 2;
        if (p.useReese) this.voices.reese(at, f, dur * 2, p.bassGain);
        else this.voices.bass(at, f, dur, p.bassGain);
      }
    }

    // --- 아르페지오 / 리드 ---
    if (!build && p.arp[inBar] === 'x') {
      const seq = [0, 1, 2, 1];
      const idx = seq[Math.floor(step / 2) % seq.length];
      const semi = tones[idx % tones.length];
      const f = midiToFreq(chordRoot + semi + 12 * p.arpOctave);
      this.voices.pluck(at, f, stepDur * 3, sparse ? 0.1 : 0.2);
    }

    // 드롭 마디 첫 박에 스탭 코드
    if (phase === 0 && inBar === 0) {
      this.voices.stab(at, tones.map((s) => midiToFreq(chordRoot + s + 12)), beatDur * 0.5, 0.18);
    }
  }
}
