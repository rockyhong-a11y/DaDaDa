#!/usr/bin/env bash
# 개발용 TS 스크립트를 esbuild 로 번들해 실행한다 (vite 와 동일한 해석 규칙).
set -euo pipefail
entry="$1"; shift
out="$(mktemp -d)/bundle.mjs"
npx esbuild "$entry" --bundle --platform=node --format=esm --log-level=warning --outfile="$out"
node "$out" "$@"
