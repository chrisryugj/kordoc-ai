/** 파일 병합 공유 타입 */

export type MergeMode = 'markdown' | 'native';

export interface MergeFilesParams {
  /** 입력 파일 경로 배열 */
  files: string[];
  /** 출력 파일 경로 */
  output_path: string;
  /** 파일 간 구분자 (마크다운 모드 전용, 기본: 제목 + 구분선) */
  separator?: string;
  /** 병합 모드 — native: 원본 서식 유지 수합, markdown: 마크다운 변환 후 합치기 (기본) */
  mode?: MergeMode;
}

export interface MergeFilesResult {
  success: boolean;
  output_path: string;
  file_count: number;
  /** 마크다운 모드: 글자 수, native 모드: 바이트 수 */
  total_length: number;
  failed_files: string[];
  /** 경고 메시지 (폴백 발생 시 등) */
  warnings?: string[];
}
