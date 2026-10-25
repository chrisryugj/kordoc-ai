import { describe, expect, it } from "vitest";
import { MAX_POINTS, actionablePoints, precheckTask, sentPoints, type PrecheckPoint } from "./precheck-task";

describe("결재 전 점검 → 편집기 AI 요청", () => {
  const items: PrecheckPoint[] = [
    { severity: "error", rule: "DATE_NO_SPACE", category: "날짜 표기", message: "날짜는 연·월·일 온점 뒤를 한 칸씩 띄웁니다.", excerpt: "2026.10.5", fix: { from: "2026.10.5", to: "2026. 10. 5." } },
    { severity: "warning", rule: "PLAIN_LANGUAGE", category: "쉬운 말", message: "더 쉬운 말로 바꿔 쓸 수 있습니다", excerpt: "금번", suggestion: "이번" },
    { severity: "info", rule: "COLON_SPACE", message: "참고만 할 것" },
    { severity: "error", rule: "DATE_NO_SPACE", category: "날짜 표기", message: "날짜는 연·월·일 온점 뒤를 한 칸씩 띄웁니다.", excerpt: "2026.10.5", fix: { from: "2026.10.5", to: "2026. 10. 5." } },
  ];
  // 사실을 확인해야 하는 지적: 요일·표 합계·한글 금액·빈칸·개인정보·항목 서식, 그리고 규칙 코드가 없는 K팀장·법령 지적
  const facts: PrecheckPoint[] = [
    { severity: "error", rule: "WEEKDAY_MISMATCH", category: "날짜와 요일", message: "날짜와 요일이 맞지 않습니다.", fix: { from: "(목)", to: "(금)" } },
    { severity: "error", rule: "SUM_MISMATCH", category: "표 합계", message: "합계가 맞지 않습니다", fix: { from: "1,500,000", to: "1,450,000" } },
    { severity: "error", rule: "MONEY_HANGUL_MISMATCH", category: "금액 표기", message: "괄호 안 한글 금액이 숫자와 다릅니다." },
    { severity: "warning", rule: "EMPTY_FIELD", category: "빈칸 안내 글자", message: "칸을 채우지 않았습니다" },
    { severity: "warning", rule: "PRIVACY_PHONE", category: "개인정보", message: "휴대전화 번호가 있습니다", excerpt: "010-●●●●-6789" },
    { severity: "warning", category: "K팀장 · 숫자", message: "합계가 이상합니다" },
  ];

  it("표기 지적의 고칠 것·살필 것만, 같은 지적은 한 번, 사실 확인 지적은 넘기지 않음", () => {
    expect(actionablePoints([...items, ...facts]).map((x) => x.rule)).toEqual(["DATE_NO_SPACE", "PLAIN_LANGUAGE"]);
  });

  it("지적마다 원문·바르게 쓸 값·제안을 싣고, 내용은 바꾸지 말라고 한다", () => {
    const t = precheckTask([...items, ...facts]);
    expect(t).toContain('1. [고칠 것 · 날짜 표기] 날짜는 연·월·일 온점 뒤를 한 칸씩 띄웁니다.\n   원문: "2026.10.5"\n   바르게: "2026.10.5" → "2026. 10. 5."');
    expect(t).toContain('2. [살필 것 · 쉬운 말] 더 쉬운 말로 바꿔 쓸 수 있습니다\n   원문: "금번"\n   제안: 이번');
    expect(t).toMatch(/find_text/);
    expect(t).toMatch(/날짜·금액·이름·번호 같은 내용은 바꾸지 않습니다/);
    for (const f of ["참고만 할 것", "(금)", "1,450,000", "●"]) expect(t).not.toContain(f);
    expect(t).not.toMatch(/[—–]/);
  });

  it(`한 번에 ${MAX_POINTS}건까지, 남은 수를 알린다`, () => {
    const many = Array.from({ length: MAX_POINTS + 5 }, (_, i): PrecheckPoint => ({ severity: "warning", rule: "PLAIN_LANGUAGE", message: `지적 ${i}`, excerpt: `원문 ${i}` }));
    expect(sentPoints(many)).toHaveLength(MAX_POINTS);
    const t = precheckTask(many);
    expect(t).toContain(`${MAX_POINTS}. [살필 것] 지적 ${MAX_POINTS - 1}`);
    expect(t).not.toContain(`지적 ${MAX_POINTS}\n`);
    expect(t).toContain("표기 지적이 5건 더 있습니다");
  });
});
