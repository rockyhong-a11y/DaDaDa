export interface PressEvent {
  /** 입력 시각 (AudioContext 기준 초) */
  at: number;
  source: 'key' | 'pointer';
}

/**
 * 입력 수집기.
 *
 * 이벤트 핸들러가 실행되는 시점은 실제 입력보다 늦을 수 있으므로
 * event.timeStamp 와 performance.now() 의 차이만큼 보정해
 * AudioContext 시간축 위의 정확한 입력 시각을 복원한다.
 */
export class InputManager {
  private listeners: ((e: PressEvent) => void)[] = [];
  private pauseHandler: (() => void) | null = null;
  private readonly held = new Set<string>();
  private readonly keys = new Set(['Space', 'KeyJ', 'KeyK', 'KeyF', 'KeyD', 'ArrowUp', 'Enter']);
  private audioNow: () => number;
  private attached = false;

  constructor(audioNow: () => number) {
    this.audioNow = audioNow;
  }

  onPress(fn: (e: PressEvent) => void): void {
    this.listeners.push(fn);
  }

  onPause(fn: () => void): void {
    this.pauseHandler = fn;
  }

  private toAudioTime(ts: number): number {
    const delay = Math.max(0, performance.now() - ts) / 1000;
    // 비정상적으로 큰 지연(탭 복귀 등)은 무시한다
    return this.audioNow() - (delay > 0.25 ? 0 : delay);
  }

  private emit(at: number, source: PressEvent['source']): void {
    for (const fn of this.listeners) fn({ at, source });
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      this.pauseHandler?.();
      return;
    }
    if (!this.keys.has(e.code)) return;
    e.preventDefault();
    if (this.held.has(e.code)) return; // 키 반복 무시
    this.held.add(e.code);
    this.emit(this.toAudioTime(e.timeStamp), 'key');
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement | null;
    // UI 버튼·입력 위의 터치는 게임 입력으로 치지 않는다
    if (target?.closest('button, a, input, label, select, textarea, .ui-panel')) return;
    this.emit(this.toAudioTime(e.timeStamp), 'pointer');
  };

  /**
   * 캔버스가 아니라 window 에 붙인다.
   * HUD 오버레이가 화면을 덮고 있어 캔버스에만 붙이면 터치가 캔버스까지
   * 내려오지 못한다. 실제로 모바일에서 탭이 전혀 먹지 않던 원인이었다.
   */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerdown', this.onPointerDown);
    this.held.clear();
  }

  clearListeners(): void {
    this.listeners = [];
    this.pauseHandler = null;
  }
}
