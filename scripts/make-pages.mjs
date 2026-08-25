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
import { copyFile, mkdir, writeFile, stat } from 'node:fs/promises';
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
