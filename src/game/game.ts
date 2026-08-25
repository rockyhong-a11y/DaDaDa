import { Group, Vector3 } from 'three';
import type { AudioEngine } from '../audio/context';
import { Conductor } from '../audio/conductor';
import { MusicPlayer } from '../audio/music';
import { Sfx, type Judgement } from '../audio/sfx';
import type { StageDef } from '../data/types';
import { City, type BuildingInst } from '../world/citygen';
import { CityMesh, AnchorMasts } from '../world/citymesh';
import { Ground, Parks, Water } from '../world/ground';
import { SKY_PRESETS } from '../world/palette';
import { Sky } from '../world/sky';
import type { Renderer } from '../world/scene';
import { buildChart, swingPoint, type Chart, type Note, type SwingSegment, type Vec3 } from './chart';
import { ChaseCamera } from './chase';
import { accuracy, applyJudge, classify, makeWindows, newScore, rankOf, type Rank, type ScoreState } from './judge';
import { NoteMarkers } from './markers';
import { Player, Trail, WebRope } from './player';
import type { InputManager, PressEvent } from '../core/input';
import { GoogleTilesLayer } from '../world/tiles3d';

export type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'cleared' | 'failed';

export interface LaneNote {
  /** 판정선까지 남은 시간(초) */
  remain: number;
  kind: Note['kind'];
  hit: Judgement | null;
  /** hold 전용: 종료 시점까지 남은 시간(초). 레인에 지속시간 바를 그리는 데 쓴다. */
  holdEndRemain?: number;
}

/** HUD 가 매 프레임 읽어가는 상태 스냅샷 */
export interface HudState {
  phase: Phase;
  score: number;
  combo: number;
  acc: number;
  hp: number;
  heat: number;
  progress: number;
  altitude: number;
  speed: number;
  time: number;
  duration: number;
  lane: LaneNote[];
  lastJudge: Judgement | null;
  lastJudgeAt: number;
  /** 게임 내부 경과 시간(초). lastJudgeAt 과 비교해 연출 시간을 잰다. */
  now: number;
  lastOffset: number;
  countdown: number;
  landmark: string | null;
  /** 지금 지나는 구역 이름 (아파트 단지·상권 등). 없으면 null. */
  place: string | null;
  /** 연출용 이름 배너. 'landmark' = 실존 건물, 'area' = 처음 들어온 구역 */
  calloutKind: 'landmark' | 'area' | null;
  calloutTitle: string | null;
  calloutSubtitle: string;
  calloutAt: number;
  /** 랜드마크 배너의 화면상 위치(0~1). 건물 위에 투영해 붙일 때 쓴다. area 배너는 안 쓴다. */
  calloutScreenX: number;
  calloutScreenY: number;
  calloutWorldVisible: boolean;
  /** 홀드 노트 진행 상태 */
  holdActive: boolean;
  holdProgress: number;
  /** 연타 노트 진행 상태 */
  mashActive: boolean;
  mashCount: number;
  mashTarget: number;
  /** 다음 홀드/연타 예고 (시작 전 카운트다운 표시용) */
  nextActionKind: 'hold' | 'mash' | null;
  nextActionRemain: number;
  /** 탭할 때마다 올라가는 카운터. 화면 좌표가 있으면(포인터) 그 자리에, 없으면(키보드) 판정선에 리플을 띄운다. */
  tapRippleId: number;
  tapRippleX: number | null;
  tapRippleY: number | null;
}

export interface StageResult {
  stage: StageDef;
  cleared: boolean;
  score: number;
  acc: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  rank: Rank;
  fullCombo: boolean;
}

const LEAD_APPROACH = 220; // 리드인 동안 뒤에서 날아오는 거리(m)

export class Game {
  readonly hud: HudState = {
    phase: 'loading',
    score: 0,
    combo: 0,
    acc: 1,
    hp: 100,
    heat: 0,
    progress: 0,
    altitude: 0,
    speed: 0,
    time: 0,
    duration: 0,
    lane: [],
    lastJudge: null,
    lastJudgeAt: -99,
  now: 0,
    lastOffset: 0,
    countdown: 0,
    landmark: null,
    place: null,
    calloutKind: null,
    calloutTitle: null,
    calloutSubtitle: '',
    calloutAt: -99,
    calloutScreenX: 0.5,
    calloutScreenY: 0.2,
    calloutWorldVisible: false,
    holdActive: false,
    holdProgress: 0,
    mashActive: false,
    mashCount: 0,
    mashTarget: 1,
    nextActionKind: null,
    nextActionRemain: 0,
    tapRippleId: 0,
    tapRippleX: null,
    tapRippleY: null,
  };

  phase: Phase = 'loading';
  onFinish: ((r: StageResult) => void) | null = null;
  /** 데모·검증용 자동 플레이 (?auto=1) */
  autoplay = false;

  private readonly world = new Group();
  private readonly conductor: Conductor;
  private readonly sfx: Sfx;
  private music: MusicPlayer | null = null;

  private stage!: StageDef;
  private city!: City;
  private chart!: Chart;
  private score!: ScoreState;
  private windows = makeWindows(1);
  /** 연속으로 놓쳐도 되는 스윙 수. 난이도가 낮을수록 관대하다. */
  private maxMissStreak = 4;

  private cityMesh: CityMesh | null = null;
  private masts: AnchorMasts | null = null;
  private ground: Ground | null = null;
  private water: Water | null = null;
  private parks: Parks | null = null;
  private sky: Sky | null = null;
  private tilesLayer: GoogleTilesLayer | null = null;
  private tilesToken = '';
  private tilesEnabled = false;
  /** 실사 타일이 켜지면 가려두는 자체 도시 레이어 */
  private proceduralLayers: Group[] = [];

  private readonly player = new Player();
  private readonly rope = new WebRope();
  private readonly trail = new Trail(52);
  private readonly markers = new NoteMarkers();
  private readonly chase: ChaseCamera;

  private noteCursor = 0;
  private segIndex = 0;
  private sag = 0;
  private sagVel = 0;
  private heat = 0;
  private trickT = 0;
  private falling = false;
  private failAt = 0;
  private clearedAt = 0;
  private lastBeatIndex = -1;
  private elapsed = 0;

  private landmarksList: BuildingInst[] = [];
  private announcedLandmarks = new Set<BuildingInst>();
  private announcedZones = new Set<string>();
  private zoneName: string | null = null;
  private calloutQueue: { kind: 'landmark' | 'area'; title: string; subtitle: string; pos: Vector3 | null }[] = [];
  private calloutBusyUntil = 0;
  /** 지금 표시 중인 랜드마크 배너가 붙어야 할 3D 좌표 (건물 옥상 위) */
  private activeCalloutPos: Vector3 | null = null;
  private readonly calloutNdc = new Vector3();

  /** 지금 진행 중인 홀드 노트 (없으면 null) */
  private activeHold: Note | null = null;
  private holdHeldTime = 0;
  private holdLastSongTime = 0;
  /** 지금 진행 중인 연타 노트 (없으면 null) */
  private activeMash: Note | null = null;
  private mashCount = 0;
  /** 다음으로 활성화할 액션 노트를 찾기 시작할 위치 (노트 배열 인덱스) */
  private actionCursor = 0;

  private readonly pos = new Vector3();
  private readonly prevPos = new Vector3();
  private readonly dir = new Vector3(0, 0, 1);
  private readonly hand = new Vector3();
  private readonly anchorV = new Vector3();
  private readonly toAnchor = new Vector3();
  private readonly tmpVec: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly tmp3 = new Vector3();
  private readonly burstAt = new Vector3();

  constructor(
    private readonly renderer: Renderer,
    private readonly engine: AudioEngine,
    private readonly input: InputManager,
  ) {
    this.conductor = new Conductor(engine);
    this.sfx = new Sfx(engine);
    this.chase = new ChaseCamera(renderer.aspect);
    this.world.add(this.player.root, this.rope.mesh, this.trail.mesh, this.markers.group);
    this.input.onPress(this.handlePress);
  }

  get camera() {
    return this.chase.camera;
  }

  get playerPosition(): Vector3 {
    return this.pos;
  }

  get currentStage(): StageDef {
    return this.stage;
  }

  get currentChart(): Chart {
    return this.chart;
  }

  // ---------------------------------------------------------------- 로딩

  /** 실사 3D 타일 배경 설정. 다음 스테이지 로드부터 적용된다. */
  setTiles(enabled: boolean, token: string): void {
    this.tilesEnabled = enabled;
    this.tilesToken = token;
  }

  load(stage: StageDef): void {
    this.unloadWorld();
    this.stage = stage;
    this.city = new City(stage);
    this.landmarksList = this.city.buildings.filter((b) => b.kind === 'landmark');
    this.chart = buildChart(this.city);
    this.score = newScore(this.chart.notes.length);
    this.windows = makeWindows(stage.timingScale);
    this.maxMissStreak = stage.difficulty <= 2 ? 5 : stage.difficulty === 3 ? 4 : 3;

    const preset = SKY_PRESETS[stage.timeOfDay];
    this.renderer.applyPreset(preset);

    this.cityMesh = new CityMesh(this.city, preset);
    this.ground = new Ground(this.city, preset);
    this.water = new Water(this.city, preset);
    this.parks = new Parks(this.city, preset);
    this.sky = new Sky(preset);
    this.masts = new AnchorMasts(
      this.chart.segments
        .filter((s) => !s.finale && s.anchor.y > s.anchorRoof + 1.5)
        .map((s) => ({ x: s.anchor.x, y: s.anchor.y, z: s.anchor.z, roof: s.anchorRoof })),
    );

    this.world.add(
      this.sky.mesh,
      this.sky.stars,
      this.ground.mesh,
      this.water.group,
      this.parks.group,
      this.cityMesh.group,
      this.masts.group,
    );
    this.renderer.scene.add(this.world);
    this.renderer.ensureComposer(this.chase.camera);
    this.renderer.setCamera(this.chase.camera);

    this.conductor.configure(stage.bpm, this.chart.leadInBeats);
    this.hud.duration = this.chart.duration;
    this.hud.landmark = this.chart.finaleTower.name ?? null;

    this.setupTiles();

    this.resetRun();
    this.phase = 'ready';
    this.hud.phase = 'ready';
  }

  /**
   * 실사 타일을 비동기로 붙인다. 성공하면 자체 도시 지오메트리를 감춰
   * 두 도시가 겹쳐 보이지 않게 한다. 실패하면 아무 일도 일어나지 않는다.
   */
  private setupTiles(): void {
    this.tilesLayer?.dispose();
    this.tilesLayer = null;
    for (const g of this.proceduralLayers) g.visible = true;
    this.proceduralLayers = [];
    if (!this.tilesEnabled || !this.tilesToken) return;

    const stage = this.stage;
    void GoogleTilesLayer.create(
      this.renderer.scene,
      this.chase.camera,
      this.renderer.renderer,
      stage.origin,
      this.tilesToken,
    ).then((layer) => {
      // 로드되는 사이에 다른 스테이지로 넘어갔다면 즉시 버린다
      if (!layer) return;
      if (this.stage !== stage) {
        layer.dispose();
        return;
      }
      this.tilesLayer = layer;
      for (const g of [this.cityMesh?.group, this.water?.group, this.parks?.group]) {
        if (g) {
          g.visible = false;
          this.proceduralLayers.push(g);
        }
      }
      if (this.ground) this.ground.mesh.visible = false;
    });
  }

  private resetRun(): void {
    this.noteCursor = 0;
    this.segIndex = 0;
    this.sag = 0;
    this.sagVel = 0;
    this.heat = 0;
    this.trickT = 0;
    this.falling = false;
    this.elapsed = 0;
    this.lastBeatIndex = -1;
    this.score = newScore(this.chart.notes.length);
    for (const n of this.chart.notes) noteState.delete(n);

    this.zoneName = null;
    this.announcedLandmarks.clear();
    this.announcedZones.clear();
    this.calloutQueue.length = 0;
    this.calloutBusyUntil = 0;
    this.activeCalloutPos = null;
    this.hud.place = null;
    this.hud.calloutKind = null;
    this.hud.calloutTitle = null;
    this.hud.calloutSubtitle = '';
    this.hud.calloutAt = -99;
    this.hud.calloutWorldVisible = false;

    this.activeHold = null;
    this.holdHeldTime = 0;
    this.holdLastSongTime = 0;
    this.activeMash = null;
    this.mashCount = 0;
    this.actionCursor = 0;
    this.hud.holdActive = false;
    this.hud.holdProgress = 0;
    this.hud.mashActive = false;
    this.hud.mashCount = 0;
    this.hud.mashTarget = 1;
    this.hud.nextActionKind = null;
    this.hud.nextActionRemain = 0;
    this.hud.tapRippleId = 0;
    this.hud.tapRippleX = null;
    this.hud.tapRippleY = null;

    const seg0 = this.chart.segments[0];
    const d = new Vector3(seg0.to.x - seg0.from.x, 0, seg0.to.z - seg0.from.z).normalize();
    this.pos.set(seg0.from.x - d.x * LEAD_APPROACH, seg0.from.y + 30, seg0.from.z - d.z * LEAD_APPROACH);
    this.prevPos.copy(this.pos);
    this.dir.copy(d);
    this.trail.reset(this.pos);
    this.chase.reset(this.pos, this.dir);
    this.markers.hideAll();
    this.rope.hide();
  }

  start(): void {
    this.conductor.start(0.25);
    this.music = new MusicPlayer(this.engine, this.conductor, this.stage, this.chart.totalBeats, this.chart.leadInBeats);
    this.phase = 'playing';
    this.hud.phase = 'playing';
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.conductor.pause();
    this.phase = 'paused';
    this.hud.phase = 'paused';
    this.engine.setMusicVolume(0.12);
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.conductor.resume();
    this.phase = 'playing';
    this.hud.phase = 'playing';
    this.engine.setMusicVolume(0.72);
  }

  restart(): void {
    this.conductor.stop();
    this.music?.stop();
    this.resetRun();
    this.engine.setMusicVolume(0.72);
    this.start();
  }

  private unloadWorld(): void {
    if (!this.cityMesh) return;
    this.renderer.scene.remove(this.world);
    for (const o of [
      this.sky?.mesh,
      this.sky?.stars,
      this.ground?.mesh,
      this.water?.group,
      this.parks?.group,
      this.cityMesh?.group,
      this.masts?.group,
    ]) {
      if (o) this.world.remove(o);
    }
    this.tilesLayer?.dispose();
    this.tilesLayer = null;
    this.proceduralLayers = [];
    this.cityMesh?.dispose();
    this.ground?.dispose();
    this.water?.dispose();
    this.parks?.dispose();
    this.sky?.dispose();
    this.masts?.dispose();
    this.cityMesh = null;
  }

  dispose(): void {
    this.unloadWorld();
    this.player.dispose();
    this.rope.dispose();
    this.trail.dispose();
    this.markers.dispose();
  }

  // ---------------------------------------------------------------- 입력

  private readonly handlePress = (e: PressEvent): void => {
    if (this.phase !== 'playing') return;
    this.hud.tapRippleId++;
    this.hud.tapRippleX = e.x ?? null;
    this.hud.tapRippleY = e.y ?? null;
    const songTime = e.at - this.conductor.toAudioTime(0);
    this.judgePress(songTime);
  };

  /** 입력 시각과 가장 가까운 미판정 노트를 찾아 판정한다 */
  private judgePress(songTime: number): void {
    // 연타 창이 열려 있으면 이 탭은 그 연타 카운트로 들어간다 —
    // 스윙/에어처럼 "가장 가까운 노트 하나"를 찾는 매칭과는 다른 입력 모델이다.
    if (this.activeMash) {
      this.mashCount++;
      this.sfx.shoot();
      return;
    }

    const notes = this.chart.notes;
    let best = -1;
    let bestErr = Infinity;
    for (let i = this.noteCursor; i < notes.length; i++) {
      const n = notes[i];
      if (noteState.has(n)) continue;
      if (n.kind === 'hold' || n.kind === 'mash') continue;
      const err = songTime - n.time;
      if (err > this.windows.good) continue;
      if (err < -this.windows.good) break;
      if (Math.abs(err) < bestErr) {
        bestErr = Math.abs(err);
        best = i;
      }
    }
    if (best < 0) return;
    const n = notes[best];
    const kind = classify(bestErr, this.windows);
    this.resolveNote(n, kind, songTime - n.time);
  }

  private resolveNote(n: Note, kind: Judgement, offset: number): void {
    noteState.set(n, kind);
    const isSwing = n.kind === 'swing';
    const isAction = n.kind === 'hold' || n.kind === 'mash';
    applyJudge(this.score, kind, n.kind);
    this.hud.lastJudge = kind;
    this.hud.lastJudgeAt = this.elapsed;
    this.hud.lastOffset = offset;
    this.sfx.judge(kind, this.score.combo);

    if (kind === 'MISS') {
      this.heat = Math.max(0, this.heat - 0.5);
      // 박자를 놓치면 웹이 헛돌아 고도가 꺼진다. 홀드/연타를 그르친 건
      // 앵커를 놓친 것보다는 가볍게, 그냥 트릭을 흘린 것보다는 무겁게 다룬다.
      this.sagVel -= isSwing ? 15 : isAction ? 10 : 5;
      this.chase.kick(isAction ? 0.7 : 0.5);
    } else {
      const power = kind === 'PERFECT' ? 1 : kind === 'GREAT' ? 0.6 : 0.3;
      this.heat = Math.min(1, this.heat + power * 0.12);
      this.sagVel += power * 5.5;
      this.chase.kick(power * (isAction ? 0.32 : 0.22));
      // 파티클은 캐릭터가 아니라 앵커 쪽에서 터뜨려 몸이 흰 덩어리로 뭉개지지 않게 한다
      const seg = this.chart.segments[Math.min(n.swingIndex, this.chart.segments.length - 1)];
      this.burstAt.set(
        (this.pos.x * 2 + seg.anchor.x) / 3,
        (this.pos.y * 2 + seg.anchor.y) / 3,
        (this.pos.z * 2 + seg.anchor.z) / 3,
      );
      this.markers.pop(
        this.burstAt,
        kind === 'PERFECT' ? 0x8ffcff : kind === 'GREAT' ? 0x7dff9c : 0xffe07d,
        isSwing || isAction ? power : power * 0.5,
      );
      if (isSwing) this.sfx.shoot();
      else if (!isAction) this.trickT = 1;
    }
    if (this.score.hp <= 0 || this.score.missStreak >= this.maxMissStreak) this.crash();
  }

  private crash(): void {
    if (this.falling) return;
    this.falling = true;
    this.failAt = this.elapsed;
    this.sfx.fail();
    this.chase.kick(1.2);
    this.engine.setMusicVolume(0.18);
  }

  // ---------------------------------------------------------------- 갱신

  update(dt: number, realDt = dt): void {
    this.elapsed += dt;
    const songTime = this.conductor.time;
    this.hud.time = songTime;
    this.music?.update();
    this.cityMesh?.update(this.elapsed);
    this.tilesLayer?.update();
    this.water?.update(this.elapsed);

    if (this.phase === 'playing') {
      if (this.autoplay) this.autoPlay(songTime);
      this.autoMiss(songTime);
      this.updateActionNotes(songTime);
      this.updateBeatPulse(songTime);
    }

    this.updateMotion(dt, songTime);
    if (this.phase === 'playing') this.updateLocationAwareness(songTime);
    this.updateHud(songTime);

    this.chase.update(
      realDt,
      this.pos,
      this.dir,
      this.hud.speed,
      this.currentBank(),
      this.heat,
      this.falling,
    );
    this.sky?.follow(this.chase.camera.position.x, this.chase.camera.position.y, this.chase.camera.position.z);
    this.updateMarkers(songTime);

    // 종료 판정
    if (this.phase === 'playing') {
      if (this.falling && this.elapsed - this.failAt > 2.6) this.finish(false);
      else if (!this.falling && songTime > this.chart.segments[this.chart.segments.length - 1].t1 + 1.6) {
        if (this.clearedAt === 0) {
          this.clearedAt = this.elapsed;
          this.sfx.clear();
        }
        if (this.elapsed - this.clearedAt > 1.8) this.finish(true);
      }
    }
  }

  private finish(cleared: boolean): void {
    this.phase = cleared ? 'cleared' : 'failed';
    this.hud.phase = this.phase;
    this.music?.stop();
    this.conductor.stop();
    this.engine.setMusicVolume(0.72);
    const acc = accuracy(this.score);
    this.onFinish?.({
      stage: this.stage,
      cleared,
      score: this.score.score,
      acc,
      maxCombo: this.score.maxCombo,
      counts: { ...this.score.counts },
      rank: rankOf(acc, cleared),
      fullCombo: this.score.fullCombo && cleared,
    });
  }

  /** 자동 플레이: 노트 시각을 지나는 순간 약간의 오차로 눌러 준다 */
  private autoPlay(songTime: number): void {
    const notes = this.chart.notes;
    for (let i = this.noteCursor; i < notes.length; i++) {
      const n = notes[i];
      if (noteState.has(n)) continue;
      if (n.time > songTime) break;
      if (n.kind === 'hold' || n.kind === 'mash') continue; // updateActionNotes 가 자동 완료시킨다
      const jitter = (Math.random() - 0.5) * this.windows.perfect * 1.4;
      this.resolveNote(n, classify(Math.abs(jitter), this.windows), jitter);
    }
  }

  /** 판정 창을 지나쳐 버린 노트를 미스 처리한다 */
  private autoMiss(songTime: number): void {
    const notes = this.chart.notes;
    while (this.noteCursor < notes.length) {
      const n = notes[this.noteCursor];
      if (noteState.has(n)) {
        this.noteCursor++;
        continue;
      }
      // 홀드/연타는 창이 훨씬 길고 자기 종료 시각에 updateActionNotes 가 직접
      // 판정한다. 겹치지 않게 배치했으므로 여기서 멈춰도 뒤 노트를 막지 않는다.
      if (n.kind === 'hold' || n.kind === 'mash') break;
      if (songTime - n.time <= this.windows.good) break;
      this.resolveNote(n, 'MISS', songTime - n.time);
      this.noteCursor++;
    }
  }

  /**
   * 홀드·연타 액션 노트를 진행시킨다.
   *
   * 스윙/에어처럼 "한 번 입력 = 한 번 판정"이 아니라, 시작~종료 시각 사이의
   * 상태(눌려 있는가, 몇 번 탭했는가)를 매 프레임 누적하다가 종료 시각에
   * 한 번에 판정한다. 자동 플레이 모드에서는 홀드는 계속 누르고 있는 것으로,
   * 연타는 시간에 비례해 목표치를 채워 가는 것으로 시뮬레이션한다.
   *
   * 누적은 프레임 dt 가 아니라 songTime 의 실제 변화량으로 한다 — 렌더링이
   * 잠깐 버벅여 프레임이 뜨문뜨문 와도(오디오 클럭은 프레임과 무관하게 계속
   * 흐르므로) 실제로 누른 시간과 어긋나지 않는다.
   */
  private updateActionNotes(songTime: number): void {
    const notes = this.chart.notes;

    if (!this.activeHold && !this.activeMash) {
      while (this.actionCursor < notes.length) {
        const n = notes[this.actionCursor];
        if (noteState.has(n) || (n.kind !== 'hold' && n.kind !== 'mash')) {
          this.actionCursor++;
          continue;
        }
        if (n.time > songTime) break; // 아직 시작 전 — 다음 프레임에 다시 확인
        if (n.kind === 'hold') {
          this.activeHold = n;
          this.holdHeldTime = 0;
          this.holdLastSongTime = n.time;
        } else {
          this.activeMash = n;
          this.mashCount = 0;
        }
        this.actionCursor++;
        break;
      }
    }

    if (this.activeHold) {
      const held = this.autoplay || this.input.isDown;
      const delta = Math.max(0, songTime - this.holdLastSongTime);
      if (held) this.holdHeldTime += delta;
      this.holdLastSongTime = songTime;
      const end = this.activeHold.holdEnd ?? this.activeHold.time;
      const total = Math.max(0.001, end - this.activeHold.time);
      this.hud.holdActive = true;
      this.hud.holdProgress = Math.min(1, this.holdHeldTime / total);
      if (songTime >= end) {
        const frac = this.hud.holdProgress;
        const kind: Judgement = frac >= 0.92 ? 'PERFECT' : frac >= 0.75 ? 'GREAT' : frac >= 0.45 ? 'GOOD' : 'MISS';
        this.resolveNote(this.activeHold, kind, 0);
        this.activeHold = null;
        this.hud.holdActive = false;
      }
    }

    if (this.activeMash) {
      const end = this.activeMash.mashEnd ?? this.activeMash.time;
      const target = this.activeMash.mashTarget ?? 1;
      if (this.autoplay) {
        const total = Math.max(0.001, end - this.activeMash.time);
        this.mashCount = Math.min(target, Math.ceil(((songTime - this.activeMash.time) / total) * target));
      }
      this.hud.mashActive = true;
      this.hud.mashCount = this.mashCount;
      this.hud.mashTarget = target;
      if (songTime >= end) {
        const ratio = this.mashCount / target;
        const kind: Judgement = ratio >= 1 ? 'PERFECT' : ratio >= 0.75 ? 'GREAT' : ratio >= 0.4 ? 'GOOD' : 'MISS';
        this.resolveNote(this.activeMash, kind, 0);
        this.activeMash = null;
        this.hud.mashActive = false;
      }
    }
  }

  private updateBeatPulse(songTime: number): void {
    const b = Math.floor(songTime / this.conductor.beatDur);
    if (b !== this.lastBeatIndex) {
      this.lastBeatIndex = b;
      this.chase.beat(b % 4 === 0 ? 1 : 0.45);
    }
  }

  /**
   * 위치 인지: 지금 지나는 구역(아파트 단지 등) 이름을 HUD 에 계속 띄우고,
   * 처음 들어오는 구역·처음 가까워지는 랜드마크마다 이름 배너를 큐에 넣는다.
   * 랜드마크는 큰 건물일수록 훨씬 멀리서부터 알아볼 수 있다는 점을 반영해
   * 트리거 반경을 높이에 비례해 키운다 — 555m 롯데월드타워는 1km 밖에서도 뜬다.
   */
  private updateLocationAwareness(songTime: number): void {
    const zone = this.city.zoneAt(this.pos.x, this.pos.z);
    if (zone !== this.zoneName) {
      this.zoneName = zone;
      this.hud.place = zone;
      if (zone && !this.announcedZones.has(zone)) {
        this.announcedZones.add(zone);
        this.calloutQueue.push({ kind: 'area', title: zone, subtitle: '지나는 구역', pos: null });
      }
    }

    for (const b of this.landmarksList) {
      if (this.announcedLandmarks.has(b) || !b.name) continue;
      const radius = Math.max(b.w, b.d) + b.height * 1.1 + 420;
      const dx = b.x - this.pos.x;
      const dz = b.z - this.pos.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      this.announcedLandmarks.add(b);
      const subtitle = b.height >= 1 ? `${Math.round(b.height)}m · ${b.floors}층` : '랜드마크';
      // 옥상보다 살짝 위에 이름표를 띄워 "이 건물이다" 라는 게 분명하게 보이게 한다
      const pos = new Vector3(b.x, b.base + b.height + 14, b.z);
      this.calloutQueue.push({ kind: 'landmark', title: b.name, subtitle, pos });
    }

    if (this.elapsed >= this.calloutBusyUntil && this.calloutQueue.length > 0) {
      const c = this.calloutQueue.shift()!;
      this.hud.calloutKind = c.kind;
      this.hud.calloutTitle = c.title;
      this.hud.calloutSubtitle = c.subtitle;
      this.hud.calloutAt = this.elapsed;
      this.activeCalloutPos = c.pos;
      this.calloutBusyUntil = this.elapsed + (c.kind === 'landmark' ? 4.0 : 2.4);
    }

    if (this.activeCalloutPos) {
      if (this.elapsed >= this.calloutBusyUntil) {
        this.activeCalloutPos = null;
        this.hud.calloutWorldVisible = false;
      } else {
        this.calloutNdc.copy(this.activeCalloutPos).project(this.chase.camera);
        this.hud.calloutScreenX = (this.calloutNdc.x + 1) / 2;
        this.hud.calloutScreenY = (1 - this.calloutNdc.y) / 2;
        this.hud.calloutWorldVisible =
          this.calloutNdc.z < 1 &&
          this.calloutNdc.x > -1.1 &&
          this.calloutNdc.x < 1.1 &&
          this.calloutNdc.y > -1.1 &&
          this.calloutNdc.y < 1.1;
      }
    }

    // 다음 홀드/연타 예고 (아직 활성화되지 않은 것 중 가장 가까운 것)
    if (!this.activeHold && !this.activeMash) {
      const notes = this.chart.notes;
      let found: Note | null = null;
      for (let i = this.actionCursor; i < notes.length; i++) {
        const n = notes[i];
        if (noteState.has(n)) continue;
        if (n.kind === 'hold' || n.kind === 'mash') {
          found = n;
          break;
        }
      }
      if (found) {
        const remain = found.time - songTime;
        if (remain > 0 && remain < 1.8) {
          this.hud.nextActionKind = found.kind as 'hold' | 'mash';
          this.hud.nextActionRemain = remain;
        } else {
          this.hud.nextActionKind = null;
        }
      } else {
        this.hud.nextActionKind = null;
      }
    } else {
      this.hud.nextActionKind = null;
    }
  }

  private currentSegment(songTime: number): { seg: SwingSegment; u: number } {
    const segs = this.chart.segments;
    while (this.segIndex < segs.length - 1 && songTime >= segs[this.segIndex].t1) this.segIndex++;
    while (this.segIndex > 0 && songTime < segs[this.segIndex].t0) this.segIndex--;
    const seg = segs[this.segIndex];
    const span = seg.t1 - seg.t0 || 1;
    const u = Math.max(0, Math.min(1, (songTime - seg.t0) / span));
    return { seg, u };
  }

  /** 진자는 최저점에서 가장 빠르다. 그 느낌만 살짝 섞는다. */
  private static easeSwing(u: number): number {
    return u * 0.72 + ((1 - Math.cos(Math.PI * u)) / 2) * 0.28;
  }

  private updateMotion(dt: number, songTime: number): void {
    this.prevPos.copy(this.pos);
    const segs = this.chart.segments;

    if (songTime < 0) {
      // 리드인: 뒤에서 활강해 시작점으로 들어온다
      const k = Math.min(1, 1 + songTime / Math.max(0.001, this.conductor.leadIn));
      const seg0 = segs[0];
      const d = new Vector3(seg0.to.x - seg0.from.x, 0, seg0.to.z - seg0.from.z).normalize();
      const e = k * k * (3 - 2 * k);
      this.pos.set(
        seg0.from.x - d.x * LEAD_APPROACH * (1 - e),
        seg0.from.y + 30 * (1 - e) + Math.sin(k * Math.PI) * 6,
        seg0.from.z - d.z * LEAD_APPROACH * (1 - e),
      );
      this.rope.hide();
    } else {
      const { seg, u } = this.currentSegment(songTime);
      swingPoint(seg, Game.easeSwing(u), this.tmpVec);
      this.pos.set(this.tmpVec.x, this.tmpVec.y, this.tmpVec.z);

      // 판정 결과에 따른 고도 처짐
      this.sagVel += -this.sag * 9 * dt - this.sagVel * 3.4 * dt;
      this.sag += this.sagVel * dt;
      this.sag = Math.max(-70, Math.min(6, this.sag));
      if (this.falling) {
        this.sagVel -= 42 * dt;
        this.sag += this.sagVel * dt;
      }
      this.pos.y += this.sag;

      const ground = this.city.groundAt(this.pos.x, this.pos.z);
      if (this.pos.y < ground + 3) {
        this.pos.y = ground + 3;
        if (!this.falling && this.phase === 'playing') this.crash();
      }
      if (this.sag < -46 && !this.falling && this.phase === 'playing') this.crash();

      // 웹 로프
      if (!this.falling) {
        this.anchorV.set(seg.anchor.x, seg.anchor.y, seg.anchor.z);
        this.player.handWorld(this.hand);
        const fade = u > 0.94 ? 1 - (u - 0.94) / 0.06 : 1;
        this.rope.set(this.hand, this.anchorV, fade);
      } else {
        this.rope.hide();
      }
    }

    // 방향 · 속도
    // 프레임 델타로 나누면 프레임 드랍 때 속도가 폭주하므로,
    // 곡 시간축 위에서 궤적을 미분해 실제 비행 속도를 구한다.
    this.tmp3.subVectors(this.pos, this.prevPos);
    const dist = this.tmp3.length();
    if (dist > 1e-4) this.dir.lerp(this.tmp3.divideScalar(dist), Math.min(1, dt * 12)).normalize();
    this.hud.speed = this.sampleSpeed(songTime);

    this.heat = Math.max(0, this.heat - dt * 0.16);
    this.trickT = Math.max(0, this.trickT - dt * 2.4);

    const { seg } = songTime >= 0 ? this.currentSegment(songTime) : { seg: segs[0] };
    if (!this.falling && songTime >= 0) {
      this.toAnchor.set(seg.anchor.x, seg.anchor.y, seg.anchor.z).sub(this.pos).normalize();
    }
    const span = seg.t1 - seg.t0 || 1;
    const u = Math.max(0, Math.min(1, (songTime - seg.t0) / span));
    this.player.root.position.copy(this.pos);
    this.player.update(
      dt,
      this.elapsed,
      this.dir,
      this.falling || songTime < 0 ? null : this.toAnchor,
      u,
      this.hud.speed,
      this.trickT,
      this.falling,
    );
    this.trail.push(this.pos, this.chase.camera.position, 1.5 + this.heat * 2.2, this.heat);
  }

  /** 곡 시간축에서 궤적을 미분해 얻는 비행 속도(m/s) */
  private sampleSpeed(songTime: number): number {
    if (songTime < 0) return 0;
    const segs = this.chart.segments;
    const last = segs[segs.length - 1];
    if (songTime > last.t1) return 0;
    const h = 0.05;
    const t0 = Math.max(0, songTime - h);
    const t1 = Math.min(last.t1, songTime + h);
    this.sampleAt(t0, this.sampleA);
    this.sampleAt(t1, this.sampleB);
    const span = t1 - t0 || h;
    const a = this.sampleA;
    const b = this.sampleB;
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / span;
  }

  private readonly sampleA: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly sampleB: Vec3 = { x: 0, y: 0, z: 0 };

  private sampleAt(t: number, out: Vec3): Vec3 {
    const segs = this.chart.segments;
    let j = this.segIndex;
    while (j < segs.length - 1 && t >= segs[j].t1) j++;
    while (j > 0 && t < segs[j].t0) j--;
    const seg = segs[j];
    const u = Math.max(0, Math.min(1, (t - seg.t0) / (seg.t1 - seg.t0 || 1)));
    return swingPoint(seg, Game.easeSwing(u), out);
  }

  private currentBank(): number {
    if (this.falling) return 0;
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const rx = this.toAnchor.x * Math.cos(yaw) - this.toAnchor.z * Math.sin(yaw);
    return Math.max(-1, Math.min(1, rx)) * 0.9;
  }

  private updateMarkers(songTime: number): void {
    const anchors: { pos: Vector3; remain: number; window: number }[] = [];
    const airs: { pos: Vector3; remain: number }[] = [];
    const notes = this.chart.notes;
    for (let i = this.noteCursor; i < notes.length && anchors.length + airs.length < 20; i++) {
      const n = notes[i];
      if (noteState.has(n)) continue;
      const remain = n.time - songTime;
      if (remain < -0.2) continue;
      if (remain > 2.6) break;
      const seg = this.chart.segments[Math.min(n.swingIndex, this.chart.segments.length - 1)];
      if (n.kind === 'swing') {
        if (anchors.length < 6) {
          anchors.push({
            pos: new Vector3(seg.anchor.x, seg.anchor.y, seg.anchor.z),
            remain,
            window: this.windows.good,
          });
        }
      } else if (n.kind === 'air' && airs.length < 14) {
        const span = seg.t1 - seg.t0 || 1;
        const u = Math.max(0, Math.min(1, (n.time - seg.t0) / span));
        swingPoint(seg, Game.easeSwing(u), this.tmpVec);
        airs.push({ pos: new Vector3(this.tmpVec.x, this.tmpVec.y, this.tmpVec.z), remain });
      }
      // hold/mash 는 3D 프리뷰 링 대신 플레이어에게 붙는 액션 이펙트로 표현한다
    }
    this.markers.update(this.chase.camera, this.elapsed, anchors, airs);

    if (this.hud.holdActive) this.markers.showHold(this.pos, this.chase.camera, this.hud.holdProgress);
    else if (this.hud.mashActive) {
      this.markers.showMash(this.pos, this.chase.camera, this.elapsed, this.hud.mashCount / this.hud.mashTarget);
    } else if (this.hud.nextActionKind) {
      const k = 1 - Math.max(0, Math.min(1, this.hud.nextActionRemain / 1.8));
      if (this.hud.nextActionKind === 'hold') this.markers.showHoldPreview(this.pos, this.chase.camera, k);
      else this.markers.showMashPreview(this.pos, this.chase.camera, k);
    } else this.markers.hideAction();
  }

  private updateHud(songTime: number): void {
    const h = this.hud;
    h.phase = this.phase;
    h.now = this.elapsed;
    h.score = this.score.score;
    h.combo = this.score.combo;
    h.acc = accuracy(this.score);
    h.hp = this.score.hp;
    h.heat = this.heat;
    h.altitude = this.pos.y;
    h.progress = Math.max(0, Math.min(1, songTime / Math.max(1, this.chart.duration)));
    h.countdown = songTime < 0 ? -songTime : 0;

    h.lane.length = 0;
    const notes = this.chart.notes;
    for (let i = this.noteCursor; i < notes.length && h.lane.length < 18; i++) {
      const n = notes[i];
      const remain = n.time - songTime;
      if (remain < -0.25) continue;
      if (remain > 1.9) break;
      const holdEndRemain = n.kind === 'hold' ? (n.holdEnd ?? n.time) - songTime : undefined;
      h.lane.push({ remain, kind: n.kind, hit: noteState.get(n) ?? null, holdEndRemain });
    }
  }

  resize(): void {
    this.chase.resize(this.renderer.aspect);
    this.tilesLayer?.resize(this.chase.camera, this.renderer.renderer);
  }
}

/** 노트별 판정 결과. 노트 객체를 키로 쓰는 약한 맵. */
const noteState = new WeakMap<Note, Judgement>();
