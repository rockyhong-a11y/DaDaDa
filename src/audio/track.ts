import type { AudioEngine } from './context';
import type { Conductor } from './conductor';
import type { StageBgm } from '../data/types';

/**
 * 실제 음원 BGM 재생기.
 *
 * 신스 시퀀서(MusicPlayer)와 달리 파형이 이미 정해져 있으므로 할 일은
 * "곡의 어느 지점을 지휘자 시계의 어느 순간에 걸 것인가" 하나뿐이다.
 * Conductor.toAudioTime() 이 곡 기준 시간을 AudioContext 절대 시각으로
 * 바꿔 주고, AudioBufferSourceNode.start(when, offset) 이 그 시각에 샘플
 * 단위로 붙으므로 노트 차트와 음원은 구조적으로 어긋나지 않는다.
 *
 * 재생을 걸 때마다 "지금 곡 시간"을 그대로 offset 에 넣으므로, 디코딩이
 * 늦게 끝나든 일시정지 후 재개하든 앞이 잘릴 뿐 싱크는 항상 맞는다.
 */
export class TrackPlayer {
  private src: AudioBufferSourceNode | null = null;
  private readonly gain: GainNode;
  private playing = false;
  private stopped = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly conductor: Conductor,
    private readonly bgm: StageBgm,
    private readonly buffer: AudioBuffer,
  ) {
    this.gain = engine.ctx.createGain();
    this.gain.gain.value = bgm.gain;
    this.gain.connect(engine.musicBus);
  }

  /**
   * 음원을 받아 디코딩한다. 실패하면 null 을 돌려주고 호출부는 신스 BGM 으로
   * 되돌아간다 — 오프라인 단일 HTML 배포본이 정확히 이 경우다.
   */
  static async load(
    engine: AudioEngine,
    url: string,
    onProgress?: (ratio: number) => void,
  ): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = await readWithProgress(res, onProgress);
      if (!bytes) return null;
      onProgress?.(1);
      // Safari 구버전은 콜백형만 지원해 undefined 를 돌려준다 — 그 경우도 폴백.
      const decoded = await engine.ctx.decodeAudioData(bytes);
      return decoded ?? null;
    } catch {
      return null;
    }
  }

  /** 지휘자 시계에 맞춰 재생을 건다. 이미 곡이 진행 중이면 그 지점부터 잇는다. */
  start(): void {
    this.resume();
  }

  resume(): void {
    if (this.playing || this.stopped) return;
    this.playing = true;
    const songTime = Math.max(0, this.conductor.time);
    const src = this.engine.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    // songTime 0 = 곡의 downbeat. 리드인 중이면 toAudioTime(0) 이 미래라
    // 그 시각에 예약되고, 이미 진행 중이면 지금 그 지점부터 이어 붙는다.
    const when = Math.max(this.engine.now, this.conductor.toAudioTime(songTime));
    src.start(when, this.bgm.downbeat + songTime);
    this.src = src;
  }

  pause(): void {
    if (!this.playing || this.stopped) return;
    this.playing = false;
    this.stopSource();
  }

  /** MusicPlayer 와 호출부를 맞추기 위한 자리. 음원은 미리 예약할 게 없다. */
  update(): void {
    /* no-op */
  }

  /**
   * 짧게 페이드아웃하며 끈다.
   * 음원은 신스처럼 아웃트로를 갖지 않으므로 그냥 끊으면 딸깍 소리가 난다.
   */
  stop(fade = 0.6): void {
    if (this.stopped) return;
    this.stopped = true;
    this.playing = false;
    const src = this.src;
    if (!src) return;
    this.src = null;
    const t = this.engine.now;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    try {
      src.stop(t + fade + 0.02);
    } catch {
      /* 이미 끝났으면 무시 */
    }
  }

  private stopSource(): void {
    if (!this.src) return;
    try {
      this.src.stop();
    } catch {
      /* 아직 start 전이면 무시 */
    }
    this.src.disconnect();
    this.src = null;
  }
}

/**
 * 진행률을 흘리면서 응답 본문을 모은다.
 * 음원은 수 MB 라 회선에 따라 수 초에서 수십 초가 걸린다 — 로딩 화면에
 * 얼마나 남았는지 보여 주지 않으면 그냥 멈춘 것처럼 보인다.
 * 스트림을 못 쓰는 환경에서는 통째로 받는 쪽으로 조용히 물러난다.
 */
async function readWithProgress(
  res: Response,
  onProgress?: (ratio: number) => void,
): Promise<ArrayBuffer | null> {
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.98, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}
