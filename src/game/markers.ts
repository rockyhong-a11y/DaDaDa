import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';

/**
 * 3D 노트 마커.
 * 다가오는 앵커에는 축소되는 링(어프로치 서클)을, 에어 노트에는 회전하는
 * 마름모를 띄운다. 정확한 타이밍은 HUD 레인이 담당하고, 여기서는
 * "어디를 향해 날아가는가"를 공간적으로 알려준다.
 */
export class NoteMarkers {
  readonly group = new Group();
  private readonly rings: { mesh: Mesh; mat: MeshBasicMaterial }[] = [];
  private readonly airs: { mesh: Mesh; mat: MeshBasicMaterial }[] = [];
  private readonly burst: Burst;
  /**
   * 홀드/연타 진행 중 플레이어에게 붙는 링. 위치가 아니라 상태를 보여 준다.
   * 색만 다르면 얼핏 봐서 구분이 안 되므로 모양 자체를 다르게 만든다 —
   * 홀드는 매끈한 원, 연타는 각진 다이아몬드.
   */
  private readonly holdMesh: Mesh;
  private readonly holdMat: MeshBasicMaterial;
  private readonly mashMesh: Mesh;
  private readonly mashMat: MeshBasicMaterial;

  constructor(ringCount = 6, airCount = 14) {
    const ringGeo = new TorusGeometry(1, 0.055, 8, 40);
    for (let i = 0; i < ringCount; i++) {
      const mat = new MeshBasicMaterial({
        color: new Color(0x38f6ff),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.rings.push({ mesh, mat });
      this.group.add(mesh);
    }
    const airGeo = new OctahedronGeometry(1.15, 0);
    for (let i = 0; i < airCount; i++) {
      const mat = new MeshBasicMaterial({
        color: new Color(0xff4fc4),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(airGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.airs.push({ mesh, mat });
      this.group.add(mesh);
    }
    this.burst = new Burst();
    this.group.add(this.burst.points);

    // 홀드 = 매끈한 원형 링
    const holdGeo = new TorusGeometry(1, 0.09, 10, 48);
    this.holdMat = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.holdMesh = new Mesh(holdGeo, this.holdMat);
    this.holdMesh.visible = false;
    this.holdMesh.frustumCulled = false;
    this.group.add(this.holdMesh);

    // 연타 = 4각 단면의 각진 다이아몬드 링 (45도 회전)
    const mashGeo = new TorusGeometry(1, 0.13, 4, 4);
    this.mashMat = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mashMesh = new Mesh(mashGeo, this.mashMat);
    this.mashMesh.rotation.z = Math.PI / 4;
    this.mashMesh.visible = false;
    this.mashMesh.frustumCulled = false;
    this.group.add(this.mashMesh);
  }

  hideAll(): void {
    for (const r of this.rings) r.mesh.visible = false;
    for (const a of this.airs) a.mesh.visible = false;
    this.holdMesh.visible = false;
    this.mashMesh.visible = false;
  }

  /** 홀드 진행 중: 채워질수록 밝아지고 살짝 오므라드는 초록 원형 링을 플레이어에 붙인다. */
  showHold(pos: Vector3, camera: Camera, progress: number): void {
    this.mashMesh.visible = false;
    this.holdMesh.visible = true;
    this.holdMesh.position.copy(pos);
    this.holdMesh.lookAt(camera.position);
    this.holdMesh.rotation.z = 0;
    this.holdMesh.scale.setScalar(3.4 - progress * 0.7);
    this.holdMat.color.setHex(0x6bff9e);
    this.holdMat.opacity = 0.45 + progress * 0.5;
  }

  /** 연타 진행 중: 탭마다 떠는 듯 흔들리는 주황 다이아몬드 링. */
  showMash(pos: Vector3, camera: Camera, time: number, progress: number): void {
    this.holdMesh.visible = false;
    this.mashMesh.visible = true;
    this.mashMesh.position.copy(pos);
    this.mashMesh.lookAt(camera.position);
    const pulse = 1 + Math.sin(time * 26) * 0.09 * (1 - progress * 0.5);
    this.mashMesh.scale.setScalar((2.6 + progress * 1.3) * pulse);
    this.mashMesh.rotation.z = Math.PI / 4 + Math.sin(time * 26) * 0.12;
    this.mashMat.color.setHex(0xffb457);
    this.mashMat.opacity = 0.55 + progress * 0.35;
  }

  /**
   * 아직 도달하지 않은 홀드 노트 예고. k=0(멀리 남음)~1(곧 도달)로 다가올수록
   * 오므라들며 밝아져 "곧 누르고 있어야 한다"는 감각을 준다.
   */
  showHoldPreview(pos: Vector3, camera: Camera, k: number): void {
    this.mashMesh.visible = false;
    this.holdMesh.visible = true;
    this.holdMesh.position.copy(pos);
    this.holdMesh.lookAt(camera.position);
    this.holdMesh.rotation.z = 0;
    this.holdMesh.scale.setScalar(7.5 - k * 4.1);
    this.holdMat.color.setHex(0x6bff9e);
    this.holdMat.opacity = 0.1 + k * 0.32;
  }

  /** 아직 도달하지 않은 연타 노트 예고: 흐릿한 다이아몬드가 다가올수록 오므라들며 밝아진다. */
  showMashPreview(pos: Vector3, camera: Camera, k: number): void {
    this.holdMesh.visible = false;
    this.mashMesh.visible = true;
    this.mashMesh.position.copy(pos);
    this.mashMesh.lookAt(camera.position);
    this.mashMesh.rotation.z = Math.PI / 4;
    this.mashMesh.scale.setScalar(7.5 - k * 4.1);
    this.mashMat.color.setHex(0xffb457);
    this.mashMat.opacity = 0.1 + k * 0.32;
  }

  hideAction(): void {
    this.holdMesh.visible = false;
    this.mashMesh.visible = false;
  }

  /**
   * @param entries 앞으로 다가올 노트 (남은 시간 순)
   */
  update(
    camera: Camera,
    time: number,
    anchors: { pos: Vector3; remain: number; window: number }[],
    airNotes: { pos: Vector3; remain: number }[],
  ): void {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const e = anchors[i];
      if (!e) {
        r.mesh.visible = false;
        continue;
      }
      // 남은 시간에 비례해 링이 줄어들어 0초에 기준 크기가 된다
      const lead = 2.2;
      const k = Math.max(0, Math.min(1, e.remain / lead));
      const scale = 4.2 + k * 22;
      r.mesh.visible = true;
      r.mesh.position.copy(e.pos);
      r.mesh.scale.setScalar(scale * (i === 0 ? 1 : 0.85));
      r.mesh.lookAt(camera.position);
      const fade = (1 - k) * (i === 0 ? 1 : 0.5);
      r.mat.opacity = 0.15 + fade * 0.85;
      r.mat.color.setHex(i === 0 ? 0x6ffcff : 0x2a8fb8);
    }
    for (let i = 0; i < this.airs.length; i++) {
      const a = this.airs[i];
      const e = airNotes[i];
      if (!e) {
        a.mesh.visible = false;
        continue;
      }
      const k = Math.max(0, Math.min(1, e.remain / 1.6));
      a.mesh.visible = true;
      a.mesh.position.copy(e.pos);
      a.mesh.rotation.set(time * 2.2, time * 3.1, 0);
      a.mesh.scale.setScalar(1.1 + k * 2.4);
      a.mat.opacity = 0.2 + (1 - k) * 0.8;
    }
    this.burst.update();
  }

  pop(pos: Vector3, color: number, power: number): void {
    this.burst.emit(pos, color, power);
  }

  dispose(): void {
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
    for (const a of this.airs) {
      a.mesh.geometry.dispose();
      a.mat.dispose();
    }
    this.burst.dispose();
    this.holdMesh.geometry.dispose();
    this.holdMat.dispose();
    this.mashMesh.geometry.dispose();
    this.mashMat.dispose();
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
