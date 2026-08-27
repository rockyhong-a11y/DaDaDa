import type { StageDef } from '../data/types';
import type { StageResult } from '../game/game';
import type { Settings, Store } from './store';

const ACCENTS = [
  'rgba(255, 180, 87, 0.55)',
  'rgba(255, 79, 196, 0.5)',
  'rgba(56, 246, 255, 0.5)',
  'rgba(124, 130, 255, 0.55)',
  'rgba(107, 255, 158, 0.45)',
];

export function el<T extends HTMLElement = HTMLDivElement>(html: string): T {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as T;
}

// ---------------------------------------------------------------- 타이틀

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // iOS Safari 등 미지원 환경에서는 조용히 넘어간다
  }
}

export function titleScreen(onStart: () => void, onSettings: () => void, onHow: () => void): HTMLElement {
  const root = el(`
    <div class="screen screen--showcase">
      <div class="title-mark">
        <div class="title-mark__logo">DaDaDa</div>
        <div class="title-mark__sub">서울 스카이 스윙</div>
        <p class="title-mark__desc">
          실제 서울 좌표 위에 세운 빌딩숲을 웹스윙으로 건넌다.<br />
          BGM 의 박자에 맞춰 웹을 쏘면 고도를 지키고, 놓치면 그대로 추락한다.<br />
          목동 · 여의도 · 잠실 · 테헤란로 · 남산까지 다섯 스테이지.
        </p>
      </div>
      <div class="title-actions">
        <button class="btn btn--primary" data-act="start">스테이지 선택</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn--ghost" data-act="how">플레이 방법</button>
          <button class="btn btn--ghost" data-act="settings">설정</button>
          ${fullscreenSupported() ? '<button class="btn btn--ghost" data-act="full">전체화면</button>' : ''}
        </div>
        <p class="hint"><kbd>Space</kbd> 또는 화면 탭으로 웹 발사 · <kbd>Esc</kbd> 일시정지</p>
      </div>
    </div>
  `);
  root.querySelector('[data-act="start"]')?.addEventListener('click', onStart);
  root.querySelector('[data-act="settings"]')?.addEventListener('click', onSettings);
  root.querySelector('[data-act="how"]')?.addEventListener('click', onHow);
  root.querySelector('[data-act="full"]')?.addEventListener('click', () => void toggleFullscreen());
  return root;
}

// ---------------------------------------------------------------- 스테이지 선택

export function stageSelectScreen(
  stages: StageDef[],
  store: Store,
  onPick: (s: StageDef) => void,
  onBack: () => void,
): HTMLElement {
  const root = el(`
    <div class="screen screen--showcase">
      <div class="select">
        <div class="select__head">
          <div class="select__title">스테이지 선택<small>SEOUL SKYLINE · 5 STAGES</small></div>
          <button class="btn btn--ghost" data-act="back">← 타이틀</button>
        </div>
        <div class="stage-grid"></div>
        <p class="hint">다섯 스테이지 모두 처음부터 자유롭게 고를 수 있다. 건물 배치와 높이는 실제 서울 좌표를 기준으로 생성된다.</p>
      </div>
    </div>
  `);
  const grid = root.querySelector('.stage-grid') as HTMLElement;

  stages.forEach((s, i) => {
    const rec = store.record(s.id);
    const card = el<HTMLButtonElement>(`
      <button class="stage-card" style="--accent:${ACCENTS[i % ACCENTS.length]}">
        <div class="stage-card__no">STAGE ${String(i + 1).padStart(2, '0')}</div>
        <div class="stage-card__name">${s.name}</div>
        <div class="stage-card__district">${s.district}</div>
        <div class="stage-card__tag">${s.tagline}</div>
        <div class="stage-card__meta">
          <span class="diff">${Array.from({ length: 5 }, (_, k) => `<i class="${k < s.difficulty ? 'on' : ''}"></i>`).join('')}</span>
          <span>${s.bpm} BPM</span>
        </div>
        ${
          rec
            ? `<div class="stage-card__best"><span class="rank-chip" data-rank="${rec.rank}">${rec.rank}</span>${rec.score.toLocaleString('ko-KR')} · ${(rec.acc * 100).toFixed(1)}%</div>`
            : `<div class="stage-card__best" style="color:var(--muted)">기록 없음</div>`
        }
      </button>
    `);
    card.addEventListener('click', () => onPick(s));
    grid.appendChild(card);
  });

  root.querySelector('[data-act="back"]')?.addEventListener('click', onBack);
  return root;
}

// ---------------------------------------------------------------- 로딩

export function loadingScreen(stage: StageDef): HTMLElement {
  return el(`
    <div class="loading">
      <div class="loading__inner">
        <div class="title-mark__sub" style="font-size:15px">${stage.name}</div>
        <div class="loading__bar"><i></i></div>
        <div class="loading__text">${stage.district} 빌딩 데이터 생성 중…</div>
      </div>
    </div>
  `);
}

// ---------------------------------------------------------------- 결과

export function resultScreen(
  r: StageResult,
  isNewBest: boolean,
  hasNext: boolean,
  onRetry: () => void,
  onNext: () => void,
  onSelect: () => void,
): HTMLElement {
  const counts = r.counts;
  const root = el(`
    <div class="screen">
      <div class="result">
        <div class="result__head">
          <div class="result__rank" data-rank="${r.rank}">${r.rank}</div>
          <div>
            <div class="result__title">${r.cleared ? 'STAGE CLEAR' : 'FALL'}<small>${r.stage.name} · ${r.stage.district}</small></div>
            <div class="result__score">${r.score.toLocaleString('ko-KR')}</div>
            ${r.fullCombo ? '<span class="badge-fc">FULL COMBO</span>' : ''}
            ${isNewBest ? '<span class="badge-fc" style="background:var(--amber)">NEW BEST</span>' : ''}
          </div>
        </div>
        <div class="result__grid">
          <div class="stat" data-k="PERFECT"><b>${counts.PERFECT}</b><span>PERFECT</span></div>
          <div class="stat" data-k="GREAT"><b>${counts.GREAT}</b><span>GREAT</span></div>
          <div class="stat" data-k="GOOD"><b>${counts.GOOD}</b><span>GOOD</span></div>
          <div class="stat" data-k="MISS"><b>${counts.MISS}</b><span>MISS</span></div>
          <div class="stat"><b>${(r.acc * 100).toFixed(2)}%</b><span>ACCURACY</span></div>
          <div class="stat"><b>${r.maxCombo}</b><span>MAX COMBO</span></div>
        </div>
        <div class="result__actions">
          <button class="btn" data-act="retry">다시 도전</button>
          ${r.cleared && hasNext ? '<button class="btn btn--primary" data-act="next">다음 스테이지</button>' : ''}
          <button class="btn btn--ghost" data-act="select">스테이지 선택</button>
        </div>
        ${r.cleared ? '' : '<p class="note">스윙 노트를 연달아 놓치면 추락한다. 박자를 놓쳤을 때 무리하게 따라가지 말고 다음 박에 다시 붙어라.</p>'}
      </div>
    </div>
  `);
  root.querySelector('[data-act="retry"]')?.addEventListener('click', onRetry);
  root.querySelector('[data-act="next"]')?.addEventListener('click', onNext);
  root.querySelector('[data-act="select"]')?.addEventListener('click', onSelect);
  return root;
}

// ---------------------------------------------------------------- 일시정지

export function pauseScreen(onResume: () => void, onRetry: () => void, onQuit: () => void): HTMLElement {
  const root = el(`
    <div class="screen screen--transparent">
      <div class="panel">
        <h2>일시정지</h2>
        <div class="result__actions">
          <button class="btn btn--primary" data-act="resume">계속하기</button>
          <button class="btn" data-act="retry">처음부터</button>
          <button class="btn btn--ghost" data-act="quit">그만두기</button>
        </div>
        <p class="note"><kbd>Esc</kbd> 로도 계속할 수 있다.</p>
      </div>
    </div>
  `);
  root.querySelector('[data-act="resume"]')?.addEventListener('click', onResume);
  root.querySelector('[data-act="retry"]')?.addEventListener('click', onRetry);
  root.querySelector('[data-act="quit"]')?.addEventListener('click', onQuit);
  return root;
}

// ---------------------------------------------------------------- 플레이 방법

export function howToScreen(onClose: () => void): HTMLElement {
  const root = el(`
    <div class="screen">
      <div class="panel" style="width:min(620px,100%)">
        <h2>플레이 방법</h2>
        <div class="note" style="font-size:13px;line-height:1.9;color:var(--text)">
          <p><b style="color:var(--cyan)">◆ 스윙 노트</b> — 화면 정중앙 청록색 마름모. 크게 나타나 오므라들다
          정중앙 기준 링에 꼭 맞는 순간 <kbd>Space</kbd>·<kbd>J</kbd> 또는 화면 탭. 새 웹을 쏴 다음 건물로 넘어간다.</p>
          <p><b style="color:var(--magenta)">● 에어 노트</b> — 분홍색 원. 스윙 도중 공중에서 넣는 트릭. 점수와 모멘텀이 오른다.</p>
          <p><b>판정</b> — PERFECT / GREAT / GOOD / MISS. 스테이지가 올라갈수록 판정 창이 좁아진다.
          판정 텍스트는 노트를 가리지 않도록 화면 위쪽에 뜬다.</p>
          <p><b style="color:var(--magenta)">SWING POWER · 피버</b> — 0%에서 시작해 노트를 성공시킬 때마다 차오른다.
          100%를 채우면 <b>피버 모드</b>가 8초간 발동해, 타이밍과 상관없이 <b>연타만으로</b> 앞의 노트가 전부
          PERFECT 처리된다. 피버가 끝나면 게이지는 다시 0%부터다.</p>
          <p><b style="color:#cfe9ff">GLIDE · 활강 구간</b> — 스테이지마다 중간과 마지막에 한 번씩,
          웹을 놓고 도시 위로 솟아올라 서울 전경을 내려다보며 활공하는 구간이 들어간다. 이때는 걸 웹이 없으므로
          노트가 전부 공중 트릭으로 바뀌고, 카메라가 뒤로 빠지며 시야가 넓어진다.</p>
          <p><b>추락</b> — 미스가 쌓이면 고도가 꺼진다. 스윙 노트를 연달아 놓치면 추락해 실패한다.</p>
          <p><b>고도</b> — 비행 고도는 주변 건물 높이를 따라간다. 목동에서는 40m, 잠실 롯데월드타워 정상에서는 555m 까지 올라간다.</p>
          <p><b>피날레</b> — 각 스테이지의 마지막 구간은 랜드마크를 나선으로 타고 오르는 등반 구간이다.</p>
        </div>
        <p class="note">싱크가 밀린다면 설정에서 오디오 오프셋을 조정하라.</p>
        <div class="result__actions"><button class="btn btn--primary" data-act="close">닫기</button></div>
      </div>
    </div>
  `);
  root.querySelector('[data-act="close"]')?.addEventListener('click', onClose);
  return root;
}

// ---------------------------------------------------------------- 설정

export function settingsScreen(
  store: Store,
  apply: (s: Settings) => void,
  onClose: () => void,
): HTMLElement {
  const s = store.settings;
  const root = el(`
    <div class="screen">
      <div class="panel">
        <h2>설정</h2>

        <div class="field">
          <div class="field__row"><label for="mv">음악 볼륨</label><span id="mvv">${Math.round(s.music * 100)}%</span></div>
          <input id="mv" type="range" min="0" max="100" value="${Math.round(s.music * 100)}" />
        </div>

        <div class="field">
          <div class="field__row"><label for="sv">효과음 볼륨</label><span id="svv">${Math.round(s.sfx * 100)}%</span></div>
          <input id="sv" type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" />
        </div>

        <div class="field">
          <div class="field__row"><label for="off">오디오 오프셋</label><span id="offv">${s.offsetMs} ms</span></div>
          <input id="off" type="range" min="-150" max="150" step="5" value="${s.offsetMs}" />
          <p class="note">노트보다 소리가 늦게 들리면 값을 키운다. 판정이 계속 빠르게 잡히면 값을 줄인다.</p>
        </div>

        <div class="field">
          <div class="field__row"><label>그래픽 품질</label></div>
          <div class="seg" id="qual">
            <button data-q="low" class="${s.quality === 'low' ? 'on' : ''}">낮음</button>
            <button data-q="medium" class="${s.quality === 'medium' ? 'on' : ''}">보통</button>
            <button data-q="high" class="${s.quality === 'high' ? 'on' : ''}">높음</button>
          </div>
          <p class="note">
            낮음은 블룸 후처리를 끄고 해상도를 제한한다.
            ${s.autoQuality ? '지금은 기기 성능에 맞춰 <b>자동 조정</b> 중이며, 직접 고르면 자동 조정이 꺼진다.' : '자동 조정이 꺼져 있다.'}
          </p>
        </div>

        <div class="field">
          <div class="field__row"><label for="gk">Google 3D Tiles API 키 (선택)</label></div>
          <input id="gk" type="password" placeholder="AIza…" value="${escapeAttr(s.googleKey)}" />
          <div class="field__row" style="margin-top:4px">
            <label for="ut">실사 3D 타일 배경 사용</label>
            <input id="ut" type="checkbox" ${s.useTiles ? 'checked' : ''} />
          </div>
          <p class="note">
            키를 넣으면 Google Photorealistic 3D Tiles 로 실제 서울 지형·건물을 배경에 겹쳐 띄운다.
            키가 없으면 실제 좌표로 생성한 자체 도시 모델로 플레이한다. 키는 이 브라우저에만 저장된다.
          </p>
        </div>

        <div class="result__actions">
          <button class="btn btn--primary" data-act="close">닫기</button>
          <button class="btn btn--ghost" data-act="reset">기록 초기화</button>
        </div>
      </div>
    </div>
  `);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const mv = q<HTMLInputElement>('#mv');
  const sv = q<HTMLInputElement>('#sv');
  const off = q<HTMLInputElement>('#off');
  const gk = q<HTMLInputElement>('#gk');
  const ut = q<HTMLInputElement>('#ut');

  const push = (patch: Partial<Settings>): void => {
    store.updateSettings(patch);
    apply(store.settings);
  };

  mv.addEventListener('input', () => {
    q('#mvv').textContent = `${mv.value}%`;
    push({ music: Number(mv.value) / 100 });
  });
  sv.addEventListener('input', () => {
    q('#svv').textContent = `${sv.value}%`;
    push({ sfx: Number(sv.value) / 100 });
  });
  off.addEventListener('input', () => {
    q('#offv').textContent = `${off.value} ms`;
    push({ offsetMs: Number(off.value) });
  });
  gk.addEventListener('change', () => push({ googleKey: gk.value.trim() }));
  ut.addEventListener('change', () => push({ useTiles: ut.checked }));

  q('#qual').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const val = btn.dataset.q as Settings['quality'];
    for (const b of Array.from(q('#qual').querySelectorAll('button'))) b.classList.toggle('on', b === btn);
    // 직접 골랐으면 자동 조정을 끈다
    push({ quality: val, autoQuality: false });
  });

  root.querySelector('[data-act="close"]')?.addEventListener('click', onClose);
  root.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
    if (confirm('모든 기록과 설정을 지울까요?')) {
      store.resetAll();
      location.reload();
    }
  });
  return root;
}

function escapeAttr(v: string): string {
  return v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
