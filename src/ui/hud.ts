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
  private readonly feverWrap: HTMLElement;
  private readonly glideWrap: HTMLElement;
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
  private readonly reticle: HTMLElement;
  private readonly reticleTarget: HTMLElement;
  private readonly progBar: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly totalEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly heatBar: HTMLElement;
  private readonly notePool: HTMLElement[] = [];
  private readonly tagPool: HTMLElement[] = [];

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
      <div class="hud__hp"><label>SWING POWER</label><div class="bar"><i style="width:0%"></i></div></div>
      <div class="hud__fever" style="display:none"><b>FEVER!</b><span>연타로 밀어붙여라</span></div>
      <div class="hud__glide" style="display:none"><b>GLIDE</b><span>서울이 발밑에 있다</span></div>
      <div class="hud__alt">
        <div class="hud__alt-row"><b>0</b><em>m</em></div>
        <span>ALTITUDE</span>
        <div class="hud__alt-row spd"><b>0</b><em>km/h</em></div>
      </div>
      <div class="hud__judge"><b>PERFECT</b><span>+0 ms</span></div>
      <div class="hud__callout"><span class="tag"></span><b></b><em></em></div>
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
    this.feverWrap = q('.hud__fever');
    this.glideWrap = q('.hud__glide');
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

  /**
   * 랜드마크 이름표를 실제 건물 위 화면 좌표에 그린다.
   * 멀수록 작고 흐릿하게(살짝 블러까지), 가까울수록 크고 또렷하게 —
   * 스카이라인 저 끝의 건물 이름이 다가올수록 선명해지는 원근을 만든다.
   */
  private renderLandmarkTags(tags: HudState['landmarkTags']): void {
    for (let i = 0; i < Math.max(this.tagPool.length, tags.length); i++) {
      const t = tags[i];
      const el = this.tagPool[i];
      if (!t) {
        if (el) el.style.display = 'none';
        continue;
      }
      let node = el;
      if (!node) {
        node = document.createElement('div');
        node.className = 'lm-tag';
        this.el.appendChild(node);
        this.tagPool[i] = node;
      }
      if (node.textContent !== t.name) node.textContent = t.name;
      // near 를 그대로 쓰면 먼 것이 너무 빨리 사라진다. 완만한 곡선으로 편다.
      const k = Math.pow(t.near, 0.7);
      const scale = 0.62 + k * 0.5;
      const opacity = (t.major ? 0.3 : 0.16) + k * (t.major ? 0.7 : 0.74);
      const blur = (1 - k) * 1.8;
      node.style.display = '';
      node.classList.toggle('major', t.major);
      node.style.left = `${(t.sx * 100).toFixed(2)}%`;
      node.style.top = `${(t.sy * 100).toFixed(2)}%`;
      node.style.opacity = opacity.toFixed(3);
      node.style.transform = `translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      node.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
    }
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

    // SWING POWER: 0 에서 차올라 100 이면 피버. 피버 중에는 남은 시간만큼 다시 비워진다.
    this.hpBar.style.width = `${s.power}%`;
    this.hpWrap.classList.toggle('fever', s.feverActive);
    this.feverWrap.style.display = s.feverActive ? '' : 'none';
    // 활강 배너는 피버와 자리가 겹치므로 피버가 우선한다
    this.glideWrap.style.display = s.gliding && !s.feverActive ? '' : 'none';

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

    // 구역(area) 배너 — 처음 들어온 지역 이름을 한 번씩만 알려 준다
    if (s.calloutTitle && s.calloutAt !== this.lastCalloutAt) {
      this.lastCalloutAt = s.calloutAt;
      this.calloutWrap.dataset.kind = s.calloutKind ?? 'area';
      this.calloutTag.textContent = '지나는 구역';
      this.calloutEl.textContent = s.calloutTitle;
      this.calloutSub.textContent = s.calloutSubtitle;
      this.calloutWrap.classList.remove('show-area');
      void this.calloutWrap.offsetWidth;
      this.calloutWrap.classList.add('show-area');
    }

    this.renderLandmarkTags(s.landmarkTags);

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

    // 리티클: 노트가 화면 좌우 가장자리에서 옅게 등장해 정중앙(기준선)으로
    // 다가오며 밝아지고 오므라든다. 등장 시간(lead)은 스테이지 템포에 맞춰
    // game.ts 가 정한다 — 빠른 스테이지일수록 짧게 잡아 링이 과하게
    // 겹치지 않게 한다. 판정이 난 뒤에도 잠깐 중앙에 남아(FADE) 판정
    // 색으로 물들었다 사라진다.
    const lead = s.noteLead;
    const edgeDist = Math.max(120, this.el.clientWidth / 2 - 60);
    for (let i = 0; i < Math.max(this.notePool.length, s.lane.length); i++) {
      const el = this.notePool[i];
      const n = s.lane[i];
      if (!n) {
        if (el) el.style.display = 'none';
        continue;
      }
      const node = this.noteEl(i);
      const k = Math.max(0, Math.min(1, n.remain / lead));
      // approach: 0 = 방금 가장자리에서 등장, 1 = 중앙 기준선에 도달(판정 시점)
      const approach = 1 - k;
      const scale = 1 + k * REACH;
      const offset = (1 - approach) * n.side * edgeDist;
      const saturate = 0.12 + approach * 0.88;
      const brightness = 0.45 + approach * 0.7;
      const opacity =
        n.remain >= 0 ? Math.min(1, (lead - n.remain) / FADE) : Math.max(0, (FADE + n.remain) / FADE);
      node.style.display = '';
      node.className = `reticle__note ${n.kind}`;
      node.style.opacity = String(opacity);
      node.style.filter = `saturate(${saturate.toFixed(2)}) brightness(${brightness.toFixed(2)})`;
      const rotate = n.kind === 'swing' ? ' rotate(45deg)' : '';
      node.style.transform = `translateX(${offset.toFixed(1)}px)${rotate} scale(${scale.toFixed(3)})`;
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
