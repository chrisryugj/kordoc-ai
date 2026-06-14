/**
 * E2E 테스트 (Issue #1171 v2): 사각형 글상자 위에 이미지 드롭 → 본문(body) sibling 삽입
 *
 * 한컴: 글상자 위에 이미지를 넣으면 글상자의 sibling 으로 본문 레벨 떠있는 개체가 된다
 * (글상자를 움직여도 이미지는 독립적으로 남음). rhwp 는 글상자 hit 의 cellPath(글상자
 * sentinel)를 그대로 insertPicture 에 넘겨, 표 전용 resolver 가 "controls[N]가 표가
 * 아닙니다" 로 거부 → 삽입 실패(이미지 안 생김).
 *
 * 수정: finishImagePlacement 가 글상자(isTextBox) hit 은 cellPath 를 쓰지 않고 본문
 * para(parentParaIndex)에 floating 으로 삽입한다.
 *
 * 검증: 가짜 글상자 hit 을 주입하고 finishImagePlacement 를 호출하여, 본문 para 25 에
 * cellPath 없는 image(= 본문 sibling)가 추가되는지 확인.
 */
import { runTest, loadHwpFile, assert } from './helpers.mjs';

// 1x1 투명 PNG
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

runTest('글상자 위 이미지 드롭 → 본문 sibling 삽입 (#1171 v2)', async ({ page }) => {
  await loadHwpFile(page, 'tac-img-02.hwp');

  const result = await page.evaluate(async (b64) => {
    const wasm = window.__wasm;
    const ih = window.__inputHandler;

    // 삽입 전: 본문 para 25 의 cellPath 없는 image 개수 (page 5)
    const countBodyImages = () => {
      let n = 0;
      const layout = wasm.getPageControlLayout(5);
      for (const c of layout.controls || []) {
        if (c.type === 'image' && c.paraIdx === 25 && !c.cellPath) n++;
      }
      return n;
    };
    const before = countBodyImages();

    // 이미지 placement 모드 진입 + 가짜 글상자 hit 주입
    const data = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    ih.enterImagePlacementMode(data, 'png', 1, 1, 'test.png');
    // 글상자(isTextBox) hit — parentParaIndex=25(본문), cellPath=글상자 sentinel
    ih.hitTestFromEvent = () => ({
      sectionIndex: 0,
      paragraphIndex: 0,
      parentParaIndex: 25,
      controlIndex: 0,
      charOffset: 0,
      isTextBox: true,
      cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
    });
    ih.imagePlacementDrag = {
      startClientX: 200, startClientY: 200,
      currentClientX: 260, currentClientY: 260,
      isDragging: true,
    };

    let err = null;
    try {
      ih.finishImagePlacement(new MouseEvent('mouseup', { clientX: 230, clientY: 230 }));
    } catch (e) {
      err = e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 400));

    const after = countBodyImages();

    // 한컴 정합: 삽입된 본문 image 의 모델 표현 확인 — 글상자(Shape)의 sibling 으로
    // 본문 para 25 에 들어있고, floating(treat_as_char=false)이어야 한다.
    let shapeStillPresent = false;
    let newImgCtrlIdx = null;
    {
      const layout = wasm.getPageControlLayout(5);
      for (const c of layout.controls || []) {
        if (c.type === 'shape' && c.paraIdx === 25) shapeStillPresent = true;
        if (c.type === 'image' && c.paraIdx === 25 && !c.cellPath) newImgCtrlIdx = c.controlIdx;
      }
    }
    let newImgTreatAsChar = null;
    if (newImgCtrlIdx !== null) {
      try {
        const props = wasm.getPictureProperties(0, 25, newImgCtrlIdx);
        newImgTreatAsChar = props.treatAsChar;
      } catch (e) { /* ignore */ }
    }

    return { before, after, err, shapeStillPresent, newImgCtrlIdx, newImgTreatAsChar };
  }, PNG_1x1);

  console.log('결과:', JSON.stringify(result));
  // finishImagePlacement 내부는 try/catch 로 에러를 삼키므로(콘솔 warn), 성공 판정은
  // 본문 sibling image 증가로 한다.
  assert(result.after === result.before + 1,
    `본문 para25 sibling image 가 1 증가해야 함 (before=${result.before}, after=${result.after}) — ` +
    `글상자 cellPath 라우팅으로 삽입 실패 시 증가하지 않음`);

  // 한컴 정합: 글상자(Shape)는 그대로 남고(독립), 삽입 image 는 본문 floating sibling.
  assert(result.shapeStillPresent,
    '글상자(Shape)가 그대로 남아있어야 함 (이미지와 독립)');
  assert(result.newImgTreatAsChar === false,
    `삽입 image 는 floating(treat_as_char=false)이어야 함 — 한컴 정합 (관측: ${result.newImgTreatAsChar})`);

  console.log('✅ #1171 v2: 글상자 위 이미지 드롭 → 본문 floating sibling 삽입 (한컴 정합) 통과');
});
