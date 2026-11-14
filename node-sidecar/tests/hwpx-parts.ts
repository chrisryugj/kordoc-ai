/** 합치기·나누기 시험용 — 구역에 바탕쪽(글·그림)과 차트를 실제 HWPX 꼴대로 붙인다.
 *
 * 바탕쪽 = Contents/masterpageN.xml(뿌리 id = manifest id) + manifest 항목 + secPr 끝의 <hp:masterPage idRef>,
 * 차트 = Chart/chartN.xml(manifest 에 없음) + 본문의 <hp:chart chartIDRef="경로">.
 * 한컴 문서·kordoc HWP→HWPX 변환본이 이 꼴이고, 변환본은 문서마다 masterpage0·chart1 부터 매긴다.
 */

import JSZip from 'jszip';

export const hpfOf = (zip: JSZip) => Object.keys(zip.files).find((n) => /content\.hpf$/i.test(n))!;

async function edit(zip: JSZip, name: string, f: (xml: string) => string): Promise<void> {
  zip.file(name, f(await zip.file(name)!.async('string')));
}

const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const HC = 'http://www.hancom.co.kr/hwpml/2011/core';

const pic = (bin: string) => `<hp:pic id="1095967444" zOrder="5" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="22225621" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="7200" height="7200"/><hp:curSz width="7200" height="7200"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="3600" centerY="3600" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="7200" y="0"/><hc:pt2 x="7200" y="7200"/><hc:pt3 x="0" y="7200"/></hp:imgRect><hp:imgClip left="0" right="7200" top="0" bottom="7200"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="7200" dimheight="7200"/><hc:img binaryItemIDRef="${bin}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="7200" widthRelTo="ABSOLUTE" height="7200" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`;

/** 막대 하나짜리 차트 (계열 이름 = label) */
const chartXml = (label: string, value: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${label}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1분기</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>${value}</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;

const chartEl = (path: string) => `<hp:chart id="1500000001" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" chartIDRef="${path}"><hp:sz width="20000" widthRelTo="ABSOLUTE" height="12000" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="709" right="709" top="709" bottom="709"/></hp:chart>`;

/**
 * section 구역에 바탕쪽 masterpage{master}(글 "바탕쪽 {mark}" + 그림 {image})와 차트 Chart/chart{chart}.xml(계열 "{mark} 예산")을 붙인다.
 * 바탕쪽 글자 모양은 그 구역 본문 첫 글자 모양과 같은 ID 를 쓴다 (합친 뒤 둘이 같은 새 ID 로 바뀌었는지 맞춰 보려고).
 * 그림은 글과 다른 문단에 둔다: 그림 바이트가 가짜라 rhwp 가 그림을 못 읽으면 같은 문단의 글까지 그리지 않는다
 */
export async function decorate(zip: JSZip, section: string, o: { master: number; chart: number; image: string; mark: string }): Promise<void> {
  const charPr = /charPrIDRef="(\d+)"/.exec(await zip.file(section)!.async('string'))![1];
  const mp = `masterpage${o.master}`;
  const chart = `Chart/chart${o.chart}.xml`;
  const para = (body: string) => `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${charPr}">${body}</hp:run></hp:p>`;
  zip.file(`BinData/${o.image}.png`, `picture-${o.mark}`);
  zip.file(`Contents/${mp}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><masterPage xmlns:hp="${HP}" xmlns:hc="${HC}" id="${mp}" type="BOTH" pageNumber="0" pageDuplicate="0" pageFront="0"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="42520" textHeight="70000" hasTextRef="0" hasNumRef="0">${para(`<hp:t>바탕쪽 ${o.mark}</hp:t>`)}${para(pic(o.image))}</hp:subList></masterPage>`);
  zip.file(chart, chartXml(`${o.mark} 예산`, 100 + o.chart));
  await edit(zip, hpfOf(zip), (x) => x.replace('</opf:manifest>', `<opf:item id="${o.image}" href="BinData/${o.image}.png" media-type="image/png" isEmbeded="1"/><opf:item id="${mp}" href="Contents/${mp}.xml" media-type="application/xml"/></opf:manifest>`));
  await edit(zip, section, (x) => x
    .replace('</hp:secPr>', `<hp:masterPage idRef="${mp}"/></hp:secPr>`)
    .replace(/masterPageCnt="\d+"/, 'masterPageCnt="1"')
    .replace(/<\/hs:sec>\s*$/, `${para(chartEl(chart))}</hs:sec>`));
}
