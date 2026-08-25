// 개발용: 로컬 프리뷰 서버에 접속해 화면을 캡처하고 콘솔 오류를 수집한다.
//
//   npm run build && npm run preview
//   npm i -D playwright   # 이 스크립트에만 필요하므로 기본 의존성에는 없다
//   node scripts/shoot.mjs "http://localhost:4173/?stage=jamsil&auto=1" /tmp/shots '[{"wait":20000,"shot":"a"}]'
//
// 환경변수: VW/VH(뷰포트), TOUCH(모바일), QUALITY(low|medium|high), CHROME_PATH
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const outDir = process.argv[3] ?? '/tmp/shots';
const steps = JSON.parse(process.argv[4] ?? '[]');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const vw = Number(process.env.VW ?? 1440);
const vh = Number(process.env.VH ?? 810);
const page = await browser.newPage({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: 1,
  hasTouch: !!process.env.TOUCH,
  isMobile: !!process.env.TOUCH,
});
if (process.env.QUALITY) {
  await page.addInitScript((q) => {
    localStorage.setItem(
      'dadada.seoul-swing.v1',
      JSON.stringify({ version: 1, records: {}, settings: { music: 0.7, sfx: 0.8, offsetMs: 0, quality: q, googleKey: '', useTiles: false } }),
    );
  }, process.env.QUALITY);
}
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

let i = 0;
for (const step of steps) {
  if (step.click) {
    try {
      await page.click(step.click, { timeout: 5000 });
    } catch (e) {
      errors.push(`[click-fail] ${step.click}: ${e.message}`);
    }
  }
  if (step.key) await page.keyboard.press(step.key);
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.shot) {
    await page.screenshot({ path: `${outDir}/${String(i).padStart(2, '0')}-${step.shot}.png` });
  }
  i++;
}
await page.screenshot({ path: `${outDir}/final.png` });
console.log(JSON.stringify({ errors: errors.slice(0, 40) }, null, 1));
await browser.close();
