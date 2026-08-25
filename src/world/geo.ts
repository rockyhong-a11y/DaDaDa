/**
 * 지리 좌표 <-> 로컬 ENU(East-North-Up) 미터 좌표 변환.
 *
 * 게임 월드는 three.js 관례를 따라 Y-up 이며,
 *   +X = 동쪽(East), +Y = 위(Up), -Z = 북쪽(North)
 * 로 정의한다. 도시 규모(수 km)에서는 등거리 원통 근사의 오차가
 * 0.1% 미만이므로 별도 투영 라이브러리 없이 충분히 정확하다.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export class GeoProjector {
  readonly origin: LatLon;
  /** 경도 1도당 미터 (원점 위도 기준) */
  readonly mPerLon: number;
  /** 위도 1도당 미터 */
  readonly mPerLat: number;

  constructor(origin: LatLon) {
    this.origin = origin;
    const latRad = origin.lat * DEG2RAD;
    this.mPerLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
    this.mPerLon = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
  }

  /** 위경도 -> 로컬 미터 (x: 동, z: 남). 북쪽이 -z 이다. */
  toLocal(lat: number, lon: number): { x: number; z: number } {
    return {
      x: (lon - this.origin.lon) * this.mPerLon,
      z: -(lat - this.origin.lat) * this.mPerLat,
    };
  }

  /** 로컬 미터 -> 위경도 */
  toGeo(x: number, z: number): LatLon {
    return {
      lat: this.origin.lat - z / this.mPerLat,
      lon: this.origin.lon + x / this.mPerLon,
    };
  }

  /** 위경도 두 점 사이의 지표 거리(m) */
  distance(a: LatLon, b: LatLon): number {
    const pa = this.toLocal(a.lat, a.lon);
    const pb = this.toLocal(b.lat, b.lon);
    return Math.hypot(pb.x - pa.x, pb.z - pa.z);
  }
}

/** 정북 기준 시계방향 방위각(도)을 월드 XZ 방향 벡터로 변환 */
export function bearingToDir(bearingDeg: number): { x: number; z: number } {
  const r = bearingDeg * DEG2RAD;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** 두 위경도 사이의 방위각(도, 정북 0 / 동 90) */
export function bearingBetween(a: LatLon, b: LatLon): number {
  const proj = new GeoProjector(a);
  const p = proj.toLocal(b.lat, b.lon);
  return (Math.atan2(p.x, -p.z) * RAD2DEG + 360) % 360;
}
