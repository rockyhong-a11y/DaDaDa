import type { City, BuildingInst } from '../world/citygen';
import { RoutePath } from './route';
import { Rand } from '../world/rng';
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
 *  - hold:  구간을 지나는 동안 버튼을 계속 누르고 있어야 하는 홀드 액션.
 *  - mash:  짧은 시간 안에 여러 번 연타해야 하는 액션.
 */
export type NoteKind = 'swing' | 'air' | 'hold' | 'mash';

export interface Note {
  index: number;
  kind: NoteKind;
  /** 곡 기준 시각(초). 스윙/에어는 입력 순간, 홀드/연타는 시작 시각. */
  time: number;
  /** 곡 기준 박자 위치 */
  beat: number;
  /** 스윙 노트일 때 이 노트가 시작하는 스윙 구간의 인덱스 */
  swingIndex: number;
  /** 피날레 등반 구간 여부 */
  finale: boolean;
  /** hold 전용: 버튼을 놓아도 되는 시각(곡 기준 초) */
  holdEnd?: number;
  /** mash 전용: 연타 창이 닫히는 시각(곡 기준 초) */
  mashEnd?: number;
  /** mash 전용: 창이 닫히기 전까지 채워야 할 탭 횟수 */
  mashTarget?: number;
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
  /** 통계: 스윙/에어/홀드/연타 노트 수 */
  swingCount: number;
  airCount: number;
  holdCount: number;
  mashCount: number;
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
  const totalSwings = routeSwings + finaleSwings;
  const totalBeatSpan = totalSwings * swingBeats;

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
  const segments: SwingSegment[] = [];
  const nodePos: Vec3[] = [];
  const nodeS: number[] = [];
  for (let j = 0; j <= totalSwings; j++) {
    const t = j * swingBeats * beatDur;
    const s = Math.min(L, speed * t);
    const p = path.at(s);
    nodePos.push({ x: p.x, y: 0, z: p.z });
    nodeS.push(s);
  }

  // --- 1단계: 스카이라인만 보고 잠정 비행 고도를 잡는다 ---
  // 서울은 구간마다 층수 차이가 커서, 고도가 실제 건물 높이를 따라가야
  // 목동(40m대)과 잠실·테헤란로(100m대)가 확실히 다르게 느껴진다.
  const hop = speed * swingBeats * beatDur;
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
  const anchorCand: { b: number; roof: number; x: number; z: number }[] = [];
  for (let j = 0; j < routeSwings; j++) {
    const sMid = (nodeS[j] + nodeS[j + 1]) / 2;
    const p = path.at(sMid);
    const dir = path.dirAt(sMid);
    const side: 1 | -1 = j % 2 === 0 ? 1 : -1;
    const off = 38;
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
      side: j % 2 === 0 ? 1 : -1,
      finale: false,
    });
  }
  // 앵커 높이 확정 -> 궤적이 건물을 뚫으면 고도를 올리고 다시 계산, 를 반복한다.
  const setAnchorHeights = (): void => {
    for (let j = 0; j < routeSwings; j++) {
      segments[j].anchor.y = Math.max(anchorCand[j].roof + 6, Math.max(flight[j], flight[j + 1]) + 19);
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
    });
    prev = to;
  }

  insertActionNotes(notes, segments, routeSwings, stage);

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
    holdCount: notes.filter((n) => n.kind === 'hold').length,
    mashCount: notes.filter((n) => n.kind === 'mash').length,
    swingCount: notes.filter((n) => n.kind === 'swing').length,
    airCount: notes.filter((n) => n.kind === 'air').length,
  };
}

/**
 * 홀드·연타 액션 노트를 스윙 구간 위에 흩뿌린다.
 *
 * 스윙/에어 노트 그리드와는 완전히 독립적으로, 세그먼트 단위로 확률을 굴려
 * 배치한다. 스윙 노트는 구간 traversal 의 핵심이라 절대 건드리지 않고 피한다.
 * 에어 노트는 겹치면 액션 노트가 그 자리를 흡수한다(제거) — 그러지 않으면
 * 에어 노트가 촘촘한 고난도 스테이지(16비트 그리드)에서는 겹치지 않는 빈틈이
 * 전혀 없어 홀드·연타가 하나도 배치되지 않는다. 피날레 등반 구간
 * (routeSwings 이후)에는 넣지 않는다 — 그곳은 이미 그 자체로 클라이맥스다.
 */
function insertActionNotes(
  notes: Note[],
  segments: SwingSegment[],
  routeSwings: number,
  stage: StageDef,
): void {
  const rand = new Rand(`${stage.id}:actions`);
  const difficultyMul = 0.8 + stage.difficulty * 0.08;
  // 연타 속도는 일부러 느슨하게 잡는다 — 홀드/연타 구간은 몰아치는 스윙 사이의
  // "쉬어가는" 구간이지, 또 다른 몰아치기 구간이 아니다.
  const tapsPerSecond = 3 + stage.difficulty * 0.25;
  let cooldown = 3; // 처음 몇 스윙은 적응할 시간을 준다
  const guard = 0.05;

  for (let j = 0; j < routeSwings; j++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }
    const seg = segments[j];
    const span = seg.t1 - seg.t0;
    const roll = rand.next();
    let t0 = 0;
    let dur = 0;
    let kind: 'hold' | 'mash' | null = null;

    // 게이지를 구간 대부분에 걸쳐 길게 늘여 여유 있게 표시한다. 다만 구간
    // 자체가 짧은 촘촘한 스테이지에서는 최소 길이를 너무 높이면 홀드·연타가
    // 아예 하나도 안 나오므로, 바닥값은 예전보다 살짝만 올린다.
    if (roll < 0.14 * difficultyMul) {
      kind = 'hold';
      t0 = seg.t0 + span * 0.15;
      dur = Math.min(span * 0.75, 3.0);
      if (dur < 0.5) continue;
    } else if (roll < 0.26 * difficultyMul) {
      kind = 'mash';
      t0 = seg.t0 + span * 0.15;
      dur = Math.min(span * 0.72, 2.4);
      if (dur < 0.35) continue;
    }
    if (!kind) continue;

    // 스윙 노트와 겹치면 포기한다 — 그건 절대 흡수하지 않는다
    const blocked = notes.some((n) => n.kind === 'swing' && n.time >= t0 - guard && n.time <= t0 + dur + guard);
    if (blocked) continue;

    // 겹치는 에어 노트는 이 액션이 흡수한다 (그 자리에서 트릭 대신 홀드/연타를 한다)
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.kind === 'air' && n.time >= t0 - guard && n.time <= t0 + dur + guard) notes.splice(i, 1);
    }

    if (kind === 'hold') {
      notes.push({ index: 0, kind: 'hold', time: t0, beat: 0, swingIndex: j, finale: false, holdEnd: t0 + dur });
    } else {
      const target = Math.max(4, Math.round(dur * tapsPerSecond));
      notes.push({
        index: 0,
        kind: 'mash',
        time: t0,
        beat: 0,
        swingIndex: j,
        finale: false,
        mashEnd: t0 + dur,
        mashTarget: target,
      });
    }
    cooldown = 2 + Math.floor(rand.next() * 2);
  }

  notes.sort((a, b) => a.time - b.time);
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
      segments[j].anchor.y = Math.max(segments[j].anchorRoof + 6, Math.max(flight[j], flight[j + 1]) + 19);
    }
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
