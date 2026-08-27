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
import {
  buildChart,
  swingPointSmooth,
  type Chart,
  type Note,
  type SwingSegment,
  type Vec3,
} from './chart';
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
  /** 화면 어느 쪽 가장자리에서 등장하는가 (해당 스윙이 향하는 좌우 방향과 맞춘다) */
  side: 1 | -1;
}

/**
 * 화면에 떠 있는 랜드마크 이름표 하나. 실제 건물 위에 투영되며, 멀수록
 * 흐릿하고 작게 · 가까울수록 또렷하고 크게 그린다.
 */
export interface LandmarkTag {
  name: string;
  /** 화면 좌표 (0~1) */
  sx: number;
  sy: number;
  /** 0(가장 멂) ~ 1(가장 가까움) */
  near: number;
  /** 실존 랜드마크(손으로 좌표를 적어 둔 건물)인가 */
  major: boolean;
}

/** HUD 가 매 프레임 읽어가는 상태 스냅샷 */
export interface HudState {
  phase: Phase;
  score: number;
  combo: number;
  acc: number;
  /** SWING POWER 게이지(0~100). 0 에서 시작해 성공할수록 차오르고 100 이면 피버로 터진다. */
  power: number;
  /** 피버 모드 진행 중인가 */
  feverActive: boolean;
  /** 피버 남은 시간(초). 게이지 비우기 연출에 쓴다. */
  feverRemain: number;
  /** 활강 구간을 지나는 중인가 (배너 연출용) */
  gliding: boolean;
  heat: number;
  progress: number;
  altitude: number;
  speed: number;
  time: number;
  duration: number;
  lane: LaneNote[];
  /** 리티클에서 노트가 등장해 중앙까지 오므라드는 데 걸리는 시간(초). 스테이지 템포에 맞춰 정해진다. */
  noteLead: number;
  lastJudge: Judgement | null;
  lastJudgeAt: number;
  /** 게임 내부 경과 시간(초). lastJudgeAt 과 비교해 연출 시간을 잰다. */
  now: number;
  lastOffset: number;
  countdown: number;
  landmark: string | null;
  /** 지금 지나는 구역 이름 (아파트 단지·상권 등). 없으면 null. */
  place: string | null;
  /** 처음 들어온 구역을 알리는 배너 ('area' 전용 — 랜드마크는 landmarkTags 가 맡는다) */
  calloutKind: 'area' | null;
  calloutTitle: string | null;
  calloutSubtitle: string;
  calloutAt: number;
  /** 지금 화면에 보이는 랜드마크 이름표들 (거리순 페이드) */
  landmarkTags: LandmarkTag[];
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

/** 피버 모드 지속 시간(초) */
const FEVER_DURATION = 8;

/** 한 프레임에 띄우는 랜드마크 이름표 최대 개수 (DOM 부담 상한) */
const MAX_LANDMARK_TAGS = 14;

/** 이름표를 띄워도 되는 화면 세로 범위(0~1). 이 밖은 고정 HUD 가 차지한다. */
const TAG_SAFE_TOP = 0.2;
const TAG_SAFE_BOTTOM = 0.88;

/**
 * 피버 중 한 번의 탭이 강제 성공시킬 수 있는 노트의 최대 선행 시간(초).
 * 판정 창(good, 보통 0.2초 안팎)보다 훨씬 넉넉해서 박자를 정확히 맞출
 * 필요 없이 연타만으로 앞의 노트를 계속 밀어낼 수 있다.
 */
const FEVER_REACH = 0.6;

/**
 * 리티클에서 노트가 등장해 중앙까지 오므라드는 데 걸리는 시간(초)을 스테이지
 * 템포에 맞춰 정한다. 리듬 패턴의 평균 스텝 간격(=노트가 실제로 도착하는
 * 속도)을 기준으로, 그 간격의 약 2.6배만큼 미리 보이게 한다 — 이러면 화면에
 * 동시에 떠 있는 접근 링 개수가 스테이지 속도와 무관하게 비슷하게 유지된다.
 * 느린 스테이지는 넉넉하게, 고 BPM·촘촘한 스텝을 쓰는 빠른 스테이지는 링이
 * 덜 겹치도록 짧게 잡는다.
 */
function computeNoteLead(stage: StageDef): number {
  const beatDur = 60 / stage.bpm;
  const steps = stage.rhythm.steps;
  const meanStep = steps.reduce((a, b) => a + b, 0) / steps.length;
  return Math.max(0.8, Math.min(1.6, meanStep * beatDur * 2.6));
}

export class Game {
  readonly hud: HudState = {
    phase: 'loading',
    score: 0,
    combo: 0,
    acc: 1,
    power: 0,
    feverActive: false,
    feverRemain: 0,
    gliding: false,
    heat: 0,
    progress: 0,
    altitude: 0,
    speed: 0,
    time: 0,
    duration: 0,
    lane: [],
    noteLead: 1.35,
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
    landmarkTags: [],
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
  /** 피버 모드: 게이지가 100 을 찍으면 켜지고, 지속시간 동안 연타로 노트를 밀어낼 수 있다. */
  private feverActive = false;
  private feverEndsAt = 0;
  /** 활강 연출 강도 (0~1). 구간 경계에서 튀지 않게 부드럽게 오간다. */
  private glideT = 0;
  private glideDrop = 0;
  private lastBeatIndex = -1;
  private elapsed = 0;

  private landmarksList: BuildingInst[] = [];
  private announcedZones = new Set<string>();
  private zoneName: string | null = null;
  private calloutQueue: { kind: 'area'; title: string; subtitle: string }[] = [];
  private calloutBusyUntil = 0;
  private readonly calloutNdc = new Vector3();
  private readonly tagPos = new Vector3();

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
    // 실존 랜드마크 + 블록에서 이름을 물려받은 대표 동. 둘 다 이름표를 띄운다.
    this.landmarksList = this.city.buildings.filter((b) => !!b.name);
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
        // 활강 구간의 앵커는 실제 웹이 아니라 궤적을 펴 주는 가상 지지점이라
        // 철탑을 세우면 안 된다 (500m 짜리 기둥이 솟아 버린다).
        .filter((s) => !s.finale && !s.glide && s.anchor.y > s.anchorRoof + 1.5)
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
    this.hud.noteLead = computeNoteLead(stage);

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
    this.feverActive = false;
    this.feverEndsAt = 0;
    this.glideT = 0;
    this.hud.gliding = false;
    this.hud.feverActive = false;
    this.hud.feverRemain = 0;
    this.hud.power = 0;
    this.elapsed = 0;
    this.lastBeatIndex = -1;
    this.score = newScore(this.chart.notes.length);
    for (const n of this.chart.notes) noteState.delete(n);

    this.zoneName = null;
    this.announcedZones.clear();
    this.calloutQueue.length = 0;
    this.calloutBusyUntil = 0;
    this.hud.place = null;
    this.hud.calloutKind = null;
    this.hud.calloutTitle = null;
    this.hud.calloutSubtitle = '';
    this.hud.calloutAt = -99;
    this.hud.landmarkTags.length = 0;

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
    const notes = this.chart.notes;

    // 피버 중에는 타이밍을 보지 않는다 — 훨씬 넓은 창 안의 가장 이른 노트를
    // 무조건 PERFECT 로 밀어낸다. 즉 연타만으로 구간을 통과할 수 있다.
    if (this.feverActive) {
      for (let i = this.noteCursor; i < notes.length; i++) {
        const n = notes[i];
        if (noteState.has(n)) continue;
        if (n.time - songTime > FEVER_REACH) break;
        this.resolveNote(n, 'PERFECT', 0);
        return;
      }
      return;
    }

    let best = -1;
    let bestErr = Infinity;
    for (let i = this.noteCursor; i < notes.length; i++) {
      const n = notes[i];
      if (noteState.has(n)) continue;
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

  /** 게이지가 가득 차면 피버 모드로 전환한다. */
  private tryStartFever(): void {
    if (this.feverActive || this.score.power < 100) return;
    this.feverActive = true;
    this.feverEndsAt = this.elapsed + FEVER_DURATION;
    this.heat = 1;
    this.chase.kick(0.9);
    this.sfx.clear();
  }

  /** 피버 지속시간 동안 게이지를 균등하게 비우고, 끝나면 0 에서 다시 시작한다. */
  private updateFever(): void {
    if (!this.feverActive) return;
    const remain = Math.max(0, this.feverEndsAt - this.elapsed);
    this.score.power = (remain / FEVER_DURATION) * 100;
    if (remain <= 0) {
      this.feverActive = false;
      this.score.power = 0;
    }
  }

  private resolveNote(n: Note, kind: Judgement, offset: number): void {
    noteState.set(n, kind);
    const isSwing = n.kind === 'swing';
    // 피버 중에는 게이지가 지속시간에 맞춰 빠지는 중이라 성공으로 되채우지 않는다
    applyJudge(this.score, kind, n.kind, !this.feverActive);
    this.hud.lastJudge = kind;
    this.hud.lastJudgeAt = this.elapsed;
    this.hud.lastOffset = offset;
    this.sfx.judge(kind, this.score.combo);

    if (kind === 'MISS') {
      this.heat = Math.max(0, this.heat - 0.5);
      // 박자를 놓치면 웹이 헛돌아 고도가 꺼진다.
      this.sagVel -= isSwing ? 15 : 5;
      this.chase.kick(0.5);
    } else {
      const power = kind === 'PERFECT' ? 1 : kind === 'GREAT' ? 0.6 : 0.3;
      this.heat = Math.min(1, this.heat + power * 0.12);
      this.sagVel += power * 5.5;
      this.chase.kick(power * 0.22);
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
        isSwing ? power : power * 0.5,
      );
      if (isSwing) this.sfx.shoot();
      else this.trickT = 1;
      this.tryStartFever();
    }
    // SWING POWER 는 이제 체력이 아니라 피버 자원이므로, 추락은 스윙 연속
    // 미스로만 판정한다 (그 외엔 고도가 꺼져 지면에 닿는 경우).
    if (this.score.missStreak >= this.maxMissStreak) this.crash();
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
      this.updateFever();
      if (this.autoplay) this.autoPlay(songTime);
      this.autoMiss(songTime);
      this.updateBeatPulse(songTime);
    }

    this.updateMotion(dt, songTime);
    if (this.phase === 'playing') this.updateLocationAwareness();
    this.updateHud(songTime);

    this.chase.update(
      realDt,
      this.pos,
      this.dir,
      this.hud.speed,
      this.currentBank(),
      this.heat,
      this.falling,
      this.glideT,
      this.glideDrop,
    );
    this.sky?.follow(this.chase.camera.position.x, this.chase.camera.position.y, this.chase.camera.position.z);
    this.updateMarkers();

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
      if (songTime - n.time <= this.windows.good) break;
      this.resolveNote(n, 'MISS', songTime - n.time);
      this.noteCursor++;
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
   * 위치 인지.
   *  - 지금 지나는 구역 이름을 HUD 좌상단에 계속 띄우고, 처음 들어오는
   *    구역이면 가운데 배너를 한 번 띄운다.
   *  - 시야 안에 들어온 랜드마크는 전부 건물 옥상 위에 이름표로 투영한다.
   *    멀면 흐릿·작게, 가까우면 또렷·크게 그려 원근이 느껴지게 한다.
   */
  private updateLocationAwareness(): void {
    const zone = this.city.zoneAt(this.pos.x, this.pos.z);
    if (zone !== this.zoneName) {
      this.zoneName = zone;
      this.hud.place = zone;
      if (zone && !this.announcedZones.has(zone)) {
        this.announcedZones.add(zone);
        this.calloutQueue.push({ kind: 'area', title: zone, subtitle: '지나는 구역' });
      }
    }

    if (this.elapsed >= this.calloutBusyUntil && this.calloutQueue.length > 0) {
      const c = this.calloutQueue.shift()!;
      this.hud.calloutKind = c.kind;
      this.hud.calloutTitle = c.title;
      this.hud.calloutSubtitle = c.subtitle;
      this.hud.calloutAt = this.elapsed;
      this.calloutBusyUntil = this.elapsed + 2.4;
    }

    this.updateLandmarkTags();
  }

  /**
   * 화면에 보이는 랜드마크 이름표를 매 프레임 다시 계산한다.
   * 큰 건물일수록 더 멀리서부터 알아볼 수 있으므로 표시 반경을 높이에
   * 비례해 키운다 — 555m 롯데월드타워는 1km 밖에서도 뜬다.
   */
  private updateLandmarkTags(): void {
    const tags = this.hud.landmarkTags;
    tags.length = 0;
    for (const b of this.landmarksList) {
      if (!b.name) continue;
      const major = b.kind === 'landmark';
      const reach = Math.max(b.w, b.d) + b.height * (major ? 1.5 : 0.9) + (major ? 700 : 430);
      const dx = b.x - this.pos.x;
      const dz = b.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach) continue;

      this.tagPos.set(b.x, b.base + b.height + 14, b.z);
      this.calloutNdc.copy(this.tagPos).project(this.chase.camera);
      // 카메라 뒤 / 화면 밖은 버린다
      if (this.calloutNdc.z >= 1) continue;
      if (this.calloutNdc.x < -1 || this.calloutNdc.x > 1) continue;
      if (this.calloutNdc.y < -1 || this.calloutNdc.y > 1) continue;

      const sy = (1 - this.calloutNdc.y) / 2;
      // 위·아래 고정 HUD(점수·고도·진행바) 띠 안으로 들어오는 이름표는 버린다 —
      // 어차피 글자끼리 겹쳐 둘 다 못 읽게 된다.
      if (sy < TAG_SAFE_TOP || sy > TAG_SAFE_BOTTOM) continue;

      // near: 0 = 표시 반경 끝(가장 멂), 1 = 코앞
      const near = 1 - Math.min(1, Math.sqrt(d2) / reach);
      tags.push({
        name: b.name,
        sx: (this.calloutNdc.x + 1) / 2,
        sy,
        near,
        major,
      });
    }
    // 먼 것부터 정렬해 뒤쪽을 먼저 그리게 한다 — 배열 뒤(=DOM 뒤)로 갈수록
    // 가까운 이름표라, 겹쳐도 가까운 쪽이 위에 온다. 개수를 넘치면 먼 것부터 버린다.
    tags.sort((a, b) => a.near - b.near);
    if (tags.length > MAX_LANDMARK_TAGS) tags.splice(0, tags.length - MAX_LANDMARK_TAGS);
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

  /**
   * 진자는 최저점에서 가장 빠르다. 그 느낌만 살짝 섞되, 예전(0.28)보다 훨씬
   * 옅게 넣는다 — 이징이 강하면 구간마다 끝에서 멈칫하다 다시 튀어나가
   * "한 칸씩 끊어 가는" 느낌이 나기 때문이다. 이음매 블렌딩과 합쳐
   * 좌우로 계속 흘러가는 모양을 만든다.
   */
  private static easeSwing(u: number): number {
    return u * 0.9 + ((1 - Math.cos(Math.PI * u)) / 2) * 0.1;
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
      swingPointSmooth(segs, this.segIndex, Game.easeSwing(u), this.tmpVec);
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

      // 웹 로프 — 활강 구간에는 걸 웹이 없으므로 감춘다
      if (!this.falling && !seg.glide) {
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

    // 활강 연출 강도. 구간 경계에서 카메라가 튀지 않게 시간 상수를 두고 좇는다.
    const wantGlide = songTime >= 0 && segs[this.segIndex]?.glide ? 1 : 0;
    this.glideT += (wantGlide - this.glideT) * Math.min(1, dt * 1.8);
    this.hud.gliding = this.glideT > 0.5;
    // 지면까지의 높이에 비례해 시선을 떨군다 — 높이 뜰수록 더 내려다봐야
    // 화면이 하늘로만 차지 않는다.
    const aboveGround = Math.max(0, this.pos.y - this.city.groundAt(this.pos.x, this.pos.z));
    this.glideDrop = Math.max(20, Math.min(320, aboveGround * 0.62));

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
    return swingPointSmooth(segs, j, Game.easeSwing(u), out);
  }

  private currentBank(): number {
    if (this.falling) return 0;
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const rx = this.toAnchor.x * Math.cos(yaw) - this.toAnchor.z * Math.sin(yaw);
    return Math.max(-1, Math.min(1, rx)) * 0.9;
  }

  private updateMarkers(): void {
    // 노트 타이밍은 화면 중앙 리티클(HUD)이 전담한다 — 여기서는 판정 파티클만 갱신한다.
    this.markers.update();
  }

  private updateHud(songTime: number): void {
    const h = this.hud;
    h.phase = this.phase;
    h.now = this.elapsed;
    h.score = this.score.score;
    h.combo = this.score.combo;
    h.acc = accuracy(this.score);
    h.power = this.score.power;
    h.feverActive = this.feverActive;
    h.feverRemain = this.feverActive ? Math.max(0, this.feverEndsAt - this.elapsed) : 0;
    h.heat = this.heat;
    h.altitude = this.pos.y;
    h.progress = Math.max(0, Math.min(1, songTime / Math.max(1, this.chart.duration)));
    h.countdown = songTime < 0 ? -songTime : 0;

    h.lane.length = 0;
    const notes = this.chart.notes;
    const segs = this.chart.segments;
    for (let i = this.noteCursor; i < notes.length && h.lane.length < 22; i++) {
      const n = notes[i];
      const remain = n.time - songTime;
      if (remain < -0.25) continue;
      if (remain > h.noteLead + 0.3) break;
      const side = segs[Math.min(n.swingIndex, segs.length - 1)]?.side ?? 1;
      h.lane.push({ remain, kind: n.kind, hit: noteState.get(n) ?? null, side });
    }
  }

  resize(): void {
    this.chase.resize(this.renderer.aspect);
    this.tilesLayer?.resize(this.chase.camera, this.renderer.renderer);
  }
}

/** 노트별 판정 결과. 노트 객체를 키로 쓰는 약한 맵. */
const noteState = new WeakMap<Note, Judgement>();
