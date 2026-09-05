import type { LatLon } from '../world/geo';

/** 도시 블록의 용도 지역. 생성기가 형태·높이·배치 규칙을 결정한다. */
export type Zone =
  | 'apt-slab' // 판상형 아파트 단지 (남향 일자 배치)
  | 'apt-tower' // 타워형 고층 아파트 / 주상복합 단지
  | 'office' // 일반 업무지구
  | 'office-hi' // 고층 업무지구 (테헤란로·여의도 등)
  | 'mixed' // 주상복합 · 상업 혼합
  | 'lowrise' // 저층 상가 / 다세대 밀집지
  | 'market' // 재래시장 / 초저층 밀집
  | 'park' // 공원 · 광장 (건물 없음)
  | 'water' // 하천 · 호수
  | 'stadium'; // 경기장 · 대형 시설

/**
 * 블록 정의 튜플.
 * [위도, 경도, 폭(m), 깊이(m), 장축방위각(도), 용도, 최저높이(m), 최고높이(m), 밀도(0~1), 이름]
 * 폭은 장축(rot 방향), 깊이는 그와 직교하는 축의 길이를 뜻한다.
 */
export type BlockTuple = [
  number,
  number,
  number,
  number,
  number,
  Zone,
  number,
  number,
  number?,
  string?,
];

/**
 * 실존 랜드마크 정의 튜플.
 * [이름, 위도, 경도, 폭(m), 깊이(m), 방위각(도), 높이(m), 층수, 형태, 지반고(m)]
 */
export type LandmarkTuple = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  LandmarkShape?,
  number?,
];

export type LandmarkShape = 'box' | 'taper' | 'cylinder' | 'dome' | 'spire' | 'stadium';

/**
 * 지형(구릉) 정의 튜플. 서울은 남산·용왕산처럼 도심 한복판에 산이 있어
 * 건물 지반고와 비행 고도에 실제로 영향을 준다.
 * [위도, 경도, 반경(m), 정상높이(m), 감쇠지수, 이름]
 */
export type HillTuple = [number, number, number, number, number?, string?];

export interface Block {
  center: LatLon;
  width: number;
  depth: number;
  rot: number;
  zone: Zone;
  hMin: number;
  hMax: number;
  density: number;
  name?: string;
}

export interface Landmark {
  name: string;
  center: LatLon;
  width: number;
  depth: number;
  rot: number;
  height: number;
  floors: number;
  shape: LandmarkShape;
  /** 지반고 지정 (미지정 시 지형에서 계산) */
  baseHeight?: number;
}

/** 리듬 패턴: 노트 간 간격을 박자 단위로 나열한 루프 */
export interface RhythmPattern {
  /** 한 마디 반복 단위. 예) [2,2,2,2] = 2박마다, [1,1,0.5,0.5,1] = 싱코페이션 */
  steps: number[];
  /** 패턴을 반복하다 중간에 섞어 넣는 변주 (선택) */
  variation?: number[];
  /** 변주가 등장하는 주기 (몇 번째 루프마다) */
  variationEvery?: number;
}

/**
 * 실제 음원 BGM.
 *
 * 지정하면 신스 시퀀서 대신 오디오 파일을 재생한다. 파일을 못 받아오면
 * (오프라인 단일 HTML 배포본, 네트워크 실패 등) 자동으로 신스 프리셋으로
 * 되돌아가므로, 스테이지는 음원이 없어도 항상 굴러간다.
 */
export interface StageBgm {
  /** 페이지 기준 상대 경로 */
  url: string;
  /** 곡의 실측 BPM. StageDef.bpm 과 반드시 같아야 차트가 곡에 붙는다. */
  bpm: number;
  /** 첫 마디 첫 박의 파일 내 위치(초). 이 지점이 차트의 0박이 된다. */
  downbeat: number;
  /** downbeat 이후 실제로 쓸 수 있는 길이(초). 차트 길이의 상한. */
  playable: number;
  /** 재생 게인 (신스 트랙과 체감 음량을 맞추는 값) */
  gain: number;
  /** 결과 화면·크레디트 표기용 */
  title: string;
}

export interface StageDef {
  id: string;
  index: number;
  name: string;
  nameEn: string;
  district: string;
  /** 스테이지 요약 설명 */
  tagline: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** 로컬 좌표계 원점 (실제 위경도) */
  origin: LatLon;
  /** 실제 도로·수변을 따라가는 비행 경로 웨이포인트 */
  route: LatLon[];
  blocks: BlockTuple[];
  landmarks: LandmarkTuple[];
  /** 지형 구릉 (선택) */
  terrain?: HillTuple[];
  /** BPM */
  bpm: number;
  /** 곡 조성 (신스 BGM 생성에 사용) - 근음 MIDI 노트 */
  rootNote: number;
  /** 음악 스타일 프리셋 (신스 폴백 트랙) */
  musicStyle: 'sunsetpop' | 'synthwave' | 'kpop' | 'dnb' | 'hardcore';
  /** 실제 음원 BGM. 지정하면 신스 대신 이 파일을 쓴다. */
  bgm?: StageBgm;
  rhythm: RhythmPattern;
  /** 판정 창 배율 (작을수록 어렵다) */
  timingScale: number;
  /** 스윙 한 번당 목표 이동 거리 배율 */
  hopScale: number;
  /** 피날레 등반 대상 랜드마크 이름 (경로 끝에서 정상까지 타고 오른다) */
  finale: string;
  /** 웹을 새로 쏘는 주기(박). 그 사이 노트는 공중 트릭(에어 노트)이 된다. 기본 2. */
  swingBeats?: number;
  /** 하늘·조명 프리셋 */
  timeOfDay: 'dawn' | 'day' | 'sunset' | 'dusk' | 'night';
  /** 강·호수 수면 높이(m, 해발 기준 로컬) */
  waterLevel?: number;
}
