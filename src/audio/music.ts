import type { AudioEngine } from './context';
import type { Conductor } from './conductor';
import { Voices, midiToFreq, type Vowel } from './voices';
import type { StageDef } from '../data/types';

/** 리드 멜로디 한 음. step 은 2마디(32칸) 프레이즈 안에서의 16분음표 위치. */
interface LeadHit {
  step: number;
  /** scaleTones() 배열의 인덱스 */
  degree: number;
  /** 길이(16분음표 개수). 생략 시 3. */
  len?: number;
}

/**
 * 보컬 한 음절. LeadHit 에 모음을 더한 것.
 * 자음 합성까지는 하지 않으므로 가사는 모음의 흐름으로만 표현한다 —
 * 실제 노래의 "아-아- 오오-" 같은 훅 라인에 해당한다.
 */
interface VocalNote extends LeadHit {
  vowel: Vowel;
}

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
  /** 벌스에서 쓰는 코드 진행 (자연단음계 도수의 반음 오프셋, 4개) */
  chords: number[];
  /** 코러스에서 쓰는 코드 진행. 벌스와 색이 달라야 "구간이 바뀌었다"는 느낌이 난다. */
  chordsB: number[];
  padGain: number;
  bassGain: number;
  arpOctave: number;
  useReese: boolean;
  clapInsteadOfSnare: boolean;
  /** 코러스에서 노래하는 리드 훅. 두 개를 번갈아 써서 반복해도 덜 기계적으로 들리게 한다. */
  leadPhrases: LeadHit[][];
  leadOctave: number;
  /** 보컬 훅. 코러스에서 메인 멜로디를 노래한다. 두 프레이즈를 번갈아 쓴다. */
  vocalPhrases: VocalNote[][];
  /** 벌스에서 흐르는 낮고 옅은 보컬 라인 (없으면 벌스는 무보컬) */
  vocalVersePhrase: VocalNote[];
  vocalOctave: number;
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
    chordsB: [8, 3, 10, 5],
    padGain: 0.11,
    bassGain: 0.4,
    arpOctave: 1,
    useReese: false,
    clapInsteadOfSnare: false,
    leadOctave: 1,
    leadPhrases: [
      [
        { step: 2, degree: 2, len: 3 },
        { step: 8, degree: 3, len: 2 },
        { step: 12, degree: 1, len: 3 },
        { step: 18, degree: 4, len: 2 },
        { step: 24, degree: 2, len: 4 },
        { step: 30, degree: 1, len: 2 },
      ],
      [
        { step: 0, degree: 3, len: 3 },
        { step: 6, degree: 2, len: 2 },
        { step: 14, degree: 4, len: 3 },
        { step: 20, degree: 3, len: 2 },
        { step: 26, degree: 1, len: 4 },
      ],
    ],
    vocalOctave: 1,
    vocalVersePhrase: [
      { step: 4, degree: 0, len: 6, vowel: 'u' },
      { step: 16, degree: 2, len: 6, vowel: 'o' },
      { step: 26, degree: 1, len: 5, vowel: 'u' },
    ],
    vocalPhrases: [
      [
        { step: 0, degree: 2, len: 5, vowel: 'a' },
        { step: 6, degree: 3, len: 4, vowel: 'a' },
        { step: 12, degree: 4, len: 6, vowel: 'o' },
        { step: 20, degree: 2, len: 4, vowel: 'e' },
        { step: 25, degree: 1, len: 7, vowel: 'a' },
      ],
      [
        { step: 0, degree: 4, len: 4, vowel: 'a' },
        { step: 5, degree: 3, len: 4, vowel: 'e' },
        { step: 10, degree: 2, len: 5, vowel: 'a' },
        { step: 17, degree: 4, len: 4, vowel: 'o' },
        { step: 22, degree: 3, len: 3, vowel: 'a' },
        { step: 26, degree: 0, len: 6, vowel: 'u' },
      ],
    ],
  },
  synthwave: {
    kick: 'x---x---x---x---',
    snare: '----x-------x---',
    hat: '--x---x---x---x-',
    openHat: '--------------x-',
    bass: 'r-r-r-r-8-8-r-r-',
    arp: 'x-x-x-x-x-x-x-x-',
    chords: [0, 10, 8, 10],
    chordsB: [0, 5, 10, 8],
    padGain: 0.12,
    bassGain: 0.42,
    arpOctave: 2,
    useReese: false,
    clapInsteadOfSnare: false,
    leadOctave: 2,
    leadPhrases: [
      [
        { step: 0, degree: 0, len: 2 },
        { step: 4, degree: 3, len: 2 },
        { step: 8, degree: 4, len: 2 },
        { step: 12, degree: 2, len: 2 },
        { step: 16, degree: 0, len: 2 },
        { step: 20, degree: 3, len: 2 },
        { step: 24, degree: 4, len: 2 },
        { step: 28, degree: 1, len: 4 },
      ],
      [
        { step: 0, degree: 4, len: 2 },
        { step: 4, degree: 2, len: 2 },
        { step: 8, degree: 0, len: 2 },
        { step: 12, degree: 3, len: 2 },
        { step: 16, degree: 4, len: 2 },
        { step: 22, degree: 1, len: 2 },
        { step: 26, degree: 2, len: 2 },
        { step: 30, degree: 0, len: 4 },
      ],
    ],
    vocalOctave: 1,
    vocalVersePhrase: [
      { step: 0, degree: 0, len: 8, vowel: 'o' },
      { step: 16, degree: 3, len: 8, vowel: 'u' },
    ],
    vocalPhrases: [
      [
        { step: 0, degree: 0, len: 6, vowel: 'a' },
        { step: 8, degree: 3, len: 6, vowel: 'o' },
        { step: 16, degree: 4, len: 6, vowel: 'a' },
        { step: 24, degree: 2, len: 8, vowel: 'e' },
      ],
      [
        { step: 0, degree: 4, len: 6, vowel: 'o' },
        { step: 8, degree: 2, len: 5, vowel: 'a' },
        { step: 14, degree: 3, len: 6, vowel: 'e' },
        { step: 22, degree: 1, len: 4, vowel: 'a' },
        { step: 27, degree: 0, len: 5, vowel: 'u' },
      ],
    ],
  },
  kpop: {
    kick: 'x-----x-x-------',
    snare: '----x-------x---',
    hat: 'x-x-x-x-x-x-xxx-',
    openHat: '----------x-----',
    bass: 'r---r-r-5---8-r-',
    arp: 'x-xx-x-xx-x-x-xx',
    chords: [0, 8, 3, 10],
    chordsB: [10, 8, 0, 5],
    padGain: 0.09,
    bassGain: 0.44,
    arpOctave: 2,
    useReese: false,
    clapInsteadOfSnare: true,
    leadOctave: 2,
    leadPhrases: [
      [
        { step: 0, degree: 2, len: 2 },
        { step: 3, degree: 2, len: 1 },
        { step: 6, degree: 3, len: 3 },
        { step: 12, degree: 4, len: 4 },
        { step: 18, degree: 3, len: 1 },
        { step: 20, degree: 2, len: 1 },
        { step: 22, degree: 1, len: 2 },
        { step: 26, degree: 2, len: 6 },
      ],
      [
        { step: 0, degree: 4, len: 2 },
        { step: 3, degree: 4, len: 1 },
        { step: 6, degree: 2, len: 3 },
        { step: 12, degree: 1, len: 4 },
        { step: 18, degree: 2, len: 1 },
        { step: 20, degree: 3, len: 1 },
        { step: 22, degree: 4, len: 2 },
        { step: 26, degree: 3, len: 6 },
      ],
    ],
    vocalOctave: 1,
    vocalVersePhrase: [
      { step: 2, degree: 1, len: 3, vowel: 'e' },
      { step: 10, degree: 0, len: 4, vowel: 'a' },
      { step: 20, degree: 2, len: 4, vowel: 'o' },
    ],
    vocalPhrases: [
      [
        { step: 0, degree: 4, len: 3, vowel: 'a' },
        { step: 3, degree: 4, len: 2, vowel: 'a' },
        { step: 6, degree: 3, len: 4, vowel: 'e' },
        { step: 12, degree: 2, len: 3, vowel: 'a' },
        { step: 16, degree: 4, len: 3, vowel: 'i' },
        { step: 20, degree: 3, len: 3, vowel: 'a' },
        { step: 24, degree: 1, len: 6, vowel: 'o' },
      ],
      [
        { step: 0, degree: 2, len: 3, vowel: 'a' },
        { step: 4, degree: 3, len: 3, vowel: 'i' },
        { step: 8, degree: 4, len: 4, vowel: 'a' },
        { step: 14, degree: 2, len: 3, vowel: 'e' },
        { step: 18, degree: 1, len: 3, vowel: 'a' },
        { step: 22, degree: 3, len: 3, vowel: 'o' },
        { step: 26, degree: 0, len: 6, vowel: 'a' },
      ],
    ],
  },
  dnb: {
    kick: 'x------x--x-----',
    snare: '----x-------x-x-',
    hat: 'xxxxxxxxxxxxxxxx',
    openHat: '------x-------x-',
    bass: 'r-------8-----5-',
    arp: '--x---x-----x---',
    chords: [0, 10, 8, 7],
    chordsB: [0, 7, 5, 10],
    padGain: 0.07,
    bassGain: 0.46,
    arpOctave: 2,
    useReese: true,
    clapInsteadOfSnare: false,
    leadOctave: 1,
    leadPhrases: [
      [
        { step: 1, degree: 1, len: 1 },
        { step: 4, degree: 2, len: 1 },
        { step: 7, degree: 0, len: 1 },
        { step: 10, degree: 3, len: 1 },
        { step: 14, degree: 1, len: 2 },
        { step: 17, degree: 2, len: 1 },
        { step: 20, degree: 4, len: 1 },
        { step: 23, degree: 2, len: 1 },
        { step: 26, degree: 0, len: 1 },
        { step: 29, degree: 1, len: 2 },
      ],
      [
        { step: 0, degree: 2, len: 1 },
        { step: 3, degree: 1, len: 1 },
        { step: 6, degree: 4, len: 1 },
        { step: 9, degree: 2, len: 1 },
        { step: 13, degree: 0, len: 2 },
        { step: 18, degree: 3, len: 1 },
        { step: 21, degree: 1, len: 1 },
        { step: 24, degree: 2, len: 1 },
        { step: 27, degree: 4, len: 1 },
        { step: 30, degree: 2, len: 2 },
      ],
    ],
    vocalOctave: 1,
    vocalVersePhrase: [
      { step: 6, degree: 0, len: 3, vowel: 'u' },
      { step: 22, degree: 2, len: 3, vowel: 'o' },
    ],
    vocalPhrases: [
      [
        { step: 0, degree: 3, len: 2, vowel: 'a' },
        { step: 3, degree: 4, len: 2, vowel: 'e' },
        { step: 7, degree: 2, len: 3, vowel: 'a' },
        { step: 12, degree: 4, len: 2, vowel: 'i' },
        { step: 16, degree: 3, len: 3, vowel: 'a' },
        { step: 21, degree: 1, len: 2, vowel: 'e' },
        { step: 25, degree: 2, len: 5, vowel: 'o' },
      ],
      [
        { step: 1, degree: 4, len: 2, vowel: 'i' },
        { step: 5, degree: 2, len: 2, vowel: 'a' },
        { step: 9, degree: 3, len: 3, vowel: 'e' },
        { step: 14, degree: 1, len: 2, vowel: 'a' },
        { step: 18, degree: 4, len: 3, vowel: 'a' },
        { step: 24, degree: 0, len: 6, vowel: 'u' },
      ],
    ],
  },
  hardcore: {
    kick: 'x---x---x---x---',
    snare: '----x-------x---',
    hat: '--x---x---x-x-x-',
    openHat: '------------x---',
    bass: 'r-r-r-r-r-r-r-r-',
    arp: 'x-x-x-x-x-x-x-x-',
    chords: [0, 8, 5, 10],
    chordsB: [0, 10, 7, 5],
    padGain: 0.08,
    bassGain: 0.5,
    arpOctave: 2,
    useReese: false,
    clapInsteadOfSnare: false,
    leadOctave: 2,
    leadPhrases: [
      [
        { step: 0, degree: 0, len: 1 },
        { step: 2, degree: 0, len: 1 },
        { step: 4, degree: 2, len: 1 },
        { step: 6, degree: 0, len: 1 },
        { step: 8, degree: 4, len: 2 },
        { step: 12, degree: 0, len: 1 },
        { step: 14, degree: 0, len: 1 },
        { step: 16, degree: 2, len: 1 },
        { step: 18, degree: 2, len: 1 },
        { step: 20, degree: 4, len: 1 },
        { step: 22, degree: 2, len: 1 },
        { step: 24, degree: 0, len: 4 },
      ],
      [
        { step: 0, degree: 4, len: 1 },
        { step: 2, degree: 4, len: 1 },
        { step: 4, degree: 2, len: 1 },
        { step: 6, degree: 4, len: 1 },
        { step: 8, degree: 0, len: 2 },
        { step: 12, degree: 4, len: 1 },
        { step: 14, degree: 4, len: 1 },
        { step: 16, degree: 2, len: 1 },
        { step: 18, degree: 2, len: 1 },
        { step: 20, degree: 0, len: 1 },
        { step: 22, degree: 2, len: 1 },
        { step: 24, degree: 4, len: 4 },
      ],
    ],
    vocalOctave: 1,
    vocalVersePhrase: [
      { step: 8, degree: 0, len: 4, vowel: 'a' },
      { step: 24, degree: 1, len: 4, vowel: 'o' },
    ],
    vocalPhrases: [
      [
        { step: 0, degree: 4, len: 3, vowel: 'a' },
        { step: 4, degree: 4, len: 2, vowel: 'a' },
        { step: 8, degree: 3, len: 3, vowel: 'e' },
        { step: 12, degree: 4, len: 3, vowel: 'a' },
        { step: 16, degree: 2, len: 3, vowel: 'i' },
        { step: 20, degree: 3, len: 3, vowel: 'a' },
        { step: 24, degree: 4, len: 6, vowel: 'a' },
      ],
      [
        { step: 0, degree: 2, len: 3, vowel: 'a' },
        { step: 4, degree: 3, len: 3, vowel: 'a' },
        { step: 8, degree: 4, len: 4, vowel: 'i' },
        { step: 14, degree: 3, len: 3, vowel: 'e' },
        { step: 18, degree: 4, len: 3, vowel: 'a' },
        { step: 22, degree: 2, len: 3, vowel: 'a' },
        { step: 26, degree: 0, len: 6, vowel: 'o' },
      ],
    ],
  },
};

/** 자연단음계에서 각 도수의 3화음 구성음 (반음) */
function triad(rootOffset: number): number[] {
  const major = [3, 8, 10].includes(((rootOffset % 12) + 12) % 12);
  return major ? [0, 4, 7] : [0, 3, 7];
}

/** 리드 멜로디용 5음 스케일 (3화음 + 장식음 2개). 아르페지오보다 넓은 색을 낸다. */
function scaleTones(rootOffset: number): number[] {
  const major = [3, 8, 10].includes(((rootOffset % 12) + 12) % 12);
  return major ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
}

/**
 * 곡의 매크로 구조(아케인지먼트).
 * 인트로 → 벌스 → 빌드업 → 코러스(드롭) → 브레이크다운 벌스 → 빌드업 → 파이널 코러스
 * 순서로, 전체 마디 수에 비례해 구간을 나눈다. 같은 16마디를 곡 끝까지 복붙하던
 * 이전 방식과 달리, 실제 곡처럼 한 번씩만 지나가는 전개를 갖는다.
 */
interface Section {
  name: string;
  startBar: number;
  endBar: number;
  chords: number[];
  intensity: number;
  drumMode: 'sparse' | 'full' | 'roll';
  bass: boolean;
  subBass: boolean;
  pad: boolean;
  lead: boolean;
  /** 보컬: 'none' | 'verse'(옅은 라인) | 'hook'(합창 훅) */
  vocal: 'none' | 'verse' | 'hook';
  ride: boolean;
  crashOnEntry: boolean;
}

const ARRANGEMENT_PLAN: {
  name: string;
  frac: number;
  chords: 'A' | 'B';
  intensity: number;
  drumMode: Section['drumMode'];
  bass: boolean;
  subBass: boolean;
  pad: boolean;
  lead: boolean;
  vocal: 'none' | 'verse' | 'hook';
  ride: boolean;
  crash: boolean;
}[] = [
  { name: 'intro', frac: 0.06, chords: 'A', intensity: 0.55, drumMode: 'sparse', bass: false, subBass: false, pad: true, lead: false, vocal: 'none', ride: false, crash: false },
  { name: 'verseA', frac: 0.24, chords: 'A', intensity: 0.75, drumMode: 'full', bass: true, subBass: false, pad: true, lead: false, vocal: 'verse', ride: false, crash: true },
  { name: 'buildA', frac: 0.06, chords: 'A', intensity: 0.85, drumMode: 'roll', bass: false, subBass: false, pad: false, lead: false, vocal: 'none', ride: false, crash: false },
  { name: 'chorusA', frac: 0.2, chords: 'B', intensity: 1.0, drumMode: 'full', bass: true, subBass: true, pad: true, lead: true, vocal: 'hook', ride: true, crash: true },
  { name: 'verseB', frac: 0.16, chords: 'A', intensity: 0.5, drumMode: 'sparse', bass: true, subBass: false, pad: true, lead: false, vocal: 'verse', ride: false, crash: false },
  { name: 'buildB', frac: 0.06, chords: 'A', intensity: 0.9, drumMode: 'roll', bass: false, subBass: false, pad: false, lead: false, vocal: 'none', ride: false, crash: false },
  { name: 'chorusB', frac: 0.22, chords: 'B', intensity: 1.0, drumMode: 'full', bass: true, subBass: true, pad: true, lead: true, vocal: 'hook', ride: true, crash: true },
];

function buildArrangement(totalBars: number, p: StylePreset): Section[] {
  const bars = Math.max(16, Math.round(totalBars));
  let acc = 0;
  const out: Section[] = [];
  for (let i = 0; i < ARRANGEMENT_PLAN.length; i++) {
    const step = ARRANGEMENT_PLAN[i];
    const isLast = i === ARRANGEMENT_PLAN.length - 1;
    const startBar = Math.round(acc);
    acc += step.frac * bars;
    const endBar = isLast ? bars : Math.max(startBar + 2, Math.round(acc));
    out.push({
      name: step.name,
      startBar,
      endBar,
      chords: step.chords === 'A' ? p.chords : p.chordsB,
      intensity: step.intensity,
      drumMode: step.drumMode,
      bass: step.bass,
      subBass: step.subBass,
      pad: step.pad,
      lead: step.lead,
      vocal: step.vocal,
      ride: step.ride,
      crashOnEntry: step.crash,
    });
  }
  return out;
}

function sectionAt(sections: Section[], bar: number): Section {
  for (const s of sections) if (bar < s.endBar) return s;
  return sections[sections.length - 1];
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
  private readonly sections: Section[];
  private nextStep: number;
  private readonly endStep: number;
  private readonly root: number;
  private stopped = false;
  private lastSectionName = '';
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
    // 하드코딩된 아웃트로(마지막 4마디)를 제외한 구간에 아케인지먼트를 편성한다
    this.sections = buildArrangement(totalBeats / 4, this.preset);
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

    const section = sectionAt(this.sections, bar);
    if (inBar === 0 && section.name !== this.lastSectionName) {
      this.lastSectionName = section.name;
      if (section.crashOnEntry) this.voices.crash(at, 0.26 + section.intensity * 0.1);
    }

    const localBar = bar - section.startBar;
    const chordIdx = ((localBar % section.chords.length) + section.chords.length) % section.chords.length;
    const chordOffset = section.chords[chordIdx];
    const chordRoot = this.root + chordOffset;
    const tones = triad(chordOffset);
    const intensity = section.intensity;
    const roll = section.drumMode === 'roll';

    // --- 드럼 ---
    if (!roll) {
      if (p.kick[inBar] === 'x') this.voices.kick(at, intensity);
      else if (p.kick[inBar] === 'o') this.voices.kick(at, intensity * 0.85, 0.9);
      if (section.drumMode === 'full' && p.snare[inBar] === 'x') {
        if (p.clapInsteadOfSnare) this.voices.clap(at, 0.5 + intensity * 0.25);
        else this.voices.snare(at, 0.4 + intensity * 0.35);
      }
      if (p.hat[inBar] === 'x') this.voices.hat(at, false, 0.14 + intensity * 0.16);
      if (p.openHat[inBar] === 'x') this.voices.hat(at, true, 0.14 + intensity * 0.14);
      if (section.ride && inBar % 4 === 2) this.voices.ride(at, 0.1 + intensity * 0.08);
    } else {
      // 스네어 롤 빌드업: 마디 후반으로 갈수록 촘촘해진다
      const density = inBar < 8 ? 2 : 1;
      if (inBar % density === 0) this.voices.snare(at, 0.28 + (inBar / 16) * 0.55);
      if (inBar === 0) this.voices.sweep(at, beatDur * 4, 0.2 + intensity * 0.08);
    }

    // --- 패드 ---
    if (section.pad && inBar === 0) {
      this.voices.pad(
        at,
        tones.map((s) => midiToFreq(chordRoot + s + 12)),
        beatDur * Math.min(4, section.endBar - bar),
        0.08 + intensity * 0.06,
      );
    }

    // --- 베이스 ---
    if (section.bass && !roll) {
      const c = p.bass[inBar];
      if (c !== '-') {
        const semi = c === 'r' ? 0 : c === '5' ? 7 : 12;
        const f = midiToFreq(chordRoot + semi - 12);
        const dur = stepDur * 2;
        const g = p.bassGain * (0.55 + intensity * 0.45);
        if (p.useReese) this.voices.reese(at, f, dur * 2, g);
        else this.voices.bass(at, f, dur, g);
      }
    }
    if (section.subBass && inBar === 0) {
      this.voices.subBass(at, midiToFreq(chordRoot - 12), beatDur * 4, 0.16 + intensity * 0.12);
    }

    // --- 아르페지오 ---
    if (!roll && p.arp[inBar] === 'x') {
      const seq = [0, 1, 2, 1];
      const idx = seq[Math.floor(step / 2) % seq.length];
      const semi = tones[idx % tones.length];
      const f = midiToFreq(chordRoot + semi + 12 * p.arpOctave);
      // 리드가 함께 노래할 땐 아르페지오를 살짝 낮춰 리드를 앞으로 내세운다
      this.voices.pluck(at, f, stepDur * 3, (section.lead ? 0.1 : 0.18) * (0.6 + intensity * 0.4));
    }

    // --- 리드 멜로디 (코러스 전용 훅) ---
    if (section.lead) {
      const scale = scaleTones(chordOffset);
      const phraseSet = p.leadPhrases;
      const phrase = phraseSet[Math.floor(bar / 2) % phraseSet.length];
      const cycleStep = ((step % 32) + 32) % 32;
      const hit = phrase.find((h) => h.step === cycleStep);
      if (hit) {
        const semi = scale[hit.degree % scale.length];
        const f = midiToFreq(chordRoot + semi + 12 * p.leadOctave);
        // 보컬이 같은 훅을 부르는 구간에서는 리드를 뒤로 물려 목소리를 앞세운다
        const leadGain = section.vocal === 'hook' ? 0.07 : 0.15 + intensity * 0.08;
        this.voices.lead(at, f, stepDur * (hit.len ?? 3), leadGain);
      }
    }

    // --- 보컬 ---
    // 코러스에서는 합창 훅이 멜로디를 노래하고, 벌스에서는 한 줄짜리 낮은
    // 라인이 옅게 흐른다. 리드 신스와 같은 음계를 쓰되 옥타브를 낮춰
    // 사람 음역(대략 C3~C5)에 두어야 목소리처럼 들린다.
    if (section.vocal !== 'none') {
      const scale = scaleTones(chordOffset);
      const cycleStep = ((step % 32) + 32) % 32;
      const isHook = section.vocal === 'hook';
      const phrase = isHook
        ? p.vocalPhrases[Math.floor(bar / 2) % p.vocalPhrases.length]
        : p.vocalVersePhrase;
      const hit = phrase.find((h) => h.step === cycleStep);
      if (hit) {
        const semi = scale[hit.degree % scale.length];
        const f = midiToFreq(chordRoot + semi + 12 * p.vocalOctave);
        const dur = stepDur * (hit.len ?? 3);
        if (isHook) this.voices.vocalChoir(at, f, dur, hit.vowel, 0.045 + intensity * 0.02);
        else this.voices.vocal(at, f, dur, hit.vowel, 0.026 + intensity * 0.012);
      }
    }

    // 코러스 진입 마디 첫 박에 강조 스탭 (임팩트용 "드롭" 히트)
    if (inBar === 0 && localBar === 0 && (section.name === 'chorusA' || section.name === 'chorusB')) {
      this.voices.stab(
        at,
        tones.map((s) => midiToFreq(chordRoot + s + 12)),
        beatDur * 0.5,
        0.14 + intensity * 0.08,
      );
    }
  }
}
