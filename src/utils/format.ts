/** 초 단위 경과 시간을 "N분 N초" 형식으로 포맷 */
export function formatElapsed(s: number): string {
  const sec = Math.floor(s);
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}분 ${sec % 60}초` : `${sec}초`;
}
