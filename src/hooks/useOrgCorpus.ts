import { useEffect, useState } from "react";
import type { OrgCorpusView, OrgReference } from "../lib/contract";
import { rpc } from "../lib/rpc";
import { baseName } from "../lib/format";
import { useApp } from "../state/app";

/** 우리 기관 서식 묶음이 바뀌면(설정에서 넣기·빼기·대표 바꾸기) 보는 곳마다 다시 읽는다 */
const listeners = new Set<() => void>();
let version = 0;
export function orgCorpusChanged(): void {
  version++;
  for (const f of listeners) f();
}

function useVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    const f = () => setV(version);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return v;
}

/** 문서 갈래의 우리 기관 참고 (없으면 null, 읽는 중엔 undefined) */
export function useOrgReference(kind: string): OrgReference | null | undefined {
  const { ready } = useApp();
  const v = useVersion();
  const [ref, setRef] = useState<OrgReference | null | undefined>(undefined);
  useEffect(() => {
    if (!ready || !kind) return;
    let live = true;
    rpc("org_corpus_reference", { kind }).then((r) => { if (live) setRef(r); }).catch(() => { if (live) setRef(null); });
    return () => { live = false; };
  }, [ready, kind, v]);
  return ref;
}

/** 우리 기관 문서 모음 목록 (읽기 전엔 null) */
export function useOrgCorpus(): OrgCorpusView | null {
  const { ready } = useApp();
  const v = useVersion();
  const [corpus, setCorpus] = useState<OrgCorpusView | null>(null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    rpc("org_corpus_list", {}).then((r) => { if (live) setCorpus(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [ready, v]);
  return corpus;
}

/** org_corpus_add 결과 한 줄: 새로 넣은 수 · 이미 넣은 문서 수 · 건너뛴 것(첫 까닭) */
export function addSummary(r: { added: number; skipped: Array<{ path: string; reason: string }> }): string {
  const dup = r.skipped.filter((x) => x.reason.startsWith("이미 넣은")).length;
  const other = r.skipped.filter((x) => !x.reason.startsWith("이미 넣은"));
  const parts = [r.added ? `${r.added}건 넣었습니다` : "새로 넣은 문서가 없습니다"];
  if (dup) parts.push(`이미 넣은 문서 ${dup}건`);
  if (other.length) parts.push(`건너뜀 ${other.length}건(${baseName(other[0].path)}: ${other[0].reason})`);
  return parts.join(" · ");
}
