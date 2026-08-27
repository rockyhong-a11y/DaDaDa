import { STAGES } from '../data/stages';
import { City } from '../world/citygen';
import { buildChart, swingPointSmooth, type Vec3 } from '../game/chart';

const tmp: Vec3 = { x: 0, y: 0, z: 0 };
for (const s of STAGES) {
  const city = new City(s);
  const c = buildChart(city);
  const hops = c.segments.map((g) => Math.hypot(g.to.x - g.from.x, g.to.z - g.from.z));
  const ys = c.segments.map((g) => g.from.y);
  // 활강 구간의 앵커는 실제 웹이 아니라 궤적을 펴 주는 가상 지지점이므로 통계에서 뺀다
  const ropes = c.segments
    .filter((g) => !g.glide)
    .map((g) => Math.hypot(g.anchor.x - g.from.x, g.anchor.y - g.from.y, g.anchor.z - g.from.z));
  // 스윙 궤적이 지면 아래로 내려가지 않는지 확인
  let minClear = Infinity;
  for (const g of c.segments) {
    for (let k = 0; k <= 8; k++) {
      swingPointSmooth(c.segments, g.index, k / 8, tmp);
      minClear = Math.min(minClear, tmp.y - city.groundAt(tmp.x, tmp.z));
    }
  }
  let minGap = Infinity;
  for (let i = 1; i < c.notes.length; i++) minGap = Math.min(minGap, c.notes[i].time - c.notes[i - 1].time);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(
    `${s.id.padEnd(9)} len=${Math.round(c.path.length)}m dur=${c.duration.toFixed(0)}s v=${c.speed.toFixed(1)} ` +
      `notes=${c.notes.length}(sw ${c.swingCount}/air ${c.airCount}) segs=${c.segments.length} ` +
      `hop avg=${avg(hops).toFixed(0)} max=${Math.max(...hops).toFixed(0)} rope avg=${avg(ropes).toFixed(0)} max=${Math.max(...ropes).toFixed(0)} ` +
      `alt ${Math.round(Math.min(...ys))}/${Math.round(avg(ys))}/${Math.round(Math.max(...c.segments.map((g) => g.to.y)))} ` +
      `mast avg=${avg(c.segments.filter((g) => !g.finale && !g.glide).map((g) => g.anchor.y - g.anchorRoof)).toFixed(0)} ` +
      `clear=${minClear.toFixed(0)}m gap=${minGap.toFixed(2)}s`,
  );
  // 활강 구간: 위치·최고 고도·평균 스카이라인 대비 여유
  const gsegs = c.segments.filter((g) => g.glide);
  const peaks = c.glides.map((g, i) => {
    const segs = c.segments.filter((x) => x.index >= g.start && x.index < g.end);
    const top = Math.max(...segs.flatMap((x) => [x.from.y, x.to.y]));
    const sky = Math.max(...segs.map((x) => city.skylineAt(x.to.x, x.to.z, 300)));
    return `#${i + 1} seg${g.start}~${g.end} 정점=${Math.round(top)}m 주변최고=${Math.round(sky)}m 여유=${Math.round(top - sky)}m`;
  });
  console.log(`  활강 ${gsegs.length}구간 · ${peaks.join(' | ')}`);
}

// 관통 검사: 궤적 샘플이 주변 옥상보다 낮으면 건물을 뚫는 것이다 (경로/피날레 둘 다)
for (const s of STAGES) {
  const city = new City(s);
  const c = buildChart(city);
  let hits = 0;
  let worst = 0;
  let finaleHits = 0;
  let finaleWorst = 0;
  for (const g of c.segments) {
    for (let k = 0; k <= 10; k++) {
      swingPointSmooth(c.segments, g.index, k / 10, tmp);
      const pen = city.skylineAt(tmp.x, tmp.z, 22) + 4 - tmp.y;
      if (pen > 0) {
        if (g.finale) {
          finaleHits++;
          finaleWorst = Math.max(finaleWorst, pen);
        } else {
          hits++;
          worst = Math.max(worst, pen);
        }
      }
    }
  }
  console.log(
    `${s.id.padEnd(9)} 관통 샘플=${hits} 최대침투=${worst.toFixed(1)}m ` +
      `피날레 관통=${finaleHits} 피날레최대침투=${finaleWorst.toFixed(1)}m`,
  );
}
