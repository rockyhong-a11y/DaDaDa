import { STAGES } from '../data/stages';
import { City } from '../world/citygen';
import { buildChart } from '../game/chart';

/** 개발용: 경로를 따라가며 어떤 구역/랜드마크 이름이 뜨는지 미리 훑어본다. */
for (const s of STAGES) {
  const city = new City(s);
  const chart = buildChart(city);
  console.log(`\n=== ${s.id} (zones=${city.zones.length}) ===`);
  const seen = new Set<string>();
  let last: string | null = null;
  for (const seg of chart.segments) {
    if (seg.finale) continue;
    const z = city.zoneAt(seg.from.x, seg.from.z);
    if (z !== last) {
      last = z;
      if (z && !seen.has(z)) {
        seen.add(z);
        console.log('  place:', z);
      }
    }
  }
  const landmarks = city.buildings.filter((b) => b.kind === 'landmark');
  let announced = 0;
  for (const b of landmarks) {
    // 대략적인 근접 반경 추정(간단 체크용): 스윙 구간이 랜드마크 반경 안을 지나는지
    const r = Math.max(b.w, b.d) * 0.7 + 260;
    const hit = chart.segments.some((seg) => {
      if (seg.finale) return false;
      const dx = seg.from.x - b.x;
      const dz = seg.from.z - b.z;
      return dx * dx + dz * dz <= r * r;
    });
    if (hit) announced++;
  }
  console.log(`  landmark callouts likely: ${announced}/${landmarks.length}`);
}
