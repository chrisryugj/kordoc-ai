/** 공유 타입 정의 */

export type AiProviderId = 'none' | 'embedded' | 'openai' | 'local' | 'gemini' | 'anthropic' | 'claude-code' | 'codex';

/** 설정 파일 구조 (v2 — JSON, 앱 데이터 폴더) */
export interface Settings {
  version: 2;
  ai: {
    provider: AiProviderId;
    /** 내장 엔진 (node-llama-cpp, GGUF) */
    embedded: { model_path: string; context_size: number; gpu: 'auto' | 'off' };
    /** OpenAI 호환 주소 — Ollama·LM Studio·vLLM·기관 서버·OpenAI */
    openai: { base_url: string; api_key: string; model: string; vision_model: string };
    gemini: { api_key: string; model: string };
    anthropic: { api_key: string; model: string };
    /** 이 PC 의 로컬 모델 서버 — Ollama·LM Studio·llama.cpp 서버·vLLM 등 (OpenAI 호환, 보통 127.0.0.1) */
    local: { base_url: string; api_key: string; model: string };
    /** 구독 계정(Claude Code) — PC 에 설치해 로그인해 둔 프로그램. model 이 비면 프로그램 기본, cli_path 가 비면 자동으로 찾음 */
    claude_code: { model: string; cli_path: string };
    /** 구독 계정(ChatGPT/Codex) — 같은 방식 */
    codex: { model: string; cli_path: string };
    /** 구독 계정으로 문서 보내기 허용 — 인터넷으로 나가니 기본 꺼짐. 기관이 false 로 고정하면 구독 연결을 막는다 */
    allow_subscription: boolean;
    /** 클라우드 공급자로 보내기 전 개인정보 자동 마스킹 */
    redact_before_cloud: boolean;
    timeout_ms: number;
  };
  privacy: {
    /** 폐쇄망 모드 — 외부 통신 전면 차단 (사설·루프백 주소만 허용) */
    offline: boolean;
  };
  /** 내 기관 정보 — 서식 칸 자동 채움·공문 머리/끝·결재란·도장 */
  org: {
    name: string;
    dept: string;
    position: string;
    person: string;
    phone: string;
    fax: string;
    email: string;
    address: string;
    homepage: string;
    /** 결재 라인 직위 (예: 담당, 팀장, 과장) */
    approval_line: string[];
    /** kordoc 기관 서식 이름 (agencyNames) — 비면 공통 */
    agency: string;
    /** 관인·서명 이미지 경로 (PNG) */
    seal_image: string;
    /** 문서번호 앞부분 (예: 총무과-) */
    doc_number_prefix: string;
  };
  convert: {
    output_dir: string;
    /** 스캔 쪽 OCR: auto(필요한 쪽만) · force(전 쪽) · off */
    ocr: 'auto' | 'force' | 'off';
  };
  general: {
    log_level: 'debug' | 'info' | 'warn' | 'error';
  };
  /** 효과 집계 — 일 종류별 "손으로 할 때 걸리는 분" 가정치를 기관 실정에 맞게 덮어씀 (비면 기본값) */
  impact: {
    baselines: Record<string, number>;
  };
  /** 법령 근거 확인 — 법제처 Open API 아이디(OC). 비면 확인하지 않는다 */
  law: { oc: string };
  /** 기관 배포 설정(읽기 전용, get_settings 가 채움) — 파일 위치·안내·고정된 항목 경로("privacy.offline" 꼴) */
  policy?: { source: string; notice?: string; locked: string[]; error?: string };
}

/** Progress notification 데이터 */
export interface ProgressData {
  current: number;
  total: number;
  message: string;
}
