/**
 * 편집기 AI 플러그인 'kordoc-ai' — rhwp-studio 의 공개 플러그인 계약(PluginHost) 위에서 kordoc-ai-ops.mjs 를 실행한다.
 * 읽기는 host.read, 고치기는 host.transaction(호출 하나 = 실행 취소 한 단계, 실패하면 진입 시점으로 되돌림).
 * 연산이 이유를 들어 거절하면 던지지 않고 { error } 로 돌려준다 (모델이 읽고 다시 시도하게).
 *
 * 되돌리기: AI 가 한 변경 수와 그 사이 사용자가 고친 변경 수(foreignChanges)를 세어, 그 요청 뒤에
 * 사용자가 고치지 않았을 때만 편집기 실행 취소로 한 번에 되돌린다.
 */
import * as ops from './kordoc-ai-ops.mjs';

export const AI_PLUGIN_ID = 'kordoc-ai';
const REVEAL = 'ext:kordoc-ai-reveal';

/** 읽기 연산 (문서를 바꾸지 않는다) */
const READS = ['outline', 'readTable', 'find', 'styles', 'readStyle', 'fields'];
/** 고치기 연산 → 실행 취소 기록 이름 */
const WRITES = {
  replace: '찾아 바꾸기', setParagraph: '문단 고치기', insertParagraphs: '문단 넣기', deleteParagraphs: '문단 지우기',
  fillCells: '표 칸 채우기', addRows: '표 줄 넣기', removeRows: '표 줄 지우기', insertTable: '표 넣기',
  formatText: '글자 모양', formatParagraphs: '문단 모양', applyStyle: '스타일 적용', createStyle: '스타일 만들기',
  editStyle: '스타일 고치기', fillField: '누름틀 채우기', insertFootnote: '각주 넣기',
};

export const aiPlugin = {
  id: AI_PLUGIN_ID,
  apiVersion: 1,

  activate(host) {
    let own = false;
    let foreign = 0;
    // 남의 변경 세기. 편집기는 내용이 바뀌면 document-mutated 를 바로 낸다(짧게 친 글은 document-changed 가
    // 늦게 오거나 안 온다). 쪽 나누기를 뒤늦게 마칠 때 내는 것은 내용 변경이 아니라 거른다(큰 문서에서
    // 우리 변경 뒤에 와서 AI 되돌리기를 막지 않게). 같은지 다른지만 보니 한 변경을 여러 번 세어도 된다
    const layoutOnly = (why) => /pagination|overflow/.test(String(why ?? ''));
    for (const name of ['document-mutated', 'document-changed']) host.events.on(name, (why) => { if (!own && !layoutOnly(why)) foreign += 1; });
    host.onDocumentSwap(() => { foreign = 0; });
    // 바뀐 곳으로 커서·화면을 옮기는 명령 (자동화 명령은 편집기의 입력 처리기를 받는다)
    host.automation.registerCommand({
      id: REVEAL,
      label: 'AI 가 바꾼 곳 보기',
      execute(services, params) {
        services.getInputHandler()?.moveCursorTo({ sectionIndex: Number(params?.sec ?? 0), paragraphIndex: Number(params?.para ?? 0), charOffset: 0 });
      },
    });

    const guard = (fn) => {
      try {
        return fn();
      } catch (e) {
        if (e instanceof ops.OpError) return { error: e.message };
        throw e;
      }
    };
    const surface = {
      foreignChanges: () => foreign,
      /** count 번 실행 취소. 사용자가 그 사이 고쳤으면(foreign 이 달라짐) 하지 않는다 */
      undo(count, since) {
        if (since !== foreign) return { ok: false, reason: '이 요청 뒤에 문서를 직접 고쳐서 한 번에 되돌릴 수 없습니다. 편집기의 되돌리기(Ctrl+Z)를 쓰세요.' };
        own = true;
        try {
          for (let i = 0; i < count; i++) host.automation.execute('edit:undo');
        } finally { own = false; }
        return { ok: true };
      },
      reveal(place) {
        const m = /^(\d+)\.(\d+)/.exec(String(place ?? ''));
        if (m) host.automation.execute(REVEAL, { sec: Number(m[1]), para: Number(m[2]) });
        return true;
      },
    };
    for (const name of READS) surface[name] = (args) => guard(() => host.read((doc) => ops[name](doc, args ?? {})));
    for (const [name, label] of Object.entries(WRITES)) {
      surface[name] = (args) => guard(() => {
        own = true;
        try {
          return host.transaction(`AI: ${label}`, (tx) => {
            tx.deferPagination();
            return ops[name](tx.doc(), args ?? {});
          });
        } finally { own = false; }
      });
    }
    return surface;
  },
};
