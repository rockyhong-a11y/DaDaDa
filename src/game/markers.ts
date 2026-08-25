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
  /** 홀드/연타 진행 중 플레이어에게 붙는 링. 위치가 아니라 상태를 보여 준다. */
  private readonly actionMesh: Mesh;
  private readonly actionMat: MeshBasicMaterial;

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

    const actionGeo = new TorusGeometry(1, 0.09, 10, 48);
    this.actionMat = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.actionMesh = new Mesh(actionGeo, this.actionMat);
    this.actionMesh.visible = false;
    this.actionMesh.frustumCulled = false;
    this.group.add(this.actionMesh);
  }

  hideAll(): void {
    for (const r of this.rings) r.mesh.visible = false;
    for (const a of this.airs) a.mesh.visible = false;
    this.actionMesh.visible = false;
  }

  /** 홀드 진행 중: 채워질수록 밝아지고 살짝 오므라드는 초록 링을 플레이어에 붙인다. */
  showHold(pos: Vector3, camera: Camera, progress: number): void {
    this.actionMesh.visible = true;
    this.actionMesh.position.copy(pos);
    this.actionMesh.lookAt(camera.position);
    this.actionMesh.scale.setScalar(3.4 - progress * 0.7);
    this.actionMat.color.setHex(0x6bff9e);
    this.actionMat.opacity = 0.45 + progress * 0.5;
  }

  /** 연타 진행 중: 탭마다 떠는 듯 흔들리는 주황 링. */
  showMash(pos: Vector3, camera: Camera, time: number, progress: number): void {
    this.actionMesh.visible = true;
    this.actionMesh.position.copy(pos);
    this.actionMesh.lookAt(camera.position);
    const pulse = 1 + Math.sin(time * 26) * 0.09 * (1 - progress * 0.5);
    this.actionMesh.scale.setScalar((2.6 + progress * 1.3) * pulse);
    this.actionMat.color.setHex(0xffb457);
    this.actionMat.opacity = 0.55 + progress * 0.35;
  }

  hideAction(): void {
    this.actionMesh.visible = false;
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
    this.actionMesh.geometry.dispose();
    this.actionMat.dispose();
  }
}

/** 판정 시 터지는 파티클 */
class Burst {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;
  private readonly max = 260;
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
          gl_PointSize = clamp(420.0 / max(-mv.z, 1.0), 2.0, 26.0) * (0.4 + aLife);
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
          gl_FragColor = vec4(vColor, a * vLife * 0.4);
        }
      `,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(p: Vector3, color: number, power: number): void {
    const c = new Color(color);
    const n = Math.round(6 + power * 14);
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;
      const sp = (2 + Math.random() * 9) * (0.6 + power);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      this.vel[k * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[k * 3 + 1] = Math.cos(ph) * sp * 0.7 + 2;
      this.vel[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.life[k] = 1;
      this.col[k * 3] = c.r;
      this.col[k * 3 + 1] = c.g;
      this.col[k * 3 + 2] = c.b;
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
