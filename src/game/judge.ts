import type { Judgement } from '../audio/sfx';
import type { NoteKind } from './chart';

export interface Windows {
  perfect: number;
  great: number;
  good: number;
}

/** 기본 판정 창(초). 스테이지의 timingScale 을 곱해 난이도를 조절한다. */
export const BASE_WINDOWS: Windows = { perfect: 0.055, great: 0.105, good: 0.17 };

export function makeWindows(scale: number): Windows {
  return {
    perfect: BASE_WINDOWS.perfect * scale,
    great: BASE_WINDOWS.great * scale,
    good: BASE_WINDOWS.good * scale,
  };
}

export function classify(absError: number, w: Windows): Judgement {
  if (absError <= w.perfect) return 'PERFECT';
  if (absError <= w.great) return 'GREAT';
  if (absError <= w.good) return 'GOOD';
  return 'MISS';
}

const VALUE: Record<Judgement, number> = { PERFECT: 300, GREAT: 200, GOOD: 100, MISS: 0 };
const ACC: Record<Judgement, number> = { PERFECT: 1, GREAT: 0.7, GOOD: 0.35, MISS: 0 };

/**
 * SWING POWER 게이지 증감량(%). 0 에서 시작해 노트를 성공시킬수록 차오르고,
 * 100 을 찍으면 피버 모드로 들어간다. 미스는 깎지만 0 밑으로는 안 내려간다 —
 * 이 게이지는 이제 체력(죽는 조건)이 아니라 "쌓아서 터뜨리는" 보상 자원이다.
 */
const POWER: Record<Judgement, number> = { PERFECT: 7, GREAT: 4.5, GOOD: 2, MISS: -6 };

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  /** SWING POWER 게이지(0~100). 100 이면 피버 발동 가능. */
  power: number;
  judged: number;
  totalNotes: number;
  accSum: number;
  /** 연속 스윙 미스 (일정 횟수면 추락) */
  missStreak: number;
  fullCombo: boolean;
}

export function newScore(totalNotes: number): ScoreState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 },
    power: 0,
    judged: 0,
    totalNotes,
    accSum: 0,
    missStreak: 0,
    fullCombo: true,
  };
}

/**
 * 판정 하나를 반영한다. 반환값은 이번 판정으로 얻은 점수.
 * `chargePower` 가 false 면 게이지를 건드리지 않는다 — 피버 중에는 이미
 * 게이지가 지속시간만큼 빠지고 있으므로 성공으로 다시 채우면 안 된다.
 */
export function applyJudge(
  s: ScoreState,
  kind: Judgement,
  noteKind: NoteKind,
  chargePower = true,
): number {
  const isSwing = noteKind === 'swing';

  s.counts[kind]++;
  s.judged++;
  s.accSum += ACC[kind] * (isSwing ? 1 : 0.85);

  if (kind === 'MISS') {
    s.combo = 0;
    s.fullCombo = false;
    if (isSwing) s.missStreak++;
  } else {
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.missStreak = 0;
  }
  if (chargePower) {
    s.power += POWER[kind] * (isSwing ? 1 : 0.6);
    s.power = Math.max(0, Math.min(100, s.power));
  }

  const mult = 1 + Math.min(s.combo, 120) / 120;
  const gained = Math.round(VALUE[kind] * mult * (isSwing ? 1 : 0.6));
  s.score += gained;
  return gained;
}

export function accuracy(s: ScoreState): number {
  if (s.judged === 0) return 1;
  return s.accSum / s.judged;
}

export type Rank = 'SSS' | 'S' | 'A' | 'B' | 'C' | 'D';

export function rankOf(acc: number, cleared: boolean): Rank {
  if (!cleared) return 'D';
  if (acc >= 0.99) return 'SSS';
  if (acc >= 0.955) return 'S';
  if (acc >= 0.91) return 'A';
  if (acc >= 0.84) return 'B';
  if (acc >= 0.74) return 'C';
  return 'D';
}
