#!/usr/bin/env node
/**
 * 단일 파일 빌드를 GitHub Pages 가 그대로 서빙할 수 있는 자리로 복사한다.
 *
 *   dist-single/dadada.html  ->  docs/index.html
 *
 * 저장소 설정에서 Pages 소스를 "Deploy from a branch → /docs" 로 두면
 * CI 없이도 https://<user>.github.io/<repo>/ 에서 바로 실행된다.
 * (.nojekyll 은 Jekyll 이 파일을 건드리지 않게 막는다.)
 */
import { copyFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'dist-single', 'dadada.html');
const outDir = join(ROOT, 'docs');

await mkdir(outDir, { recursive: true });
await copyFile(src, join(outDir, 'index.html'));
await writeFile(join(outDir, '.nojekyll'), '');
const { size } = await stat(join(outDir, 'index.html'));
console.log(`docs/index.html  ${(size / 1024).toFixed(0)} kB`);

// 실제 음원 BGM 은 HTML 에 인라인하지 않는다. base64 로 밀어 넣으면 용량이
// 1.37 배로 불어나는 데다 곡 전체를 받아야 게임이 시작되기 때문이다.
// Pages 는 그냥 정적 파일로 서빙하면 되므로 옆자리에 복사만 해 둔다.
const audioSrc = join(ROOT, 'public', 'audio');
const audioOut = join(outDir, 'audio');
let files = [];
try {
  files = await readdir(audioSrc);
} catch {
  files = [];
}
if (files.length) {
  await mkdir(audioOut, { recursive: true });
  for (const f of files) {
    await copyFile(join(audioSrc, f), join(audioOut, f));
    const s = await stat(join(audioOut, f));
    console.log(`docs/audio/${f}  ${(s.size / 1024).toFixed(0)} kB`);
  }
}
