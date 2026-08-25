import type { HudState } from '../game/game';
import type { StageDef } from '../data/types';

const JUDGE_COLOR: Record<string, string> = {
  PERFECT: 'var(--cyan)',
  GREAT: 'var(--green)',
  GOOD: 'var(--amber)',
  MISS: 'var(--red)',
};

const JUDGE_LABEL: Record<string, string> = {
  PERFECT: 'PERFECT',
  GREAT: 'GREAT',
  GOOD: 'GOOD',
  MISS: 'MISS',
};

/** 레인에서 노트가 판정선까지 다가오는 데 보이는 시간(초) */
const LANE_LEAD = 1.35;

/** 인게임 HUD. DOM 으로 그려 가볍고 선명하게 유지한다. */
export class Hud {
  readonly el: HTMLDivElement;
  private readonly scoreEl: HTMLElement;
  private readonly accEl: HTMLElement;
  private readonly comboWrap: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly hpWrap: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly altEl: HTMLElement;
  private readonly spdEl: HTMLElement;
  private readonly judgeWrap: HTMLElement;
  private readonly judgeEl: HTMLElement;
  private readonly judgeOff: HTMLElement;
  private readonly lane: HTMLElement;
  private readonly hitline: HTMLElement;
  private readonly progBar: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly heatBar: HTMLElement;
  private readonly notePool: HTMLElement[] = [];

  private lastCombo = 0;
  private lastJudgeAt = -99;
  private lastBeat = -1;

  constructor(stage: StageDef) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__top">
        <div class="hud__stage">STAGE ${stage.index + 1} · ${stage.name}<small>${stage.district} · ${stage.bpm} BPM</small></div>
        <div class="hud__score"><b>0</b><span>ACC 100.00%</span></div>
        <div class="hud__combo"><b>0</b><span>COMBO</span></div>
      </div>
      <div class="hud__hp"><label>SWING POWER</label><div class="bar"><i style="width:100%"></i></div></div>
      <div class="hud__alt">
        <div class="hud__alt-row"><b>0</b><em>m</em></div>
        <span>ALTITUDE</span>
        <div class="hud__alt-row spd"><b>0</b><em>km/h</em></div>
      </div>
      <div class="hud__judge"><b>PERFECT</b><span>+0 ms</span></div>
      <div class="lane">
        <div class="lane__track"></div>
        <div class="lane__hitline"></div>
        <div class="lane__label">SPACE · 탭</div>
      </div>
      <div class="hud__progress"><span class="t">0:00</span><div class="bar"><i style="width:0%"></i></div><span class="d">0:00</span></div>
      <div class="hud__heat"><label>MOMENTUM</label><div class="bar"><i style="width:0%"></i></div></div>
      <div class="hud__countdown" style="display:none">3</div>
    `;
    const q = <T extends HTMLElement>(sel: string): T => this.el.querySelector(sel) as T;
    this.scoreEl = q('.hud__score b');
    this.accEl = q('.hud__score span');
    this.comboWrap = q('.hud__combo');
    this.comboEl = q('.hud__combo b');
    this.hpWrap = q('.hud__hp');
    this.hpBar = q('.hud__hp .bar i');
    this.altEl = q('.hud__alt-row b');
    this.spdEl = q('.hud__alt-row.spd b');
    this.judgeWrap = q('.hud__judge');
    this.judgeEl = q('.hud__judge b');
    this.judgeOff = q('.hud__judge span');
    this.lane = q('.lane');
    this.hitline = q('.lane__hitline');
    this.progBar = q('.hud__progress .bar i');
    this.timeEl = q('.hud__progress .t');
    this.totalEl = q('.hud__progress .d');
    this.countEl = q('.hud__countdown');
    this.heatBar = q('.hud__heat .bar i');
  }

  private noteEl(i: number): HTMLElement {
    let el = this.notePool[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'lane__note';
      this.lane.appendChild(el);
      this.notePool[i] = el;
    }
    return el;
  }

  update(s: HudState, beatIndex: number): void {
    this.scoreEl.textContent = s.score.toLocaleString('ko-KR');
    this.accEl.textContent = `ACC ${(s.acc * 100).toFixed(2)}%`;

    if (s.combo !== this.lastCombo) {
      this.comboEl.textContent = String(s.combo);
      this.comboWrap.classList.remove('pop');
      // 리플로우를 강제해 애니메이션을 재시작
      void this.comboWrap.offsetWidth;
      if (s.combo > 0) this.comboWrap.classList.add('pop');
      this.lastCombo = s.combo;
    }

    this.hpBar.style.width = `${s.hp}%`;
    this.hpWrap.classList.toggle('low', s.hp < 35);
    this.altEl.textContent = String(Math.round(s.altitude));
    this.spdEl.textContent = String(Math.min(9999, Math.round(s.speed * 3.6)));
    this.heatBar.style.width = `${Math.round(s.heat * 100)}%`;
    this.progBar.style.width = `${(s.progress * 100).toFixed(1)}%`;
    this.timeEl.textContent = fmtTime(Math.max(0, s.time));
    this.totalEl.textContent = fmtTime(s.duration);

    if (s.lastJudge && s.lastJudgeAt !== this.lastJudgeAt) {
      this.lastJudgeAt = s.lastJudgeAt;
      this.judgeEl.textContent = JUDGE_LABEL[s.lastJudge];
      this.judgeEl.style.color = JUDGE_COLOR[s.lastJudge];
      const ms = Math.round(s.lastOffset * 1000);
      this.judgeOff.textContent = s.lastJudge === 'MISS' ? '놓침' : `${ms >= 0 ? '+' : ''}${ms} ms`;
      this.judgeWrap.classList.remove('show');
      void this.judgeWrap.offsetWidth;
      this.judgeWrap.classList.add('show');
    }

    if (beatIndex !== this.lastBeat) {
      this.lastBeat = beatIndex;
      this.hitline.classList.remove('beat');
      void this.hitline.offsetWidth;
      this.hitline.classList.add('beat');
    }

    if (s.countdown > 0) {
      this.countEl.style.display = '';
      const n = Math.ceil(s.countdown);
      this.countEl.textContent = n > 3 ? 'READY' : String(n);
    } else if (this.countEl.style.display !== 'none') {
      this.countEl.style.display = 'none';
    }

    // 타이밍 레인: 오른쪽에서 중앙 판정선으로 흘러온다
    const half = this.lane.clientWidth / 2;
    for (let i = 0; i < Math.max(this.notePool.length, s.lane.length); i++) {
      const el = this.notePool[i];
      const n = s.lane[i];
      if (!n) {
        if (el) el.style.display = 'none';
        continue;
      }
      const node = this.noteEl(i);
      const x = half + (n.remain / LANE_LEAD) * half;
      node.style.display = '';
      node.style.left = `${x}px`;
      node.className = `lane__note${n.kind === 'air' ? ' air' : ''}`;
      node.style.opacity = n.remain > LANE_LEAD ? '0' : '1';
    }
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
