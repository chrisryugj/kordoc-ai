/** RPC 메서드 — AI (계약: types/rpc-contract.ts 의 "AI" 영역) */

import type { RpcRouter } from '../router.js';
import type { ChatMessage, RpcParams } from '../../types/rpc-contract.js';
import { validatePath } from '../../infra/pathGuard.js';
import { toAiError } from '../../core/errors.js';
import { summarize } from '../../core/summary/index.js';
import { reviewDocument } from '../../core/inspect/index.js';
import { chatWithDocs } from '../../core/ai/chat.js';
import { draftDocument } from '../../core/ai/draft.js';
import { rewriteText, type RewriteMode } from '../../core/ai/rewrite.js';
import { suggestFill } from '../../core/ai/fill.js';
import { writeFromTemplate } from '../../core/ai/template-write.js';
import { agentStep, type AgentEvent, type AgentToolDef } from '../../core/ai/agent-step.js';
import { extractTable } from '../../core/ai/extract.js';
import { fitLinesWithAi } from '../../core/ai/fit-lines.js';
import { aiStatus, aiTest, aiWarmup, listServerModels } from '../../core/ai/status.js';
import { localServers, subscriptionModels, subscriptionStatus } from '../../core/ai/connect.js';
import { CATALOG, catalog, deleteModel, downloadModel, importModel, listModels } from '../../core/ai/models.js';

const paths = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || !v.length) throw new Error(`${what}를 하나 이상 고르세요.`);
  return v.map((p) => validatePath(String(p)));
};
const optPaths = (v: unknown): string[] => (Array.isArray(v) ? v.map((p) => validatePath(String(p))) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function registerAi(router: RpcRouter): void {
  // AI 공급자·네트워크 오류를 할 일을 적은 한국어로 (registrar 와 같은 자리에서)
  const reg: RpcRouter['register'] = (name, handler, opts) => router.register(name, async (p, signal) => {
    try { return await handler(p, signal); } catch (err) { throw toAiError(err); }
  }, opts);
  // ── 연결 ──
  reg('ai_status', () => aiStatus());
  reg('ai_test', (_p, signal) => aiTest(signal), { heavy: true });
  reg('ai_list_models', (p, signal) => listServerModels({ base_url: str(p.base_url), api_key: str(p.api_key), slot: p.slot === 'local' ? 'local' : 'openai' }, signal));
  reg('ai_local_servers', (_p, signal) => localServers(signal));
  reg('ai_subscription_status', (p) => subscriptionStatus(p));
  reg('ai_subscription_models', (p, signal) => subscriptionModels(p, signal));
  reg('ai_warmup', () => aiWarmup(), { heavy: true });

  // ── 내장 모델 ──
  reg('llm_catalog', () => catalog());
  reg('llm_list', () => listModels());
  reg('llm_download', async (p, signal) => {
    const item = CATALOG.find((c) => c.id === p.id);
    if (!item) throw new Error(`추천 목록에 없는 모델입니다: ${String(p.id)}`);
    return { path: await downloadModel(item, signal) };
  });
  reg('llm_import', async (p, signal) => ({ path: await importModel(validatePath(String(p.path ?? '')), signal) }));
  reg('llm_delete', (p) => deleteModel(validatePath(String(p.path ?? ''))));

  // ── 문서 AI ──
  reg('ai_summarize', (p, signal) => {
    const q = p as RpcParams<'ai_summarize'>;
    return summarize({ text: str(q.text), path: q.path ? validatePath(q.path) : undefined, style: q.style, length: q.length }, signal);
  }, { heavy: true });

  reg('ai_chat', (p, signal) => chatWithDocs({
    paths: paths(p.paths, '대화할 문서'),
    question: String(p.question ?? ''),
    history: Array.isArray(p.history) ? (p.history as ChatMessage[]) : [],
  }, signal), { heavy: true });

  reg('ai_draft', (p, signal) => {
    const q = p as RpcParams<'ai_draft'>;
    return draftDocument({ instruction: String(q.instruction ?? ''), preset: str(q.preset), kind: q.kind, references: optPaths(q.references), length: q.length }, signal);
  }, { heavy: true });

  reg('ai_rewrite', (p, signal) => rewriteText({
    text: String(p.text ?? ''),
    mode: String(p.mode ?? 'polish') as RewriteMode,
    instruction: str(p.instruction),
  }, signal), { heavy: true });

  reg('ai_review', (p, signal) => reviewDocument({ path: validatePath(String(p.path ?? '')) }, signal), { heavy: true });

  reg('ai_fill_suggest', (p, signal) => {
    const q = p as RpcParams<'ai_fill_suggest'>;
    return suggestFill({
      fields: Array.isArray(q.fields) ? q.fields : [],
      references: optPaths(q.references),
      note: str(q.note),
      instruction: str(q.instruction),
      guides: q.guides && typeof q.guides === 'object' ? q.guides : undefined,
    }, signal);
  }, { heavy: true });

  reg('ai_agent_step', (p, signal) => agentStep({
    system: String(p.system ?? ''),
    tools: Array.isArray(p.tools) ? (p.tools as AgentToolDef[]) : [],
    events: Array.isArray(p.events) ? (p.events as AgentEvent[]) : [],
  }, signal), { heavy: true });

  reg('ai_template_write', (p, signal) => writeFromTemplate({
    path: validatePath(String(p.path ?? '')),
    instruction: String(p.instruction ?? ''),
    references: optPaths(p.references),
    output_path: str(p.output_path),
  }, signal), { heavy: true });

  reg('ai_fit_lines', (p, signal) => {
    const q = p as Partial<RpcParams<'ai_fit_lines'>>;
    const cover = q.cover && typeof q.cover === 'object' ? q.cover : undefined;
    return fitLinesWithAi({
      markdown: String(q.markdown ?? ''),
      preset: str(q.preset),
      agency: str(q.agency),
      levels_from: q.levels_from ? validatePath(String(q.levels_from)) : undefined,
      profile_from: q.profile_from ? validatePath(String(q.profile_from)) : undefined,
      cover: cover ? { org: str(cover.org), date: str(cover.date) } : undefined,
      toc: typeof q.toc === 'boolean' ? q.toc : undefined,
      approval: Array.isArray(q.approval) ? q.approval.map(String) : undefined,
      page_numbers: typeof q.page_numbers === 'boolean' ? q.page_numbers : undefined,
      end_mark: typeof q.end_mark === 'boolean' ? q.end_mark : undefined,
    }, signal);
  }, { heavy: true });

  reg('ai_extract', (p, signal) => extractTable({
    paths: paths(p.paths, '표로 만들 문서'),
    columns: Array.isArray(p.columns) ? p.columns.map(String) : [],
    output_path: str(p.output_path),
  }, signal), { heavy: true });
}
