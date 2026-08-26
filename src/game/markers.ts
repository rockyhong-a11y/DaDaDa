import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

/**
 * 3D 히트 파티클.
 * 노트 타이밍 자체는 화면 중앙의 2D 리티클(HUD)이 전담한다 — 예전에는 이
 * 클래스가 다가오는 앵커/에어/홀드/연타를 3D 공간의 링으로도 미리 보여
 * 줬지만, 그 링이 웹 로프와 같은 자리에 겹쳐 오히려 잘 안 보인다는 피드백
 * 때문에 걷어냈다. 여기 남은 건 판정 순간 터지는 파티클 팝뿐이다.
 */
export class NoteMarkers {
  readonly group = new Group();
  private readonly burst: Burst;

  constructor() {
    this.burst = new Burst();
    this.group.add(this.burst.points);
  }

  update(): void {
    this.burst.update();
  }

  pop(pos: Vector3, color: number, power: number): void {
    this.burst.emit(pos, color, power);
  }

  dispose(): void {
    this.burst.dispose();
  }
}

/** 판정 시 터지는 파티클 */
class Burst {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;
  private readonly max = 520;
  private cursor = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly col: Float32Array;

  constructor() {
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.col = new Float32Array(this.max * 3);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new BufferAttribute(this.life, 1));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute vec3 aColor;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vLife = aLife;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(560.0 / max(-mv.z, 1.0), 2.5, 38.0) * (0.5 + aLife * 0.7);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          if (vLife <= 0.001) discard;
          vec2 d = gl_PointCoord - 0.5;
          float a = 1.0 - smoothstep(0.1, 0.5, length(d));
          // 터지는 순간(수명 초반)은 하얗게 확 밝았다가 색이 드러나며 잦아든다
          vec3 col = mix(vColor, vec3(1.0), smoothstep(0.55, 1.0, vLife) * 0.6);
          gl_FragColor = vec4(col, a * vLife * 0.65);
        }
      `,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(p: Vector3, color: number, power: number): void {
    const c = new Color(color);
    // 팡 터지는 느낌을 위해 두 겹으로 쏜다: 빠르게 퍼지는 바깥 스파크 + 느리게 흩어지는 안쪽 잔불
    const nBurst = Math.round(16 + power * 34);
    for (let i = 0; i < nBurst; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;
      const sp = (4 + Math.random() * 15) * (0.7 + power);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      this.vel[k * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[k * 3 + 1] = Math.cos(ph) * sp * 0.7 + 2.5;
      this.vel[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.life[k] = 1;
      this.col[k * 3] = c.r;
      this.col[k * 3 + 1] = c.g;
      this.col[k * 3 + 2] = c.b;
    }
    const nEmber = Math.round(6 + power * 14);
    for (let i = 0; i < nEmber; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;
      const sp = (1 + Math.random() * 3.5) * (0.6 + power);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      this.vel[k * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[k * 3 + 1] = Math.cos(ph) * sp * 0.5 + 1.2;
      this.vel[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.life[k] = 1;
      this.col[k * 3] = Math.min(1, c.r + 0.25);
      this.col[k * 3 + 1] = Math.min(1, c.g + 0.25);
      this.col[k * 3 + 2] = Math.min(1, c.b + 0.25);
    }
  }

  update(): void {
    const dt = 1 / 60;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.5;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 14 * dt;
    }
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
