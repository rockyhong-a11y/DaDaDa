/**
 * 실측 건물 발자국(footprint).
 * OpenStreetMap 폴리곤을 최소 면적 회전 사각형으로 근사한 형태로,
 * 게임의 인스턴싱 렌더러가 그대로 그릴 수 있다.
 */
export interface Footprint {
  /** 위도 */
  lat: number;
  /** 경도 */
  lon: number;
  /** 장축 길이(m) */
  w: number;
  /** 단축 길이(m) */
  d: number;
  /** 장축 방위각(도, 정북 0 / 동 90) */
  rot: number;
  /** 높이(m) */
  h: number;
  /** 층수 */
  floors: number;
  /** OSM building 태그에서 추정한 용도 */
  kind: 'apt' | 'office' | 'lowrise';
}
