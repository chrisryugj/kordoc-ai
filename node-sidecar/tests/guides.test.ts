/** 미리보기 사본의 빈 누름틀 안내문 — XML 특수 문자(& < >)가 든 안내문도 글자 수대로 자르고 다시 이스케이프한다 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { showFieldGuides } from '../src/core/render/guides.js';

async function hwpx(command: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('Contents/header.xml', '<hh:head xmlns:hh="h"><hh:refList><hh:charProperties itemCnt="1"><hh:charPr id="0" height="1000" textColor="#000000"><hh:spacing hangul="0"/></hh:charPr></hh:charProperties></hh:refList></hh:head>');
  zip.file('Contents/section0.xml', `<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run charPrIDRef="0"><hp:t>담당 </hp:t><hp:ctrl><hp:fieldBegin id="1" type="CLICK_HERE" name="담당"><hp:parameters cnt="1"><hp:stringParam name="Command">${command}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="1"/></hp:ctrl><hp:t> 끝</hp:t></hp:run></hp:p></hs:sec>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function sectionOf(bytes: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file('Contents/section0.xml')!.async('string');
}

describe('showFieldGuides', () => {
  it('안내문 "Q&A 담당"·"기간<월>" 을 글자 수대로 자르고 XML 이 깨지지 않게', async () => {
    for (const [cmd, want] of [
      ['Clickhere:set:40:Direction:wstring:6:Q&amp;A 담당 HelpState:wstring:0: ', '<hp:t>Q&amp;A 담당</hp:t>'],
      ['Clickhere:set:40:Direction:wstring:5:기간&lt;월&gt; HelpState:wstring:0: ', '<hp:t>기간&lt;월&gt;</hp:t>'],
    ] as const) {
      const xml = await sectionOf(await showFieldGuides(await hwpx(cmd)));
      expect(xml).toContain(want);
      const errors: string[] = [];
      new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg); } }).parseFromString(xml, 'text/xml');
      expect(errors).toEqual([]);
    }
  });
});
