/** RPC 메서드 — 영수증으로 지출조서 (core/receipt) */

import type { RpcRouter } from '../router.js';
import type { ReceiptColumn, ReceiptRow } from '../../types/rpc-contract.js';
import { receiptRead } from '../../core/receipt/read.js';
import { receiptReport } from '../../core/receipt/report.js';
import { templateClear, templateGet, templateLearn, templateSet } from '../../core/receipt/template.js';
import { bool, optPath, registrar, reqPath, reqPaths, str } from './params.js';

const ROW_KEYS = ['date', 'vendor', 'brn', 'purpose', 'amount', 'payment', 'note', 'supply', 'vat', 'approval', 'owner', 'address'] as const;

function rows(v: unknown): ReceiptRow[] {
  if (!Array.isArray(v) || !v.length) throw new Error('지출조서에 넣을 영수증이 없습니다. 영수증을 먼저 읽으세요.');
  return v.map((r) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    return Object.fromEntries(ROW_KEYS.map((k) => [k, typeof o[k] === 'string' ? (o[k] as string).slice(0, 500) : ''])) as unknown as ReceiptRow;
  });
}

export function registerReceipt(router: RpcRouter): void {
  const reg = registrar(router);
  reg('receipt_read', (p, signal) => receiptRead({ paths: reqPaths(p.paths), ai: bool(p.ai) }, signal), { heavy: true });
  reg('receipt_report', (p, signal) => receiptReport({
    rows: rows(p.rows), save: bool(p.save), template: bool(p.template), output_path: optPath(p.output_path), output_dir: optPath(p.output_dir), title: str(p.title),
  }, signal), { heavy: true });
  reg('receipt_template_learn', (p, signal) => templateLearn({ path: reqPath(p.path), save: bool(p.save), ai: bool(p.ai) }, signal), { heavy: true });
  reg('receipt_template_get', () => templateGet());
  reg('receipt_template_set', (p) => templateSet((Array.isArray(p.fields) ? p.fields : []).map((f) => (typeof f === 'string' ? f : '') as ReceiptColumn | '')));
  reg('receipt_template_clear', () => templateClear());
}
