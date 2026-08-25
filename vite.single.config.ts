import { defineConfig, type Plugin } from 'vite';
import type { OutputAsset, OutputChunk } from 'rollup';

/**
 * JS·CSS 를 전부 HTML 안에 밀어 넣어 파일 하나로 만든다.
 *
 * 번들을 IIFE 로 뽑고 일반 <script> 로 삽입하는 게 핵심이다.
 * type="module" 스크립트는 file:// 에서 CORS 로 차단돼(origin 이 null),
 * 브라우저로 HTML 을 직접 열면 흰 화면만 나온다.
 */
function inlineEverything(outputName: string): Plugin {
  return {
    name: 'inline-everything',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let js = '';
      let css = '';
      let html: OutputAsset | undefined;
      const drop: string[] = [];

      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'chunk') {
          js += (item as OutputChunk).code;
          drop.push(fileName);
        } else if (fileName.endsWith('.css')) {
          css += String(item.source);
          drop.push(fileName);
        } else if (fileName.endsWith('.html')) {
          html = item;
        }
      }
      if (!html) throw new Error('index.html 산출물을 찾지 못했습니다');

      let source = String(html.source)
        // vite 가 넣은 외부 참조 태그를 걷어낸다
        .replace(/<script\b[^>]*\bsrc=[^>]*><\/script>\s*/g, '')
        .replace(/<link\b[^>]*\brel="(?:stylesheet|modulepreload|preload)"[^>]*>\s*/g, '');

      // 스크립트/스타일 안에서 종료 태그로 오해될 문자열을 막는다
      const safeJs = js.replace(/<\/(script)/gi, '<\\/$1');
      const safeCss = css.replace(/<\/(style)/gi, '<\\/$1');

      // 치환 문자열이 아니라 함수를 써야 한다. 문자열을 쓰면 코드 안의
      // `$&` `$1` 같은 시퀀스를 replace 가 치환 패턴으로 해석해 번들을 망가뜨린다.
      if (safeCss) source = source.replace('</head>', () => `  <style>\n${safeCss}\n  </style>\n</head>`);
      source = source.replace('</body>', () => `  <script>\n${safeJs}\n  </script>\n</body>`);

      html.source = source;
      html.fileName = outputName;
      for (const name of drop) delete bundle[name];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineEverything('dadada.html')],
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    emptyOutDir: true,
    cssCodeSplit: false,
    // 모든 에셋을 data URI 로 인라인 (외부 파일이 남지 않도록)
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: 'iife',
        // 동적 import 도 같은 번들로 합쳐 파일 하나로 만든다
        inlineDynamicImports: true,
      },
    },
  },
});
