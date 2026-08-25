import { GeoProjector, DEG2RAD } from './geo';
import { Rand, hashString } from './rng';
import type { Block, BlockTuple, LandmarkShape, StageDef, Zone } from '../data/types';
import { OSM_FOOTPRINTS } from '../data/osm';

export type BuildingKind = 'apt' | 'office' | 'lowrise' | 'landmark' | 'special';

export interface BuildingInst {
  x: number;
  z: number;
  /** 장축 길이(m) */
  w: number;
  /** 단축 길이(m) */
  d: number;
  /** Y축 회전(라디안) */
  rot: number;
  /** 지반고(m) */
  base: number;
  /** 건물 자체 높이(m) */
  height: number;
  kind: BuildingKind;
  zone: Zone;
  /** 색·창문 밀도 변주용 0~1 */
  tint: number;
  floors: number;
  name?: string;
  shape?: LandmarkShape;
}

export interface Patch {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  y: number;
  name?: string;
}

export interface Hill {
  x: number;
  z: number;
  radius: number;
  height: number;
  falloff: number;
}

const FLOOR_H = 3.1;

export class City {
  readonly stage: StageDef;
  readonly proj: GeoProjector;
  readonly buildings: BuildingInst[] = [];
  readonly waters: Patch[] = [];
  readonly parks: Patch[] = [];
  readonly hills: Hill[] = [];
  /** 실측 OSM 발자국을 사용했는지 여부 */
  usedOsm = false;
  /** 100m 격자 공간 인덱스 (건물 인덱스 목록) */
  private grid = new Map<number, number[]>();
  private static readonly CELL = 100;

  constructor(stage: StageDef) {
    this.stage = stage;
    this.proj = new GeoProjector(stage.origin);

    for (const h of stage.terrain ?? []) {
      const p = this.proj.toLocal(h[0], h[1]);
      this.hills.push({ x: p.x, z: p.z, radius: h[2], height: h[3], falloff: h[4] ?? 2 });
    }

    // 랜드마크 -> (실측 데이터 | 블록 규칙) -> 배경 도시 순으로 채운다.
    // 뒤에 오는 단계는 앞 단계가 차지한 자리를 피한다.
    this.placeLandmarks();
    this.usedOsm = this.placeOsmFootprints();
    if (!this.usedOsm) this.placeBlocks();
    else this.placePatchesOnly();
    this.fillBackground();
    this.buildIndex();
  }

  /** 지형 표고(m). 가우시안 형태의 구릉을 합성한다. */
  groundAt(x: number, z: number): number {
    let h = 0;
    for (const hill of this.hills) {
      const dist = Math.hypot(x - hill.x, z - hill.z);
      if (dist > hill.radius) continue;
      const t = 1 - dist / hill.radius;
      const smooth = t * t * (3 - 2 * t); // smoothstep
      h += hill.height * Math.pow(smooth, hill.falloff * 0.5);
    }
    return h;
  }

  private placeLandmarks(): void {
    for (const lm of this.stage.landmarks) {
      const [name, lat, lon, w, d, rot, height, floors, shape, baseHeight] = lm;
      const p = this.proj.toLocal(lat, lon);
      this.buildings.push({
        x: p.x,
        z: p.z,
        w,
        d,
        rot: rot * DEG2RAD,
        base: baseHeight ?? this.groundAt(p.x, p.z),
        height,
        kind: 'landmark',
        zone: 'office-hi',
        tint: 0.5,
        floors,
        name,
        shape: shape ?? 'box',
      });
    }
  }

  /**
   * 실측 발자국을 그대로 배치한다. `npm run fetch:osm` 으로 데이터를 구워 두면
   * 블록 규칙 대신 실제 건물 윤곽·층수가 쓰인다.
   */
  private placeOsmFootprints(): boolean {
    const fps = OSM_FOOTPRINTS[this.stage.id];
    if (!fps || fps.length < 50) return false;
    const landmarkCount = this.buildings.length;
    let i = 0;
    for (const f of fps) {
      const p = this.proj.toLocal(f.lat, f.lon);
      if (this.collidesLandmark(p.x, p.z, landmarkCount)) continue;
      this.buildings.push({
        x: p.x,
        z: p.z,
        w: f.w,
        d: f.d,
        rot: f.rot * DEG2RAD,
        base: this.groundAt(p.x, p.z),
        height: f.h,
        kind: f.kind,
        zone: f.kind === 'apt' ? 'apt-slab' : f.kind === 'office' ? 'office' : 'lowrise',
        tint: ((i * 2654435761) % 1000) / 1000,
        floors: f.floors,
      });
      i++;
    }
    return true;
  }

  /** 실측 데이터를 쓸 때도 물·공원 패치는 블록 정의에서 가져온다 */
  private placePatchesOnly(): void {
    for (const t of this.stage.blocks) {
      const b = this.toBlock(t);
      if (b.zone !== 'water' && b.zone !== 'park') continue;
      const p = this.proj.toLocal(b.center.lat, b.center.lon);
      const rot = b.rot * DEG2RAD;
      if (b.zone === 'water') {
        this.waters.push({ x: p.x, z: p.z, w: b.width, d: b.depth, rot, y: this.stage.waterLevel ?? -2, name: b.name });
      } else {
        this.parks.push({ x: p.x, z: p.z, w: b.width, d: b.depth, rot, y: this.groundAt(p.x, p.z), name: b.name });
      }
    }
  }

  private toBlock(t: BlockTuple): Block {
    return {
      center: { lat: t[0], lon: t[1] },
      width: t[2],
      depth: t[3],
      rot: t[4],
      zone: t[5],
      hMin: t[6],
      hMax: t[7],
      density: t[8] ?? 0.85,
      name: t[9],
    };
  }

  private placeBlocks(): void {
    const landmarkCount = this.buildings.length;
    for (let bi = 0; bi < this.stage.blocks.length; bi++) {
      const b = this.toBlock(this.stage.blocks[bi]);
      const rand = new Rand(`${this.stage.id}:${bi}:${b.name ?? ''}`);
      const p = this.proj.toLocal(b.center.lat, b.center.lon);
      const rot = b.rot * DEG2RAD;

      if (b.zone === 'water') {
        this.waters.push({ x: p.x, z: p.z, w: b.width, d: b.depth, rot, y: this.stage.waterLevel ?? -2, name: b.name });
        continue;
      }
      if (b.zone === 'park') {
        this.parks.push({ x: p.x, z: p.z, w: b.width, d: b.depth, rot, y: this.groundAt(p.x, p.z), name: b.name });
        continue;
      }
      this.fillBlock(b, p, rot, rand, landmarkCount);
    }
  }

  /** 블록 로컬 좌표(u: 장축, v: 단축) -> 월드 좌표 */
  private static local(px: number, pz: number, rot: number, u: number, v: number): { x: number; z: number } {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // 장축 방향은 방위각 rot 을 따르므로 (sin, -cos), 직교축은 (cos, sin)
    return { x: px + u * s + v * c, z: pz - u * c + v * s };
  }

  private fillBlock(b: Block, p: { x: number; z: number }, rot: number, rand: Rand, landmarkCount: number): void {
    const spec = MORPHOLOGY[b.zone];
    if (!spec) return;

    const stepU = spec.stepU(rand);
    const stepV = spec.stepV(rand);
    const nu = Math.max(1, Math.floor(b.width / stepU));
    const nv = Math.max(1, Math.floor(b.depth / stepV));
    const offU = -((nu - 1) * stepU) / 2;
    const offV = -((nv - 1) * stepV) / 2;

    for (let iu = 0; iu < nu; iu++) {
      for (let iv = 0; iv < nv; iv++) {
        if (!rand.chance(b.density * spec.fill)) continue;
        const jitter = spec.jitter;
        const u = offU + iu * stepU + rand.bell() * jitter;
        const v = offV + iv * stepV + rand.bell() * jitter;
        const pos = City.local(p.x, p.z, rot, u, v);

        // 랜드마크와 겹치면 생략
        if (this.collidesLandmark(pos.x, pos.z, landmarkCount)) continue;

        const size = spec.size(rand, stepU, stepV);
        // 블록 가장자리로 갈수록 낮아지는 자연스러운 스카이라인
        const edge = Math.max(Math.abs(u) / (b.width / 2), Math.abs(v) / (b.depth / 2));
        const centrality = 1 - Math.min(edge, 1) * spec.edgeFalloff;
        const raw = spec.height(rand, b.hMin, b.hMax);
        const h = Math.max(b.hMin * 0.7, raw * centrality);
        const floors = Math.max(1, Math.round(h / FLOOR_H));

        this.buildings.push({
          x: pos.x,
          z: pos.z,
          w: size.w,
          d: size.d,
          rot: rot + spec.rotJitter * rand.bell(),
          base: this.groundAt(pos.x, pos.z),
          height: floors * FLOOR_H,
          kind: spec.kind,
          zone: b.zone,
          tint: rand.next(),
          floors,
        });
      }
    }
  }

  /**
   * 배경 도시. 손으로 기술한 블록 바깥을 저주파 노이즈 기반의 시가지로 메운다.
   * 경로 주변은 촘촘하게, 멀어질수록 성기게 채워 지평선까지 빌딩숲이 이어지게 한다.
   */
  private fillBackground(): void {
    const rand = new Rand(`${this.stage.id}:bg`);
    const pts = this.stage.route.map((w) => this.proj.toLocal(w.lat, w.lon));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const OUTER = 2400;
    const NEAR = 900;
    minX -= OUTER;
    maxX += OUTER;
    minZ -= OUTER;
    maxZ += OUTER;

    const blockRects = this.stage.blocks.map((t) => {
      const b = this.toBlock(t);
      const p = this.proj.toLocal(b.center.lat, b.center.lon);
      return { x: p.x, z: p.z, hw: b.width / 2 + 12, hd: b.depth / 2 + 12, rot: b.rot * DEG2RAD };
    });
    const landmarkCount = this.stage.landmarks.length;

    const COARSE = 74;
    const FINE = 34;
    const seed = hashString(this.stage.id);

    for (let x = minX; x < maxX; x += FINE) {
      for (let z = minZ; z < maxZ; z += FINE) {
        const dRoute = distToPolyline(x, z, pts);
        const fine = dRoute < NEAR;
        // 성긴 영역에서는 COARSE 격자에 해당하는 칸만 사용한다
        if (!fine) {
          if (Math.round(x / FINE) % Math.round(COARSE / FINE) !== 0) continue;
          if (Math.round(z / FINE) % Math.round(COARSE / FINE) !== 0) continue;
        }
        if (dRoute > OUTER) continue;
        const px = x + rand.bell() * (fine ? 7 : 16);
        const pz = z + rand.bell() * (fine ? 7 : 16);
        if (insideAnyRect(px, pz, blockRects)) continue;
        if (this.insidePatch(px, pz, this.waters, 20) || this.insidePatch(px, pz, this.parks, 10)) continue;
        if (this.collidesLandmark(px, pz, landmarkCount)) continue;
        if (!rand.chance(fine ? 0.82 : 0.72)) continue;

        // 저주파 노이즈 두 겹으로 도심 밀도 기복을 만든다
        const n1 = valueNoise(px / 620, pz / 620, seed);
        const n2 = valueNoise(px / 190, pz / 190, seed + 7);
        const urban = Math.pow(n1 * 0.72 + n2 * 0.28, 1.6);
        const tall = urban > 0.62;
        const h = tall
          ? 34 + urban * 118 * rand.range(0.7, 1.3)
          : 9 + urban * 46 * rand.range(0.6, 1.35);
        const floors = Math.max(1, Math.round(h / FLOOR_H));
        const footprint = tall ? rand.range(20, 34) : rand.range(12, 22);
        const scale = fine ? 1 : 1.35; // 원경은 조금 크게 만들어 실루엣을 유지
        this.buildings.push({
          x: px,
          z: pz,
          w: footprint * scale * rand.range(0.85, 1.3),
          d: footprint * scale * rand.range(0.85, 1.25),
          rot: rand.range(0, Math.PI),
          base: this.groundAt(px, pz),
          height: floors * FLOOR_H,
          kind: tall ? 'office' : 'lowrise',
          zone: tall ? 'office' : 'lowrise',
          tint: rand.next(),
          floors,
        });
      }
    }
  }

  private insidePatch(x: number, z: number, patches: Patch[], margin: number): boolean {
    for (const p of patches) {
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const dx = x - p.x;
      const dz = z - p.z;
      const u = dx * s - dz * c;
      const v = dx * c + dz * s;
      if (Math.abs(u) < p.w / 2 + margin && Math.abs(v) < p.d / 2 + margin) return true;
    }
    return false;
  }

  private collidesLandmark(x: number, z: number, landmarkCount: number): boolean {
    for (let i = 0; i < landmarkCount; i++) {
      const lm = this.buildings[i];
      const r = Math.max(lm.w, lm.d) * 0.7 + 14;
      if ((lm.x - x) ** 2 + (lm.z - z) ** 2 < r * r) return true;
    }
    return false;
  }

  // ---- 공간 인덱스 ----

  private key(cx: number, cz: number): number {
    return ((cx + 4096) << 13) | (cz + 4096);
  }

  private buildIndex(): void {
    this.grid.clear();
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const cx = Math.floor(b.x / City.CELL);
      const cz = Math.floor(b.z / City.CELL);
      const k = this.key(cx, cz);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
  }

  /** 반경 내 건물 인덱스 조회 */
  query(x: number, z: number, radius: number): number[] {
    const out: number[] = [];
    const c0x = Math.floor((x - radius) / City.CELL);
    const c1x = Math.floor((x + radius) / City.CELL);
    const c0z = Math.floor((z - radius) / City.CELL);
    const c1z = Math.floor((z + radius) / City.CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const b = this.buildings[i];
          if ((b.x - x) ** 2 + (b.z - z) ** 2 <= radius * radius) out.push(i);
        }
      }
    }
    return out;
  }

  /** 반경 내 최고 옥상고 */
  skylineAt(x: number, z: number, radius: number): number {
    let top = this.groundAt(x, z);
    for (const i of this.query(x, z, radius)) {
      const b = this.buildings[i];
      const roof = b.base + b.height;
      if (roof > top) top = roof;
    }
    return top;
  }
}

interface Morphology {
  kind: BuildingKind;
  fill: number;
  jitter: number;
  rotJitter: number;
  edgeFalloff: number;
  stepU: (r: Rand) => number;
  stepV: (r: Rand) => number;
  size: (r: Rand, su: number, sv: number) => { w: number; d: number };
  height: (r: Rand, lo: number, hi: number) => number;
}

/**
 * 용도별 도시 형태 규칙.
 * 서울의 실제 단지·가로 형태를 단순화해 옮겼다.
 */
const MORPHOLOGY: Partial<Record<Zone, Morphology>> = {
  // 남향 일자 배치 판상형. 장축(동서)으로 길고 남북 간격이 넓다.
  'apt-slab': {
    kind: 'apt',
    fill: 1,
    jitter: 4,
    rotJitter: 0.01,
    edgeFalloff: 0.18,
    stepU: (r) => r.range(78, 96),
    stepV: (r) => r.range(56, 70),
    size: (r, su) => ({ w: su * r.range(0.72, 0.86), d: r.range(13, 17) }),
    height: (r, lo, hi) => r.range(lo, hi) * (r.chance(0.15) ? 0.72 : 1),
  },
  // 타워형 고층 아파트. 정사각에 가까운 평면이 격자로 흩어진다.
  'apt-tower': {
    kind: 'apt',
    fill: 0.82,
    jitter: 9,
    rotJitter: 0.25,
    edgeFalloff: 0.22,
    stepU: (r) => r.range(52, 66),
    stepV: (r) => r.range(52, 66),
    size: (r) => ({ w: r.range(22, 30), d: r.range(20, 27) }),
    height: (r, lo, hi) => r.range(lo, hi),
  },
  'office-hi': {
    kind: 'office',
    fill: 0.9,
    jitter: 5,
    rotJitter: 0.05,
    edgeFalloff: 0.3,
    stepU: (r) => r.range(46, 62),
    stepV: (r) => r.range(44, 58),
    size: (r, su, sv) => ({ w: su * r.range(0.6, 0.8), d: sv * r.range(0.6, 0.8) }),
    // 대부분 중간 높이, 가끔 초고층이 튀어나오는 로그 분포
    height: (r, lo, hi) => {
      const t = Math.pow(r.next(), 2.1);
      return lo + (hi - lo) * t * (r.chance(0.08) ? 1.25 : 1);
    },
  },
  office: {
    kind: 'office',
    fill: 0.88,
    jitter: 5,
    rotJitter: 0.07,
    edgeFalloff: 0.28,
    stepU: (r) => r.range(36, 48),
    stepV: (r) => r.range(34, 46),
    size: (r, su, sv) => ({ w: su * r.range(0.6, 0.82), d: sv * r.range(0.6, 0.82) }),
    height: (r, lo, hi) => lo + (hi - lo) * Math.pow(r.next(), 1.7),
  },
  mixed: {
    kind: 'office',
    fill: 0.7,
    jitter: 8,
    rotJitter: 0.2,
    edgeFalloff: 0.35,
    stepU: (r) => r.range(48, 64),
    stepV: (r) => r.range(46, 60),
    size: (r) => ({ w: r.range(24, 40), d: r.range(22, 36) }),
    height: (r, lo, hi) => (r.chance(0.35) ? r.range(hi * 0.7, hi) : r.range(lo, lo + (hi - lo) * 0.35)),
  },
  lowrise: {
    kind: 'lowrise',
    fill: 0.94,
    jitter: 3,
    rotJitter: 0.16,
    edgeFalloff: 0.12,
    stepU: (r) => r.range(19, 27),
    stepV: (r) => r.range(18, 25),
    size: (r, su, sv) => ({ w: su * r.range(0.66, 0.88), d: sv * r.range(0.66, 0.88) }),
    height: (r, lo, hi) => r.range(lo, hi),
  },
  market: {
    kind: 'lowrise',
    fill: 0.97,
    jitter: 2,
    rotJitter: 0.1,
    edgeFalloff: 0.06,
    stepU: (r) => r.range(12, 17),
    stepV: (r) => r.range(11, 16),
    size: (r, su, sv) => ({ w: su * r.range(0.78, 0.95), d: sv * r.range(0.78, 0.95) }),
    height: (r, lo, hi) => r.range(lo, hi),
  },
  stadium: {
    kind: 'special',
    fill: 0.4,
    jitter: 10,
    rotJitter: 0.3,
    edgeFalloff: 0.4,
    stepU: (r) => r.range(70, 90),
    stepV: (r) => r.range(70, 90),
    size: (r) => ({ w: r.range(40, 60), d: r.range(36, 54) }),
    height: (r, lo, hi) => r.range(lo, hi),
  },
};


function insideAnyRect(
  x: number,
  z: number,
  rects: { x: number; z: number; hw: number; hd: number; rot: number }[],
): boolean {
  for (const r of rects) {
    const c = Math.cos(r.rot);
    const s = Math.sin(r.rot);
    const dx = x - r.x;
    const dz = z - r.z;
    const u = dx * s - dz * c;
    const v = dx * c + dz * s;
    if (Math.abs(u) < r.hw && Math.abs(v) < r.hd) return true;
  }
  return false;
}

function distToPolyline(x: number, z: number, pts: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
    if (d < best) best = d;
  }
  return best;
}

/** 해시 기반 값 노이즈 (0~1). 외부 의존성 없이 결정적으로 동작한다. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const h = (a: number, b: number): number => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
