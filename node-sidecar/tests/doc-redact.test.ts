/** 보안·손질·취합 — redact(서식 보존·잔존 재검사·결과에 원문 없음)·redact_batch·seal·patch_document·validate_hwpx·collect·write/read */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx, parse, redactMarkdown } from 'kordoc';
import { call, makePng, sample, setupEnv, SAMPLES } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const CLAIM = sample('3-민원서류_정보공개 청구서.hwpx');
const LETTER_PDF = sample('1-받은공문_도민체육대회 참가 협조 요청.pdf');
const FORMS = ['총무과', '기획예산과', '민원봉사과', '복지정책과', '도시계획과'].map((d) => sample(`취합/교육수요조사서_${d}.hwpx`));
let env: ReturnType<typeof setupEnv>;
/** 원본에 든 개인정보 원문 (검사용 — 결과·파일에 나오면 실패) */
let raw: string[] = [];

beforeAll(async () => {
  env = setupEnv();
  const r = await parse(readFileSync(CLAIM));
  if (!r.success) throw new Error(r.error);
  raw = redactMarkdown(r.markdown).hits.map((h) => r.markdown.slice(h.index, h.index + h.length));
});

describe('redact', () => {
  it('HWPX — 서식 보존 마스킹, 잔존 0, 결과·파일에 원문 없음', async () => {
    expect(raw.length).toBeGreaterThanOrEqual(4);
    const r = await call('redact', { path: CLAIM });
    expect(r.preserved).toBe(true);
    expect(r.residual).toBe(0);
    expect(r.total).toBeGreaterThanOrEqual(raw.length);
    expect(r.hits.map((h: { rule: string }) => h.rule)).toEqual(expect.arrayContaining(['rrn', 'phone']));
    const json = JSON.stringify(r);
    for (const v of raw) expect(json).not.toContain(v);
    expect(r.output_path).toMatch(/_가림\.hwpx$/);
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    for (const v of raw) expect(back.markdown).not.toContain(v);
    expect(redactMarkdown(back.markdown).hits).toHaveLength(0);
  });

  it('미리보기(dry_run) — 파일 없음, 마스크 문자', async () => {
    const r = await call('redact', { path: CLAIM, dry_run: true, mask_char: '*' });
    expect(r.output_path).toBeUndefined();
    expect(r.hits.flatMap((h: { samples: string[] }) => h.samples).join('')).toContain('*');
  });

  it('output_dir — 그 폴더에 <이름>_공개용 사본, 같은 이름은 (2) (화면 공개용 사본)', async () => {
    const dir = join(env.base, '공개용 폴더');
    const a = await call('redact', { path: CLAIM, output_dir: dir });
    expect(a.output_path).toBe(join(dir, '3-민원서류_정보공개 청구서_공개용.hwpx'));
    const b = await call('redact', { path: CLAIM, output_dir: dir });
    expect(b.output_path).toBe(join(dir, '3-민원서류_정보공개 청구서_공개용 (2).hwpx'));
    expect(existsSync(a.output_path) && existsSync(b.output_path)).toBe(true);
  });

  it('PDF — 검은 상자를 칠한 쪽 그림 PDF, 글자층이 없어 원문을 뽑을 수 없다', async () => {
    const src = await parse(readFileSync(LETTER_PDF));
    if (!src.success) throw new Error(src.error);
    const rules = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'name', 'address'];
    // 엔진과 같은 규칙(kordoc + 놓친 주소 꼴: 발신 기관 주소 "가온시 도청로 1" 도 주소로 가린다)
    const { redactMarkdown: engineRules } = await import('../src/core/redact/rules.js');
    const originals = engineRules(src.markdown, { rules: rules as never }).hits.map((h) => src.markdown.slice(h.index, h.index + h.length));
    expect(originals.length).toBeGreaterThanOrEqual(2); // 전자우편·이름
    const r = await call('redact', { path: LETTER_PDF, rules });
    expect(r.preserved).toBe(false);
    expect(r.output_path).toMatch(/_가림\.pdf$/);
    expect(r.residual).toBe(0);
    expect(r.total).toBe(originals.length);
    const out = readFileSync(r.output_path);
    expect(out.subarray(0, 4).toString()).toBe('%PDF');
    // 쪽 수는 같고, 어느 쪽에서도 글을 뽑을 수 없다 (PDFium 글자층·kordoc 파싱 모두)
    const { openPdf } = await import('../src/core/render/pdfium.js');
    const doc = await openPdf(new Uint8Array(out));
    try {
      expect(doc.getPageCount()).toBe(src.pageCount ?? 1);
      for (let i = 0; i < doc.getPageCount(); i++) expect(doc.getPage(i).getText().trim()).toBe('');
    } finally {
      doc.destroy();
    }
    const back = await parse(out, { ocr: false });
    const text = back.success ? back.markdown : '';
    for (const v of [...originals, '가온도민 한마음']) expect(text).not.toContain(v);
    expect(out.toString('latin1')).not.toMatch(/gaon\.example/);
  });

  it('그림 — 한 쪽짜리 가림 PDF (스캔은 글자 읽기로 자리를 찾는다)', async () => {
    const png = join(env.work, '스캔.png');
    writeFileSync(png, await makePng(1200, 300, 'mail hong@gaon.example'));
    const r = await call('redact', { path: png, rules: ['email'] });
    if (r.unscanned) {
      // 글자 읽기 모델이 없는 PC: 가리지 못한 쪽을 숨기지 않고 알린다
      expect(r.residual).toBeGreaterThanOrEqual(r.unscanned);
    } else {
      expect(r.total).toBe(1);
      expect(r.output_path).toMatch(/스캔_가림\.pdf$/);
    }
  });

  it('PDF — 글자층이 있는 쪽에 붙은 그림 속 글자도 읽어 가린다 (못 읽으면 숨기지 않고 알린다)', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawText('contact lee@gaon.example for the schedule of the event', { x: 50, y: 760, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
    page.drawImage(await pdf.embedPng(await makePng(1200, 300, 'mail hong@gaon.example')), { x: 50, y: 500, width: 480, height: 120 });
    const src = join(env.work, '붙임 있는 안내.pdf');
    writeFileSync(src, await pdf.save());
    const r = await call('redact', { path: src, rules: ['email'] });
    expect(r.output_path).toMatch(/_가림\.pdf$/);
    if (r.notes?.some((n: string) => n.includes('읽지 못했습니다'))) {
      // 글자 읽기 모델이 없는 PC: 글자층만 가렸고, 그림은 못 봤다고 알린다
      expect(r.total).toBe(1);
      expect(r.residual).toBeGreaterThanOrEqual(1);
    } else {
      expect(r.total).toBe(2);
    }
  });

  it('PDF 양식 칸에 적어 넣은 개인정보 — 미리 찾기는 칸이 있다고 알리고, 가릴 때 칸 속 글자까지 읽어 가린다', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawText('Application form for the autumn sports event of the province', { x: 50, y: 780, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const field = pdf.getForm().createTextField('contact');
    field.setText('hong@gaon.example');
    field.addToPage(page, { x: 50, y: 600, width: 400, height: 40 });
    const src = join(env.work, '양식 신청서.pdf');
    writeFileSync(src, await pdf.save());
    // 글자층에는 칸의 값이 없다 → 미리 찾기는 0곳이지만 조용히 넘어가지 않는다
    const dry = await call('redact', { path: src, rules: ['email'], dry_run: true });
    expect(dry.total).toBe(0);
    expect(dry.residual).toBeGreaterThanOrEqual(1);
    expect(dry.notes?.join(' ')).toMatch(/양식 칸/);
    const r = await call('redact', { path: src, rules: ['email'] });
    if (r.notes?.some((n: string) => /읽지 못했습니다|확인하지 못했습니다/.test(n))) {
      // 글자 읽기 모델이 없는 PC: 가렸다고 하지 않고 사람이 보라고 알린다
      expect(r.residual).toBeGreaterThanOrEqual(1);
    } else {
      // 칸 속 전자우편을 읽어 칠했다 → 가린 사본이 있고, 찾은 곳에 든다
      expect(r.output_path).toMatch(/_가림\.pdf$/);
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(r)).not.toContain('hong@gaon');
    }
  }, 60_000);

  it('PDF 좁은 칸에서 줄표 자리에 줄이 바뀐 번호도 찾아 가린다 ("010-1234-" / "5678")', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const put = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 12, font });
    put('Contact list of the autumn sports event of the province', 50, 780);
    put('Kim', 50, 700); put('010-1234-', 200, 700); put('5678', 200, 684);
    put('Lee', 50, 650); put('010-9876-5432', 200, 650);
    put('Park', 50, 600); put('900101-', 200, 600); put('1234567', 200, 584);
    const src = join(env.work, '좁은 칸 명단.pdf');
    writeFileSync(src, await pdf.save());
    const dry = await call('redact', { path: src, rules: ['phone', 'rrn'], dry_run: true });
    expect(dry.hits.find((h: { rule: string }) => h.rule === 'phone')?.count).toBe(2);
    expect(dry.hits.find((h: { rule: string }) => h.rule === 'rrn')?.count).toBe(1);
    const r = await call('redact', { path: src, rules: ['phone', 'rrn'] });
    expect(r.output_path).toMatch(/_가림\.pdf$/);
    expect(r.total).toBe(3);
    // 견본에도 가린 모양만 (전화는 규칙대로 끝 네 자리가 남는다)
    expect(JSON.stringify(r)).not.toContain('1234');
  }, 60_000);

  it('엔진 경고: 가리지 못한 개체는 사람이 볼 곳으로 세고, 삽입 그림은 수만 넘긴다(그림 속 글자는 따로 읽는다)', async () => {
    const { blindSpots } = await import('../src/core/redact/index.js');
    const b = blindSpots([
      '삽입 그림 2개(BinData/image1.png, BinData/image2.jpg)는 화소 속 글자(스캔 문서 등)를 탐지하지 못합니다',
      '삽입 개체 1개(BinData/ole1.ole — OLE·EMF)는 가리지 못합니다',
    ]);
    expect(b).toMatchObject({ count: 1, pictures: 2 });
    expect(b.notes).toHaveLength(1);
    expect(blindSpots([])).toMatchObject({ count: 0, pictures: 0 });
    expect(blindSpots(undefined).notes).toEqual([]);
  });

  it('한글 문서 안 그림: 그림 속 글자에 개인정보가 보이면 알리고, 없으면(직인·표지) 조용하다', async () => {
    const withPicture = async (name: string, text: string) => {
      const doc = join(env.work, `${name}.hwpx`);
      writeFileSync(doc, Buffer.from(await markdownToHwpx('# 신청서\n\n신청인 가온 (인)\n\n문의: kim@gaon.example\n')));
      const img = join(env.work, `${name}.png`);
      writeFileSync(img, await makePng(1200, 300, text));
      const sealed = await call('seal', { path: doc, image_path: img, anchor: '(인)' });
      expect(sealed.placed).toBe(1);
      return sealed.output_path as string;
    };
    const clean = await call('redact', { path: await withPicture('직인', 'GAON CITY'), rules: ['email'] });
    // 본문과 첫 쪽 미리보기 글에서 한 번씩
    expect(clean.total).toBeGreaterThanOrEqual(1);
    // 글자 읽기 모델이 없는 PC 에서는 그림을 읽지 못했다고 알린다 (조용히 넘어가지 않는다)
    const noOcr = clean.notes?.some((n: string) => n.includes('읽지 못했습니다'));
    if (!noOcr) expect(clean).toMatchObject({ residual: 0, unscanned: 0 });
    expect(clean.notes?.some((n: string) => n.includes('개인정보로 보이는')) ?? false).toBe(false);

    const leak = await call('redact', { path: await withPicture('신분증', 'mail hong@gaon.example'), rules: ['email'] });
    // 그림 속 글자는 가린 곳에 넣지 않는다 (가리지 못했다)
    expect(leak.total).toBe(clean.total);
    expect(leak.residual).toBeGreaterThanOrEqual(1);
    expect(leak.notes?.join(' ')).toMatch(noOcr ? /읽지 못했습니다/ : /그림 1개에서 개인정보로 보이는 글자 1곳/);
    // 미리 찾아보기도 같은 안내를 낸다 (가릴 것이 본문에 없어도 그림은 본다)
    const dry = await call('redact', { path: await withPicture('신분증2', 'mail hong@gaon.example'), rules: ['email'], dry_run: true });
    expect(dry.notes?.length).toBeGreaterThanOrEqual(1);
  });

  it('주소만 있는 문서 — 엔진 규칙에 안 걸려도 가린 사본을 만들고, 첫 쪽 미리보기 글에도 남기지 않는다', async () => {
    const JSZip = (await import('jszip')).default;
    const src = join(env.work, '주소만.hwpx');
    writeFileSync(src, Buffer.from(await markdownToHwpx('# 방문 안내\n\n오실 곳: 가온시 한빛로 123, 101동 1004호\n')));
    const r = await call('redact', { path: src, rules: ['address'] });
    expect(r.total).toBe(1);
    expect(r.residual).toBe(0);
    expect(r.output_path).toMatch(/주소만_가림\.hwpx$/);
    const out = readFileSync(r.output_path);
    const back = await parse(out);
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('가온시');
    expect(back.markdown).not.toContain('한빛로');
    const zip = await JSZip.loadAsync(out);
    const preview = await zip.file('Preview/PrvText.txt')?.async('string');
    expect(preview ?? '').not.toContain('한빛로');
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
  });

  it('남길 것 — 기관 대표번호·담당 공무원 이름은 가리지 않고, 나머지는 가린다', async () => {
    const doc = join(env.work, '안내문.hwpx');
    writeFileSync(doc, Buffer.from(await markdownToHwpx('# 안내\n\n문의: 주무관 김가온(031-000-1234), 신청인 연락처 010-2345-6789\n')));
    const r = await call('redact', { path: doc, rules: ['phone', 'name'], keep: ['031-000-1234', '김가온'] });
    expect(r.kept).toBe(2);
    expect(JSON.stringify(r.hits)).not.toContain('031-');
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('031-000-1234');
    expect(back.markdown).toContain('김가온');
    expect(back.markdown).not.toContain('010-2345-6789');
  });

  it('정보공개 공개본(이름·주소까지) — 도로명 주소 "가온시 한빛로 123, 101동 1004호" 까지 가린다 (kordoc 주소 규칙이 놓치는 꼴)', async () => {
    const DISCLOSURE = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'name', 'address'];
    const dry = await call('redact', { path: CLAIM, dry_run: true, rules: DISCLOSURE });
    expect(dry.hits.some((h: { rule: string }) => h.rule === 'address')).toBe(true);
    const r = await call('redact', { path: CLAIM, rules: DISCLOSURE, output_dir: join(env.out, '공개본') });
    expect(JSON.stringify(r)).not.toContain('한빛로 123');
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).not.toContain('한빛로 123');
    expect(back.markdown).not.toContain('1004호');
    expect(back.markdown).toContain('가온시'); // 시·군·구 이름은 남긴다 (kordoc 주소 가림과 같은 모양)
  });

  it('주소 규칙 — 도로명·지번 + 동·호는 잡고, 시 이름 뒤 보통 문장·문서번호는 안 잡는다', async () => {
    const { redactText } = await import('../src/core/redact/rules.js');
    const mask = (s: string) => redactText(s, { rules: ['address'] }).text;
    expect(mask('주소: 가온시 한빛로 123, 101동 1004호')).toBe('주소: 가온시 ●●● ●●●, ●●●● ●●●●●');
    expect(mask('경기도 가온시 중앙동 123-4번지')).toBe('경기도 가온시 ●●● ●●●●●●●');
    expect(mask('가온시 한빛로12번길 34')).not.toContain('34');
    for (const s of ['2026년 가온시 생활체육 시설 사용료', '가온시 체육진흥과-1234(2026.10.5.)', '가온시 시민 300명 참가']) expect(mask(s)).toBe(s);
    // 주소를 고르지 않으면 건드리지 않는다
    expect(redactText('가온시 한빛로 123', { rules: ['phone'] }).text).toBe('가온시 한빛로 123');
  });

  it('보지 않은 항목을 밝힌다 — 이름·주소를 고르지 않으면 unchecked_rules', async () => {
    const r = await call('redact', { path: CLAIM, dry_run: true });
    expect(r.unchecked_rules).toEqual(expect.arrayContaining(['name', 'address']));
    const all = await call('redact', { path: CLAIM, dry_run: true, rules: ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'name', 'address'] });
    expect(all.unchecked_rules).toEqual([]);
  });

  it('잘못된 마스크 문자는 안내', async () => {
    await expect(call('redact', { path: CLAIM, mask_char: 'ab' })).rejects.toThrow();
  });

  it('일괄 — 건수·잔존', async () => {
    const r = await call('redact_batch', { paths: [CLAIM, LETTER_PDF] });
    expect(r.results.every((x: { ok: boolean; residual: number }) => x.ok && x.residual === 0)).toBe(true);
    expect(r.results[0].total).toBeGreaterThanOrEqual(4);
  });
});

describe('seal·patch_document·validate_hwpx', () => {
  it('도장 — 앵커 위에 그림, 결과는 구조 검사 통과', async () => {
    const doc = join(env.work, '신청서.hwpx');
    writeFileSync(doc, Buffer.from(await markdownToHwpx('# 신청서\n\n신청인 홍길동 (인)\n')));
    const img = join(env.work, '도장.png');
    writeFileSync(img, await makePng(200, 200, '印'));
    const r = await call('seal', { path: doc, image_path: img, anchor: '(인)' });
    expect(r.placed).toBe(1);
    expect((await call('validate_hwpx', { path: r.output_path })).ok).toBe(true);
    // 없는 자리 글: 오류 대신 placed 0 + 할 일, 파일을 만들지 않는다
    const none = await call('seal', { path: doc, image_path: img, anchor: '(없는 문구)' });
    expect(none).toMatchObject({ placed: 0, output_path: '' });
    expect(none.reason).toContain('찾지 못해');
    expect(none.reason).not.toMatch(/occurrence|place_seal/);
  });

  it('도장 — 띄어 쓴 "( 인 )" 도 (인) 자리로 찾는다', async () => {
    const doc = join(env.work, '신청서2.hwpx');
    writeFileSync(doc, Buffer.from(await markdownToHwpx('# 신청서\n\n신청인 홍길동 ( 인 )\n')));
    const img = join(env.work, '도장.png');
    writeFileSync(img, await makePng(200, 200, '印'));
    const r = await call('seal', { path: doc, image_path: img, anchor: '(인)' });
    expect(r).toMatchObject({ placed: 1, anchor: '( 인 )' });
  });

  it('도장 — (인) 이 없는 공문은 발신명의(가온도지사) 끝 글자에 찍는다', async () => {
    const img = join(env.work, '도장.png');
    writeFileSync(img, await makePng(200, 200, '印'));
    const r = await call('seal', { path: sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'), image_path: img, anchor: '(인)' });
    expect(r).toMatchObject({ placed: 1, anchor: '사' });
    expect((await call('validate_hwpx', { path: r.output_path })).ok).toBe(true);
    // 도장 그림이 발신명의 문단에 들어갔다
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(readFileSync(r.output_path))).file('Contents/section0.xml')!.async('text');
    const name = xml.indexOf('가온도지사');
    const at = xml.indexOf('kordoc seal');
    expect(at).toBeGreaterThan(name);
    expect(at).toBeLessThan(xml.indexOf('</hp:p>', name));
  });

  it('도장 — (인)도 발신명의도 없는 보고서는 placed 0 과 이유, 개발자 문장 없음', async () => {
    const img = join(env.work, '도장.png');
    writeFileSync(img, await makePng(200, 200, '印'));
    const before = readdirSync(env.out).length;
    const r = await call('seal', { path: sample('4-보고서_디지털 행정 혁신 추진계획.hwpx'), image_path: img, anchor: '(인)' });
    expect(r).toMatchObject({ placed: 0, output_path: '' });
    expect(r.reason).toContain('(인)');
    expect(readdirSync(env.out).length).toBe(before);
  });

  it('고친 글 반영 — 서식 그대로', async () => {
    const src = sample('취합/교육수요조사서_총무과.hwpx');
    const md = (await call('convert', { path: src, keep_layout: true, save: false })).content as string;
    expect(md).toContain('이가람');
    const r = await call('patch_document', { path: src, markdown: md.replace('이가람', '박가온') });
    expect(r.applied).toBe(1);
    const back = await parse(readFileSync(r.output_path));
    expect(back.success && back.markdown).toContain('박가온');
  });

  it('구조 검사 — 깨진 HWPX', async () => {
    const bad = join(env.work, '깨짐.hwpx');
    writeFileSync(bad, 'PK not really');
    const r = await call('validate_hwpx', { path: bad });
    expect(r.ok).toBe(false);
    expect(r.issues[0].severity).toBe('error');
  });
});

describe('collect_fields·collect_run', () => {
  it('다섯 부서 서식 → 칸 후보 → 엑셀 한 장', async () => {
    const f = await call('collect_fields', { paths: FORMS });
    expect(f.fields.find((x: { label: string }) => x.label === '부서명')).toMatchObject({ count: 5 });
    const r = await call('collect_run', { paths: FORMS, fields: ['부서명', '담당자', '희망인원'] });
    expect(r.rows).toBe(5);
    expect(r.failed).toEqual([]);
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('총무과');
    expect(back.markdown).toContain('이가람');
  });
});

describe('write_file·read_file_b64', () => {
  it('덮어쓰기 거절 기본·허용 확장자·읽기', async () => {
    const p = join(env.work, '내보내기.hwpx');
    const data = readFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'));
    await call('write_file', { path: p, data_b64: data.toString('base64') });
    await expect(call('write_file', { path: p, data_b64: data.toString('base64') })).rejects.toThrow(/덮어쓰기/);
    await call('write_file', { path: p, data_b64: data.toString('base64'), overwrite: true });
    const r = await call('read_file_b64', { path: p });
    expect(r).toMatchObject({ name: '내보내기.hwpx', size: data.length });
    expect(Buffer.from(r.data_b64, 'base64').equals(data)).toBe(true);
    await expect(call('write_file', { path: join(env.work, 'x.exe'), data_b64: 'AA==' })).rejects.toThrow(/저장할 수 없습니다/);
    expect(existsSync(join(SAMPLES, '내보내기.hwpx'))).toBe(false);
  });
});
