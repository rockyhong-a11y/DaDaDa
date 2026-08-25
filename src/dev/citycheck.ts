import { STAGES } from '../data/stages';
import { City } from '../world/citygen';

/** 개발용 통계 점검 스크립트 (`node --experimental-strip-types src/dev/citycheck.ts`) */
for (const s of STAGES) {
  const city = new City(s);
  const hs = city.buildings.map((b) => b.base + b.height).sort((a, b) => a - b);
  const p = (q: number) => Math.round(hs[Math.floor(hs.length * q)]);
  console.log(
    `${s.id.padEnd(9)} bldgs=${String(city.buildings.length).padStart(5)} ` +
      `roof p10=${p(0.1)} p50=${p(0.5)} p90=${p(0.9)} max=${Math.round(hs[hs.length - 1])} ` +
      `water=${city.waters.length} park=${city.parks.length} hills=${city.hills.length}`,
  );
}
