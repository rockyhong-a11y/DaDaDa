import type { City } from '../world/citygen';

export interface RoutePoint {
  x: number;
  z: number;
  /** 경로 시작점으로부터의 누적 거리(m) */
  s: number;
}

/** 위경도 웨이포인트를 로컬 좌표 폴리라인으로 변환하고 누적거리를 붙인다. */
export class RoutePath {
  readonly pts: RoutePoint[] = [];
  readonly length: number;

  constructor(city: City) {
    let s = 0;
    const raw = city.stage.route.map((w) => city.proj.toLocal(w.lat, w.lon));
    // Catmull-Rom 으로 부드럽게 보간해 급격한 꺾임을 없앤다
    const smooth = smoothPolyline(raw, 12);
    for (let i = 0; i < smooth.length; i++) {
      if (i > 0) s += Math.hypot(smooth[i].x - smooth[i - 1].x, smooth[i].z - smooth[i - 1].z);
      this.pts.push({ x: smooth[i].x, z: smooth[i].z, s });
    }
    this.length = s;
  }

  /** 누적거리 s 위치의 좌표 */
  at(s: number): { x: number; z: number } {
    const t = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = this.pts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.pts[mid].s <= t) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[hi];
    const span = b.s - a.s || 1;
    const k = (t - a.s) / span;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  }

  /** 누적거리 s 위치의 진행 방향 단위벡터 */
  dirAt(s: number): { x: number; z: number } {
    const d = 6;
    const a = this.at(Math.max(0, s - d));
    const b = this.at(Math.min(this.length, s + d));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }
}

function smoothPolyline(pts: { x: number; z: number }[], subdiv: number): { x: number; z: number }[] {
  if (pts.length < 3) return pts;
  const out: { x: number; z: number }[] = [];
  const get = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let j = 0; j < subdiv; j++) {
      const t = j / subdiv;
      out.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
