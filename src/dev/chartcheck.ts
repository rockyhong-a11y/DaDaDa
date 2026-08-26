import { STAGES } from '../data/stages';
import { City } from '../world/citygen';
import { buildChart, swingPoint, type Vec3 } from '../game/chart';

const tmp: Vec3 = { x: 0, y: 0, z: 0 };
for (const s of STAGES) {
  const city = new City(s);
  const c = buildChart(city);
  const hops = c.segments.map((g) => Math.hypot(g.to.x - g.from.x, g.to.z - g.from.z));
  const ys = c.segments.map((g) => g.from.y);
  const ropes = c.segments.map((g) => Math.hypot(g.anchor.x - g.from.x, g.anchor.y - g.from.y, g.anchor.z - g.from.z));
  // 스윙 궤적이 지면 아래로 내려가지 않는지 확인
  let minClear = Infinity;
  for (const g of c.segments) {
    for (let k = 0; k <= 8; k++) {
      swingPoint(g, k / 8, tmp);
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
      `mast avg=${avg(c.segments.filter((g) => !g.finale).map((g) => g.anchor.y - g.anchorRoof)).toFixed(0)} ` +
      `clear=${minClear.toFixed(0)}m gap=${minGap.toFixed(2)}s`,
  );
}

// 관통 검사: 궤적 샘플이 주변 옥상보다 낮으면 건물을 뚫는 것이다
for (const s of STAGES) {
  const city = new City(s);
  const c = buildChart(city);
  let hits = 0;
  let worst = 0;
  for (const g of c.segments) {
    if (g.finale) continue;
    for (let k = 0; k <= 10; k++) {
      swingPoint(g, k / 10, tmp);
      const pen = city.skylineAt(tmp.x, tmp.z, 22) + 4 - tmp.y;
      if (pen > 0) {
        hits++;
        worst = Math.max(worst, pen);
      }
    }
  }
  console.log(`${s.id.padEnd(9)} 관통 샘플=${hits} 최대침투=${worst.toFixed(1)}m`);
}
