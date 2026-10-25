/**
 * 한글 편집기(rhwp-studio) 중계 프로토콜 — 앱 창(Tauri) ↔ 중계 페이지(host.html, 127.0.0.1)
 *
 * 구조: 앱 창이 `editor_server` 의 host_url 을 iframe 으로 연다. 중계 페이지는 같은 출처의
 * rhwp-studio 를 @rhwp/editor SDK(createStudio + hwpctrl 플러그인)로 품고, 앱 창과는 아래
 * postMessage 로만 말한다. (SDK 는 HTTP(S) 출처만 받아서 tauri:// 창에서 직접 못 쓴다)
 *
 * 요청:  { kd: 'req', id, op, ...인자 }      앱 → 중계
 * 응답:  { kd: 'res', id, ok: true, result } | { kd: 'res', id, ok: false, error }
 * 이벤트: { kd: 'event', type, ... }          중계 → 앱
 * 바이트는 ArrayBuffer 로 transfer 한다.
 *
 * 문서 수명(열기·저장·인쇄)은 앱이 쥔다: 스튜디오를 ?chrome=embed 프로필로 띄워 스튜디오 자체의
 * 열기·새로 만들기·저장·PDF·인쇄 메뉴와 단축키가 없다. 편집기 안 Ctrl/⌘+S 는 save_request 이벤트로 앱에 넘긴다.
 */

export interface EditorDocState {
  format: 'hwp' | 'hwpx';
  dirty: boolean;
  changeSeq: number;
  pageCount: number;
}

export interface EditorParagraphTarget {
  section: number;
  paragraph: number;
}

/** op 이름 → [인자, 결과] */
export interface EditorOps {
  /** 문서 열기 (기존 문서 교체, 저장 안 한 변경 확인 없음) */
  load: [{ bytes: ArrayBuffer; name: string }, { pageCount: number }];
  /** 빈 문서 — embed 프로필엔 스튜디오의 새 문서 명령이 없어 늘 실패한다. 빈 문서는 앱이 만들어 load 로 연다 */
  new_doc: [Record<string, never>, { pageCount: number }];
  export: [{ format: 'hwp' | 'hwpx' }, { bytes: ArrayBuffer }];
  /** 지금 상태 (가볍다: 문서를 내보내지 않는다). 저장·출력·문서 바꾸기 직전엔 주기 알림을 기다리지 말고 이걸 물어라 */
  state: [Record<string, never>, EditorDocState];
  /** 문서 전체 글 (저장 없이 표기법 검사·AI 검토용) */
  text: [Record<string, never>, { text: string }];
  /** 커서가 있는 본문 문단 글 (표 안이면 target 이 null) */
  selection_text: [Record<string, never>, { text: string; target: EditorParagraphTarget | null; collapsed: boolean }];
  /** 커서 문단을 통째로 바꿔 넣기 — 실행 취소 1단계.
   *  글자 모양이 섞였거나 표·누름틀이 든 문단이면 바꾸지 않고 그 문단을 선택만 해 두고
   *  { ok:false, fallback:'paste' } — 앱이 글을 클립보드에 넣고 "붙여 넣기(Ctrl+V)" 를 안내한다 */
  replace_selection: [{ text: string }, { ok: boolean; fallback?: 'paste'; reason?: string }];
  /** 누름틀 이름 목록 */
  fields: [Record<string, never>, { names: string[] }];
  get_fields: [{ names: string[] }, { values: Record<string, string> }];
  /** 누름틀 채우기 — 한 트랜잭션(실행 취소 1단계) */
  put_fields: [{ values: Record<string, string> }, { applied: string[]; missing: string[] }];
  /** 찾기: 글자를 찾아 그 자리로 커서·화면 이동 (표기법 결과 클릭) */
  find: [{ text: string }, { found: boolean }];
  /** 스튜디오 명령 (edit:find-replace · view:zoom-fit-width …). 대화상자 여는 명령은 allow_dialog.
   *  embed 프로필이라 file:open·file:save·file:print 같은 파일 명령은 없다(ok:false, reason 'unregistered') */
  command: [{ id: string; params?: Record<string, unknown>; allow_dialog?: boolean }, { ok: boolean; reason?: string }];
  undo: [Record<string, never>, { ok: boolean }];
  redo: [Record<string, never>, { ok: boolean }];
  /** 앱이 파일로 저장한 뒤 알림 → 편집기 dirty 해제 */
  saved: [{ name: string }, { ok: boolean }];
  /** 메뉴·도구 상자·상태 표시줄 보이기 */
  chrome: [{ menu?: boolean; toolbar?: boolean; statusbar?: boolean }, { ok: boolean }];
  /** 변경 확인(changed 이벤트) 켜기·끄기 — 편집 화면이 안 보이면 끈다. 켜면 바로 한 번 확인한다 */
  watch: [{ on: boolean }, { ok: boolean }];
  /** 편집기 AI 도구 — 스튜디오 안 AI 플러그인(node-sidecar/studio-plugin/kordoc-ai-plugin.mjs)의 메서드를 부른다.
   *  변경 하나는 편집기 실행 취소 한 단계. 처음 부를 때 플러그인을 올린다 */
  agent: [{ method: string; args: unknown[] }, { result: unknown }];
}

export type EditorOp = keyof EditorOps;

export type EditorEvent =
  /** 스튜디오 준비 끝 — 이 뒤로 요청 가능 */
  | { kd: 'event'; type: 'ready'; studioVersion: string }
  /** 문서가 바뀜 (상태 확인에서 changeSeq·dirty 가 달라졌을 때. 확인은 앞 확인이 끝난 뒤 1초 이상 쉬고, watch 로 끌 수 있다).
   *  dirty:false 는 앱이 저장(saved)하거나 연(load) 뒤에만 온다 */
  | { kd: 'event'; type: 'changed'; state: EditorDocState }
  /** 편집기 안에서 Ctrl/⌘+S — 앱이 저장한다 */
  | { kd: 'event'; type: 'save_request' }
  | { kd: 'event'; type: 'error'; message: string };
