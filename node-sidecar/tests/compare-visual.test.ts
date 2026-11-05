/** 나란히 비교 (compare_visual) — 쪽 글자 자리 읽기·블록 맞추기·칠할 상자 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { call, sample, setupEnv } from './doc-helpers.js';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { alignSide, alignText, snippets, svgGlyphs, type Glyph } from '../src/core/comparator/visual.js';
import type { CompareVisualResult, VisualMark } from '../src/types/rpc-contract.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const OLD = `# 가온시 주민 복지 조례

제1조(목적) 이 조례는 주민 복지 향상에 필요한 사항을 정한다.

제2조(정의) 이 조례에서 "주민"이란 시에 주소를 둔 사람을 말한다.

제3조(위임) 시행에 필요한 사항은 규칙으로 정한다.`;
const NEW = `# 가온시 주민 복지 조례

제1조(목적) 이 조례는 주민 복지 향상에 필요한 사항을 정한다.

제2조(정의) 이 조례에서 "주민"이란 시에 주민등록을 한 사람을 말한다.

제4조(지원) 시장은 예산의 범위에서 비용을 지원할 수 있다.`;

const g = (c: string, p = 0, x = 0): Glyph => ({ c, p, x, y: 0, w: 10, h: 10 });
const unit = (text: string, changed: string | boolean = false) => {
  const chars = Array.from(text.replace(/\s/g, ''));
  const mark = typeof changed === 'string' ? changed.replace(/\s/g, '') : '';
  const at = mark ? chars.join('').indexOf(mark) : -1;
  return { chars, mask: chars.map((_, i) => changed === true || (at >= 0 && i >= at && i < at + mark.length)) };
};

describe('svgGlyphs (rhwp 쪽 SVG)', () => {
  it('x·y 꼴과 translate 꼴, 엔티티, 공백 빼기', () => {
    const svg = [
      '<text x="10" y="50" font-size="20">가</text>',
      '<text x="30" y="50" font-size="20"> </text>',
      '<text x="50" y="50" font-size="20">&amp;</text>',
      '<text transform="translate(100,80) scale(0.5,1)" font-size="20" textLength="10" lengthAdjust="spacingAndGlyphs">2</text>',
    ].join('\n');
    const out = svgGlyphs(svg, 3);
    expect(out.map((x) => x.c)).toEqual(['가', '&', '2']);
    expect(out.every((x) => x.p === 3)).toBe(true);
    expect(out[0]).toMatchObject({ x: 10 });
    expect(out[0].y).toBeLessThan(50); // 기준선 위가 글자 머리
    expect(out[2]).toMatchObject({ x: 100, w: 5 }); // textLength × 장평
  });

  it('같은 줄 다음 글자까지를 폭으로', () => {
    const out = svgGlyphs('<text x="0" y="10" font-size="10">가</text><text x="12" y="10" font-size="10">나</text>', 0);
    expect(out[0].w).toBeCloseTo(10.5); // 간격 12 는 글자 크기 × 1.05 로 자른다
  });
});

describe('alignSide (블록 → 쪽 글자)', () => {
  it('그대로 있는 블록은 그 자리, 바뀐 글자만 칠함, 없는 블록은 들어갈 자리', () => {
    const glyphs = Array.from('머리말제1조목적제2조주소를둔사람꼬리').map((c, i) => g(c, 0, i * 10));
    const { hit, after } = alignSide([unit('제1조 목적'), null, unit('제2조 주소를 둔 사람', '주소를 둔')], glyphs);
    const marked = glyphs.filter((_, i) => hit[i] === 2).map((x) => x.c).join('');
    expect(marked).toBe('주소를둔');
    expect([...hit].filter((k) => k === 0)).toHaveLength(0); // 안 바뀐 블록은 칠하지 않는다
    expect(glyphs[after[1]].c).toBe('적'); // 없는 블록이 들어갈 자리 = 앞 블록(제1조 목적) 마지막 글자 뒤
    expect(after[0]).toBe(-1); // 맨 앞 블록 앞은 아직 맞춘 글자가 없다
  });

  it('쪽 글자에 끼어든 글(쪽 번호·안내문)이 있어도 맞춘다', () => {
    const glyphs = Array.from('제2조이조례에서-1-주민이란주소를둔사람').map((c, i) => g(c, 0, i * 10));
    const { hit } = alignSide([unit('제2조 이 조례에서 주민이란 주소를 둔 사람', '주소를 둔')], glyphs);
    expect(glyphs.filter((_, i) => hit[i] === 0).map((x) => x.c).join('')).toBe('주소를둔');
  });

  it('찾지 못한 블록은 건너뛰고 뒤 블록을 이어서 맞춘다', () => {
    const glyphs = Array.from('가나다라마바').map((c, i) => g(c, 0, i * 10));
    const { hit } = alignSide([unit('전혀다른글자', true), unit('라마', true)], glyphs);
    expect(glyphs.filter((_, i) => hit[i] === 1).map((x) => x.c).join('')).toBe('라마');
    expect([...hit].filter((k) => k === 0)).toHaveLength(0);
  });

  it('번호가 달리 그려진 짧은 블록이 멀리 흩어진 글자를 줍지 않는다 (뒤 바뀐 곳을 건너뛰지 않게)', () => {
    // 블록 "1.개요" 가 쪽에는 "1)개요" 로, 뒤쪽 "제1.항목과개요" 에 1·.·개·요 가 흩어져 있다
    const glyphs = Array.from('1)개요가온시는다음과같이추진한다변경된예산제1.항목과개요').map((c, i) => g(c, 0, i * 10));
    const { hit } = alignSide([unit('1.개요'), unit('가온시는 다음과 같이 추진한다'), unit('변경된 예산', true)], glyphs);
    expect(glyphs.filter((_, i) => hit[i] === 2).map((x) => x.c).join('')).toBe('변경된예산');
  });
});

describe('alignText (맞출 글)', () => {
  it('하위 항목 없는 목록 블록: 줄 머리 번호만 빼고 본문의 날짜·밑줄·별표는 쪽 글자 그대로', () => {
    const out = alignText({ type: 'list', text: '2026. 11. 5. 회의 a_b *x*' } as never);
    expect(out).toContain('2026. 11. 5. 회의 a_b *x*');
    expect(out).not.toContain('\\');
  });
});

describe('snippets (목록에 보낼 글)', () => {
  it('긴 글 끝쪽이 바뀌어도 바뀐 곳이 들어간다 (앞뒤 같은 부분은 줄임)', () => {
    const head = '가'.repeat(300);
    const [a, b] = snippets(`${head} 주소를 둔 사람`, `${head} 주민등록을 한 사람`);
    expect(a.startsWith('…')).toBe(true);
    expect(a).toContain('주소를 둔');
    expect(b).toContain('주민등록을 한');
    expect(a.length).toBeLessThan(80);
  });
  it('새로 넣은·뺀 글은 앞에서부터, 너무 길면 자른다', () => {
    const [a] = snippets('나'.repeat(500), '');
    expect(a.length).toBeLessThanOrEqual(241);
    expect(a.endsWith('…')).toBe(true);
    expect(snippets('짧은 글', '')[0]).toBe('짧은 글');
  });
});

describe('compare_visual', () => {
  let env: ReturnType<typeof setupEnv>;
  let oldPath: string;
  let newPath: string;
  let r: CompareVisualResult;

  beforeAll(async () => {
    env = setupEnv();
    oldPath = join(env.work, '조례_현행.hwpx');
    newPath = join(env.work, '조례_개정안.hwpx');
    writeFileSync(oldPath, Buffer.from(await markdownToHwpx(OLD)));
    writeFileSync(newPath, Buffer.from(await markdownToHwpx(NEW)));
    r = await call('compare_visual', { old_path: oldPath, new_path: newPath });
  }, 60_000);

  const inPage = (m: VisualMark) => m.x >= 0 && m.y >= 0 && m.x + m.w <= 1.001 && m.y + m.h <= 1.001 && m.w > 0 && m.h > 0;

  it('두 문서 모두 쪽 모양과 칠할 상자, 대조표 행도 같이', () => {
    expect(r.old?.pages.length).toBeGreaterThan(0);
    expect(r.new?.pages.length).toBeGreaterThan(0);
    expect(r.old!.marks.every(inPage)).toBe(true);
    expect(r.new!.marks.every(inPage)).toBe(true);
    expect(r.rows.some((x) => x.type === 'modified')).toBe(true);
  });

  it('바뀐 곳마다 양쪽 자리를 찾는다', () => {
    expect(r.changes.length).toBeGreaterThanOrEqual(2);
    for (const c of r.changes) {
      expect(c.old_page, `원본 자리 ${c.type} ${c.old}${c.new}`).toBeDefined();
      expect(c.new_page, `비교본 자리 ${c.type} ${c.old}${c.new}`).toBeDefined();
    }
    const mod = r.changes.find((c) => c.type === 'modified' && c.old.includes('주소를 둔'))!;
    expect(mod).toBeDefined();
    expect(r.old!.marks.filter((m) => m.change === mod.id).every((m) => m.kind === 'del')).toBe(true);
    expect(r.new!.marks.filter((m) => m.change === mod.id).every((m) => m.kind === 'add')).toBe(true);
    // 바뀐 어절만 칠한다 (제2조 줄 전체가 아니라)
    const width = r.new!.marks.filter((m) => m.change === mod.id).reduce((s, m) => s + m.w, 0);
    expect(width).toBeLessThan(0.4);
  });

  it('새로 넣은 조문은 원본에 들어갈 자리 막대, 뺀 조문은 비교본에 빠진 자리 막대', () => {
    const added = r.changes.find((c) => c.type === 'added' && c.new.includes('제4조'));
    const removed = r.changes.find((c) => c.type === 'removed' && c.old.includes('제3조'));
    if (added) expect(r.old!.marks.find((m) => m.change === added.id)?.kind).toBe('gap');
    if (removed) expect(r.new!.marks.find((m) => m.change === removed.id)?.kind).toBe('gap');
    expect(added || removed).toBeTruthy();
  });

  it('글자층 없는 PDF(스캔본)는 나란히 보기 대신 까닭을 준다', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const blank = join(env.work, '스캔본.pdf');
    writeFileSync(blank, await pdf.save());
    const t: CompareVisualResult = await call('compare_visual', { old_path: oldPath, new_path: blank });
    expect(t.new).toBeNull();
    expect(t.new_why).toMatch(/글자 정보가 없는/);
  }, 60_000);

  it('돌려 놓은 PDF 쪽(/Rotate 90)은 돌린 모양 그대로의 자리에 칠한다', async () => {
    const make = async (word: string, rotate: number) => {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const page = pdf.addPage([595, 842]);
      // 쪽 왼쪽 위에 한 줄 (돌리면 화면에서는 오른쪽 위로 간다)
      page.drawText(`Article 2. A resident is a person who ${word} in the city.`, { x: 50, y: 780, size: 12, font });
      page.drawText('Article 3. Details are set by rule.', { x: 50, y: 740, size: 12, font });
      if (rotate) page.setRotation(degrees(rotate));
      return pdf.save();
    };
    const a = join(env.work, '돌림_현행.pdf');
    const b = join(env.work, '돌림_개정안.pdf');
    writeFileSync(a, await make('has an address', 0));
    writeFileSync(b, await make('is registered', 90));
    const t: CompareVisualResult = await call('compare_visual', { old_path: a, new_path: b });
    expect(t.new!.pages[0]).toMatchObject({ width: 842, height: 595 }); // 돌린 쪽은 가로로 놓인다
    const add = t.new!.marks.filter((m) => m.kind === 'add');
    expect(add.length).toBeGreaterThan(0);
    expect(add.every(inPage)).toBe(true);
    // 돌리지 않은 자리(왼쪽 위 x≈0.06)가 아니라 돌린 자리(오른쪽, 위쪽)
    expect(add.every((m) => m.x > 0.5 && m.y < 0.6)).toBe(true);
    // 원본(안 돌림)은 왼쪽 위
    expect(t.old!.marks.filter((m) => m.kind === 'del').every((m) => m.x < 0.6 && m.y < 0.2)).toBe(true);
  }, 60_000);

  it('PDF 는 PDFium 글자 상자로 (한글 ↔ PDF 교차 비교)', async () => {
    const t: CompareVisualResult = await call('compare_visual', {
      old_path: sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'),
      new_path: sample('1-받은공문_도민체육대회 참가 협조 요청.pdf'),
    });
    expect(t.new?.pages.length).toBeGreaterThan(0);
    expect(t.new!.marks.length).toBeGreaterThan(0);
    expect(t.new!.marks.every(inPage)).toBe(true);
    // 바뀐 곳으로 잡힌 블록은 PDF 쪽에서도 자리를 찾는다
    expect(t.changes.filter((c) => c.type !== 'removed').every((c) => c.new_page)).toBe(true);
  }, 60_000);
});
