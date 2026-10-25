#!/bin/bash
# 화면 E2E 전부 — 스크립트마다 새 데이터 폴더로 중계기를 띄우고 끝나면 내린다.
#   앞서 필요: node scripts/build-sidecar.mjs, 화면 서버(node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort)
#   사용: bash scripts/e2e-ui/run-all.sh [작업 폴더]   (기본: 임시 폴더)
cd "$(dirname "$0")/../.." || exit 1
W=${1:-$(mktemp -d -t kordoc-e2e)}
mkdir -p "$W"
fail=0
run() { # 이름 포트 환경변수 명령…
  local name=$1 port=$2 envs=$3; shift 3
  local data="$W/data-$name"; rm -rf "$data"; mkdir -p "$data" "$W/out-$name"
  env $envs node scripts/dev-relay.mjs --port "$port" --data "$data" > "$W/relay-$name.log" 2>&1 &
  local rp=$!
  sleep 5
  KORDOC_DATA="$data" "$@" > "$W/$name.log" 2>&1 || fail=1
  echo "== $name $(grep -E '통과' "$W/$name.log" | tail -1)"
  grep -E '^FAIL' "$W/$name.log" | head -8
  kill $rp 2>/dev/null; sleep 1
}
run a-shell 7721 "" node scripts/e2e-ui/a-shell.mjs --relay http://127.0.0.1:7721 --out "$W/out-a-shell"
run a-workbench 7721 "" node scripts/e2e-ui/a-workbench.mjs --relay http://127.0.0.1:7721 --out "$W/out-a-workbench"
run b-create 7722 "" node scripts/e2e-ui/b-create-output.mjs "$W/out-b-create" http://127.0.0.1:7722
run b-fill 7722 "" node scripts/e2e-ui/b-fill-wizard.mjs "$W/out-b-fill" http://127.0.0.1:7722
run b-mail 7722 "" node scripts/e2e-ui/b-mailmerge.mjs "$W/out-b-mail" http://127.0.0.1:7722
run c-precheck 7723 "" node scripts/e2e-ui/c-precheck.mjs --relay http://127.0.0.1:7723 --out "$W/out-c-precheck"
run d-gather 7724 "" node scripts/e2e-ui/d-gather.mjs --relay http://127.0.0.1:7724 --out "$W/out-d-gather"
run e-style 7725 "" node scripts/e2e-ui/e-style-copy.mjs "$W/out-e-style" http://127.0.0.1:7725
run f-law 7726 "KORDOC_LAW_BASE=http://127.0.0.1:7736/DRF/" node scripts/e2e-ui/f-law.mjs --relay http://127.0.0.1:7726 --drf-port 7736 --out "$W/out-f-law"
run g-shrink 7727 "" node scripts/e2e-ui/g-shrink.mjs --relay http://127.0.0.1:7727 --out "$W/out-g-shrink"
# 한글 편집기: 중계기를 스스로 두 번 띄운다(앱이 꺼졌다 다시 켜짐)
mkdir -p "$W/out-h-editor"
KORDOC_DATA="$W/data-h-editor" node scripts/e2e-ui/h-editor.mjs --port 7728 --out "$W/out-h-editor" > "$W/h-editor.log" 2>&1 || fail=1
echo "== h-editor $(grep -E '통과' "$W/h-editor.log" | tail -1)"
grep -E '^FAIL' "$W/h-editor.log" | head -8
echo "결과·스크린샷: $W"
exit $fail
