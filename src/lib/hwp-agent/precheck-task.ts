/**
 * 결재 전 점검 지적 → 편집기 AI 첫 요청 글.
 * 점검 결과에는 편집기 자리("구역.문단")가 없어서, 지적마다 원문을 주고 편집기 AI 가 find_text 로 찾아 고치게 한다.
 *
 * 편집기 AI 에는 글만 보고 고칠 수 있는 표기 지적만 넘긴다. 사실을 확인해야 하는 지적은 넘기지 않는다:
 * 날짜와 요일(요일이 틀렸는지 날짜가 틀렸는지 모름), 표 합계·본문과 표 숫자(칸 값이 틀렸을 수도), 괄호 안 한글 금액,
 * 빈칸 안내 글자(채울 값), 개인정보(원문이 이미 가려져 찾지 못하고 결재 문서의 연락처일 수 있음), 항목 서식,
 * 그리고 K팀장·법령 지적(규칙 코드 없음: 판단이 필요).
 */

export interface PrecheckPoint {
  severity: "error" | "warning" | "info";
  message: string;
  /** 점검 규칙 코드 (표기 점검에만 있다) */
  rule?: string;
  category?: string;
  /** 문서에서 찾을 원문 */
  excerpt?: string;
  context?: string;
  suggestion?: string;
  fix?: { from: string; to: string };
}

/** 한 번에 넘기는 지적 수 (로컬 모델의 짧은 맥락을 넘지 않게) */
export const MAX_POINTS = 30;

const FACT_RULES = /^(WEEKDAY_|SUM_MISMATCH|NUMBER_CHECK|MONEY_HANGUL_MISMATCH|EMPTY_FIELD|PRIVACY_|STYLE_DEVIATION)/;
const LABEL = { error: "고칠 것", warning: "살필 것" } as const;

/** 편집기 AI 가 글만 보고 고칠 수 있는 고칠 것·살필 것, 같은 지적은 한 번 */
export function actionablePoints<T extends PrecheckPoint>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    if (x.severity === "info" || !x.rule || FACT_RULES.test(x.rule)) return false;
    const key = `${x.message}\u0000${x.excerpt ?? x.context ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 이번 요청에 실을 지적 (앞에서부터 MAX_POINTS 개) */
export const sentPoints = <T extends PrecheckPoint>(items: T[]): T[] => actionablePoints(items).slice(0, MAX_POINTS);

export function precheckTask(items: PrecheckPoint[]): string {
  const points = sentPoints(items);
  const lines = [
    "결재 전 점검에서 나온 표기 지적입니다. 이 문서를 고쳐 주세요.",
    "- 지적마다 원문을 find_text 로 찾아 그 자리만 고칩니다.",
    "- 바르게 쓸 값이 적힌 지적은 그 값으로, 값이 없는 지적은 같은 뜻을 지키며 표기만 고칩니다.",
    "- 날짜·금액·이름·번호 같은 내용은 바꾸지 않습니다. 표기를 고치려면 내용을 바꿔야 하는 지적은 고치지 말고 끝에 알려 주세요.",
    "- 찾지 못한 지적도 끝에 알려 주세요.",
    "",
  ];
  points.forEach((p, i) => {
    const head = [LABEL[p.severity as "error" | "warning"], p.category].filter(Boolean).join(" · ");
    lines.push(`${i + 1}. [${head}] ${p.message}`);
    const quote = p.excerpt ?? p.context;
    if (quote) lines.push(`   원문: "${quote.replace(/\s+/g, " ").trim().slice(0, 160)}"`);
    if (p.fix) lines.push(`   바르게: "${p.fix.from}" → "${p.fix.to}"`);
    else if (p.suggestion) lines.push(`   제안: ${p.suggestion}`);
  });
  const rest = actionablePoints(items).length - points.length;
  if (rest > 0) lines.push("", `(표기 지적이 ${rest}건 더 있습니다. 이번에 고친 뒤 다시 점검하면 이어서 볼 수 있습니다.)`);
  return lines.join("\n");
}
