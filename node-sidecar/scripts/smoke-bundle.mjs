/**
 * 번들 스모크 테스트 — MSI가 설치하는 그대로 sidecar를 띄워 엔진이 사는지 본다.
 *
 * MSI에는 node_modules가 들어가지 않는다 (tauri.conf.json resources = dist/ + config/).
 * 그래서 esbuild가 번들에 못 넣고 런타임 require로 남긴 모듈이 하나라도 있으면
 * 사용자 PC에서 "엔진 오류"가 난다. 개발 환경에서는 node_modules가 옆에 있어
 * 그대로 굴러가기 때문에 vitest로는 절대 안 잡힌다 — v1.5.0이 cfb를 놓친 채
 * 나간 이유가 이것이다.
 *
 * dist/를 레포 바깥 임시 디렉토리로 옮겨 실행한다. 위쪽 node_modules를 탐색으로
 * 주워오지 못하게 하려는 것 — 사용자 PC와 같은 조건을 만든다.
 *
 * 사용: node scripts/smoke-bundle.mjs   (node-sidecar 에서)
 */
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TIMEOUT_MS = 60_000

if (!existsSync('dist/bundle.cjs')) {
  console.error('[smoke] dist/bundle.cjs 없음 — 먼저 `npx tsc && node esbuild.config.mjs`')
  process.exit(1)
}

const stage = mkdtempSync(join(tmpdir(), 'kordoc-smoke-'))
cpSync('dist', join(stage, 'dist'), { recursive: true })
if (existsSync('config')) cpSync('config', join(stage, 'config'), { recursive: true })

const entry = join(stage, 'dist', 'bundle.cjs')
console.log(`[smoke] ${entry} (node_modules 없음)`)

const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'], cwd: stage })
let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', (d) => (err += d))
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })}\n`)

let settled = false
function finish(ok, reason) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  child.kill('SIGKILL')

  // 임시 디렉토리 청소는 best-effort로 둔다. Windows는 자식을 죽여도 파일 핸들이
  // 곧바로 안 풀려서 rmdir 이 EBUSY 로 튄다 — 청소 실패가 엔진 판정을 뒤집으면
  // "엔진은 멀쩡한데 CI 는 빨간" 상태가 된다. 못 지우면 OS 가 temp 를 회수한다.
  try {
    rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* 청소 실패는 판정과 무관 */
  }

  if (ok) {
    console.log('[smoke] ✅ 엔진 준비됨 — ping 응답 확인')
    process.exit(0)
  }
  console.error(`[smoke] ❌ 엔진 오류 — ${reason}`)
  console.error('--- sidecar stderr ---')
  console.error(err.trim() || '(없음)')
  const missing = err.match(/Cannot find module '([^']+)'/)
  if (missing) {
    console.error(
      `\n[smoke] '${missing[1]}' 가 번들에 안 들어갔다. esbuild.config.mjs 의 external 목록에서\n` +
        `        빼거나, kordoc이 createRequire로 동적 로드하는 모듈이면 dynamicRequirePlugin 이\n` +
        `        정적 import 로 치환하도록 고쳐라. 이대로 릴리스하면 사용자 PC에서 엔진이 죽는다.`,
    )
  }
  process.exit(1)
}

const timer = setTimeout(() => finish(false, `${TIMEOUT_MS}ms 안에 ping 응답 없음`), TIMEOUT_MS)
child.stdout.on('data', () => {
  if (out.includes('"result"')) finish(true)
})
child.on('exit', (code) => finish(out.includes('"result"'), `프로세스가 코드 ${code}로 종료`))
child.on('error', (e) => finish(false, e.message))
