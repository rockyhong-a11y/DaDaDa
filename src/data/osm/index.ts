/**
 * 실측 건물 데이터 레지스트리 (선택 사항).
 *
 * `npm run fetch:osm` 을 돌리면 OpenStreetMap Overpass API 에서 각 스테이지
 * 영역의 실제 건물 윤곽·층수를 받아 이 디렉터리에 JSON 으로 굽고,
 * 이 파일을 그 JSON 들을 가리키도록 다시 쓴다.
 *
 * 기본 상태(데이터 없음)에서는 비어 있고, 도시 생성기는 실제 위경도 기반의
 * 블록 규칙으로 건물을 만든다. 두 경로 모두 같은 좌표계·같은 렌더러를 쓴다.
 */
export type { Footprint } from './types';
import type { Footprint } from './types';

export const OSM_FOOTPRINTS: Record<string, Footprint[]> = {};
