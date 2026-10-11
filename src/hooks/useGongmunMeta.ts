import { useEffect, useState } from "react";
import type { GongmunMeta } from "../lib/contract";
import { rpc } from "../lib/rpc";
import { useApp } from "../state/app";

let cache: Promise<GongmunMeta> | null = null;

/** 공문서 프리셋·기관 서식·내장 서식 목록 (한 번 읽어 나눠 쓴다) */
export function useGongmunMeta(): GongmunMeta | null {
  const { ready } = useApp();
  const [meta, setMeta] = useState<GongmunMeta | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!cache) cache = rpc("gongmun_meta", {}).catch((e) => { cache = null; throw e; });
    cache.then(setMeta).catch(() => setMeta(null));
  }, [ready]);
  return meta;
}
