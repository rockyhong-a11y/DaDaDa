import type { City, BuildingInst } from '../world/citygen';
import { RoutePath } from './route';
import type { RhythmPattern, StageDef } from '../data/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 노트 종류.
 *  - swing: 새 웹을 발사한다. 앵커가 바뀌고 몸이 다음 스윙 지점으로 날아간다.
 *  - air:   스윙 도중 공중에서 넣는 트릭 입력. 앵커는 그대로 두고 점수·부스트만 쌓인다.
 */
export type NoteKind = 'swing' | 'air';

export interface Note {
  index: number;
  kind: NoteKind;
  /** 곡 기준 시각(초). 입력 순간. */
  time: number;
  /** 곡 기준 박자 위치 */
  beat: number;
  /** 스윙 노트일 때 이 노트가 시작하는 스윙 구간의 인덱스 */
  swingIndex: number;
  /** 피날레 등반 구간 여부 */
  finale: boolean;
}

/** 하나의 스윙 구간: 시작점 -> 앵커에 매달려 -> 끝점 */
export interface SwingSegment {
  index: number;
  /** 구간 시작 시각(초) */
  t0: number;
  /** 구간 종료 시각(초) */
  t1: number;
  from: Vec3;
  to: Vec3;
  anchor: Vec3;
  /** 앵커가 얹힌 건물의 옥상고. 마스트를 세워 그린다. */
  anchorRoof: number;
  /** 앵커 건물 인덱스 (-1 = 지상에서 솟은 가상 철탑) */
  anchorBuilding: number;
  side: 1 | -1;
  finale: boolean;
  /**
   * 활강 구간인가. 웹을 놓고 높이 솟아올라 도시 전체를 내려다보며 미끄러지는
   * 구간으로, 스테이지마다 중간과 마지막에 하나씩 들어간다. 로프를 그리지
   * 않고 카메라도 뒤로 빠진다.
   */
  glide: boolean;
}

/** 활강 구간의 범위 (스윙 인덱스 기준, end 는 미포함) */
export interface GlideRange {
  start: number;
  end: number;
  /** 이 구간에서 도달하는 최고 고도(m) */
  apex: number;
}

export interface Chart {
  stage: StageDef;
  notes: Note[];
  segments: SwingSegment[];
  leadInBeats: number;
  totalBeats: number;
  duration: number;
  speed: number;
  finaleTower: BuildingInst;
  path: RoutePath;
  /** 통계: 스윙/에어 노트 수 */
  swingCount: number;
  airCount: number;
  /** 활강 구간 두 곳 (중간 · 마무리) */
  glides: GlideRange[];
}

const BASE_SPEED = 27; // m/s
const LEAD_IN_BEATS = 16;

function expandRhythm(r: RhythmPattern, count: number): number[] {
  const beats: number[] = [];
  let b = 0;
  let loop = 0;
  while (beats.length < count) {
    const useVar = r.variation && r.variationEvery && loop % r.variationEvery === r.variationEvery - 1;
    const steps = useVar ? r.variation! : r.steps;
    for (const st of steps) {
      beats.push(b);
      b += st;
      if (beats.length >= count) break;
    }
    loop++;
  }
  return beats;
}

export function buildChart(city: City): Chart {
  const stage = city.stage;
  const path = new RoutePath(city);
  const beatDur = 60 / stage.bpm;
  const L = path.length;
  const swingBeats = stage.swingBeats ?? 2;

  const tower = findFinaleTower(city);
  const towerTop = tower.base + tower.height;

  // 등반 시작 고도: 타워 자체를 빼고 본 접근부 스카이라인
  const approach = path.at(Math.max(0, L - 260));
  const approachY = Math.min(city.skylineAt(approach.x, approach.z, 150) + 14, towerTop * 0.55);
  const climb = Math.max(towerTop - approachY, 60);
  const finaleSwings = Math.max(6, Math.min(30, Math.round(climb / 26)));

  // --- 노트 박자 목록과 스윙/에어 분류 ---
  const beats = expandRhythm(stage.rhythm, 6000);
  const targetSpeed = BASE_SPEED * stage.hopScale;

  // 경로를 몇 개의 스윙으로 건널지: 목표 속도에 가장 가까운 스윙 수
  const routeSwings = Math.max(6, Math.round(L / (targetSpeed * swingBeats * beatDur)));
  const routeBeats = routeSwings * swingBeats;
  const speed = L / (routeBeats * beatDur);

  // --- 활강 구간 두 곳 ---
  // 중간: 경로 한복판에서 솟아올랐다 내려온다. 마무리: 피날레 타워 정상에서
  // 뛰어내려 도시 위를 길게 미끄러지며 끝난다.
  const midGlideLen = Math.max(4, Math.min(8, Math.round(routeSwings * 0.1)));
  const midGlideStart = Math.max(2, Math.round(routeSwings * 0.46));
  const finalGlideLen = 6;
  const totalSwings = routeSwings + finaleSwings + finalGlideLen;
  const totalBeatSpan = totalSwings * swingBeats;
  const glides: GlideRange[] = [
    { start: midGlideStart, end: midGlideStart + midGlideLen, apex: 0 },
    { start: routeSwings + finaleSwings, end: totalSwings, apex: 0 },
  ];
  const inGlide = (j: number): GlideRange | null =>
    glides.find((g) => j >= g.start && j < g.end) ?? null;

  const notes: Note[] = [];
  let nextSwingBeat = 0;
  let swingIdx = -1;
  for (const b of beats) {
    if (b > totalBeatSpan - 1e-6) break;
    let kind: NoteKind = 'air';
    if (b >= nextSwingBeat - 1e-6) {
      kind = 'swing';
      swingIdx++;
      nextSwingBeat += swingBeats;
    }
    // 활강 중에는 걸 웹이 없다. 진입하는 첫 스윙(도약)만 남기고 나머지
    // 스윙 노트는 공중 트릭으로 바꾼다 — 미끄러지며 묘기를 넣는 구간이 된다.
    const g = inGlide(swingIdx);
    if (kind === 'swing' && g && swingIdx !== g.start) kind = 'air';
    notes.push({
      index: notes.length,
      kind,
      time: b * beatDur,
      beat: b,
      swingIndex: swingIdx,
      finale: swingIdx >= routeSwings,
    });
  }
  // 마지막 스윙의 도착 노트를 반드시 하나 둔다 (정상 착지)
  if (notes[notes.length - 1].beat < totalBeatSpan - 1e-6) {
    notes.push({
      index: notes.length,
      kind: 'swing',
      time: totalBeatSpan * beatDur,
      beat: totalBeatSpan,
      swingIndex: totalSwings,
      finale: true,
    });
  }

  // --- 스윙 구간의 시작/끝 지점 (경로 구간) ---
  //
  // 착지점을 경로 중심선 위에 그대로 두면 앵커만 좌우로 살짝 바뀔 뿐 몸은
  // 정면으로만 나아가 밋밋하다. 노드 자체를 중심선 좌우로 번갈아 밀어 두면
  // 매 스윙이 왼쪽 끝 → 오른쪽 끝을 가로지르며 실제로 좌우를 오가게 된다.
  const hopDist = speed * swingBeats * beatDur;
  const sway = Math.min(82, hopDist * 0.52);
  const segments: SwingSegment[] = [];
  const nodePos: Vec3[] = [];
  const nodeS: number[] = [];
  for (let j = 0; j <= totalSwings; j++) {
    const t = j * swingBeats * beatDur;
    const s = Math.min(L, speed * t);
    const p = path.at(s);
    const dir = path.dirAt(s);
    // 피날레 진입점(j === routeSwings)은 중심선으로 되돌려 타워 나선과 매끄럽게 잇는다
    const lat = j >= routeSwings ? 0 : (j % 2 === 0 ? 1 : -1) * sway;
    nodePos.push({ x: p.x + -dir.z * lat, y: 0, z: p.z + dir.x * lat });
    nodeS.push(s);
  }

  // --- 1단계: 스카이라인만 보고 잠정 비행 고도를 잡는다 ---
  // 서울은 구간마다 층수 차이가 커서, 고도가 실제 건물 높이를 따라가야
  // 목동(40m대)과 잠실·테헤란로(100m대)가 확실히 다르게 느껴진다.
  const hop = hopDist;
  const maxStep = hop * 0.55 + 8;
  const flight: number[] = new Array(routeSwings + 1).fill(0);
  for (let j = 0; j <= routeSwings; j++) {
    const p = nodePos[j];
    const sky = city.skylineAt(p.x, p.z, 170);
    flight[j] = Math.max(city.groundAt(p.x, p.z) + 30, sky + 12);
  }
  smoothInPlace(flight, routeSwings + 1, 3);
  for (let j = 1; j <= routeSwings; j++) {
    flight[j] = Math.max(flight[j - 1] - maxStep * 1.5, Math.min(flight[j - 1] + maxStep, flight[j]));
  }

  // --- 2단계: 잠정 고도에 어울리는 옥상을 앵커로 고른다 ---
  // 앵커는 이번 스윙이 향하는 쪽(도착 노드가 있는 쪽) 바깥에 건다 — 그쪽으로
  // 몸을 끌어당기며 감아 도는 모양이 되어 좌우 전환이 눈에 확실히 들어온다.
  const anchorSideOf = (j: number): 1 | -1 => ((j + 1) % 2 === 0 ? 1 : -1);
  const anchorCand: { b: number; roof: number; x: number; z: number }[] = [];
  for (let j = 0; j < routeSwings; j++) {
    const sMid = (nodeS[j] + nodeS[j + 1]) / 2;
    const p = path.at(sMid);
    const dir = path.dirAt(sMid);
    const side = anchorSideOf(j);
    const off = sway * 1.1 + 34;
    const cx = p.x + -dir.z * off * side;
    const cz = p.z + dir.x * off * side;
    const target = Math.max(flight[j], flight[j + 1]) + 30;
    const found = pickAnchor(city, cx, cz, 120, target);
    anchorCand.push(found ?? { b: -1, roof: city.groundAt(cx, cz) + 34, x: cx, z: cz });
  }

  // --- 3단계: 앵커가 감당 못 할 만큼 높이 날지는 않는다 ---
  for (let j = 0; j <= routeSwings; j++) {
    const capPrev = j > 0 ? anchorCand[j - 1].roof + 6 : Infinity;
    const capCur = j < routeSwings ? anchorCand[j].roof + 6 : Infinity;
    flight[j] = Math.min(flight[j], capPrev, capCur);
  }
  smoothInPlace(flight, routeSwings + 1, 1);
  for (let j = 1; j <= routeSwings; j++) {
    flight[j] = Math.max(flight[j - 1] - maxStep * 1.5, Math.min(flight[j - 1] + maxStep, flight[j]));
  }
  for (let j = 0; j <= routeSwings; j++) {
    const p = nodePos[j];
    flight[j] = Math.max(city.groundAt(p.x, p.z) + 24, flight[j]);
    p.y = flight[j];
  }

  // --- 중간 활강: 창구간 위로 크게 부풀린 종 모양 고도 곡선 ---
  // 양 끝은 원래 비행 고도에 맞춰 두고 가운데를 스카이라인 한참 위까지
  // 밀어 올려, 솟았다가 도시를 내려다보며 미끄러져 내려오게 만든다.
  {
    const g = glides[0];
    const lo = Math.min(g.start, routeSwings);
    const hi = Math.min(g.end, routeSwings);
    let ceiling = 0;
    for (let j = lo; j <= hi; j++) {
      const p = nodePos[j];
      ceiling = Math.max(ceiling, city.skylineAt(p.x, p.z, 320));
    }
    g.apex = ceiling + 210;
    const span = Math.max(1, hi - lo);
    for (let j = lo; j <= hi; j++) {
      const u = (j - lo) / span;
      // sin 종 곡선: 양 끝 0, 가운데 1
      const bell = Math.sin(Math.PI * u);
      const lift = (g.apex - flight[j]) * bell;
      if (lift > 0) {
        flight[j] += lift;
        nodePos[j].y = flight[j];
      }
    }
  }

  for (let j = 0; j < routeSwings; j++) {
    const cand = anchorCand[j];
    segments.push({
      index: j,
      t0: j * swingBeats * beatDur,
      t1: (j + 1) * swingBeats * beatDur,
      from: nodePos[j],
      to: nodePos[j + 1],
      anchor: { x: cand.x, y: 0, z: cand.z },
      anchorRoof: cand.roof,
      anchorBuilding: cand.b,
      side: anchorSideOf(j),
      finale: false,
      glide: !!inGlide(j),
    });
  }
  // 앵커 높이 확정 -> 궤적이 건물을 뚫으면 고도를 올리고 다시 계산, 를 반복한다.
  // 활강 구간은 실제 옥상에 거는 웹이 아니라 궤적을 완만하게 펴 주는 가상의
  // 높은 지지점이라, 훨씬 위에 띄워 거의 직선에 가까운 활공 곡선을 만든다.
  const setAnchorHeights = (): void => {
    for (let j = 0; j < routeSwings; j++) {
      const top = Math.max(flight[j], flight[j + 1]);
      segments[j].anchor.y = segments[j].glide
        ? top + 520
        : Math.max(anchorCand[j].roof + 6, top + 19);
    }
  };
  setAnchorHeights();
  resolveClearance(city, segments, nodePos, flight, routeSwings);
  setAnchorHeights();

  // --- 피날레: 타워를 나선으로 감아 오른다 ---
  const startNode = nodePos[routeSwings];
  const startY = startNode.y;
  const startRadius = Math.max(Math.hypot(startNode.x - tower.x, startNode.z - tower.z), 70);
  const startAngle = Math.atan2(startNode.z - tower.z, startNode.x - tower.x);
  const towerR = Math.max(tower.w, tower.d) * 0.6;
  let prev = startNode;
  for (let k = 0; k < finaleSwings; k++) {
    const j = routeSwings + k;
    const t = (k + 1) / finaleSwings;
    const ease = t * t * (3 - 2 * t);
    const y = startY + (towerTop + 6 - startY) * ease;
    const radius = k === finaleSwings - 1 ? 0 : startRadius + (towerR + 22 - startRadius) * Math.pow(t, 0.65);
    const angle = startAngle + t * Math.PI * 1.6;
    const to: Vec3 = { x: tower.x + Math.cos(angle) * radius, y, z: tower.z + Math.sin(angle) * radius };
    // 앵커는 타워 몸통에서 조금 더 위
    const aT = Math.min(1, t + 1.4 / finaleSwings);
    const aEase = aT * aT * (3 - 2 * aT);
    const aY = Math.min(towerTop + 34, startY + (towerTop + 6 - startY) * aEase + 30);
    const aAngle = angle - 0.35;
    segments.push({
      index: j,
      t0: j * swingBeats * beatDur,
      t1: (j + 1) * swingBeats * beatDur,
      from: prev,
      to,
      anchor: { x: tower.x + Math.cos(aAngle) * towerR * 0.95, y: aY, z: tower.z + Math.sin(aAngle) * towerR * 0.95 },
      anchorRoof: aY,
      anchorBuilding: -1,
      side: k % 2 === 0 ? 1 : -1,
      finale: true,
      glide: false,
    });
    prev = to;
  }
  // 피날레 나선 구간은 routeSwings 구간과 달리 관통 검사를 한 번도 안 거쳤다 —
  // 타워 자체나 그 주변 건물을 그대로 뚫고 지나가는 버그의 원인이었다.
  resolveFinaleClearance(city, segments, routeSwings, finaleSwings);

  // --- 마무리 활강: 정상에서 몸을 던져 도시 위를 길게 미끄러진다 ---
  // 타워 꼭대기에서 진행 방향으로 크게 호를 그리며 내려오는 구간. 스테이지의
  // 마지막 인상이 "가장 높은 곳에서 서울 전체를 내려다보는 장면"이 된다.
  {
    const g = glides[1];
    const summit = prev;
    g.apex = summit.y + 120;
    // 경로 마지막 진행 방향으로 뻗어 나간다 (타워를 등지고 바깥으로)
    const away = Math.atan2(summit.z - tower.z, summit.x - tower.x);
    const glideSpan = hopDist * 2.1;
    let gPrev = summit;
    for (let k = 0; k < finalGlideLen; k++) {
      const j = routeSwings + finaleSwings + k;
      const t = (k + 1) / finalGlideLen;
      const dist = glideSpan * (k + 1);
      const x = summit.x + Math.cos(away) * dist;
      const z = summit.z + Math.sin(away) * dist;
      // 처음엔 살짝 더 솟았다가(도약) 완만하게 활강해 내려온다
      const rise = Math.sin(Math.PI * Math.min(1, t * 1.25)) * 90;
      const fall = Math.pow(t, 1.6) * (summit.y - (city.skylineAt(x, z, 260) + 70));
      const y = Math.max(city.skylineAt(x, z, 200) + 46, summit.y + rise - fall);
      const to: Vec3 = { x, y, z };
      segments.push({
        index: j,
        t0: j * swingBeats * beatDur,
        t1: (j + 1) * swingBeats * beatDur,
        from: gPrev,
        to,
        // 활강이라 실제 웹이 아니다 — 궤적을 완만하게 펴 주는 가상의 지지점
        anchor: { x: (gPrev.x + x) / 2, y: Math.max(gPrev.y, y) + 560, z: (gPrev.z + z) / 2 },
        anchorRoof: 0,
        anchorBuilding: -1,
        side: k % 2 === 0 ? 1 : -1,
        finale: true,
        glide: true,
      });
      gPrev = to;
    }
  }

  balanceTouchDensity(notes, stage);

  const tailBeats = 8;
  const totalBeats = Math.ceil((totalBeatSpan + tailBeats) / 4) * 4;

  return {
    stage,
    notes,
    segments,
    leadInBeats: LEAD_IN_BEATS,
    totalBeats,
    duration: totalBeats * beatDur,
    speed,
    finaleTower: tower,
    path,
    swingCount: notes.filter((n) => n.kind === 'swing').length,
    airCount: notes.filter((n) => n.kind === 'air').length,
    glides,
  };
}

/**
 * 터치 노트(스윙+에어) 밀도를 실제 등장 속도(초 단위 간격)에 맞춰 손본다.
 * 리듬 패턴(steps)만 보고 그리드를 그대로 다 채우면, 고 BPM · 촘촘한
 * 스텝(0.5박)을 쓰는 고난도 스테이지에서는 노트가 숨 돌릴 틈 없이
 * 계속 몰아쳐 나올 수 있다. 최소 간격보다 좁게 몰린 에어 노트가 일정
 * 개수 이상 연속되면 하나씩 솎아내 리듬 골격은 유지하되 손이 잠깐씩
 * 쉴 틈을 준다. 스윙 노트는 경로 이동의 핵심이라 절대 솎아내지 않는다.
 */
function balanceTouchDensity(notes: Note[], stage: StageDef): void {
  // 난이도(=템포)가 높을수록 좁은 간격을 더 봐주지만, 최소한의 여유는 남긴다.
  const minGap = Math.max(0.15, 0.34 - stage.difficulty * 0.028);
  // 이 개수 이상 좁은 간격으로 계속 이어지면 한 번은 걸러낸다.
  const maxRun = Math.max(3, 9 - stage.difficulty);

  let run = 0;
  let lastTime = -Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.kind !== 'air') {
      run = 0;
      lastTime = n.time;
      continue;
    }
    const gap = n.time - lastTime;
    if (gap >= minGap) {
      run = 0;
      lastTime = n.time;
      continue;
    }
    run++;
    if (run > maxRun) {
      // lastTime 은 갱신하지 않는다 — 다음 노트는 더 벌어진 간격을 기준으로 재평가된다.
      notes.splice(i, 1);
      i--;
      run = 0;
      continue;
    }
    lastTime = n.time;
  }

  notes.forEach((n, i) => {
    n.index = i;
  });
}

/**
 * 스윙 궤적이 건물을 관통하지 않도록 고도를 밀어 올린다.
 * 궤적을 샘플링해 반경 안 최고 옥상보다 낮은 지점이 있으면
 * 해당 구간 양끝 고도를 올리고, 이웃 구간과 다시 어우러지도록 몇 번 반복한다.
 */
function resolveClearance(
  city: City,
  segments: SwingSegment[],
  nodePos: Vec3[],
  flight: number[],
  routeSwings: number,
): void {
  const CLEAR = 11; // 옥상 위 최소 여유(m)
  const PROBE = 24; // 몸 주변 충돌 반경(m)
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  for (let pass = 0; pass < 5; pass++) {
    let worst = 0;
    const raise = new Array(routeSwings + 1).fill(0);
    for (let j = 0; j < routeSwings; j++) {
      const seg = segments[j];
      let need = 0;
      for (let k = 0; k <= 10; k++) {
        swingPoint(seg, k / 10, tmp);
        const top = city.skylineAt(tmp.x, tmp.z, PROBE) + CLEAR;
        if (top > tmp.y) need = Math.max(need, top - tmp.y);
      }
      if (need > 0) {
        raise[j] = Math.max(raise[j], need);
        raise[j + 1] = Math.max(raise[j + 1], need);
        worst = Math.max(worst, need);
      }
    }
    if (worst < 0.5) break;
    for (let j = 0; j <= routeSwings; j++) {
      if (raise[j] <= 0) continue;
      flight[j] += raise[j];
      nodePos[j].y = flight[j];
    }
    // 급격한 계단이 생기지 않게 살짝 평활화 (올리는 방향으로만)
    for (let j = 1; j < routeSwings; j++) {
      const avg = (flight[j - 1] + flight[j + 1]) / 2;
      if (avg > flight[j]) {
        flight[j] = flight[j] * 0.5 + avg * 0.5;
        nodePos[j].y = flight[j];
      }
    }
    for (let j = 0; j < routeSwings; j++) {
      const top = Math.max(flight[j], flight[j + 1]);
      segments[j].anchor.y = segments[j].glide ? top + 520 : Math.max(segments[j].anchorRoof + 6, top + 19);
    }
  }
}

/**
 * 피날레 나선 구간(타워를 감아 오르는 구간)의 관통을 막는다.
 * routeSwings 구간과 같은 방식으로 궤적을 샘플링해 검사하지만, 이쪽은
 * 도착 지점이 고정 경유점이 아니라 매 구간 새로 계산되는 나선이라 접근이
 * 다르다 — 부족한 만큼 그 구간의 시작·도착 고도(양끝)와 앵커 고도를 그대로
 * 밀어 올린다. 시작 고도(from)는 이전 구간의 도착 고도와 같은 좌표
 * 객체를 공유하므로, 첫 구간에서 밀어 올리면 route 구간 마지막 착지점까지
 * 자동으로 반영된다 — 실제로 침투가 가장 먼저 발생하는 지점이 바로 거기다
 * (평지 고도에서 타워 쪽으로 급격히 붙는 첫 도약). 오르는 구간이라 고도를
 * 더 올리는 것 자체가 자연스럽고, 몇 차례 반복해 수렴시킨다.
 */
function resolveFinaleClearance(
  city: City,
  segments: SwingSegment[],
  routeSwings: number,
  finaleSwings: number,
): void {
  const CLEAR = 11;
  const PROBE = 22;
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  for (let pass = 0; pass < 6; pass++) {
    let worst = 0;
    for (let k = 0; k < finaleSwings; k++) {
      const seg = segments[routeSwings + k];
      let need = 0;
      for (let s = 0; s <= 10; s++) {
        swingPoint(seg, s / 10, tmp);
        const top = city.skylineAt(tmp.x, tmp.z, PROBE) + CLEAR;
        if (top > tmp.y) need = Math.max(need, top - tmp.y);
      }
      if (need > 0) {
        seg.from.y += need;
        seg.to.y += need;
        seg.anchor.y += need;
        worst = Math.max(worst, need);
      }
    }
    if (worst < 0.5) break;
  }
}

/**
 * 앵커로 쓸 옥상 고르기.
 * 목표 높이(target)에 가깝고 탐색 중심에서 가까운 옥상을 선호한다.
 * 목표보다 낮은 건물은 웹을 걸 수 없으니 더 크게 감점한다.
 */
function pickAnchor(
  city: City,
  x: number,
  z: number,
  radius: number,
  target: number,
): { b: number; roof: number; x: number; z: number } | null {
  const ids = city.query(x, z, radius);
  let best: { b: number; roof: number; x: number; z: number } | null = null;
  let bestScore = -Infinity;
  for (const i of ids) {
    const b = city.buildings[i];
    const roof = b.base + b.height;
    const dist = Math.hypot(b.x - x, b.z - z);
    const diff = roof - target;
    const heightPenalty = diff >= 0 ? diff * 0.35 : -diff * 1.6;
    const score = -heightPenalty - dist * 0.55;
    if (score > bestScore) {
      bestScore = score;
      best = { b: i, roof, x: b.x, z: b.z };
    }
  }
  return best;
}

function smoothInPlace(arr: number[], n: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const copy = arr.slice(0, n);
    for (let i = 1; i < n - 1; i++) {
      arr[i] = copy[i - 1] * 0.25 + copy[i] * 0.5 + copy[i + 1] * 0.25;
    }
  }
}

function findFinaleTower(city: City): BuildingInst {
  const named = city.buildings.find((b) => b.kind === 'landmark' && b.name === city.stage.finale);
  if (named) return named;
  const end = city.stage.route[city.stage.route.length - 1];
  const p = city.proj.toLocal(end.lat, end.lon);
  let best = city.buildings[0];
  let bestScore = -Infinity;
  for (const b of city.buildings) {
    if (b.kind !== 'landmark') continue;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    const score = b.base + b.height - d * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

/**
 * 스윙 구간 안에서의 위치.
 * 앵커를 중심으로 시작점과 끝점을 구면 보간해 진자 궤적을 만든다.
 * 줄 길이를 함께 보간하므로 웹을 감았다 푸는 느낌이 난다.
 */
export function swingPoint(seg: SwingSegment, t: number, out: Vec3): Vec3 {
  const ax = seg.anchor.x;
  const ay = seg.anchor.y;
  const az = seg.anchor.z;
  let sx = seg.from.x - ax;
  let sy = seg.from.y - ay;
  let sz = seg.from.z - az;
  let ex = seg.to.x - ax;
  let ey = seg.to.y - ay;
  let ez = seg.to.z - az;
  const rs = Math.hypot(sx, sy, sz) || 1;
  const re = Math.hypot(ex, ey, ez) || 1;
  sx /= rs;
  sy /= rs;
  sz /= rs;
  ex /= re;
  ey /= re;
  ez /= re;
  let dot = sx * ex + sy * ey + sz * ez;
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  const r = rs + (re - rs) * t;
  let ux: number;
  let uy: number;
  let uz: number;
  if (omega < 1e-4) {
    ux = sx + (ex - sx) * t;
    uy = sy + (ey - sy) * t;
    uz = sz + (ez - sz) * t;
  } else {
    const sinO = Math.sin(omega);
    const a = Math.sin((1 - t) * omega) / sinO;
    const b = Math.sin(t * omega) / sinO;
    ux = sx * a + ex * b;
    uy = sy * a + ey * b;
    uz = sz * a + ez * b;
  }
  const ul = Math.hypot(ux, uy, uz) || 1;
  out.x = ax + (ux / ul) * r;
  out.y = ay + (uy / ul) * r;
  out.z = az + (uz / ul) * r;
  return out;
}

/** 이음매를 뭉개는 구간 폭(각 구간 길이의 비율). */
const JOINT_BLEND = 0.26;

const blendTmp: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * 이음매를 부드럽게 이은 스윙 위치.
 *
 * 구간마다 독립적으로 구면 보간하면 위치는 이어지지만 **속도 방향이 노드마다
 * 꺾인다**(C0 만 연속). 스파이더맨처럼 좌우로 흘러가는 느낌이 나려면 이음매에서
 * 방향까지 이어져야 해서, 노드 근처에서는 이웃 구간의 궤적을 t<0 / t>1 로
 * 외삽해 겹쳐 섞는다. 두 궤적 모두 노드를 정확히 지나므로 위치는 그대로고
 * 접선만 평균 나 코너가 사라진다.
 *
 * 이 블렌딩은 노드 도착 시각을 살짝 흐트러뜨리지만, 판정은 곡 시간축 위의
 * 노트가 담당하고 이 함수는 "몸이 어디 있는가"만 그리므로 문제되지 않는다.
 */
export function swingPointSmooth(segs: SwingSegment[], index: number, t: number, out: Vec3): Vec3 {
  const seg = segs[index];
  swingPoint(seg, t, out);
  const span = seg.t1 - seg.t0 || 1;

  if (t < JOINT_BLEND && index > 0) {
    const prev = segs[index - 1];
    // 같은 절대 시각을 이전 구간의 파라미터로 환산 (1 을 넘어가는 외삽)
    const pSpan = prev.t1 - prev.t0 || 1;
    const pt = (seg.t0 + t * span - prev.t0) / pSpan;
    swingPoint(prev, pt, blendTmp);
    // 노드에서 0.5 → 블렌드 끝에서 0 으로 떨어지는 가중치
    const k = t / JOINT_BLEND;
    const w = 0.5 * (1 - k * k * (3 - 2 * k));
    out.x += (blendTmp.x - out.x) * w;
    out.y += (blendTmp.y - out.y) * w;
    out.z += (blendTmp.z - out.z) * w;
  } else if (t > 1 - JOINT_BLEND && index < segs.length - 1) {
    const next = segs[index + 1];
    const nSpan = next.t1 - next.t0 || 1;
    const nt = (seg.t0 + t * span - next.t0) / nSpan; // 0 보다 작은 외삽
    swingPoint(next, nt, blendTmp);
    const k = (1 - t) / JOINT_BLEND;
    const w = 0.5 * (1 - k * k * (3 - 2 * k));
    out.x += (blendTmp.x - out.x) * w;
    out.y += (blendTmp.y - out.y) * w;
    out.z += (blendTmp.z - out.z) * w;
  }
  return out;
}
