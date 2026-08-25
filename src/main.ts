import './ui/styles.css';
import { Vector3 } from 'three';
import { AudioEngine } from './audio/context';
import { InputManager } from './core/input';
import { STAGES } from './data/stages';
import type { StageDef } from './data/types';
import { Game, type StageResult } from './game/game';
import { Renderer } from './world/scene';
import { Hud } from './ui/hud';
import { Store, type Settings } from './ui/store';
import {
  howToScreen,
  loadingScreen,
  pauseScreen,
  resultScreen,
  settingsScreen,
  stageSelectScreen,
  titleScreen,
} from './ui/screens';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;

const params = new URLSearchParams(location.search);
const store = new Store();
const engine = new AudioEngine();
const input = new InputManager(() => engine.now);
const renderer = new Renderer(canvas);
const game = new Game(renderer, engine, input);
game.autoplay = params.get('auto') === '1';

let hud: Hud | null = null;
let overlay: HTMLElement | null = null;
let attract = true;
let lastTime = performance.now();
let attractAngle = 0;
let fpsAcc = 0;
let fpsFrames = 0;
const debugEl = params.get('debug') === '1' ? document.createElement('div') : null;
if (debugEl) {
  debugEl.style.cssText =
    'position:absolute;left:22px;top:130px;font:12px var(--mono);color:#7dff9c;pointer-events:none;text-shadow:0 1px 3px #000';
  uiRoot.appendChild(debugEl);
}

applySettings(store.settings);
renderer.setQuality(store.settings.quality);
renderer.resize();
input.attach(canvas);
input.onPause(() => {
  if (game.phase === 'playing') openPause();
  else if (game.phase === 'paused') closePauseAndResume();
});

window.addEventListener('resize', () => {
  renderer.resize();
  game.resize();
});
window.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase === 'playing') openPause();
});

function applySettings(s: Settings): void {
  engine.setMusicVolume(s.music);
  engine.setSfxVolume(s.sfx);
  renderer.setQuality(s.quality);
  gameOffset(s.offsetMs / 1000);
  game.setTiles(s.useTiles, s.googleKey);
}

function gameOffset(sec: number): void {
  // Conductor 는 Game 내부에 있으므로 전용 창구를 통해 전달한다
  (game as unknown as { conductor: { offset: number } }).conductor.offset = sec;
}

function setOverlay(node: HTMLElement | null): void {
  if (overlay) overlay.remove();
  overlay = node;
  if (node) uiRoot.appendChild(node);
}

function clearHud(): void {
  hud?.el.remove();
  hud = null;
}

// ---------------------------------------------------------------- 화면 전환

function showTitle(): void {
  attract = true;
  clearHud();
  setOverlay(
    titleScreen(
      () => {
        void engine.resume();
        showSelect();
      },
      () => showSettings(showTitle),
      () => setOverlay(howToScreen(showTitle)),
    ),
  );
}

function showSelect(): void {
  attract = true;
  clearHud();
  setOverlay(stageSelectScreen(STAGES, store, (s) => startStage(s), showTitle));
}

function showSettings(back: () => void): void {
  setOverlay(settingsScreen(store, applySettings, back));
}

function startStage(stage: StageDef): void {
  void engine.resume();
  setOverlay(loadingScreen(stage));
  // 로딩 화면이 한 프레임 그려진 뒤 무거운 생성 작업을 시작한다
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      game.load(stage);
      gameOffset(store.settings.offsetMs / 1000);
      attract = false;
      setOverlay(null);
      hud = new Hud(stage);
      uiRoot.appendChild(hud.el);
      game.start();
    });
  });
}

function openPause(): void {
  game.pause();
  setOverlay(
    pauseScreen(
      closePauseAndResume,
      () => {
        setOverlay(null);
        game.restart();
      },
      () => {
        game.pause();
        showSelect();
      },
    ),
  );
}

function closePauseAndResume(): void {
  setOverlay(null);
  game.resume();
}

game.onFinish = (r: StageResult) => {
  const rec = {
    score: r.score,
    acc: r.acc,
    rank: r.rank,
    maxCombo: r.maxCombo,
    fullCombo: r.fullCombo,
    cleared: r.cleared,
  };
  const isBest = store.submit(r.stage.id, rec);
  const idx = STAGES.findIndex((s) => s.id === r.stage.id);
  const next = STAGES[idx + 1];
  clearHud();
  attract = true;
  setOverlay(
    resultScreen(
      r,
      isBest && r.cleared,
      !!next,
      () => {
        setOverlay(null);
        attract = false;
        hud = new Hud(r.stage);
        uiRoot.appendChild(hud.el);
        game.restart();
      },
      () => next && startStage(next),
      showSelect,
    ),
  );
};

// ---------------------------------------------------------------- 메인 루프

function frame(now: number): void {
  const raw = (now - lastTime) / 1000;
  lastTime = now;
  // 시뮬레이션 dt 는 튀지 않게 자르되, 카메라 감쇠에는 실제 경과 시간을 쓴다.
  // 그러지 않으면 프레임이 떨어질 때 카메라가 영원히 따라붙지 못한다.
  const dt = Math.min(0.05, raw);
  game.update(dt, Math.min(0.25, raw));

  if (attract) attractCamera(dt);
  if (hud) {
    const beat = Math.floor(game.hud.time / (60 / game.currentStage.bpm));
    hud.update(game.hud, beat);
  }

  if (debugEl) {
    fpsAcc += raw;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      const dist = game.camera.position.distanceTo(game.playerPosition);
      debugEl.textContent = `${(fpsFrames / fpsAcc).toFixed(0)} fps · cam ${dist.toFixed(1)} m · alt ${game.hud.altitude.toFixed(0)} m`;
      fpsAcc = 0;
      fpsFrames = 0;
    }
  }

  renderer.render(game.camera);
  requestAnimationFrame(frame);
}

const attractTarget = new Vector3();

/** 타이틀·선택 화면 뒤에서 랜드마크를 천천히 도는 카메라 */
function attractCamera(dt: number): void {
  const chart = game.currentChart;
  if (!chart) return;
  attractAngle += dt * 0.045;
  const tower = chart.finaleTower;
  const top = tower.base + tower.height;
  // 타워를 옆에서 올려다보는 거리·높이라야 스카이라인이 함께 잡힌다
  const radius = Math.max(760, top * 1.9);
  const cam = game.camera;
  cam.position.set(
    tower.x + Math.cos(attractAngle) * radius,
    tower.base + top * 0.5 + Math.sin(attractAngle * 0.7) * top * 0.05,
    tower.z + Math.sin(attractAngle) * radius,
  );
  // UI 가 화면 가운데를 덮으므로, 바라보는 점을 월드 Y축 기준으로 돌려
  // 랜드마크를 오른쪽으로 밀어낸다. 카메라 자체를 돌리면 수평선이 기운다.
  const yaw = -0.34;
  const dx = tower.x - cam.position.x;
  const dz = tower.z - cam.position.z;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  attractTarget.set(
    cam.position.x + dx * cs - dz * sn,
    tower.base + top * 0.4,
    cam.position.z + dx * sn + dz * cs,
  );
  cam.lookAt(attractTarget);
  // Euler 의 z 를 직접 대입하면 요각에 따라 짐벌락으로 화면이 통째로 기운다.
  // 로컬 축 기준 증분 회전을 써야 한다.
  cam.rotateZ(Math.sin(attractAngle * 0.5) * 0.015);
  if (cam.fov !== 58) {
    cam.fov = 58;
    cam.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- 부팅

function boot(): void {
  const direct = params.get('stage');
  const target = direct ? (STAGES.find((s) => s.id === direct) ?? STAGES[0]) : STAGES[2];
  setOverlay(loadingScreen(target));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (direct) {
        // ?stage=<id> 로 바로 진입 (개발·검증용)
        game.load(target);
        attract = false;
        setOverlay(null);
        hud = new Hud(target);
        uiRoot.appendChild(hud.el);
        void engine.resume();
        game.start();
      } else {
        // 타이틀 배경으로 여의도 스카이라인을 띄운다
        game.load(target);
        showTitle();
      }
      lastTime = performance.now();
      requestAnimationFrame(frame);
    });
  });
}

boot();
