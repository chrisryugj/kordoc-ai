/** 금액 칸의 커서 — 치는 동안 쉼표를 다시 매겨도 커서가 끝으로 튀지 않게, 커서 앞 숫자 수로 자리를 되찾는다 */

/** 커서 앞에 있던 숫자 수 */
export function digitsBefore(text: string, caret: number): number {
  return text.slice(0, caret).replace(/[^\d]/g, "").length;
}

/** 쉼표를 매긴 글에서 n번째 숫자 바로 뒤 자리 (n 이 0 이면 맨 앞, 숫자가 모자라면 맨 끝) */
export function caretAfterDigits(formatted: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]) && ++seen === n) return i + 1;
  }
  return formatted.length;
}
