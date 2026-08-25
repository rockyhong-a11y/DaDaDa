import {
  BufferAttribute,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { City } from './citygen';
import type { SkyPreset } from './palette';
import { DEG2RAD } from './geo';

const COMMON_FOG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 col, float dist, float height) {
    float fog = 1.0 - exp(-uFogDensity * dist);
    fog *= clamp(1.0 - (height - 40.0) / 900.0, 0.25, 1.0);
    return mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  }
`;

/**
 * 지면. 지형 기복을 반영한 격자 메시 위에 가로등·도로 불빛을 그린다.
 */
export class Ground {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor(city: City, preset: SkyPreset, size = 11000, segments = 200) {
    const geo = new PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as BufferAttribute;
    // 스테이지 경로 중앙으로 옮긴 뒤 지형 높이를 입힌다
    const c = center(city);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + c.x;
      const z = pos.getZ(i) + c.z;
      pos.setX(i, x);
      pos.setZ(i, z);
      pos.setY(i, city.groundAt(x, z));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const bearing = mainBearing(city) * DEG2RAD;
    this.mat = new ShaderMaterial({
      uniforms: {
        uBase: { value: preset.ground },
        uGlow: { value: preset.cityGlow },
        uFogColor: { value: preset.fogColor },
        uFogDensity: { value: preset.fogDensity },
        uSunDir: { value: new Vector3(...preset.sunDir).normalize() },
        uSunColor: { value: preset.sunColor },
        uAmbient: { value: preset.ambient },
        uRot: { value: bearing },
        uNight: { value: preset.windowGlow },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying float vDist;
        void main() {
          vWorld = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying float vDist;
        uniform vec3 uBase;
        uniform vec3 uGlow;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uAmbient;
        uniform float uRot;
        uniform float uNight;
        ${COMMON_FOG}

        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        // 격자 도로: 간선(넓고 밝은)과 이면도로(좁고 어두운)를 겹쳐 그린다
        float roadMask(vec2 p, float pitch, float width) {
          vec2 q = abs(fract(p / pitch) - 0.5) * pitch;
          vec2 w = fwidth(p) * 1.5 + 0.3;
          float lx = 1.0 - smoothstep(width - w.x, width + w.x, q.x);
          float ly = 1.0 - smoothstep(width - w.y, width + w.y, q.y);
          return max(lx, ly);
        }

        void main() {
          float cr = cos(uRot);
          float sr = sin(uRot);
          vec2 p = vec2(vWorld.x * cr - vWorld.z * sr, vWorld.x * sr + vWorld.z * cr);

          // 픽셀이 도로 간격보다 커지는 거리에서는 격자를 뭉갠다
          float pxMinor = max(fwidth(p.x), fwidth(p.y)) / 92.0;
          float detail = 1.0 - smoothstep(0.3, 0.9, pxMinor);

          float minor = roadMask(p, 92.0, 4.5) * detail;
          float major = roadMask(p, 460.0, 9.0);
          // 블록마다 밝기를 흩뿌려 균일한 격자로 보이지 않게 한다
          float v = hash21(floor(p / 92.0));
          float blockShade = mix(0.78, 1.16, v);

          vec3 col = uBase * blockShade;
          col = mix(col, uBase * 2.2, minor * (0.45 + 0.55 * v));
          col = mix(col, uBase * 2.9, major * 0.85);

          vec3 n = normalize(vNormal);
          float ndl = max(dot(n, normalize(uSunDir)), 0.0);
          col *= (uAmbient * 1.5 + uSunColor * ndl * 0.9 + 0.06);

          // 가로등 · 차량 불빛 (조명 계산 뒤에 더해 밤에도 선명하게 보인다)
          float lamp = minor * (0.3 + 0.7 * v) + major * 1.2;
          col += uGlow * lamp * (0.02 + uNight * 0.026);
          // 도로가 뭉개지는 원경에는 은은한 도시 발광만 남긴다
          col += uGlow * (1.0 - detail) * uNight * 0.022;

          gl_FragColor = vec4(applyFog(col, vDist, vWorld.y), 1.0);
        }
      `,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** 강·호수 수면 */
export class Water {
  readonly group = new Group();
  private readonly mats: ShaderMaterial[] = [];

  constructor(city: City, preset: SkyPreset) {
    for (const w of city.waters) {
      const geo = new PlaneGeometry(w.w, w.d, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new ShaderMaterial({
        transparent: true,
        side: DoubleSide,
        uniforms: {
          uColor: { value: preset.waterColor },
          uSky: { value: preset.horizon },
          uGlow: { value: preset.cityGlow },
          uFogColor: { value: preset.fogColor },
          uFogDensity: { value: preset.fogDensity },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          varying float vDist;
          void main() {
            vUv = uv;
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            vec4 mv = viewMatrix * world;
            vDist = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          varying vec3 vWorld;
          varying float vDist;
          uniform vec3 uColor;
          uniform vec3 uSky;
          uniform vec3 uGlow;
          uniform float uTime;
          ${COMMON_FOG}

          float hash21(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }

          void main() {
            // 잔물결: 서로 다른 방향의 사인파를 겹친다
            float w1 = sin(vWorld.x * 0.06 + uTime * 0.9);
            float w2 = sin(vWorld.z * 0.045 - uTime * 0.7);
            float w3 = sin((vWorld.x + vWorld.z) * 0.021 + uTime * 0.35);
            float ripple = (w1 * 0.4 + w2 * 0.35 + w3 * 0.25);

            vec3 col = uColor;
            col += uSky * (0.10 + 0.06 * ripple);
            // 강 위로 길게 늘어지는 도시 불빛 반사
            float streak = pow(max(ripple, 0.0), 3.0);
            float band = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
            col += uGlow * streak * band * 0.45;
            float spark = step(0.995, hash21(floor(vec2(vWorld.x * 0.4, vWorld.z * 0.4 + uTime * 2.0))));
            col += uGlow * spark * 0.5;

            gl_FragColor = vec4(applyFog(col, vDist, vWorld.y), 0.94);
          }
        `,
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(w.x, w.y, w.z);
      mesh.rotation.y = -w.rot;
      mesh.renderOrder = -5;
      this.mats.push(mat);
      this.group.add(mesh);
    }
  }

  update(t: number): void {
    for (const m of this.mats) (m.uniforms.uTime as { value: number }).value = t;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
  }
}

/** 공원·녹지 패치 */
export class Parks {
  readonly group = new Group();
  private readonly mat: ShaderMaterial;

  constructor(city: City, preset: SkyPreset) {
    this.mat = new ShaderMaterial({
      uniforms: {
        uFogColor: { value: preset.fogColor },
        uFogDensity: { value: preset.fogDensity },
        uAmbient: { value: preset.ambient },
        uGlow: { value: preset.cityGlow },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec2 vUv;
        varying float vDist;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mv = viewMatrix * world;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorld;
        varying vec2 vUv;
        varying float vDist;
        uniform vec3 uAmbient;
        uniform vec3 uGlow;
        ${COMMON_FOG}
        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        void main() {
          // 수관이 뭉쳐 보이도록 저주파 얼룩을 준다
          float n = hash21(floor(vec2(vWorld.x, vWorld.z) / 11.0));
          float n2 = hash21(floor(vec2(vWorld.x, vWorld.z) / 41.0));
          vec3 green = mix(vec3(0.05, 0.11, 0.06), vec3(0.09, 0.19, 0.10), n * 0.6 + n2 * 0.4);
          vec3 col = green * (uAmbient * 1.4 + 0.35);
          // 산책로 조명
          col += uGlow * step(0.985, n) * 0.35;
          gl_FragColor = vec4(applyFog(col, vDist, vWorld.y), 1.0);
        }
      `,
    });
    for (const p of city.parks) {
      const geo = new PlaneGeometry(p.w, p.d, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mesh = new Mesh(geo, this.mat);
      mesh.position.set(p.x, p.y + 0.6, p.z);
      mesh.rotation.y = -p.rot;
      mesh.renderOrder = -8;
      this.group.add(mesh);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.mat.dispose();
  }
}

function center(city: City): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const w of city.stage.route) {
    const p = city.proj.toLocal(w.lat, w.lon);
    x += p.x;
    z += p.z;
  }
  const n = city.stage.route.length;
  return { x: x / n, z: z / n };
}

/** 경로 시작점 -> 끝점 방위각. 도로 격자 방향의 근사치로 쓴다. */
function mainBearing(city: City): number {
  const r = city.stage.route;
  const a = city.proj.toLocal(r[0].lat, r[0].lon);
  const b = city.proj.toLocal(r[r.length - 1].lat, r[r.length - 1].lon);
  return (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
}
