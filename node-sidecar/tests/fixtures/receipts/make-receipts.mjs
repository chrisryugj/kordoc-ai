/**
 * 합성 영수증 만들기 (시험용). 가짜 가게·가짜 사업자번호(검증 숫자가 일부러 틀린 번호)만 쓴다. 개인 영수증 금지.
 *
 *   CHROME_PATH=<크롬> node tests/fixtures/receipts/make-receipts.mjs
 *
 * HTML 을 헤드리스 크롬으로 PNG·PDF 로 찍고, 사진처럼 기울임·흐림은 sharp 로 더한다.
 * 결과: 이 폴더의 *.png·*.jpg·*.pdf + expected.json (시험이 맞춰 볼 값)
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', '..', 'package.json'));
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) throw new Error('CHROME_PATH 를 주세요');

/** 사업자등록번호 검증 숫자 (국세청 공개 규칙). 시험 번호는 일부러 틀리게 만들어 실제 사업자와 겹치지 않게 한다 */
function brnCheck(d9) {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(d9[i]) * w[i];
  s += Math.floor((Number(d9[8]) * 5) / 10);
  return (10 - (s % 10)) % 10;
}
function fakeBrn(first9) {
  const bad = (brnCheck(first9) + 1) % 10;
  const d = `${first9}${bad}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

const won = (n) => n.toLocaleString('en-US');
const FONT = "'GulimChe', 'Gulim', 'Malgun Gothic', monospace";
const page = (body, width, extra = '') => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; color: #111; font-family: ${FONT}; font-size: 15px; line-height: 1.55; }
  .r { width: ${width}px; padding: 18px 16px 26px; }
  .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 20px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .hr { border-top: 1px dashed #333; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 1px 0; text-align: right; font-weight: 400; }
  td:first-child, th:first-child { text-align: left; }
  ${extra}
</style><div class="r">${body}</div>`;

const itemsTable = (items) => `<table><tr><th>품명</th><th>수량</th><th>단가</th><th>금액</th></tr>${
  items.map(([n, q, u]) => `<tr><td>${n}</td><td>${q}</td><td>${won(u)}</td><td>${won(q * u)}</td></tr>`).join('')}</table>`;
const sum = (items) => items.reduce((s, [, q, u]) => s + q * u, 0);
const vatOf = (total) => total - Math.round(total / 1.1);

const R = [];

// 1. 마트 (카드)
{
  const brn = fakeBrn('214860001');
  const items = [['우유 1L', 2, 2650], ['식빵', 1, 3500], ['사과(봉)', 1, 9900], ['생수 2L x6', 1, 5100]];
  const total = sum(items);
  const vat = vatOf(total);
  R.push({
    file: 'mart.png', kind: 'mart', width: 340,
    html: `<p class="c b big">가온마트 한빛점</p>
      <p>사업자번호: ${brn}</p><p>대표자: 박가온</p><p>가온시 한빛로 101</p><p>TEL 031-000-1234</p>
      <p>[등록] 2026-10-28 14:32:10</p><div class="hr"></div>${itemsTable(items)}<div class="hr"></div>
      <div class="row"><span>과세물품가액</span><span>${won(total - vat)}</span></div>
      <div class="row"><span>부  가  세</span><span>${won(vat)}</span></div>
      <div class="row b big"><span>합    계</span><span>${won(total)}</span></div><div class="hr"></div>
      <div class="row"><span>신용카드</span><span>${won(total)}</span></div>
      <p>카드번호: 5412-34**-****-7890</p><p>승인번호: 12345678</p><p class="c">감사합니다</p>`,
    expect: { date: '2026-10-28', vendor: '가온마트 한빛점', brn, total, vat, supply: total - vat, payment: '카드', approval: '12345678', card: '5412', items: items.length },
  });
}

// 2. 식당 (현금, 받은금액·거스름돈이 합계보다 크다)
{
  const brn = fakeBrn('105120034');
  const items = [['김치찌개', 2, 9000], ['제육볶음', 1, 11000], ['공기밥', 1, 1000]];
  const total = sum(items);
  R.push({
    file: 'restaurant.png', kind: 'restaurant', width: 320,
    html: `<p class="c b big">한빛식당</p><p class="c">${brn}  대표 최한빛</p><p class="c">가온시 시청로 45 1층</p>
      <p>일자: 2026.10.30 (금) 12:41</p><div class="hr"></div>${itemsTable(items)}<div class="hr"></div>
      <div class="row b"><span>합계금액</span><span>${won(total)}</span></div>
      <div class="row"><span>받을금액</span><span>${won(total)}</span></div>
      <div class="row"><span>받은금액(현금)</span><span>50,000</span></div>
      <div class="row"><span>거스름돈</span><span>${won(50000 - total)}</span></div>
      <p class="c">현금영수증 미발행</p>`,
    expect: { date: '2026-10-30', vendor: '한빛식당', brn, total, payment: '현금', items: items.length },
  });
}

// 3. 신용카드 매출전표 (공급가액·부가세·합계 따로)
{
  const brn = fakeBrn('317040052');
  const supply = 41000;
  const vat = 4100;
  R.push({
    file: 'card-slip.png', kind: 'card', width: 360,
    html: `<p class="c b big">신용카드 매출전표</p><div class="hr"></div>
      <div class="row"><span>카드종류</span><span>가온카드</span></div>
      <div class="row"><span>카드번호</span><span>9410-12**-****-3456</span></div>
      <div class="row"><span>거래일시</span><span>2026/11/02 12:05:33</span></div>
      <div class="row"><span>거래유형</span><span>신용승인</span></div>
      <div class="row"><span>할부</span><span>일시불</span></div><div class="hr"></div>
      <div class="row"><span>공급가액</span><span>${won(supply)}</span></div>
      <div class="row"><span>부가세</span><span>${won(vat)}</span></div>
      <div class="row b big"><span>합계</span><span>${won(supply + vat)}</span></div>
      <div class="row"><span>승인번호</span><span>30012345</span></div><div class="hr"></div>
      <div class="row"><span>가맹점명</span><span>가온문구</span></div>
      <div class="row"><span>사업자번호</span><span>${brn}</span></div>
      <div class="row"><span>대표자명</span><span>김가온</span></div>
      <div class="row"><span>주소</span><span>가온시 시청로 12</span></div>`,
    expect: { date: '2026-11-02', vendor: '가온문구', brn, total: supply + vat, vat, supply, payment: '카드', approval: '30012345', card: '9410', items: 0 },
  });
}

// 3-2. 카드사 정보가 위에 있는 매출전표 (카드사 사업자번호가 가게 번호보다 먼저 나온다)
{
  const issuer = fakeBrn('110810001');
  const brn = fakeBrn('208110033');
  const supply = 20000;
  const vat = 2000;
  R.push({
    file: 'card-slip-issuer.png', kind: 'card', width: 360,
    html: `<p class="c b big">신용카드 매출전표</p><div class="hr"></div>
      <p>[카드사 정보]</p>
      <div class="row"><span>매입사</span><span>한빛카드</span></div>
      <div class="row"><span>사업자번호</span><span>${issuer}</span></div>
      <div class="row"><span>카드번호</span><span>4012-34**-****-5678</span></div>
      <div class="row"><span>거래일시</span><span>2026/11/03 15:40:12</span></div>
      <div class="row"><span>승인번호</span><span>41005566</span></div><div class="hr"></div>
      <div class="row"><span>공급가액</span><span>${won(supply)}</span></div>
      <div class="row"><span>부가세</span><span>${won(vat)}</span></div>
      <div class="row b big"><span>합계</span><span>${won(supply + vat)}</span></div><div class="hr"></div>
      <p>[가맹점 정보]</p>
      <div class="row"><span>가맹점명</span><span>바른사무</span></div>
      <div class="row"><span>사업자번호</span><span>${brn}</span></div>
      <div class="row"><span>대표자명</span><span>오바른</span></div>`,
    expect: { date: '2026-11-03', vendor: '바른사무', brn, total: supply + vat, vat, supply, payment: '카드', approval: '41005566', card: '4012', items: 0 },
  });
}

// 4. 간이영수증 (칸 있는 양식, 년월일 꼴, ₩ 표시)
{
  const brn = fakeBrn('602190078');
  const items = [['현수막 제작', 1, 30000], ['배송비', 1, 6000]];
  const total = sum(items);
  R.push({
    file: 'simple.png', kind: 'simple', width: 420,
    extra: `.f td, .f th { border: 1px solid #222; padding: 4px 6px; text-align: left; } .f .n { text-align: right; } .f th { background: #f3f3f3; }`,
    html: `<p class="c b big">영 수 증 (공급받는자용)</p><p>가온시 총무과 귀하</p>
      <table class="f"><tr><th rowspan="4">공급자</th><th>사업자등록번호</th><td colspan="2">${brn}</td></tr>
        <tr><th>상호</th><td>한결인쇄</td></tr><tr><th>성명</th><td>이한결</td></tr><tr><th>사업장소재지</th><td>가온시 공단로 7</td></tr></table>
      <table class="f" style="margin-top:8px"><tr><th>작성년월일</th><th>공급대가총액</th></tr><tr><td>2026년 11월 3일</td><td class="n">₩${won(total)}</td></tr></table>
      <p style="margin:8px 0">위 금액을 영수(청구)함.</p>
      <table class="f"><tr><th>품목</th><th>수량</th><th>단가</th><th>금액</th></tr>${
        items.map(([n, q, u]) => `<tr><td>${n}</td><td class="n">${q}</td><td class="n">${won(u)}</td><td class="n">${won(q * u)}</td></tr>`).join('')}
        <tr><th>합계</th><td></td><td></td><td class="n">${won(total)}</td></tr></table>`,
    expect: { date: '2026-11-03', vendor: '한결인쇄', brn, total, items: items.length },
  });
}

// 5. 편의점 세로 긴 감열지 (품목 많음)
{
  const brn = fakeBrn('129330066');
  const items = [['삼각김밥 참치', 2, 1300], ['컵라면 큰컵', 3, 1700], ['생수 500ml', 6, 900], ['커피우유', 2, 1600], ['초코과자', 1, 2400],
    ['물티슈', 2, 1500], ['볼펜 흑', 3, 800], ['A4 복사지', 1, 6500], ['테이프', 2, 1200], ['건전지 AA', 1, 4500], ['종이컵 50개', 2, 2200], ['커피믹스', 1, 9800]];
  const total = sum(items);
  const vat = vatOf(total);
  R.push({
    file: 'convenience-long.png', kind: 'long', width: 300,
    html: `<p class="c b big">가온25 시청점</p><p>사업자 ${brn}</p><p>가온시 시청로 3</p><p>2026-11-01 09:12 POS 02</p><div class="hr"></div>
      ${itemsTable(items)}<div class="hr"></div>
      <div class="row"><span>합계수량</span><span>${items.reduce((s, [, q]) => s + q, 0)}</span></div>
      <div class="row"><span>과세매출</span><span>${won(total - vat)}</span></div><div class="row"><span>부가세</span><span>${won(vat)}</span></div>
      <div class="row b big"><span>결제금액</span><span>${won(total)}</span></div><div class="hr"></div>
      <div class="row"><span>카드결제</span><span>${won(total)}</span></div><p>카드 4518-****-****-2201 승인 77001234</p>
      <p class="c">교환·환불은 영수증 지참</p><p class="c">${'·'.repeat(10)}</p>`,
    expect: { date: '2026-11-01', vendor: '가온25 시청점', brn, total, vat, supply: total - vat, payment: '카드', approval: '77001234', card: '4518', items: items.length },
  });
}

// 6. 사진처럼 기울고 흐린 분식집 영수증 (두 자리 연도)
{
  const brn = fakeBrn('411250019');
  const items = [['떡볶이', 2, 4500], ['순대', 1, 4000], ['어묵', 2, 1250]];
  const total = sum(items);
  R.push({
    file: 'skewed-blur.jpg', kind: 'photo', width: 320, skew: 2.5, blur: 0.7,
    html: `<p class="c b big">바른분식</p><p>${brn} 정바른</p><p>가온시 학교로 9</p><p>26.11.04 15:20</p><div class="hr"></div>
      ${itemsTable(items)}<div class="hr"></div><div class="row b big"><span>합계</span><span>${won(total)}</span></div>
      <div class="row"><span>카드</span><span>${won(total)}</span></div><p>승인번호 55667788</p>`,
    expect: { date: '2026-11-04', vendor: '바른분식', brn, total, payment: '카드', approval: '55667788', items: items.length },
  });
}

// 7. 전자영수증 PDF (글자층 있음 → OCR 안 함)
{
  const brn = fakeBrn('220810045');
  const items = [['공문서 작성 실무', 1, 18000], ['행정 문서 편람', 1, 14400]];
  const total = sum(items);

  R.push({
    file: 'e-receipt.pdf', kind: 'pdf', width: 420, pdf: true,
    html: `<p class="c b big">가온서점 전자영수증</p><p>상호: 가온서점</p><p>사업자등록번호: ${brn}</p><p>거래일: 2026-10-25</p><div class="hr"></div>
      ${itemsTable(items)}<div class="hr"></div><div class="row"><span>면세물품가액</span><span>${won(total)}</span></div>
      <div class="row b big"><span>총 결제금액</span><span>${won(total)}</span></div><div class="row"><span>결제수단</span><span>신용카드</span></div>`,
    expect: { date: '2026-10-25', vendor: '가온서점', brn, total, payment: '카드', items: items.length, via: 'text' },
  });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const tab = await browser.newPage();
  for (const r of R) {
    await tab.setViewport({ width: r.width, height: 400, deviceScaleFactor: 2 });
    await tab.setContent(page(r.html, r.width, r.extra), { waitUntil: 'load' });
    const out = join(here, r.file);
    if (r.pdf) {
      await tab.pdf({ path: out, width: `${r.width + 40}px`, printBackground: true });
      continue;
    }
    const el = await tab.$('.r');
    let img = sharp(await el.screenshot({ type: 'png' }));
    if (r.skew) img = sharp(await img.rotate(r.skew, { background: '#e9e7e2' }).png().toBuffer());
    if (r.blur) img = img.blur(r.blur);
    // 작게: 회색조, 사진은 JPEG
    img = img.grayscale();
    await (r.file.endsWith('.jpg') ? img.jpeg({ quality: 82 }) : img.png({ compressionLevel: 9, palette: true })).toFile(out);
  }
} finally {
  await browser.close();
}
writeFileSync(join(here, 'expected.json'), `${JSON.stringify(Object.fromEntries(R.map((r) => [r.file, r.expect])), null, 2)}\n`);
console.log(`영수증 ${R.length}장: ${R.map((r) => r.file).join(', ')}`);
