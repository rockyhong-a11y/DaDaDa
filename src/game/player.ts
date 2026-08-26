import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

const SUIT = 0x2b3576;
const SUIT_ALT = 0x53246e;
const NEON_A = 0x18c6d8; // 시안
const NEON_B = 0xd42a90; // 마젠타

/**
 * 플레이어 캐릭터.
 * 리깅된 모델 대신 프리미티브를 계층으로 묶어 스윙·트릭·낙하 포즈를
 * 절차적으로 만든다. 뒤에서 보는 3인칭 시점에 맞춰 실루엣을 잡았다.
 */
export class Player {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly torso: Mesh;
  private readonly head: Mesh;
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly cape: Mesh;
  private readonly capeMat: ShaderMaterial;
  private readonly materials: (MeshStandardMaterial | MeshBasicMaterial)[] = [];
  /** 몸통 롤(뱅킹) 각 */
  private bank = 0;
  private spin = 0;

  constructor() {
    // 어떤 하늘색 아래서도 실루엣이 살도록 자체 발광을 조금 섞는다
    const suit = new MeshStandardMaterial({
      color: SUIT,
      roughness: 0.42,
      metalness: 0.2,
      emissive: 0x121a45,
      emissiveIntensity: 1,
    });
    const suitAlt = new MeshStandardMaterial({
      color: SUIT_ALT,
      roughness: 0.5,
      metalness: 0.15,
      emissive: 0x24103a,
      emissiveIntensity: 1,
    });
    const neonA = new MeshBasicMaterial({ color: NEON_A });
    const neonB = new MeshBasicMaterial({ color: NEON_B });
    this.materials.push(suit, suitAlt, neonA, neonB);

    this.torso = new Mesh(new CapsuleGeometry(0.42, 0.85, 6, 12), suit);
    this.torso.castShadow = false;
    this.body.add(this.torso);

    // 가슴 네온 라인
    const chest = new Mesh(new SphereGeometry(0.2, 10, 8), neonA);
    chest.position.set(0, 0.28, 0.36);
    chest.scale.set(1.5, 0.5, 0.35);
    this.body.add(chest);

    this.head = new Mesh(new SphereGeometry(0.34, 14, 12), suitAlt);
    this.head.position.y = 0.92;
    this.body.add(this.head);
    // 마스크 렌즈
    for (const sx of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.13, 10, 8), neonA);
      eye.position.set(sx * 0.14, 0.96, 0.26);
      eye.scale.set(1.1, 0.62, 0.5);
      this.body.add(eye);
    }

    const limb = (mat: MeshStandardMaterial, len: number): Mesh => {
      const m = new Mesh(new CapsuleGeometry(0.15, len, 5, 9), mat);
      m.position.y = -len / 2 - 0.15;
      return m;
    };
    for (const [grp, sx] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as [Group, number][]) {
      grp.position.set(sx * 0.48, 0.5, 0);
      grp.add(limb(suit, 0.72));
      const glove = new Mesh(new SphereGeometry(0.17, 10, 8), sx > 0 ? neonB : neonA);
      glove.position.y = -1.02;
      grp.add(glove);
      this.body.add(grp);
    }
    for (const [grp, sx] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as [Group, number][]) {
      grp.position.set(sx * 0.2, -0.52, 0);
      grp.add(limb(suitAlt, 0.86));
      const boot = new Mesh(new ConeGeometry(0.19, 0.34, 8), neonB);
      boot.position.set(0, -1.18, 0.06);
      boot.rotation.x = Math.PI * 0.5;
      grp.add(boot);
      this.body.add(grp);
    }

    // 나부끼는 스카프
    this.capeMat = new ShaderMaterial({
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSpeed: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uSpeed;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = uv.y;
          p.x += sin(uTime * 9.0 + w * 7.0) * 0.22 * w;
          p.y += sin(uTime * 7.0 + w * 5.0) * 0.13 * w;
          p.z -= w * (0.6 + uSpeed * 0.02);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        void main() {
          float a = (1.0 - vUv.y) * 0.38 * (1.0 - abs(vUv.x - 0.5) * 1.4);
          vec3 c = mix(vec3(0.18, 0.95, 1.0), vec3(1.0, 0.18, 0.7), vUv.y);
          gl_FragColor = vec4(c, max(a, 0.0));
        }
      `,
    });
    const capeGeo = new BufferGeometry();
    {
      const segs = 10;
      const verts: number[] = [];
      const uvs: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        verts.push(-0.34, 0.55 - t * 0.1, -t * 1.9, 0.34, 0.55 - t * 0.1, -t * 1.9);
        uvs.push(0, t, 1, t);
        if (i < segs) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      capeGeo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      capeGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
      capeGeo.setIndex(idx);
    }
    this.cape = new Mesh(capeGeo, this.capeMat);
    this.body.add(this.cape);

    this.root.add(this.body);
    this.root.scale.setScalar(1.7);
  }

  /**
   * 매 프레임 포즈 갱신.
   * @param dir      진행 방향 단위벡터
   * @param toAnchor 앵커 방향 단위벡터 (없으면 null)
   * @param swingT   현재 스윙 구간 진행도 0~1
   * @param speed    속도(m/s)
   * @param trick    공중 트릭 진행도 0~1 (0이면 트릭 아님)
   * @param falling  추락 중 여부
   */
  update(
    dt: number,
    time: number,
    dir: Vector3,
    toAnchor: Vector3 | null,
    swingT: number,
    speed: number,
    trick: number,
    falling: boolean,
  ): void {
    // 진행 방향을 바라본다
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -dir.y))) * 0.7;
    this.root.rotation.set(0, yaw, 0);

    // 스윙 아래로 지날 때 몸이 기우는 뱅킹
    const targetBank = toAnchor && !falling ? Math.atan2(toAnchor.x * Math.cos(yaw) - toAnchor.z * Math.sin(yaw), 1) * 0.9 : 0;
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 6);

    this.spin = trick > 0 ? trick * Math.PI * 2 : this.spin * Math.max(0, 1 - dt * 5);
    this.body.rotation.set(pitch + (falling ? 0.5 : 0) + this.spin, 0, this.bank);

    const swayA = Math.sin(time * 3.1) * 0.12;
    if (falling) {
      this.armL.rotation.set(-2.4 + swayA, 0.4, 0.9);
      this.armR.rotation.set(-2.2 - swayA, -0.4, -1.0);
      this.legL.rotation.set(0.9 + swayA, 0, 0.35);
      this.legR.rotation.set(0.5 - swayA, 0, -0.4);
    } else if (toAnchor) {
      // 한 팔은 웹을 잡고 위로, 다리는 스윙 위상에 따라 접었다 편다
      this.armR.rotation.set(-2.5, -0.25, -0.15);
      this.armL.rotation.set(-0.7 + Math.sin(swingT * Math.PI) * 0.5, 0.2, 0.55);
      const tuck = Math.sin(swingT * Math.PI); // 최저점에서 가장 많이 접힌다
      this.legL.rotation.set(-0.2 - tuck * 1.5, 0, 0.18);
      this.legR.rotation.set(0.35 - tuck * 1.1, 0, -0.2);
    } else {
      this.armL.rotation.set(-1.6, 0.2, 0.5);
      this.armR.rotation.set(-1.6, -0.2, -0.5);
      this.legL.rotation.set(-0.6, 0, 0.15);
      this.legR.rotation.set(-0.2, 0, -0.15);
    }

    this.capeMat.uniforms.uTime.value = time;
    this.capeMat.uniforms.uSpeed.value = speed;
  }

  /** 오른손(웹 슈터) 월드 좌표 */
  handWorld(out: Vector3): Vector3 {
    this.armR.updateWorldMatrix(true, false);
    out.set(0, -1.02, 0);
    return out.applyMatrix4(this.armR.matrixWorld);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.capeMat.dispose();
  }
}

/** 웹 로프. 손끝에서 앵커까지 이어지는 발광 선. 반투명하게 둬서 뒤 배경을 가리지 않는다. */
export class WebRope {
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private readonly up = new Vector3(0, 1, 0);
  private readonly dirV = new Vector3();

  constructor() {
    const geo = new CylinderGeometry(0.055, 0.11, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    this.mat = new MeshBasicMaterial({ color: 0xdff7ff, transparent: true, opacity: 0.36 });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  set(from: Vector3, to: Vector3, opacity = 1): void {
    this.dirV.subVectors(to, from);
    const len = this.dirV.length();
    if (len < 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.copy(from);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(this.up, this.dirV.divideScalar(len));
    this.mat.opacity = 0.36 * opacity;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** 속도 잔상 리본 */
export class Trail {
  /** 잔상 최대 길이(m) */
  private static readonly MAX_LENGTH = 42;
  readonly mesh: Mesh;
  private readonly positions: Vector3[] = [];
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;
  private readonly count: number;
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  constructor(count = 48) {
    this.count = count;
    const verts = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = t;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = t;
      if (i < count - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(verts, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.geo.setIndex(idx);
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: { uHeat: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uHeat;
        void main() {
          float fade = pow(1.0 - vUv.y, 1.6);
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          vec3 cool = vec3(0.16, 0.85, 1.0);
          vec3 hot = vec3(1.0, 0.55, 0.15);
          vec3 c = mix(cool, hot, uHeat);
          gl_FragColor = vec4(c, fade * edge * (0.10 + uHeat * 0.16));
        }
      `,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  reset(p: Vector3): void {
    this.positions.length = 0;
    for (let i = 0; i < this.count; i++) this.positions.push(p.clone());
  }

  push(p: Vector3, camPos: Vector3, width: number, heat: number): void {
    if (this.positions.length === 0) this.reset(p);
    // 순간이동(리드인 진입·리스타트)에서 잔상이 길게 늘어지지 않도록 끊는다
    else if (this.positions[0].distanceToSquared(p) > 25 * 25) this.reset(p);
    this.positions.unshift(p.clone());
    while (this.positions.length > this.count) this.positions.pop();
    // 프레임레이트에 따라 잔상 길이가 달라지지 않도록 누적 길이로 자른다
    let acc = 0;
    for (let i = 1; i < this.positions.length; i++) {
      acc += this.positions[i].distanceTo(this.positions[i - 1]);
      if (acc > Trail.MAX_LENGTH) {
        this.positions.length = i + 1;
        break;
      }
    }

    const attr = this.geo.attributes.position as BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      const cur = this.positions[Math.min(i, this.positions.length - 1)];
      const nxt = this.positions[Math.min(i + 1, this.positions.length - 1)];
      this.tmpA.subVectors(nxt, cur);
      if (this.tmpA.lengthSq() < 1e-6) this.tmpA.set(0, 0, 1);
      this.tmpB.subVectors(camPos, cur).cross(this.tmpA).normalize();
      const w = width * (1 - i / this.count) * 0.5;
      attr.setXYZ(i * 2, cur.x - this.tmpB.x * w, cur.y - this.tmpB.y * w, cur.z - this.tmpB.z * w);
      attr.setXYZ(i * 2 + 1, cur.x + this.tmpB.x * w, cur.y + this.tmpB.y * w, cur.z + this.tmpB.z * w);
    }
    attr.needsUpdate = true;
    this.mat.uniforms.uHeat.value = heat;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
