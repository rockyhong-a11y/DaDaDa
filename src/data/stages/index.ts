import type { StageDef } from '../types';
import { STAGE_MOKDONG } from './s1-mokdong';
import { STAGE_YEOUIDO } from './s2-yeouido';
import { STAGE_JAMSIL } from './s3-jamsil';
import { STAGE_TEHERAN } from './s4-teheran';
import { STAGE_CBD } from './s5-cbd';

export const STAGES: StageDef[] = [
  STAGE_MOKDONG,
  STAGE_YEOUIDO,
  STAGE_JAMSIL,
  STAGE_TEHERAN,
  STAGE_CBD,
];

export function getStage(id: string): StageDef {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`알 수 없는 스테이지: ${id}`);
  return s;
}
