import { describe, expect, it } from "vitest";
import { isPdfInput } from "./hwp-editor";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("isPdfInput (편집기가 PDF 가져오기 창을 띄울 입력)", () => {
  it("이름이 .pdf 면 PDF", () => {
    expect(isPdfInput(bytes("PK"), "받은 공문.pdf")).toBe(true);
    expect(isPdfInput(bytes("PK"), "받은 공문.PDF")).toBe(true);
  });

  it("확장자가 틀려도 앞 1024바이트 안에 %PDF- 가 있으면 PDF (10분 제한을 받아야 한다)", () => {
    expect(isPdfInput(bytes("%PDF-1.7\n..."), "문서.hwp")).toBe(true);
    expect(isPdfInput(bytes(`${" ".repeat(900)}%PDF-1.4`), "문서.hwpx")).toBe(true);
  });

  it("한글 문서는 PDF 가 아니다", () => {
    expect(isPdfInput(bytes("PK\u0003\u0004 mimetype"), "보고서.hwpx")).toBe(false);
    expect(isPdfInput(bytes(`${" ".repeat(1100)}%PDF-1.4`), "보고서.hwpx")).toBe(false);
    expect(isPdfInput(new Uint8Array(0), "빈.hwp")).toBe(false);
  });
});
