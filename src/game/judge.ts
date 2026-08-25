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
const HP: Record<Judgement, number> = { PERFECT: 1.4, GREAT: 0.8, GOOD: 0.1, MISS: -9 };

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  hp: number;
  judged: number;
  totalNotes: number;
  accSum: number;
  /** 연속 스윙 미스 (3회면 추락) */
  missStreak: number;
  fullCombo: boolean;
}

export function newScore(totalNotes: number): ScoreState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 },
    hp: 100,
    judged: 0,
    totalNotes,
    accSum: 0,
    missStreak: 0,
    fullCombo: true,
  };
}

/**
 * 판정 하나를 반영한다. 반환값은 이번 판정으로 얻은 점수.
 *
 * hold/mash 는 스윙만큼 무겁게 채점한다(정확도·점수·HP 전부 풀 가중치) — 웹을
 * 쏘는 것 못지않게 신경 써야 하는 진짜 액션이기 때문이다. 다만 "3연속 놓치면
 * 추락"하는 miss-streak 는 스윙 전용으로 남겨 둔다 — 그건 문자 그대로
 * 앵커를 놓쳐 추락하는 상황을 뜻하지, 홀드/연타를 어설프게 한 것과는 다르다.
 */
export function applyJudge(s: ScoreState, kind: Judgement, noteKind: NoteKind): number {
  const isSwing = noteKind === 'swing';
  const isMajor = isSwing || noteKind === 'hold' || noteKind === 'mash';

  s.counts[kind]++;
  s.judged++;
  s.accSum += ACC[kind] * (isMajor ? 1 : 0.85);

  if (kind === 'MISS') {
    s.combo = 0;
    s.fullCombo = false;
    s.hp += isMajor ? HP.MISS : HP.MISS * 0.4;
    if (isSwing) s.missStreak++;
  } else {
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.hp += HP[kind] * (isMajor ? 1 : 0.6);
    s.missStreak = 0;
  }
  s.hp = Math.max(0, Math.min(100, s.hp));

  const mult = 1 + Math.min(s.combo, 120) / 120;
  const gained = Math.round(VALUE[kind] * mult * (isMajor ? 1 : 0.6));
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
