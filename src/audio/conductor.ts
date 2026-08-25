import type { AudioEngine } from './context';

/**
 * 트랜스포트(마스터 클럭).
 *
 * 리듬 게임의 모든 시간은 AudioContext.currentTime 을 기준으로 계산한다.
 * requestAnimationFrame 의 프레임 간격이나 performance.now() 는
 * 프레임 드랍·탭 전환에 흔들리지만 오디오 클럭은 하드웨어 샘플 기준이라
 * 노트 판정이 절대 밀리지 않는다.
 */
export class Conductor {
  private readonly engine: AudioEngine;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private running = false;

  /** 한 박의 길이(초) */
  beatDur = 0.5;
  /** 곡 시작 전 대기 마디 수만큼의 리드인(초) */
  leadIn = 0;
  /** 사용자 오디오 오프셋 보정(초). 양수면 판정이 늦게 잡힌다. */
  offset = 0;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  configure(bpm: number, leadInBeats: number): void {
    this.beatDur = 60 / bpm;
    this.leadIn = leadInBeats * this.beatDur;
  }

  /** 트랜스포트 시작. 반환값은 곡의 0초에 해당하는 AudioContext 절대 시각. */
  start(delay = 0.12): number {
    this.startedAt = this.engine.now + delay + this.leadIn;
    this.running = true;
    this.pausedAt = null;
    return this.startedAt;
  }

  /** 곡 기준 시간(초). 리드인 구간에서는 음수. */
  get time(): number {
    if (!this.running) return this.pausedAt ?? 0;
    return this.engine.now - this.startedAt - this.offset;
  }

  /** 곡 기준 박자 위치 */
  get beat(): number {
    return this.time / this.beatDur;
  }

  /** 노트 시각(초) -> AudioContext 절대 시각 */
  toAudioTime(songTime: number): number {
    return this.startedAt + songTime;
  }

  get isRunning(): boolean {
    return this.running;
  }

  pause(): void {
    if (!this.running) return;
    this.pausedAt = this.time;
    this.running = false;
  }

  resume(): void {
    if (this.running) return;
    const t = this.pausedAt ?? 0;
    this.startedAt = this.engine.now - t;
    this.running = true;
    this.pausedAt = null;
  }

  stop(): void {
    this.running = false;
    this.pausedAt = 0;
  }
}
