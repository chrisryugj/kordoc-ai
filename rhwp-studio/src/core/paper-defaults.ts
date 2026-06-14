/**
 * 용지 크기별 기본 설정 (한컴 coreEngine.js IDS_PAPER_* 참조)
 *
 * 모든 값은 HWPUNIT (1인치 = 7200, 1mm ≈ 283.465)
 * 향후 새 문서 생성 시 사용
 */

export interface PaperDef {
  /** 용지 이름 (한국어) */
  name: string;
  /** 용지 이름 (영문) */
  nameEn: string;
  /** 용지 가로 (HWPUNIT) */
  width: number;
  /** 용지 세로 (HWPUNIT) */
  height: number;
  /** 위 여백 (HWPUNIT) */
  marginTop: number;
  /** 아래 여백 (HWPUNIT) */
  marginBottom: number;
  /** 왼쪽 여백 (HWPUNIT) */
  marginLeft: number;
  /** 오른쪽 여백 (HWPUNIT) */
  marginRight: number;
  /** 머리말 여백 (HWPUNIT) */
  marginHeader: number;
  /** 꼬리말 여백 (HWPUNIT) */
  marginFooter: number;
  /** 제본 여백 (HWPUNIT) */
  marginGutter: number;
}

/** 용지 크기별 기본 설정 테이블 (한컴 coreEngine.js 기준) */
export const PAPER_DEFAULTS: Record<string, PaperDef> = {
  // ── 대형 ──
  A3: {
    name: 'A3(국배배판)', nameEn: 'A3',
    width: 84188, height: 119052,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  A4: {
    name: 'A4(국배판)', nameEn: 'A4',
    width: 59527, height: 84188,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  B4: {
    name: 'B4(타블로이드판)', nameEn: 'B4',
    width: 72852, height: 103180,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },

  // ── 중형 ──
  B5: {
    name: 'B5(46배판)', nameEn: 'B5',
    width: 51592, height: 72852,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 7085, marginRight: 7085,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  CROWN: {
    name: '크라운판', nameEn: 'Crown',
    width: 49890, height: 70299,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 7085, marginRight: 7085,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },

  // ── 소형 ──
  A5: {
    name: 'A5(국판)', nameEn: 'A5',
    width: 41952, height: 59527,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 5668, marginRight: 5668,
    marginHeader: 2834, marginFooter: 2834,
    marginGutter: 0,
  },
  A5_NEW: {
    name: '신국판', nameEn: 'A5 New',
    width: 41952, height: 63779,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 5668, marginRight: 5668,
    marginHeader: 2834, marginFooter: 2834,
    marginGutter: 0,
  },
  A6: {
    name: 'A6(문고판)', nameEn: 'A6',
    width: 29763, height: 41952,
    marginTop: 2126, marginBottom: 2126,
    marginLeft: 4252, marginRight: 4252,
    marginHeader: 2126, marginFooter: 2126,
    marginGutter: 0,
  },

  // ── 미국/국제 ──
  LETTER: {
    name: '레터', nameEn: 'Letter',
    width: 61200, height: 79200,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  LEGAL: {
    name: '리갈', nameEn: 'Legal',
    width: 61200, height: 100800,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  EXECUTIVE: {
    name: 'Executive', nameEn: 'Executive',
    width: 52186, height: 75600,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 7085, marginRight: 7085,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  EXECUTIVE_JIS: {
    name: 'Executive(JIS)', nameEn: 'Executive JIS',
    width: 61228, height: 93515,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 7085, marginRight: 7085,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },

  // ── 봉투 ──
  ENVELOPE_DL: {
    name: 'Envelope DL', nameEn: 'Envelope DL',
    width: 31181, height: 62362,
    marginTop: 2126, marginBottom: 2126,
    marginLeft: 4252, marginRight: 4252,
    marginHeader: 2126, marginFooter: 2126,
    marginGutter: 0,
  },
  ENVELOPE_C5: {
    name: 'Envelope C5', nameEn: 'Envelope C5',
    width: 45921, height: 64913,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 7085, marginRight: 7085,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  ENVELOPE_B5: {
    name: 'Envelope B5', nameEn: 'Envelope B5',
    width: 49890, height: 70866,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 7085, marginRight: 7085,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  ENVELOPE_MONARCH: {
    name: 'Envelope Monarch', nameEn: 'Envelope Monarch',
    width: 27893, height: 54000,
    marginTop: 2126, marginBottom: 2126,
    marginLeft: 4252, marginRight: 4252,
    marginHeader: 2126, marginFooter: 2126,
    marginGutter: 0,
  },

  // ── 와이드 ──
  PRINT_132: {
    name: '프린트 132', nameEn: 'Print 132',
    width: 95040, height: 79200,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },

  // ── 점자/특수 ──
  BRAILLE_1: {
    name: '점자출력용지', nameEn: 'Braille Paper',
    width: 65196, height: 79199,
    marginTop: 5668, marginBottom: 4252,
    marginLeft: 8504, marginRight: 8504,
    marginHeader: 4252, marginFooter: 4252,
    marginGutter: 0,
  },
  BRAILLE_2: {
    name: '16절지(국판)', nameEn: 'Braille 16-cut',
    width: 45070, height: 66327,
    marginTop: 4252, marginBottom: 4252,
    marginLeft: 5668, marginRight: 5668,
    marginHeader: 2834, marginFooter: 2834,
    marginGutter: 0,
  },
};

/** 새 문서 기본 용지 */
export const DEFAULT_PAPER = PAPER_DEFAULTS.A4;
