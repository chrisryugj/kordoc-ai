import { describe, expect, it } from "vitest";
import {
  EMPTY, addFile, clickSelect, duplicate, imageItems, insertBlank, interleave, invert, keysFromSpec, looksBlank, move, nudge, oddEven,
  planAll, planCuts, planEvery, planSelected, positionsOf, pruneSelection, remove, removeFile, reverse, rotate, selectKeys,
  shownSize, toggleCut, NO_SELECTION, type Board,
} from "./model";

const A4 = { width: 595, height: 842 };
const file = (name: string, pages: number, size = A4) => ({ path: `/문서/${name}`, name, source: `/문서/${name}`, converted: false, secured: false, sizes: Array(pages).fill(size) });

/** 가.pdf 3쪽 + 나.pdf 2쪽 */
function board(): Board {
  return addFile(addFile(EMPTY, file("가.pdf", 3)), file("나.pdf", 2, { width: 842, height: 595 }));
}
const label = (b: Board) => b.items.map((it) => (it.blank ? "빈" : `${b.files.find((f) => f.id === it.file)!.name[0]}${it.page}`));
const keys = (b: Board, ...pos: number[]) => new Set(pos.map((p) => b.items[p - 1].key));

describe("쪽 줄", () => {
  it("파일을 넣으면 쪽이 원래 차례로, 파일마다 다른 색", () => {
    const b = board();
    expect(label(b)).toEqual(["가1", "가2", "가3", "나1", "나2"]);
    expect(b.files.map((f) => f.color)).toEqual([0, 1]);
    expect(label(addFile(b, file("다.pdf", 1), 1))).toEqual(["가1", "다1", "가2", "가3", "나1", "나2"]);
  });

  it("옮기기: 고른 쪽끼리 차례는 그대로, 자리는 지금 줄 기준", () => {
    const b = board();
    expect(label(move(b, keys(b, 4, 5), 0))).toEqual(["나1", "나2", "가1", "가2", "가3"]);
    expect(label(move(b, keys(b, 1, 3), 5))).toEqual(["가2", "나1", "나2", "가1", "가3"]);
    expect(label(move(b, keys(b, 1), 3))).toEqual(["가2", "가3", "가1", "나1", "나2"]);
    expect(move(b, keys(b, 2), 2)).toBe(b);
  });

  it("한 칸씩 앞뒤로, 끝에서는 그대로", () => {
    const b = board();
    expect(label(nudge(b, keys(b, 2, 3), -1))).toEqual(["가2", "가3", "가1", "나1", "나2"]);
    expect(label(nudge(b, keys(b, 2, 3), 1))).toEqual(["가1", "나1", "가2", "가3", "나2"]);
    expect(nudge(b, keys(b, 1), -1)).toBe(b);
    expect(nudge(b, keys(b, 5), 1)).toBe(b);
  });

  it("돌리기는 90도씩 쌓이고, 돌리면 보이는 크기가 바뀐다", () => {
    let b = board();
    b = rotate(b, keys(b, 1), 90);
    b = rotate(b, keys(b, 1, 2), -90);
    expect(b.items.map((it) => it.rotate)).toEqual([0, 270, 0, 0, 0]);
    expect(shownSize(b, b.items[1])).toEqual({ width: 842, height: 595 });
    expect(shownSize(b, b.items[3])).toEqual({ width: 842, height: 595 });
  });

  it("지우기·복제·빈 쪽·거꾸로", () => {
    const b = board();
    // 지울 것이 없으면 그대로 (되돌리기 단계가 쌓이지 않게)
    expect(remove(b, new Set(["없는 쪽"]))).toBe(b);
    // 거꾸로 해서 맨 앞에 온 쪽의 나눌 자리는 푼다
    const cut = toggleCut(b, b.items[4].key);
    expect(reverse(cut, keys(cut, 1, 5)).cuts).toEqual([]);
    expect(label(remove(b, keys(b, 2, 4)))).toEqual(["가1", "가3", "나2"]);
    expect(label(duplicate(b, keys(b, 2)))).toEqual(["가1", "가2", "가2", "가3", "나1", "나2"]);
    const d = duplicate(b, keys(b, 2));
    expect(new Set(d.items.map((it) => it.key)).size).toBe(6);
    const blank = insertBlank(b, b.items[3].key);
    expect(label(blank)).toEqual(["가1", "가2", "가3", "나1", "빈", "나2"]);
    expect(blank.items[4].blank).toEqual({ width: 842, height: 595 });
    expect(label(insertBlank(EMPTY, null))).toEqual(["빈"]);
    expect(label(reverse(b, keys(b, 1, 3, 5)))).toEqual(["나2", "가2", "가3", "나1", "가1"]);
  });

  it("양면 스캔: 두 파일 쪽을 번갈아, 뒤 파일은 거꾸로도", () => {
    const b = addFile(addFile(addFile(EMPTY, file("앞.pdf", 3)), file("뒤.pdf", 3)), file("붙임.pdf", 1));
    const [f, k] = [b.files[0].id, b.files[1].id];
    expect(label(interleave(b, f, k, false))).toEqual(["앞1", "뒤1", "앞2", "뒤2", "앞3", "뒤3", "붙1"]);
    expect(label(interleave(b, f, k, true))).toEqual(["앞1", "뒤3", "앞2", "뒤2", "앞3", "뒤1", "붙1"]);
    const moved = move(b, new Set([b.items[6].key]), 0);
    expect(label(interleave(moved, f, k, true))[0]).toBe("붙1");
    expect(interleave(b, f, f, true)).toBe(b);
  });

  it("파일 빼기는 그 파일 쪽만", () => {
    const b = board();
    expect(label(removeFile(b, b.files[0].id))).toEqual(["나1", "나2"]);
  });
});

describe("나눌 자리", () => {
  it("맨 앞 쪽 앞은 안 되고, 켜고 끄기", () => {
    let b = board();
    expect(toggleCut(b, b.items[0].key)).toBe(b);
    b = toggleCut(b, b.items[3].key);
    b = toggleCut(b, b.items[1].key);
    expect(b.cuts).toEqual([b.items[1].key, b.items[3].key]);
    expect(toggleCut(b, b.items[1].key).cuts).toEqual([b.items[3].key]);
  });

  it("나눈 자리 앞 쪽을 지우면 자리는 다음 쪽으로, 맨 앞으로 오면 없어진다", () => {
    let b = board();
    b = toggleCut(b, b.items[3].key);
    const r = remove(b, keys(b, 4));
    expect(r.cuts).toEqual([r.items[3].key]);
    expect(label(r)[3]).toBe("나2");
    const front = toggleCut(b, b.items[1].key);
    expect(remove(front, keys(front, 1)).cuts).toEqual([front.items[3].key]);
    expect(move(front, keys(front, 2), 0).cuts).toEqual([front.items[3].key]);
  });
});

describe("고르기", () => {
  const b = board();
  const [k1, k2, k3, k4] = b.items.map((it) => it.key);

  it("누르기·Ctrl·Shift", () => {
    let s = clickSelect(b.items, NO_SELECTION, k2, {});
    expect([...s.keys]).toEqual([k2]);
    s = clickSelect(b.items, s, k4, { range: true });
    expect([...s.keys]).toEqual([k2, k3, k4]);
    s = clickSelect(b.items, s, k1, { toggle: true });
    expect(s.keys.size).toBe(4);
    expect(s.anchor).toBe(k1);
    s = clickSelect(b.items, s, k3, { toggle: true });
    expect(s.keys.has(k3)).toBe(false);
  });

  it("홀수·짝수·반대로·쪽 번호로", () => {
    expect(oddEven(b.items, true)).toEqual([b.items[0].key, b.items[2].key, b.items[4].key]);
    expect(oddEven(b.items, false)).toEqual([k2, k4]);
    expect(invert(b.items, selectKeys([k1, k2]))).toEqual([k3, k4, b.items[4].key]);
    expect(keysFromSpec(b.items, "1-2, 4")).toEqual([k1, k2, k4]);
    expect(keysFromSpec(b.items, "4-")).toEqual([k4, b.items[4].key]);
    expect(keysFromSpec(b.items, "9")).toEqual([]);
    expect(keysFromSpec(b.items, "9-")).toEqual([]);
    expect(keysFromSpec(b.items, "가")).toBeNull();
    expect(positionsOf(b.items, new Set([k1, k2, k4]))).toBe("1-2,4");
  });

  it("지운 쪽은 고른 것에서 빠진다", () => {
    const s = selectKeys([k1, k2], k2);
    const r = remove(b, new Set([k2]));
    expect(pruneSelection(r.items, s)).toEqual({ keys: new Set([k1]), anchor: null });
  });
});

describe("저장 계획", () => {
  it("하나로: 지금 차례·돌린 각·빈 쪽 그대로, 이름은 합본·정리", () => {
    let b = board();
    b = rotate(move(b, keys(b, 4), 0), keys(b, 4), 90);
    b = insertBlank(b, b.items[0].key);
    const [o] = planAll(b);
    expect(o.name).toBe("가_외1건_합본");
    expect(o.pages[0]).toEqual({ path: "/문서/나.pdf", page: 1, rotate: 90 });
    expect(o.pages[1]).toEqual({ blank: { width: 595, height: 842 } });
    expect(o.pages[2]).toEqual({ path: "/문서/가.pdf", page: 1 });
    const one = addFile(EMPTY, file("보고서.pdf", 2));
    expect(planAll(one)[0].name).toBe("보고서_정리");
  });

  it("고른 쪽만: 지금 차례대로, 이름에 쪽 번호", () => {
    const b = board();
    const [o] = planSelected(b, keys(b, 5, 1, 2));
    expect(o.name).toBe("가_외1건_1-2,5쪽");
    expect(o.pages.map((p) => ("page" in p ? p.page : 0))).toEqual([1, 2, 2]);
  });

  it("긴 파일 이름에도 번호·쪽 번호는 남는다 (80자 안)", () => {
    const long = addFile(EMPTY, file(`${"가".repeat(90)}.pdf`, 30));
    const parts = planEvery(long, 1);
    expect(new Set(parts.map((o) => o.name)).size).toBe(30);
    expect(parts.every((o) => (o.name ?? "").length <= 80 && /_\d{2}$/.test(o.name ?? ""))).toBe(true);
    const odd = new Set(oddEven(long.items, true));
    expect(planSelected(long, odd)[0].name).toMatch(/_15쪽$/);
  });

  it("나눈 자리마다·N쪽씩·쪽마다, 번호는 두 자리부터", () => {
    let b = board();
    b = toggleCut(b, b.items[3].key);
    expect(planCuts(b).map((o) => [o.name, o.pages.length])).toEqual([["가_외1건_01", 3], ["가_외1건_02", 2]]);
    expect(planEvery(b, 2).map((o) => o.pages.length)).toEqual([2, 2, 1]);
    expect(planEvery(b, 1)).toHaveLength(5);
    expect(planCuts(board())).toHaveLength(1);
  });

  it("그림으로: 고른 쪽, 없으면 전부", () => {
    const b = board();
    expect(imageItems(b, new Set())).toHaveLength(5);
    expect(imageItems(b, keys(b, 2))).toEqual([{ path: "/문서/가.pdf", page: 2 }]);
  });
});

describe("빈 쪽 찾기", () => {
  const page = (inkRatio: number, paper = 250) => Array.from({ length: 2000 }, (_, i) => (i < 2000 * inkRatio ? 40 : paper));
  it("글자가 조금이라도 있으면 빈 쪽이 아니고, 회색 스캔 바탕도 빈 쪽으로 본다", () => {
    expect(looksBlank(page(0))).toBe(true);
    expect(looksBlank(page(0.002, 205))).toBe(true);
    expect(looksBlank(page(0.02))).toBe(false);
    expect(looksBlank([])).toBe(false);
    // 어두운 바탕에 흰 글자, 온통 검은 쪽은 빈 쪽이 아님
    expect(looksBlank(Array.from({ length: 2000 }, (_, i) => (i < 100 ? 250 : 20)))).toBe(false);
    expect(looksBlank(Array(2000).fill(0))).toBe(false);
  });
});
