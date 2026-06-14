/**
 * HWP 문서 관련 상수 정의 (한컴 coreEngine.js 기준)
 *
 * 컨트롤/필드 이름, 자동번호 유형, 편집 모드, 제한값,
 * 문서 요약 필드, 스타일 정보 레이블 등
 */

// ─────────────────────────────────────────────────
// 단위 변환 상수
// ─────────────────────────────────────────────────

/** 1인치 = 7200 HWPUNIT */
export const HWPUNIT_PER_INCH = 7200;
/** 1mm ≈ 283.465 HWPUNIT */
export const HWPUNIT_PER_MM = 7200 / 25.4;

/** 자주 사용되는 여백값 (HWPUNIT → mm 매핑) */
export const COMMON_MARGINS = {
  /** 7.5 mm */ MM_7_5: 2126,
  /** 10 mm */  MM_10: 2834,
  /** 15 mm */  MM_15: 4252,
  /** 20 mm */  MM_20: 5668,
  /** 25 mm */  MM_25: 7085,
  /** 30 mm */  MM_30: 8504,
} as const;

// ─────────────────────────────────────────────────
// 편집 모드
// ─────────────────────────────────────────────────

export const EDIT_MODE = {
  INSERT: '삽입',
  OVERWRITE: '수정',
} as const;

// ─────────────────────────────────────────────────
// 쪽 유형
// ─────────────────────────────────────────────────

export const PAGE_TYPE = {
  BOTH: '양 쪽',
  EVEN: '짝수 쪽',
  ODD: '홀수 쪽',
} as const;

// ─────────────────────────────────────────────────
// 바탕쪽(마스터페이지) 유형
// ─────────────────────────────────────────────────

export const MASTERPAGE = {
  LAST: '구역 마지막 쪽',
  BEGIN: '구역 임의 쪽',
  LAST_SHORT: '마지막',
  BEGIN_SHORT: '임의',
} as const;

// ─────────────────────────────────────────────────
// 자동 번호 유형
// ─────────────────────────────────────────────────

export const AUTO_NUMBER_TYPE = {
  PAGE: '쪽 번호',
  FOOTNOTE: '각주 번호',
  ENDNOTE: '미주 번호',
  FIGURE: '그림 번호',
  TABLE: '표 번호',
  EQUATION: '수식 번호',
  TOTAL_PAGE: '전체 쪽수',
} as const;

export const NEW_AUTO_NUMBER_TYPE = {
  PAGE: '새 쪽 번호',
  FOOTNOTE: '새 각주 번호',
  ENDNOTE: '새 미주 번호',
  FIGURE: '새 그림 번호',
  TABLE: '새 표 번호',
  EQUATION: '새 수식 번호',
} as const;

// ─────────────────────────────────────────────────
// 제한값
// ─────────────────────────────────────────────────

/** 누름틀 입력 최대 글자수 */
export const CLICKHERE_INPUT_LIMIT = 259;
/** 그림 삽입 최대 파일 크기 (bytes) */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// ─────────────────────────────────────────────────
// 스타일 정보 레이블
// ─────────────────────────────────────────────────

export const STYLE_INFO = {
  NORMAL_STYLE: '바탕글',
  CHAR_NAME: '글꼴',
  SIZE: '크기',
  RATIO: '장평',
  SPACING: '자간',
  LINE_SPACING: '줄간격',
  LEFT_MARGIN: '왼쪽 여백',
  FIRST_LINE: '첫 줄',
  ALIGN_CENTER: '가운데',
  INDENT_NORMAL: '보통',
  INDENT_HANGING: '내어쓰기',
  INDENT_FIRST_LINE: '들여쓰기',
  NEXT_STYLE: '다음 스타일',
  PARA_HEADING_TYPE: '문단 종류',
  PARA_HEADING_BULLET: '글머리표',
  PARA_HEADING_BULLET_IMAGE: '그림 글머리표',
  PARA_HEADING_NUMBER: '번호',
  PARA_HEADING_OUTLINE: '개요',
  NONE: '없음',
} as const;

// ─────────────────────────────────────────────────
// 문서 요약 필드
// ─────────────────────────────────────────────────

export const SUMMARY_FIELDS = {
  TITLE: '제목',
  SUBJECT: '주제',
  AUTHOR: '지은이',
  DATE: '날짜',
  KEYWORDS: '키워드',
  COMMENTS: '기타',
} as const;

// ─────────────────────────────────────────────────
// 사용자 정보 필드
// ─────────────────────────────────────────────────

export const USER_INFO_FIELDS = {
  USER_NAME: '사용자 이름',
  COMPANY: '회사 이름',
  DEPARTMENT: '부서 이름',
  POSITION: '직책 이름',
  OFFICE_TELEPHONE: '회사 전화번호',
  FAX: '팩스 번호',
  HOME_TELEPHONE: '집 전화번호',
  MOBILEPHONE: '핸드폰 번호',
  HOMEPAGE: '홈페이지 주소',
  EMAIL1: '전자 우편 주소1',
  EMAIL2: '전자 우편 주소2',
  ETC: '기타',
} as const;

// ─────────────────────────────────────────────────
// 컨트롤 이름 (조판 부호)
// ─────────────────────────────────────────────────

export const CTRL_NAMES: Record<string, string> = {
  AUTO_NUM: '번호 넣기',
  BOOKMARK: '책갈피',
  CANVAS: '캔버스',
  CHART: '차트',
  COLDEF: '단 정의',
  COMMENT: '숨은 설명',
  COMPOSE: '글자 겹치기',
  DUTMAL: '덧말',
  ENDNOTE: '미주',
  EQEDIT: '수식',
  FIELD: '필드',
  FIELD_END: '필드 끝',
  FIXED_WIDTH_SPACE: '고정폭 빈 칸',
  FOOTER: '꼬리말',
  FOOTNOTE: '각주',
  GEN_SHAPE_OBJECT: '그리기',
  HEADER: '머리말',
  HYPHEN: '하이픈',
  INDEXMARK: '색인 표시',
  LINE_BREAK: '줄바꿈',
  MARKIGNORE: '차례 숨김',
  NEW_NUM: '새 번호',
  NON_BREAKING_SPACE: '묶음 빈 칸',
  OLE: 'OLE 개체',
  PAGE_HIDING: '감추기',
  PAGE_NUM_CTRL: '쪽 번호 제어',
  PAGE_NUM_POS: '쪽 번호 위치',
  PARA_BREAK: '문단 나눔',
  PLUGIN: '플러그인',
  SECDEF: '구역 정의',
  TAB: '탭',
  TABLE: '표',
  TEXTART: '글맵시',
  TITLEMARK: '제목 차례',
  VIDEO: '동영상',
  GRAPH: '그래프',
};

// ─────────────────────────────────────────────────
// 필드 이름
// ─────────────────────────────────────────────────

export const FIELD_NAMES: Record<string, string> = {
  BOOKMARK: '책갈피 영역',
  CLICKHERE: '누름틀',
  CROSSREF: '상호 참조',
  DATECODE: '날짜 코드',
  FORMULA: '계산식',
  HYPERLINK: '하이퍼링크',
  MAILMERGE: '메일 머지',
  MEMO: '메모',
  PATH: '파일 경로',
  PRIVATE_INFO_SECURITY: '개인 정보',
  SUMMARY: '문서 정보',
  TABLEOFCONTENTS: '차례',
  UNKNOWN: '필드',
  USERINFO: '사용자 정보',
  CITATION: '인용',
  BIBLIOGRAPHY: '참고문헌',
  METADATA: 'MetaData',
};

// ─────────────────────────────────────────────────
// 교정 부호 (Revision Sign) 이름
// ─────────────────────────────────────────────────

export const REVISION_NAMES: Record<string, string> = {
  SIGN: '교정 부호',
  SIMPLE_CHANGE: '고침표',
  SIMPLE_INSERT: '추가표',
  ATTACH: '붙임표',
  CHANGE: '메모 고침표',
  CLIPPING: '뺌표',
  DELETE: '지움표',
  HYPERLINK: '자료 연결',
  LEFT_MOVE: '왼 자리 옮김표',
  RIGHT_MOVE: '오른 자리 옮김표',
  LINE: '줄표',
  LINE_ATTACH: '줄 붙임표',
  LINE_LINK: '줄 이음표',
  LINE_TRANSFER: '줄 서로 바꿈표',
  PRAISE: '칭찬표',
  SAWTOOTH: '톱니표',
  INSERT: '넣음표',
  LINE_INSERT: '줄 비움표',
  LINE_SEPARATE: '줄 바꿈표',
  SPACE: '띄움표',
  SYMBOL: '부호 넣음표',
  SPLIT: '나눔표',
  SPLIT_TRANSFER: '자리 바꿈 나눔표',
  SPLIT_LINE_TRANSFER: '줄 서로 바꿈 나눔표',
  THINKING: '생각표',
  TRANSFER: '자리 바꿈표',
};

// ─────────────────────────────────────────────────
// 도형 구성요소 이름
// ─────────────────────────────────────────────────

export const SHAPE_COMP_NAMES: Record<string, string> = {
  ARC: '호',
  CONNECT_LINE: '개체 연결선',
  CONTAINER: '묶음 개체',
  CURVE: '곡선',
  ELLIPSE: '타원',
  LINE: '선',
  MUNDANLINE: '문단띠로',
  OLE_CHART: '차트',
  OLE_FLASH: '플래쉬로',
  OLE_MOVIE: '동영상으로',
  OLE_VOICE: '소리로',
  PICTURE: '그림',
  POLYGON: '다각형',
  RECTANGLE: '사각형',
  UNKNOWN: '알 수 없는 개체',
};

// ─────────────────────────────────────────────────
// 양식(Form) 개체 이름
// ─────────────────────────────────────────────────

export const FORM_NAMES: Record<string, string> = {
  CHECKBUTTON: '선택 상자',
  COMBOBOX: '목록 상자',
  EDIT: '입력 상자',
  GENOBJECT: '양식개체',
  LISTBOX: '리스트 상자',
  PUSHBUTTON: '명령 단추',
  RADIOBUTTON: '라디오 단추',
  SCROLLBAR: '스크롤바',
};

// ─────────────────────────────────────────────────
// 번호 매기기 레이블
// ─────────────────────────────────────────────────

export const NUMBERING_LABELS = {
  FIGURE: '그림',
  TABLE: '표',
  EQUATION: '수식',
} as const;

// ─────────────────────────────────────────────────
// 상호 참조 위치
// ─────────────────────────────────────────────────

export const CROSSREF_POS = {
  UP: '위',
  DOWN: '아래',
} as const;

// ─────────────────────────────────────────────────
// 기본 문자열
// ─────────────────────────────────────────────────

/** 새 빈 문서 기본 이름 */
export const EMPTY_DOC_NAME = '빈문서 1';
/** 이름없음 */
export const NONAME = '이름없음';
/** 누름틀 기본 안내 문구 */
export const CLICKHERE_DEFAULT = '이곳을 마우스로 누르고 내용을 입력하세요.';
/** 스타일 사본 접미사 */
export const STYLE_COPY_SUFFIX_KO = ' 사본';
export const STYLE_COPY_SUFFIX_EN = ' Copy';
