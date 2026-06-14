/**
 * 로컬 글꼴 감지 모듈
 *
 * Local Font Access API (queryLocalFonts) 를 사용하여
 * 사용자 PC에 설치된 글꼴 목록을 조회한다.
 * Chrome/Edge 103+ 지원, 미지원 브라우저는 빈 배열 반환.
 */
import { REGISTERED_FONTS } from './font-loader';

/** queryLocalFonts 반환 타입 (DOM 표준 미포함) */
interface FontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontData[]>;
  }
}

/** 캐시된 로컬 글꼴 목록 (감지 전 null) */
let cachedFonts: string[] | null = null;

/** Local Font Access API 지원 여부 */
export function isLocalFontSupported(): boolean {
  return typeof window.queryLocalFonts === 'function';
}

/**
 * 로컬 글꼴을 감지하여 family 목록을 반환한다.
 * - 중복 제거, 한국어 로케일 정렬
 * - REGISTERED_FONTS에 이미 등록된 글꼴은 제외
 * - 캐시되어 재호출 시 권한 프롬프트 없이 즉시 반환
 */
export async function detectLocalFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;

  if (!isLocalFontSupported()) {
    return [];
  }

  const fontDataList = await window.queryLocalFonts!();
  const families = new Set<string>();
  for (const fd of fontDataList) {
    if (fd.family && !REGISTERED_FONTS.has(fd.family)) {
      families.add(fd.family);
    }
  }

  cachedFonts = Array.from(families).sort((a, b) => a.localeCompare(b, 'ko'));
  console.log(`[LocalFonts] ${cachedFonts.length}개 로컬 글꼴 감지됨`);
  return cachedFonts;
}

/** 캐시된 로컬 글꼴 목록을 동기적으로 반환 (감지 전이면 빈 배열) */
export function getLocalFonts(): string[] {
  return cachedFonts ?? [];
}
