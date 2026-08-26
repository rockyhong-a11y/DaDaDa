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

/**
 * 홀드·연타는 순간 반응이 아니라 미리 준비해서 눌러야 하는 노트라
 * 스윙/에어보다 훨씬 먼 거리(=훨씬 이른 시점)부터 레인에 들어와 천천히
 * 다가오게 한다. game.ts 의 ACTION_PREVIEW_LEAD 와 맞춰 둔다.
 */
const LANE_LEAD_ACTION = 3.2;

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
  private readonly placeEl: HTMLElement;
  private readonly calloutWrap: HTMLElement;
  private readonly calloutTag: HTMLElement;
  private readonly calloutEl: HTMLElement;
  private readonly calloutSub: HTMLElement;
  private readonly holdWrap: HTMLElement;
  private readonly holdBar: HTMLElement;
  private readonly mashWrap: HTMLElement;
  private readonly mashCountEl: HTMLElement;
  private readonly mashTargetEl: HTMLElement;
  private readonly previewWrap: HTMLElement;
  private readonly previewLabel: HTMLElement;
  private readonly previewBar: HTMLElement;
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
  private lastCalloutAt = -99;
  private lastPlace: string | null = null;
  private lastTapRippleId = 0;

  constructor(stage: StageDef) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__top">
        <div class="hud__stage">STAGE ${stage.index + 1} · ${stage.name}<small>${stage.district} · ${stage.bpm} BPM</small><small class="place" hidden></small></div>
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
      <div class="hud__callout"><span class="tag"></span><b></b><em></em></div>
      <div class="hud__action hold" style="display:none">
        <span>HOLD</span>
        <div class="bar"><i style="width:0%"></i></div>
      </div>
      <div class="hud__action mash" style="display:none">
        <span>연타!</span>
        <b><em>0</em> / <em class="target">1</em></b>
      </div>
      <div class="hud__action preview" style="display:none">
        <span></span>
        <div class="bar"><i style="width:0%"></i></div>
      </div>
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
    this.placeEl = q('.hud__stage small.place');
    this.calloutWrap = q('.hud__callout');
    this.calloutTag = q('.hud__callout .tag');
    this.calloutEl = q('.hud__callout b');
    this.calloutSub = q('.hud__callout em');
    this.holdWrap = q('.hud__action.hold');
    this.holdBar = q('.hud__action.hold .bar i');
    this.mashWrap = q('.hud__action.mash');
    this.mashCountEl = q('.hud__action.mash em:not(.target)');
    this.mashTargetEl = q('.hud__action.mash em.target');
    this.previewWrap = q('.hud__action.preview');
    this.previewLabel = q('.hud__action.preview span');
    this.previewBar = q('.hud__action.preview .bar i');
    this.lane = q('.lane');
    this.hitline = q('.lane__hitline');
    this.progBar = q('.hud__progress .bar i');
    this.timeEl = q('.hud__progress .t');
    this.totalEl = q('.hud__progress .d');
    this.countEl = q('.hud__countdown');
    this.heatBar = q('.hud__heat .bar i');
  }

  /**
   * 탭 지점에 순간 이펙트를 띄운다. 키보드 입력(x/y 없음)일 때는 탭할 화면
   * 좌표가 없으므로 판정선 위치로 대체한다.
   */
  private spawnTapRipple(x: number | null, y: number | null): void {
    let px = x;
    let py = y;
    if (px == null || py == null) {
      const r = this.hitline.getBoundingClientRect();
      px = r.left + r.width / 2;
      py = r.top + r.height / 2;
    }
    const el = document.createElement('div');
    el.className = 'tap-ripple';
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    this.el.appendChild(el);
    const cleanup = (): void => el.remove();
    el.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 700);
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
      const milestone = s.combo > 0 && s.combo % 10 === 0 && s.combo > this.lastCombo;
      this.comboWrap.classList.remove('pop', 'milestone');
      // 리플로우를 강제해 애니메이션을 재시작
      void this.comboWrap.offsetWidth;
      if (s.combo > 0) this.comboWrap.classList.add('pop');
      if (milestone) this.comboWrap.classList.add('milestone');
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

    this.holdWrap.style.display = s.holdActive ? '' : 'none';
    if (s.holdActive) this.holdBar.style.width = `${Math.round(s.holdProgress * 100)}%`;

    this.mashWrap.style.display = s.mashActive ? '' : 'none';
    if (s.mashActive) {
      this.mashCountEl.textContent = String(Math.min(s.mashCount, s.mashTarget));
      this.mashTargetEl.textContent = String(s.mashTarget);
      this.mashWrap.classList.toggle('full', s.mashCount >= s.mashTarget);
    }

    // 아직 시작되지 않은 홀드/연타를 미리 알려 준다 — 게이지가 차오를수록
    // 곧 눌러야 한다는 걸 인지하고 준비할 수 있게.
    if (s.nextActionKind) {
      this.previewWrap.style.display = '';
      this.previewWrap.dataset.kind = s.nextActionKind;
      this.previewLabel.textContent = s.nextActionKind === 'hold' ? '홀드 준비' : '연타 준비';
      const k = 1 - Math.max(0, Math.min(1, s.nextActionRemain / LANE_LEAD_ACTION));
      this.previewBar.style.width = `${Math.round(k * 100)}%`;
    } else {
      this.previewWrap.style.display = 'none';
    }

    if (s.lastJudge && s.lastJudgeAt !== this.lastJudgeAt) {
      this.lastJudgeAt = s.lastJudgeAt;
      this.judgeEl.textContent = JUDGE_LABEL[s.lastJudge];
      this.judgeEl.style.color = JUDGE_COLOR[s.lastJudge];
      const ms = Math.round(s.lastOffset * 1000);
      this.judgeOff.textContent = s.lastJudge === 'MISS' ? '놓침' : `${ms >= 0 ? '+' : ''}${ms} ms`;
      this.judgeWrap.classList.remove('show');
      void this.judgeWrap.offsetWidth;
      this.judgeWrap.classList.add('show');

      // 판정선 자체도 판정 색으로 번쩍인다 — 터치가 들어간 그 자리에서 바로 결과가 보이게.
      this.hitline.dataset.judge = s.lastJudge;
      this.hitline.classList.remove('judge-hit');
      void this.hitline.offsetWidth;
      this.hitline.classList.add('judge-hit');
    }

    if (s.place !== this.lastPlace) {
      this.lastPlace = s.place;
      this.placeEl.hidden = !s.place;
      if (s.place) this.placeEl.textContent = `▸ ${s.place}`;
    }

    if (s.calloutTitle && s.calloutAt !== this.lastCalloutAt) {
      this.lastCalloutAt = s.calloutAt;
      this.calloutWrap.dataset.kind = s.calloutKind ?? 'landmark';
      this.calloutTag.textContent = s.calloutKind === 'area' ? '지나는 구역' : '랜드마크';
      this.calloutEl.textContent = s.calloutTitle;
      this.calloutSub.textContent = s.calloutSubtitle;
      this.calloutWrap.classList.remove('show', 'show-area');
      void this.calloutWrap.offsetWidth;
      this.calloutWrap.classList.add(s.calloutKind === 'area' ? 'show-area' : 'show');
    }

    // 랜드마크 배너는 화면 중앙이 아니라 실제 건물 위 화면 좌표를 매 프레임 따라간다.
    // 구역(area) 배너는 건물이 아니라 지역 전체를 가리키는 것이라 고정 위치를 유지한다.
    if (s.calloutKind === 'landmark') {
      this.calloutWrap.classList.add('world');
      this.calloutWrap.style.left = `${(s.calloutScreenX * 100).toFixed(2)}%`;
      this.calloutWrap.style.visibility = s.calloutWorldVisible ? '' : 'hidden';
      this.calloutWrap.style.setProperty('--wy', `${(s.calloutScreenY * 100).toFixed(2)}%`);
    } else {
      this.calloutWrap.classList.remove('world');
      this.calloutWrap.style.left = '';
      this.calloutWrap.style.visibility = '';
    }

    if (s.tapRippleId !== this.lastTapRippleId) {
      this.lastTapRippleId = s.tapRippleId;
      this.spawnTapRipple(s.tapRippleX, s.tapRippleY);
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

    // 타이밍 레인: 오른쪽에서 중앙 판정선으로 흘러온다.
    // 홀드·연타는 훨씬 먼 거리(LANE_LEAD_ACTION)부터 등장해 스윙/에어보다
    // 한참 일찍, 훨씬 천천히 다가온다 — 미리 보고 준비할 여유를 주기 위해서다.
    const half = this.lane.clientWidth / 2;
    for (let i = 0; i < Math.max(this.notePool.length, s.lane.length); i++) {
      const el = this.notePool[i];
      const n = s.lane[i];
      if (!n) {
        if (el) el.style.display = 'none';
        continue;
      }
      const isAction = n.kind === 'hold' || n.kind === 'mash';
      const lead = isAction ? LANE_LEAD_ACTION : LANE_LEAD;
      const node = this.noteEl(i);
      const x = half + (n.remain / lead) * half;
      node.style.display = '';
      node.className = `lane__note ${n.kind}`;
      node.style.opacity = n.remain > lead ? '0' : '1';
      if (n.kind === 'hold' && n.holdEndRemain !== undefined) {
        // 시작(왼쪽, 판정선에 먼저 닿음) ~ 종료(오른쪽, 아직 다가오는 중) 를
        // 잇는 막대로 그려 "이 구간 내내 눌러야 한다"는 걸 보여 준다.
        const xEnd = half + (Math.max(0, n.holdEndRemain) / lead) * half;
        node.style.left = `${x}px`;
        node.style.width = `${Math.max(4, xEnd - x)}px`;
      } else {
        node.style.left = `${x}px`;
        node.style.width = '';
      }
    }
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
