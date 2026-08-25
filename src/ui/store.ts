import type { Rank } from '../game/judge';

export interface StageRecord {
  score: number;
  acc: number;
  rank: Rank;
  maxCombo: number;
  fullCombo: boolean;
  cleared: boolean;
}

export interface Settings {
  music: number;
  sfx: number;
  /** 오디오 오프셋 보정(ms). 양수면 판정을 늦춘다. */
  offsetMs: number;
  quality: 'low' | 'medium' | 'high';
  /** 화질을 기기 성능에 맞춰 자동으로 조정할지. 사용자가 직접 고르면 꺼진다. */
  autoQuality: boolean;
  /** Google Maps Photorealistic 3D Tiles API 키 (선택) */
  googleKey: string;
  useTiles: boolean;
}

interface Save {
  version: number;
  records: Record<string, StageRecord>;
  settings: Settings;
}

const KEY = 'dadada.seoul-swing.v1';

export const DEFAULT_SETTINGS: Settings = {
  music: 0.72,
  sfx: 0.85,
  offsetMs: 0,
  quality: 'high',
  autoQuality: true,
  googleKey: '',
  useTiles: false,
};

/**
 * 첫 실행 시 기기 성능을 보고 화질을 정한다.
 * 모바일에서 기본값 '높음' 으로 시작하면 블룸 + 고DPR 때문에
 * 첫인상부터 프레임이 무너진다.
 */
export function detectQuality(): Settings['quality'] {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  if (coarse && (cores <= 4 || mem <= 4)) return 'low';
  if (coarse || shortSide < 760) return 'medium';
  return 'high';
}

function blank(): Save {
  return { version: 1, records: {}, settings: { ...DEFAULT_SETTINGS } };
}

/** 진행도·설정 저장소. localStorage 를 쓸 수 없는 환경에서도 동작한다. */
export class Store {
  private data: Save;

  constructor() {
    this.data = blank();
    this.data.settings.quality = detectQuality();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Save>;
        this.data = {
          version: 1,
          records: parsed.records ?? {},
          settings: { ...DEFAULT_SETTINGS, quality: detectQuality(), ...(parsed.settings ?? {}) },
        };
      }
    } catch {
      this.data = blank();
      this.data.settings.quality = detectQuality();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // 시크릿 모드 등에서 저장이 막혀도 게임은 계속된다
    }
  }

  get settings(): Settings {
    return this.data.settings;
  }

  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.data.settings, patch);
    this.persist();
  }

  record(stageId: string): StageRecord | null {
    return this.data.records[stageId] ?? null;
  }

  /** 더 좋은 기록일 때만 갱신한다 */
  submit(stageId: string, r: StageRecord): boolean {
    const prev = this.data.records[stageId];
    const better = !prev || r.score > prev.score;
    if (better) {
      this.data.records[stageId] = r;
    } else if (r.cleared && !prev.cleared) {
      this.data.records[stageId] = { ...prev, cleared: true };
    }
    this.persist();
    return better;
  }

  /** 해당 인덱스의 스테이지가 열려 있는가 (직전 스테이지를 클리어하면 열린다) */
  isUnlocked(index: number, ids: string[]): boolean {
    if (index === 0) return true;
    const prev = this.data.records[ids[index - 1]];
    return !!prev?.cleared;
  }

  resetAll(): void {
    this.data = blank();
    this.persist();
  }
}
