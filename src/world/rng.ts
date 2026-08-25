/** 결정적 난수 생성기 (mulberry32). 같은 시드면 항상 같은 도시가 나온다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rand {
  private r: () => number;
  constructor(seed: number | string) {
    this.r = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  }
  next(): number {
    return this.r();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.r();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.r() * arr.length) % arr.length];
  }
  chance(p: number): boolean {
    return this.r() < p;
  }
  /** 0을 중심으로 몰린 분포 (-1..1) */
  bell(): number {
    return (this.r() + this.r() + this.r()) / 1.5 - 1;
  }
}
