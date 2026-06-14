/**
 * 사용자 환경설정 저장/로드 서비스
 *
 * localStorage 기반, 단일 키(rhwp-settings)에 JSON으로 저장.
 * 섹션별 확장 가능한 구조.
 */

/** 대표 글꼴 세트 (7개 언어별 글꼴) */
export interface FontSet {
  name: string;
  korean: string;
  english: string;
  chinese: string;
  japanese: string;
  other: string;
  symbol: string;
  user: string;
}

/** 글꼴 환경 설정 */
export interface FontSettings {
  /** 사용자 정의 대표 글꼴 세트 */
  fontSets: FontSet[];
  /** 최근 사용 글꼴 표시 여부 */
  showRecentFonts: boolean;
  /** 최근 사용 글꼴 표시 개수 (1~5) */
  recentFontCount: number;
}

/** 전체 설정 구조 */
export interface AppSettings {
  version: number;
  font: FontSettings;
}

/** 언어 인덱스 상수 (HWP 7개 언어) */
export const LANG = {
  KOREAN: 0,
  ENGLISH: 1,
  CHINESE: 2,
  JAPANESE: 3,
  OTHER: 4,
  SYMBOL: 5,
  USER: 6,
} as const;

/** 언어 인덱스 → 한국어 라벨 */
export const LANG_LABELS = ['한글', '영문', '한자', '일어', '외국어', '기호', '사용자'] as const;

/** 언어 인덱스 → FontSet 키 매핑 */
const LANG_KEYS: (keyof Omit<FontSet, 'name'>)[] = [
  'korean', 'english', 'chinese', 'japanese', 'other', 'symbol', 'user',
];

/** 내장 기본 대표 글꼴 (편집/삭제 불가) */
export const BUILTIN_FONT_SETS: readonly FontSet[] = [
  {
    name: '함초롬',
    korean: '함초롬바탕', english: '함초롬바탕', chinese: '함초롬바탕',
    japanese: '함초롬바탕', other: '함초롬바탕', symbol: '함초롬바탕', user: '함초롬바탕',
  },
  {
    name: '함초롬돋움',
    korean: '함초롬돋움', english: '함초롬돋움', chinese: '함초롬돋움',
    japanese: '함초롬돋움', other: '함초롬돋움', symbol: '함초롬돋움', user: '함초롬돋움',
  },
  {
    name: '맑은 고딕',
    korean: '맑은 고딕', english: '맑은 고딕', chinese: '맑은 고딕',
    japanese: '맑은 고딕', other: '맑은 고딕', symbol: '맑은 고딕', user: '맑은 고딕',
  },
  {
    name: '바탕',
    korean: '바탕', english: '바탕', chinese: '바탕',
    japanese: '바탕', other: '바탕', symbol: '바탕', user: '바탕',
  },
];

const STORAGE_KEY = 'rhwp-settings';

function defaultSettings(): AppSettings {
  return {
    version: 1,
    font: {
      fontSets: [],
      showRecentFonts: true,
      recentFontCount: 3,
    },
  };
}

/** 사용자 환경설정 서비스 (싱글턴) */
class UserSettingsService {
  private data: AppSettings;

  constructor() {
    this.data = this.load();
  }

  private load(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSettings();
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      // 기본값 병합
      const defaults = defaultSettings();
      return {
        version: parsed.version ?? defaults.version,
        font: {
          ...defaults.font,
          ...(parsed.font ?? {}),
        },
      };
    } catch {
      return defaultSettings();
    }
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  /** 전체 설정 반환 */
  getAll(): AppSettings {
    return this.data;
  }

  /** 글꼴 설정 반환 */
  getFontSettings(): FontSettings {
    return this.data.font;
  }

  /** 글꼴 설정 업데이트 */
  updateFontSettings(partial: Partial<FontSettings>): void {
    Object.assign(this.data.font, partial);
    this.save();
  }

  /** 모든 대표 글꼴 세트 반환 (내장 + 사용자) */
  getAllFontSets(): FontSet[] {
    return [...BUILTIN_FONT_SETS, ...this.data.font.fontSets];
  }

  /** 사용자 정의 대표 글꼴 세트만 반환 */
  getUserFontSets(): FontSet[] {
    return this.data.font.fontSets;
  }

  /** 대표 글꼴 세트 추가 */
  addFontSet(fs: FontSet): boolean {
    const allNames = this.getAllFontSets().map(s => s.name);
    if (allNames.includes(fs.name)) return false; // 중복 이름 불가
    this.data.font.fontSets.push(fs);
    this.save();
    return true;
  }

  /** 대표 글꼴 세트 수정 (사용자 정의만) */
  updateFontSet(index: number, fs: FontSet): boolean {
    if (index < 0 || index >= this.data.font.fontSets.length) return false;
    this.data.font.fontSets[index] = fs;
    this.save();
    return true;
  }

  /** 대표 글꼴 세트 삭제 (사용자 정의만) */
  removeFontSet(index: number): boolean {
    if (index < 0 || index >= this.data.font.fontSets.length) return false;
    this.data.font.fontSets.splice(index, 1);
    this.save();
    return true;
  }

  /** FontSet의 언어 인덱스로 글꼴 이름 조회 */
  static getFontByLang(fs: FontSet, langIndex: number): string {
    return fs[LANG_KEYS[langIndex] ?? 'korean'] ?? fs.korean;
  }

  /** FontSet에 언어 인덱스로 글꼴 이름 설정 */
  static setFontByLang(fs: FontSet, langIndex: number, fontName: string): void {
    const key = LANG_KEYS[langIndex];
    if (key) (fs as any)[key] = fontName;
  }
}

/** 싱글턴 인스턴스 */
export const userSettings = new UserSettingsService();
