#!/usr/bin/env node
/**
 * OpenStreetMap 에서 스테이지별 실제 건물 발자국을 받아 굽는 스크립트.
 *
 *   npm run fetch:osm            # 전체 스테이지
 *   npm run fetch:osm -- jamsil  # 특정 스테이지만
 *
 * 각 건물 폴리곤을 최소 면적 회전 사각형으로 근사해
 * {중심 위경도, 장축/단축 길이, 방위각, 높이, 층수} 로 압축한다.
 * 게임의 인스턴싱 렌더러가 박스 단위로 그리기 때문에 이 형태가 그대로 쓰인다.
 *
 * 높이는 height 태그를 우선하고, 없으면 building:levels × 3.1m,
 * 그것도 없으면 building 태그별 기본값을 쓴다.
 *
 * 네트워크가 막힌 환경에서는 실패하며, 그 경우 게임은 기존의
 * 블록 규칙 기반 생성기를 그대로 사용한다 (데이터는 선택 사항).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'data', 'osm');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** 스테이지 id -> 경로 웨이포인트 (src/data/stages 와 동일하게 유지) */
const STAGE_ROUTES = {
  mokdong: [
    [37.5492, 126.8804], [37.5456, 126.8793], [37.5419, 126.878], [37.5381, 126.8767],
    [37.5343, 126.8757], [37.5305, 126.8751], [37.5272, 126.8752], [37.5243, 126.8759],
  ],
  yeouido: [
    [37.532, 126.9139], [37.5301, 126.918], [37.5279, 126.9219], [37.5263, 126.9257],
    [37.5249, 126.9292], [37.5232, 126.9331], [37.5212, 126.9369], [37.5197, 126.9401],
  ],
  jamsil: [
    [37.5158, 127.0722], [37.515, 127.0782], [37.5142, 127.0845], [37.5135, 127.0908],
    [37.5129, 127.0966], [37.515, 127.1014], [37.515, 127.1062], [37.5112, 127.1058],
    [37.5125, 127.1025],
  ],
  teheran: [
    [37.4979, 127.0276], [37.4999, 127.0338], [37.5011, 127.0396], [37.5031, 127.0452],
    [37.5054, 127.051], [37.5074, 127.0566], [37.5089, 127.0628], [37.5114, 127.0648],
    [37.5126, 127.0604], [37.5092, 127.059],
  ],
  cbd: [
    [37.5759, 126.9769], [37.5722, 126.9789], [37.5701, 126.9829], [37.5679, 126.9868],
    [37.5659, 126.9901], [37.5632, 126.9884], [37.5601, 126.9868], [37.5566, 126.9878],
    [37.5533, 126.9884], [37.5513, 126.9883],
  ],
};

/** 경로를 감싸는 bbox + 여유 (m) */
const MARGIN_M = 700;

const DEFAULT_H = {
  apartments: 45,
  residential: 15,
  house: 7,
  detached: 8,
  office: 40,
  commercial: 25,
  retail: 12,
  industrial: 12,
  school: 14,
  hospital: 30,
  hotel: 40,
  church: 15,
  yes: 14,
};

function bboxOf(route) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [lat, lon] of route) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }
  const dLat = MARGIN_M / 110900;
  const dLon = MARGIN_M / (111320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180));
  return [minLat - dLat, minLon - dLon, maxLat + dLat, maxLon + dLon];
}

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`  ${url} 실패: ${err.message}`);
    }
  }
  throw lastErr ?? new Error('모든 Overpass 엔드포인트 실패');
}

/** 위경도 폴리곤 -> 로컬 미터 좌표 */
function toMeters(nodes, lat0) {
  const mLat = 110574;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return nodes.map((n) => ({ x: n.lon * mLon, y: n.lat * mLat }));
}

/** 회전 캘리퍼스로 최소 면적 외접 사각형을 구한다 */
function minAreaRect(pts) {
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    const ux = ex / len;
    const uy = ey / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = {
        area,
        cx: cu * ux - cv * uy,
        cy: cu * uy + cv * ux,
        w, h,
        ux, uy,
      };
    }
  }
  return best;
}

function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function heightOf(tags) {
  const h = parseFloat(tags.height ?? tags['building:height'] ?? '');
  if (Number.isFinite(h) && h > 1) return h;
  const lv = parseFloat(tags['building:levels'] ?? tags['building:levels:aboveground'] ?? '');
  if (Number.isFinite(lv) && lv >= 1) return lv * 3.1;
  return DEFAULT_H[tags.building] ?? DEFAULT_H.yes;
}

function kindOf(tags) {
  const b = tags.building ?? 'yes';
  if (['apartments', 'residential', 'dormitory'].includes(b)) return 'apt';
  if (['office', 'commercial', 'hotel', 'hospital', 'government', 'public'].includes(b)) return 'office';
  return 'lowrise';
}

async function fetchStage(id, route) {
  const [s, w, n, e] = bboxOf(route);
  console.log(`[${id}] bbox ${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`);
  const query = `[out:json][timeout:180];
    (way["building"](${s},${w},${n},${e});
     relation["building"]["type"="multipolygon"](${s},${w},${n},${e}););
    out tags;
    >;
    out skel qt;`;
  const data = await overpass(query);

  const nodes = new Map();
  for (const el of data.elements) if (el.type === 'node') nodes.set(el.id, el);

  const lat0 = (s + n) / 2;
  const mLat = 110574;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const out = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes || !el.tags?.building) continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (pts.length < 4) continue;
    const rect = minAreaRect(toMeters(pts, lat0));
    if (!rect || rect.w < 3 || rect.h < 3) continue;
    // 장축이 w 가 되도록 정렬
    let ww = rect.w;
    let dd = rect.h;
    let ux = rect.ux;
    let uy = rect.uy;
    if (dd > ww) {
      [ww, dd] = [dd, ww];
      [ux, uy] = [-uy, ux];
    }
    const h = heightOf(el.tags);
    out.push({
      lat: +(rect.cy / mLat).toFixed(6),
      lon: +(rect.cx / mLon).toFixed(6),
      w: +ww.toFixed(1),
      d: +dd.toFixed(1),
      // 방위각: 정북 0, 동 90 (게임 좌표계와 동일)
      rot: +(((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360).toFixed(1),
      h: +h.toFixed(1),
      floors: Math.max(1, Math.round(h / 3.1)),
      kind: kindOf(el.tags),
    });
  }
  console.log(`[${id}] 건물 ${out.length}동`);
  return out;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = only.length ? only : Object.keys(STAGE_ROUTES);
  await mkdir(OUT_DIR, { recursive: true });

  const written = [];
  for (const id of ids) {
    const route = STAGE_ROUTES[id];
    if (!route) {
      console.error(`알 수 없는 스테이지: ${id}`);
      continue;
    }
    try {
      const fps = await fetchStage(id, route);
      if (!fps.length) continue;
      await writeFile(join(OUT_DIR, `${id}.json`), JSON.stringify(fps), 'utf8');
      written.push(id);
    } catch (err) {
      console.error(`[${id}] 실패: ${err.message}`);
    }
  }

  if (!written.length) {
    console.error('\n받아온 데이터가 없습니다. 기존 생성기가 그대로 쓰입니다.');
    process.exitCode = 1;
    return;
  }

  const index = `/**
 * 자동 생성 파일 — 직접 수정하지 마세요. \`npm run fetch:osm\` 으로 다시 만듭니다.
 * 출처: OpenStreetMap contributors (ODbL 1.0)
 */
export type { Footprint } from './types';
import type { Footprint } from './types';
${written.map((id) => `import ${id} from './${id}.json';`).join('\n')}

export const OSM_FOOTPRINTS: Record<string, Footprint[]> = {
${written.map((id) => `  ${id}: ${id} as Footprint[],`).join('\n')}
};
`;
  await writeFile(join(OUT_DIR, 'index.ts'), index, 'utf8');
  console.log(`\n완료: ${written.join(', ')}`);
}

await main();
