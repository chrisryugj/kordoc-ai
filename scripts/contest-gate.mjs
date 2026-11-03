/**
 * 출품 관문 — 2026 공공 AI 대전환 챌린지 세션1 제출 전에 놓치는 것이 없게 한 번에 검사한다.
 *
 *   node scripts/contest-gate.mjs                      개발 중 (빠른 길, 사람 할 일은 TODO 로)
 *   node scripts/contest-gate.mjs --final              제출 직전 (번들·편집기 새로 빌드, Rust 시험, SKIP·TODO 도 실패)
 *   node scripts/contest-gate.mjs --models local:gemma4:e4b,claude-code   실모델 에이전트 실측 더하기
 *   node scripts/contest-gate.mjs --only engine,repo   영역만 (code·engine·repo·docs)
 *
 * 영역: 코드(타입·계약·시험·빌드·설치본 스모크) · 엔진(도구 전수·원본 불변·기본 저장 위치·MCP) · 모델 ·
 *       저장소(비밀값·DRM·취약점·고지) · 서류(파일명·쪽수·A4·양식 항목·영상 길이·README·줄표) · 사람(checklist.md)
 * 보고서: gate.json 의 out_dir/관문 보고서/<시각>.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { results } from './gate/lib.mjs';
import { codeChecks } from './gate/checks-code.mjs';
import { engineChecks } from './gate/checks-engine.mjs';
import { repoChecks } from './gate/checks-repo.mjs';
import { docChecks, loadConfig } from './gate/checks-docs.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const final = argv.includes('--final');
const only = opt('--only')?.split(',');
const models = opt('--models')?.split(',').filter(Boolean) ?? [];
const want = (a) => !only || only.includes(a);
const t0 = Date.now();

console.log(`출품 관문 ${final ? '(최종)' : '(개발)'} 시작\n`);
if (want('code')) codeChecks({ final });
if (want('engine')) await engineChecks({ models });
if (want('repo')) repoChecks();
if (want('docs')) await docChecks({ final });

const n = (s) => results.filter((r) => r.status === s).length;
const failing = results.filter((r) => r.status === 'FAIL' || (final && (r.status === 'SKIP' || r.status === 'TODO')));
const summary = `PASS ${n('PASS')} · WARN ${n('WARN')} · FAIL ${n('FAIL')} · SKIP ${n('SKIP')} · TODO ${n('TODO')} · ${((Date.now() - t0) / 60000).toFixed(1)}분`;

const cfg = loadConfig();
const dir = join(cfg.out_dir, '관문 보고서');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const file = join(dir, `${stamp}${final ? '-최종' : ''}.md`);
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, '<br>');
writeFileSync(file, [
  `# 출품 관문 ${final ? '최종' : '개발'} 보고서 (${new Date().toLocaleString('ko-KR')})`, '', summary, '',
  failing.length ? `## 막는 것 ${failing.length}건\n\n${failing.map((r) => `- [${r.area}] ${r.name}: ${r.detail.split('\n')[0]}`).join('\n')}\n` : '## 막는 것 없음\n',
  '| 영역 | 항목 | 결과 | 내용 | 시간 |', '| --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.area} | ${cell(r.name)} | ${r.status} | ${cell(r.detail)} | ${r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''} |`),
].join('\n'));

console.log(`\n${summary}`);
if (failing.length) console.log(`막는 것 ${failing.length}건:\n${failing.map((r) => `  ✗ [${r.area}] ${r.name}`).join('\n')}`);
console.log(`보고서: ${file}`);
process.exit(failing.length ? 1 : 0);
