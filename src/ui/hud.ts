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

/** 리티클에 노트가 등장해 중앙까지 오므라드는 데 걸리는 시간(초) */
const SWING_LEAD = 1.35;

/**
 * 홀드·연타는 순간 반응이 아니라 미리 준비해서 눌러야 하는 노트라
 * 스윙/에어보다 훨씬 이른 시점부터 등장해 천천히 오므라든다.
 * game.ts 의 ACTION_PREVIEW_LEAD 와 맞춰 둔다.
 */
const ACTION_LEAD = 3.2;

/** 등장/소멸 시 페이드에 걸리는 시간(초) */
const FADE = 0.25;

/** 원이 중앙 기준 크기의 몇 배로 커진 채 등장하는가 */
const REACH = 3.4;

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
  private readonly holdRing: HTMLElement;
  private readonly mashWrap: HTMLElement;
  private readonly mashRing: HTMLElement;
  private readonly mashCountEl: HTMLElement;
  private readonly mashTargetEl: HTMLElement;
  private readonly previewWrap: HTMLElement;
  private readonly previewLabel: HTMLElement;
  private readonly previewBar: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly reticleTarget: HTMLElement;
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
        <div class="ring"></div>
        <b>HOLD</b>
      </div>
      <div class="hud__action mash" style="display:none">
        <div class="ring"></div>
        <b><em>0</em>/<em class="target">1</em></b>
      </div>
      <div class="hud__action preview" style="display:none">
        <span></span>
        <div class="bar"><i style="width:0%"></i></div>
      </div>
      <div class="reticle">
        <div class="reticle__target"></div>
      </div>
      <div class="reticle__label">SPACE · 탭</div>
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
    this.holdRing = q('.hud__action.hold .ring');
    this.mashWrap = q('.hud__action.mash');
    this.mashRing = q('.hud__action.mash .ring');
    this.mashCountEl = q('.hud__action.mash em:not(.target)');
    this.mashTargetEl = q('.hud__action.mash em.target');
    this.previewWrap = q('.hud__action.preview');
    this.previewLabel = q('.hud__action.preview span');
    this.previewBar = q('.hud__action.preview .bar i');
    this.reticle = q('.reticle');
    this.reticleTarget = q('.reticle__target');
    this.progBar = q('.hud__progress .bar i');
    this.timeEl = q('.hud__progress .t');
    this.totalEl = q('.hud__progress .d');
    this.countEl = q('.hud__countdown');
    this.heatBar = q('.hud__heat .bar i');
  }

  /**
   * 탭 지점에 순간 이펙트를 띄운다. 키보드 입력(x/y 없음)일 때는 탭할 화면
   * 좌표가 없으므로 중앙 리티클(판정 기준선) 위치로 대체한다.
   */
  private spawnTapRipple(x: number | null, y: number | null): void {
    let px = x;
    let py = y;
    if (px == null || py == null) {
      const r = this.reticleTarget.getBoundingClientRect();
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
      el.className = 'reticle__note';
      this.reticle.appendChild(el);
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

    // 홀드/연타가 활성화되면 접근하던 리티클 노트 대신 중앙 링 자체가
    // 진행 상태를 보여 준다 — 같은 기준선 위에서 자연스럽게 이어받는다.
    this.holdWrap.style.display = s.holdActive ? '' : 'none';
    if (s.holdActive) this.holdRing.style.setProperty('--p', String(Math.round(s.holdProgress * 100)));

    this.mashWrap.style.display = s.mashActive ? '' : 'none';
    if (s.mashActive) {
      this.mashCountEl.textContent = String(Math.min(s.mashCount, s.mashTarget));
      this.mashTargetEl.textContent = String(s.mashTarget);
      this.mashWrap.classList.toggle('full', s.mashCount >= s.mashTarget);
      this.mashRing.style.setProperty('--p', String(Math.round((s.mashCount / s.mashTarget) * 100)));
    }

    // 아직 시작되지 않은 홀드/연타를 미리 알려 준다 — 게이지가 차오를수록
    // 곧 눌러야 한다는 걸 인지하고 준비할 수 있게.
    if (s.nextActionKind) {
      this.previewWrap.style.display = '';
      this.previewWrap.dataset.kind = s.nextActionKind;
      this.previewLabel.textContent = s.nextActionKind === 'hold' ? '홀드 준비' : '연타 준비';
      const k = 1 - Math.max(0, Math.min(1, s.nextActionRemain / ACTION_LEAD));
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

      // 중앙 기준선 자체도 판정 색으로 번쩍인다 — 터치가 들어간 그 자리에서 바로 결과가 보이게.
      this.reticleTarget.dataset.judge = s.lastJudge;
      this.reticleTarget.classList.remove('judge-hit');
      void this.reticleTarget.offsetWidth;
      this.reticleTarget.classList.add('judge-hit');
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
      this.reticleTarget.classList.remove('beat');
      void this.reticleTarget.offsetWidth;
      this.reticleTarget.classList.add('beat');
    }

    if (s.countdown > 0) {
      this.countEl.style.display = '';
      const n = Math.ceil(s.countdown);
      this.countEl.textContent = n > 3 ? 'READY' : String(n);
    } else if (this.countEl.style.display !== 'none') {
      this.countEl.style.display = 'none';
    }

    // 리티클: 노트가 크게 등장해 오므라들며 화면 정중앙(기준선)에 맞춰진다.
    // 홀드·연타는 훨씬 먼 거리(ACTION_LEAD)부터 등장해 스윙/에어보다 한참
    // 일찍, 훨씬 천천히 오므라든다 — 미리 보고 준비할 여유를 주기 위해서다.
    // 판정이 난 뒤에도 잠깐 남아(FADE) 판정 색으로 물들었다 사라진다.
    for (let i = 0; i < Math.max(this.notePool.length, s.lane.length); i++) {
      const el = this.notePool[i];
      const n = s.lane[i];
      if (!n) {
        if (el) el.style.display = 'none';
        continue;
      }
      const isAction = n.kind === 'hold' || n.kind === 'mash';
      const lead = isAction ? ACTION_LEAD : SWING_LEAD;
      const isDiamond = n.kind === 'swing' || n.kind === 'mash';
      const node = this.noteEl(i);
      const k = Math.max(0, Math.min(1, n.remain / lead));
      const scale = 1 + k * REACH;
      const opacity =
        n.remain >= 0 ? Math.min(1, (lead - n.remain) / FADE) : Math.max(0, (FADE + n.remain) / FADE);
      node.style.display = '';
      node.className = `reticle__note ${n.kind}`;
      node.style.opacity = String(opacity);
      node.style.transform = isDiamond ? `rotate(45deg) scale(${scale})` : `scale(${scale})`;
      if (n.hit) node.dataset.judge = n.hit;
      else delete node.dataset.judge;
    }
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
