/** 가짜 법제처(DRF) — 항·호·목 조문 JSON, 시행일 판(eflaw) 검색·본문까지. law-verify.test.ts 와 화면 검증(scripts/e2e-ui/f-law.mjs)이 같이 쓴다.
 *
 * 응답 모양은 2026-10 실측·open.law.go.kr 안내서 그대로(LawSearch.law[]·법령.조문.조문단위[]·항[]{항번호 '①'}·호[]{호번호 '1.'}·목[]{목번호 '가.'},
 * 항으로 나뉘지 않은 조문은 항번호 없는 { 호: [...] } 하나). 법령 이름·조문 내용은 모두 시험용으로 지어낸 것이다(실제 법령 아님).
 *
 *   const drf = await startFakeDrf();   // drf.base = 'http://127.0.0.1:<port>/DRF/'
 *   drf.requests                         // 받은 요청 URL 들
 *   await drf.close();
 */
import { createServer } from 'node:http';

const row = (name, mst, id, ef, state = '현행', abbr = '') => ({ 법령명한글: name, 법령약칭명: abbr, 법령일련번호: mst, 법령ID: id, 현행연혁코드: state, 시행일자: ef, 공포일자: ef });

/** 현행 판 */
export const CURRENT = [
  row('가온 개인정보 시험법', '910002', '910000', '20260601'),
  row('가온 개인정보 시험법 시행령', '910102', '910100', '20250101'),
  row('가온 새이름법', '910202', '910200', '20250101'),
  row('가온 주차 시험법', '910302', '910300', '20200101'),
];
/** 연혁 판 (현행 행과 같은 법령ID) */
export const HISTORY = [
  row('가온 개인정보 시험법', '910001', '910000', '20240101', '연혁'),
  row('가온 개인정보 시험법', '910000', '910000', '20200101', '연혁'),
  row('가온 옛이름법', '910201', '910200', '20200101', '연혁'),
];

const unit = (jo, content, extra = {}) => ({ 조문번호: jo, 조문여부: '조문', 조문내용: content, ...extra });
const ho = (no, text, mok) => ({ 호번호: `${no}.`, 호내용: `${no}. ${text}`, ...(mok ? { 목: mok.map(([n, t]) => ({ 목번호: `${n}.`, 목내용: `${n}. ${t}` })) } : {}) });

const DEF = unit('2', '제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.', {
  조문제목: '정의',
  항: { 호: [ho(1, '"개인정보"란 살아 있는 개인에 관한 정보로서 다음 각 목의 어느 하나에 해당하는 정보를 말한다.', [['가', '성명, 주민등록번호 및 영상 등을 통하여 개인을 알아볼 수 있는 정보'], ['나', '해당 정보만으로는 특정 개인을 알아볼 수 없더라도 다른 정보와 쉽게 결합하여 알아볼 수 있는 정보']]), ho(2, '"처리"란 개인정보의 수집, 생성, 저장, 이용, 제공 등을 말한다.')] },
});
const P1 = (ho2) => ({ 항번호: '①', 항내용: '① 개인정보처리자는 다음 각 호의 어느 하나에 해당되는 경우에는 정보주체의 개인정보를 제3자에게 제공할 수 있다. <개정 2026.6.1>', 호: [ho(1, '정보주체의 동의를 받은 경우'), ho(2, ho2)] });
const P2 = { 항번호: '②', 항내용: '② 개인정보처리자는 제1항제1호에 따른 동의를 받을 때에는 제공받는 자와 제공 목적을 정보주체에게 알려야 한다.' };

export const BODIES = {
  // 현행 (2026. 6. 1. 시행)
  '910002': [
    { 조문번호: '1', 조문여부: '전문', 조문내용: '제1장 총칙' },
    unit('1', '제1조(목적) 이 법은 개인정보의 처리 및 보호에 관한 사항을 정함을 목적으로 한다.', { 조문제목: '목적' }),
    DEF,
    unit('17', '제17조(개인정보의 제공)', { 조문제목: '개인정보의 제공', 항: [P1('법률에 특별한 규정이 있는 경우'), P2, { 항번호: '③', 항내용: '③ 삭제 <2026.6.1>' }] }),
    unit('18', '제18조(목적 외 이용의 제한) 개인정보처리자는 개인정보를 수집 목적의 범위를 초과하여 이용하여서는 아니 된다. [본조신설 2026.6.1]', { 조문제목: '목적 외 이용의 제한' }),
    unit('20', '제20조 삭제 <2026.6.1>'),
  ],
  // 2024. 1. 1. 시행 판 (공문 시행일 2026. 3. 2. 당시)
  '910001': [
    unit('1', '제1조(목적) 이 법은 개인정보의 처리 및 보호에 관한 사항을 정함을 목적으로 한다.', { 조문제목: '목적' }),
    DEF,
    unit('17', '제17조(개인정보의 제공)', { 조문제목: '개인정보의 제공', 항: [P1('법률에 특별한 규정이 있거나 법령상 의무를 준수하기 위하여 불가피한 경우'), P2, { 항번호: '③', 항내용: '③ 개인정보처리자는 제3자에게 제공한 내역을 기록하고 3년간 보관하여야 한다.' }] }),
    unit('20', '제20조(수집 출처 등의 통지) 개인정보처리자는 정보주체 이외로부터 수집한 개인정보를 처리하는 때에는 수집 출처를 정보주체에게 알려야 한다.', { 조문제목: '수집 출처 등의 통지' }),
  ],
  '910000': [unit('1', '제1조(목적) 시험용 옛 목적 조문', { 조문제목: '목적' })],
  '910102': [unit('3', '제3조(제공 절차) 법 제17조에 따른 제공은 서면으로 요청한다.', { 조문제목: '제공 절차' })],
  '910202': [unit('3', '제3조(시험 조문) 시험용 본문', { 조문제목: '시험 조문' })],
  '910302': [unit('5', '제5조(주차요금 감면) ① 시장은 장애인 차량의 주차요금을 감면할 수 있다.', { 조문제목: '주차요금 감면' })],
};

const norm = (s) => s.replace(/\s+/g, '').replace(/[·ㆍ]/g, '');

/** 공문 견본 — 맞는 인용·없는 조문·없는 항·바뀐 이름·내용 어긋남·공문 시행일 뒤 개정·그 당시엔 없던 조문·지금은 삭제된 항 */
export const SAMPLE_GONGMUN = [
  '가온시',
  '수신 가온구청장(개인정보보호과장)',
  '제목 개인정보 제3자 제공 협조 요청',
  '',
  '1. 「가온 개인정보 시험법」 제17조제1항제1호에 따라 정보주체의 동의를 받은 경우 개인정보를 제3자에게 제공할 수 있습니다.',
  '2. 같은 법 제17조 제1항 제2호에 따라 법령상 의무를 준수하기 위하여 불가피한 경우에도 제공합니다.',
  '3. 동법 제17조제3항에 따라 제공한 내역을 기록하고 3년간 보관하여 주시기 바랍니다.',
  '4. 같은 법 제17조제5항에 따른 제공 동의서 서식을 붙임과 같이 보냅니다.',
  '5. 같은 법 제2조제1호가목에 따른 성명과 주민등록번호는 가려서 보내 주십시오.',
  '6. 같은 법 제18조에 따라 수집 목적의 범위를 초과하여 이용하지 않도록 유의하여 주십시오.',
  '7. 「가온 개인정보 시험법」 제1조에 따라 주차장 요금 감면 대상 차량 번호를 매월 정리하여 보고합니다.',
  '8. 「가온 옛이름법」 제3조와 「가온 개인정보 시험법」 제99조도 참고하시기 바랍니다.',
  '',
  '붙임 제공 동의서 서식 1부. 끝.',
  '',
  '가온시장',
  '시행 개인정보보호과-1234 (2026. 3. 2.) 접수',
].join('\n');

export async function startFakeDrf({ port = 0, host = '127.0.0.1' } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    requests.push(u);
    const p = u.searchParams;
    const json = (v) => { res.writeHead(200, { 'content-type': 'application/json;charset=UTF-8' }); res.end(JSON.stringify(v)); };
    if (p.get('OC') === 'bad-oc') return json({ result: '사용자 정보 검증에 실패하였습니다.', msg: 'OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.' });
    if (p.get('type') !== 'JSON') return json({});
    const target = p.get('target');
    if (u.pathname === '/DRF/lawSearch.do') {
      const q = norm(p.get('query') ?? '');
      const hit = (r) => !q || norm(r.법령명한글).includes(q) || (r.법령약칭명 !== '' && norm(r.법령약칭명).includes(q));
      let law;
      if (target === 'law') law = CURRENT.filter(hit);
      else if (target === 'eflaw') {
        const all = [...CURRENT, ...HISTORY];
        const lid = p.get('LID');
        const range = /^(\d{8})~(\d{8})$/.exec(p.get('efYd') ?? '');
        if (lid || range) {
          law = all.filter((r) => (!lid || r.법령ID === lid) && hit(r) && (!range || (r.시행일자 >= range[1] && r.시행일자 <= range[2])));
          if (p.get('sort') === 'efdes') law.sort((a, b) => b.시행일자.localeCompare(a.시행일자));
        } else {
          // 실측: 옛 이름으로 찾아도 같은 법령ID 의 현행 행(바뀐 이름)이 함께 온다
          const ids = new Set(all.filter(hit).map((r) => r.법령ID));
          law = all.filter((r) => ids.has(r.법령ID));
        }
      } else { res.writeHead(200); res.end(''); return; }
      return json({ LawSearch: { target, totalCnt: String(law.length), resultCode: '00', ...(law.length ? { law: law.length === 1 ? law[0] : law } : {}) } });
    }
    if (u.pathname === '/DRF/lawService.do') {
      const mst = p.get('MST') ?? '';
      // eflaw 본문은 MST + efYd(그 판의 시행일자)가 맞아야 준다
      if (target === 'eflaw') {
        const r = [...CURRENT, ...HISTORY].find((x) => x.법령일련번호 === mst);
        if (!r || r.시행일자 !== p.get('efYd')) return json({ Law: '일치하는 법령이 없습니다. 법령명을 확인하여 주십시오.' });
      } else if (target === 'law' && !CURRENT.some((x) => x.법령일련번호 === mst)) {
        return json({ Law: '일치하는 법령이 없습니다. 법령명을 확인하여 주십시오.' });
      }
      const units = BODIES[mst];
      if (!units) return json({ Law: '일치하는 법령이 없습니다. 법령명을 확인하여 주십시오.' });
      return json({ 법령: { 기본정보: { 법령명_한글: '' }, 조문: { 조문단위: units } } });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(port, host, r));
  const base = `http://${host}:${server.address().port}/DRF/`;
  return {
    base, requests, server,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
