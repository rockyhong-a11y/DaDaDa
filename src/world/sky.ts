import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { SkyPreset } from './palette';
import { Rand } from './rng';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uCityGlow;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // 지평선을 중심으로 상하 그라디언트
    float up = clamp(h, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
    float down = clamp(-h, 0.0, 1.0);
    col = mix(col, uGround, pow(down, 0.45));
    // 지평선 근처 도시 광공해
    float glow = exp(-abs(h) * 26.0) * 0.85 + exp(-abs(h) * 7.0) * 0.25;
    col += uCityGlow * glow * 0.5;
    // 태양/달
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, uSunSize) * 1.6;
    col += uSunColor * pow(sd, 6.0) * 0.16;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  readonly mesh: Mesh;
  readonly stars: Points;
  private readonly mat: ShaderMaterial;

  constructor(preset: SkyPreset, radius = 24000) {
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: preset.zenith },
        uHorizon: { value: preset.horizon },
        uGround: { value: preset.ground },
        uCityGlow: { value: preset.cityGlow },
        uSunDir: { value: new Vector3(...preset.sunDir).normalize() },
        uSunColor: { value: preset.sunColor },
        uSunSize: { value: 900 },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 32, 20), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    this.stars = Sky.makeStars(radius * 0.94, preset.starIntensity);
  }

  private static makeStars(radius: number, intensity: number): Points {
    const count = intensity > 0 ? 1400 : 0;
    const pos = new Float32Array(count * 3);
    const rand = new Rand('stars');
    for (let i = 0; i < count; i++) {
      // 상반구에만 배치
      const u = rand.range(-1, 1);
      const phi = rand.range(0, Math.PI * 2);
      const y = Math.abs(u) * 0.95 + 0.05;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(phi) * r * radius;
      pos[i * 3 + 1] = y * radius;
      pos[i * 3 + 2] = Math.sin(phi) * r * radius;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new PointsMaterial({
      size: radius * 0.0016,
      sizeAttenuation: true,
      color: 0xdfe8ff,
      transparent: true,
      opacity: Math.min(1, intensity),
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    const p = new Points(geo, mat);
    p.frustumCulled = false;
    p.renderOrder = -999;
    p.visible = count > 0;
    return p;
  }

  /** 카메라를 따라다니게 해 스카이돔이 무한히 멀리 있는 것처럼 보이게 한다 */
  follow(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
    this.stars.position.set(x, y, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as PointsMaterial).dispose();
  }
}
