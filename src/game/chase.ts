import { PerspectiveCamera, Vector3 } from 'three';

/**
 * 3인칭 추격 카메라.
 * 목표 위치로 스프링처럼 따라붙고, 속도·콤보·박자에 따라 FOV 와 롤을 흔들어
 * 리듬감을 화면으로 전달한다.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  private readonly pos = new Vector3();
  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly tmp = new Vector3();
  private roll = 0;
  private fov = 68;
  private shake = 0;
  /** 박자 펄스 (0~1) */
  private pulse = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(68, aspect, 0.6, 30000);
  }

  reset(playerPos: Vector3, dir: Vector3): void {
    this.desired.copy(playerPos).addScaledVector(dir, -14).add(new Vector3(0, 5, 0));
    this.pos.copy(this.desired);
    this.target.copy(playerPos);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(playerPos);
  }

  kick(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  beat(strength: number): void {
    this.pulse = Math.max(this.pulse, strength);
  }

  update(
    dt: number,
    playerPos: Vector3,
    dir: Vector3,
    speed: number,
    bank: number,
    heat: number,
    falling: boolean,
    /** 활강 구간 정도 (0~1). 카메라를 뒤·위로 빼서 도시 전경을 보여 준다. */
    glide = 0,
    /** 활강 중 시선을 얼마나 아래로 떨굴지(m). 지면까지의 높이에 비례해 넘어온다. */
    glideDrop = 0,
  ): void {
    const back = 13 + Math.min(speed * 0.16, 7) + heat * 2.5 + glide * 16;
    const up = 4.2 + Math.min(speed * 0.04, 2.4) + glide * 9;
    this.desired.copy(playerPos).addScaledVector(dir, -back);
    this.desired.y += up;
    if (falling) this.desired.y += 6;

    // 스프링 추종 (프레임레이트 독립)
    const k = 1 - Math.exp(-dt * 9);
    this.pos.lerp(this.desired, k);

    // 흔들림
    this.shake = Math.max(0, this.shake - dt * 2.6);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.9;
      this.tmp.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
      );
      this.pos.add(this.tmp);
    }

    this.camera.position.copy(this.pos);

    // 진행 방향 조금 앞을 본다. 활강 중에는 더 멀리·더 아래를 본다 —
    // 발밑으로 펼쳐진 도시가 화면에 들어와야 "내려다보며 난다"가 된다.
    // 시선을 떨구는 양은 고정값이 아니라 지면까지의 높이에 비례해야 한다:
    // 200~600m 상공에서 16m 만 내려다봐 봐야 화면에는 하늘만 남는다.
    this.lookAt.copy(playerPos).addScaledVector(dir, 9 + glide * 26);
    this.lookAt.y += 1.2 - glide * glideDrop;
    this.camera.lookAt(this.lookAt);

    // 롤: 스윙 뱅킹의 일부를 카메라에 옮긴다
    this.pulse = Math.max(0, this.pulse - dt * 4.5);
    const targetRoll = bank * 0.2;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5);
    this.camera.rotateZ(this.roll);

    // FOV: 속도 + 히트 + 박자 펄스
    const targetFov = 66 + Math.min(speed * 0.38, 20) + heat * 6 + this.pulse * 3.5 + glide * 10;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
