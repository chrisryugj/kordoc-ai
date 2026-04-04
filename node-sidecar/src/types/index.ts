/** 공유 타입 정의 */

/** 설정 파일 구조 */
export interface Settings {
  gemini: {
    model: string;
    lite_model: string;
    api_key: string;
    proxy_url: string;
    max_retries: number;
    timeout_ms: number;
    mode: 'online' | 'offline';
  };
  convert: {
    output_dir: string;
    ocr_fallback: boolean;
  };
  general: {
    log_level: 'debug' | 'info' | 'warn' | 'error';
  };
}

/** Progress notification 데이터 */
export interface ProgressData {
  current: number;
  total: number;
  message: string;
}
