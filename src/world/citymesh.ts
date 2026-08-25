import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry as BG,
} from 'three';
import type { BuildingInst, City } from './citygen';
import type { LandmarkShape } from '../data/types';
import type { SkyPreset } from './palette';
import { BUILDING_FRAG, BUILDING_VERT } from './buildingShader';

const KIND_ID: Record<BuildingInst['kind'], number> = {
  apt: 0,
  office: 1,
  lowrise: 2,
  landmark: 3,
  special: 1,
};

/** 아래쪽 끝이 원점에 오도록 지오메트리를 옮긴다 (건물은 지면에서 자란다) */
function groundAlign(g: BG): BG {
  g.translate(0, 0.5, 0);
  return g;
}

function shapeGeometry(shape: LandmarkShape): BG {
  switch (shape) {
    case 'taper':
      // 위로 갈수록 좁아지는 사각 프리즘
      return groundAlign(new CylinderGeometry(0.34, 0.5, 1, 4, 1).rotateY(Math.PI / 4));
    case 'cylinder':
      return groundAlign(new CylinderGeometry(0.5, 0.5, 1, 24, 1));
    case 'dome': {
      // 상반구는 y 가 0~0.5 라서 2배로 늘려 높이 1 에 맞춘다
      const g = new SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 2, 1);
      return g;
    }
    case 'spire': {
      // 전망대 불룩한 부분이 있는 첨탑 실루엣
      const pts = [
        new Vector2(0.5, 0),
        new Vector2(0.45, 0.22),
        new Vector2(0.34, 0.5),
        new Vector2(0.22, 0.74),
        new Vector2(0.3, 0.8),
        new Vector2(0.26, 0.86),
        new Vector2(0.08, 0.95),
        new Vector2(0.03, 1),
        new Vector2(0.0, 1),
      ];
      return new LatheGeometry(pts, 20);
    }
    case 'stadium':
      return groundAlign(new CylinderGeometry(0.5, 0.44, 1, 22, 1));
    case 'box':
    default:
      return groundAlign(new BoxGeometry(1, 1, 1));
  }
}

export class CityMesh {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly meshes: InstancedMesh[] = [];
  private readonly warningLights: Points;
  private readonly lightMat: ShaderMaterial;
  readonly uniforms: Record<string, { value: unknown }>;

  constructor(city: City, preset: SkyPreset) {
    this.uniforms = {
      uSunDir: { value: new Vector3(...preset.sunDir).normalize() },
      uSunColor: { value: preset.sunColor },
      uSunIntensity: { value: preset.sunIntensity },
      uAmbient: { value: preset.ambient },
      uAmbientIntensity: { value: preset.ambientIntensity },
      uFogColor: { value: preset.fogColor },
      uFogDensity: { value: preset.fogDensity },
      uWindowLit: { value: preset.windowLit },
      uWindowGlow: { value: preset.windowGlow },
      uGroundTint: { value: preset.cityGlow },
      uTime: { value: 0 },
    };
    this.material = new ShaderMaterial({
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_FRAG,
      uniforms: this.uniforms,
    });

    // 형태별로 인스턴스를 묶는다: 일반 건물은 전부 박스 하나로 처리된다.
    const groups = new Map<LandmarkShape, BuildingInst[]>();
    for (const b of city.buildings) {
      const shape: LandmarkShape = b.kind === 'landmark' ? (b.shape ?? 'box') : 'box';
      let list = groups.get(shape);
      if (!list) groups.set(shape, (list = []));
      list.push(b);
    }

    const dummy = new Object3D();
    const mat4 = new Matrix4();
    for (const [shape, list] of groups) {
      const geo = shapeGeometry(shape);
      const mesh = new InstancedMesh(geo, this.material, list.length);
      const size = new Float32Array(list.length * 3);
      const tint = new Float32Array(list.length);
      const seed = new Float32Array(list.length);
      const kind = new Float32Array(list.length);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        dummy.position.set(b.x, b.base, b.z);
        dummy.rotation.set(0, b.rot, 0);
        dummy.scale.set(b.w, b.height, b.d);
        dummy.updateMatrix();
        mat4.copy(dummy.matrix);
        mesh.setMatrixAt(i, mat4);
        size[i * 3] = b.w;
        size[i * 3 + 1] = b.height;
        size[i * 3 + 2] = b.d;
        tint[i] = b.tint;
        seed[i] = (i * 37 + b.floors * 13) % 997;
        kind[i] = KIND_ID[b.kind];
      }
      geo.setAttribute('aSize', new InstancedBufferAttribute(size, 3));
      geo.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));
      geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
      geo.setAttribute('aKind', new InstancedBufferAttribute(kind, 1));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    // 항공장애표시등: 90m 넘는 건물 옥상에서 붉게 깜빡인다
    const tall = city.buildings.filter((b) => b.height > 90);
    const pos = new Float32Array(tall.length * 3);
    const phase = new Float32Array(tall.length);
    for (let i = 0; i < tall.length; i++) {
      const b = tall[i];
      pos[i * 3] = b.x;
      pos[i * 3 + 1] = b.base + b.height + 3;
      pos[i * 3 + 2] = b.z;
      phase[i] = (i * 0.37) % 1;
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(pos, 3));
    lg.setAttribute('aPhase', new BufferAttribute(phase, 1));
    this.lightMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        varying float vBlink;
        uniform float uTime;
        uniform float uScale;
        void main() {
          float t = fract(uTime * 0.55 + aPhase);
          vBlink = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.16, 0.42, t));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(900.0 / max(-mv.z, 1.0), 1.5, 9.0) * uScale;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBlink;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = 1.0 - smoothstep(0.15, 0.5, length(d));
          if (a <= 0.001 || vBlink <= 0.001) discard;
          gl_FragColor = vec4(vec3(1.0, 0.18, 0.12) * (0.7 + vBlink), a * vBlink);
        }
      `,
    });
    this.warningLights = new Points(lg, this.lightMat);
    this.warningLights.frustumCulled = false;
    this.group.add(this.warningLights);
  }

  update(time: number): void {
    (this.uniforms.uTime as { value: number }).value = time;
    (this.lightMat.uniforms.uTime as { value: number }).value = time;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
    this.warningLights.geometry.dispose();
    this.lightMat.dispose();
  }
}

/** 앵커가 얹힌 옥상에 세우는 철탑 + 항공등 */
export class AnchorMasts {
  readonly group = new Group();
  private readonly mat: MeshBasicMaterial;

  private readonly tipMat: MeshBasicMaterial;

  constructor(anchors: { x: number; y: number; z: number; roof: number }[]) {
    // 옥상 철탑: 어둡게 두고 꼭대기의 항공등만 눈에 띄게 한다
    this.mat = new MeshBasicMaterial({ color: 0x10151f });
    this.tipMat = new MeshBasicMaterial({ color: 0xb8331f });
    const geo = groundAlign(new CylinderGeometry(0.22, 0.55, 1, 5, 1));
    const tipGeo = new SphereGeometry(1, 6, 5);
    const mesh = new InstancedMesh(geo, this.mat, anchors.length);
    const tips = new InstancedMesh(tipGeo, this.tipMat, anchors.length);
    const dummy = new Object3D();
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const h = Math.max(2, a.y - a.roof);
      dummy.position.set(a.x, a.roof, a.z);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.85);
      dummy.updateMatrix();
      tips.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    tips.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    tips.frustumCulled = false;
    this.group.add(mesh, tips);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof InstancedMesh) {
        o.geometry.dispose();
        o.dispose();
      }
    });
    this.mat.dispose();
    this.tipMat.dispose();
  }
}
