/** 문서 속 링크 살피기 — 글이 곧 주소면 바로, 아니면 실제 주소를 보이고 묻는다. 보이는 주소와 다른 곳이면 경고 */

import { describe, it, expect } from "vitest";
import { displayHref, hrefHost, isExternalHref, isThisPcUrl, linkMismatch, showsOwnHref } from "./links";

/** 글 방향을 뒤집는 보이지 않는 글자 (소스에 날 글자로 두지 않는다) */
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);

describe("isExternalHref", () => {
  it("http·https·mailto 만 밖으로 연다", () => {
    expect(isExternalHref("https://www.gwangjin.go.kr")).toBe(true);
    expect(isExternalHref("HTTP://a.kr")).toBe(true);
    expect(isExternalHref("mailto:a@b.go.kr")).toBe(true);
    expect(isExternalHref("#목차")).toBe(false);
    expect(isExternalHref("file:///C:/a.hwp")).toBe(false);
    expect(isExternalHref("javascript:alert(1)")).toBe(false);
    expect(isExternalHref(undefined)).toBe(false);
  });
});

describe("showsOwnHref", () => {
  it("글이 곧 그 주소면 (http(s)://·www.·끝 / 차이는 같게) 묻지 않는다", () => {
    expect(showsOwnHref("www.gwangjin.go.kr", "http://www.gwangjin.go.kr/")).toBe(true);
    expect(showsOwnHref("https://law.go.kr/법령", "https://www.law.go.kr/%EB%B2%95%EB%A0%B9")).toBe(true);
    expect(showsOwnHref("a@b.go.kr", "mailto:a@b.go.kr")).toBe(true);
  });

  it("이름 붙은 링크·다른 주소는 묻는다", () => {
    expect(showsOwnHref("광진구청 누리집", "https://www.gwangjin.go.kr")).toBe(false);
    expect(showsOwnHref("www.gwangjin.go.kr", "https://gwangjin-go.kr.example.com")).toBe(false);
    expect(showsOwnHref("", "https://a.kr")).toBe(false);
  });

  it("다른 나라 글자 호스트(퓨니코드)·보이지 않는 글자가 든 주소는 같아 보여도 묻는다", () => {
    expect(showsOwnHref("https://광진.kr", "https://광진.kr")).toBe(false);
    expect(showsOwnHref(`https://a.kr/${RLO}x`, `https://a.kr/${RLO}x`)).toBe(false);
    expect(showsOwnHref(`a.kr${ZWSP}`, "https://a.kr")).toBe(false);
  });

  it("호스트 앞에 사용자 이름(@)을 붙인 주소는 글이 같아도 묻는다 (앞쪽이 갈 곳처럼 보인다)", () => {
    expect(showsOwnHref("https://gwangjin.go.kr@evil.example", "https://gwangjin.go.kr@evil.example")).toBe(false);
  });
});

describe("linkMismatch", () => {
  it("글에 적힌 호스트와 실제 호스트가 다르면 둘을 알린다", () => {
    expect(linkMismatch("www.gwangjin.go.kr", "https://gwangjin.go.kr.evil.example/login")).toEqual({ shown: "gwangjin.go.kr", real: "gwangjin.go.kr.evil.example" });
    expect(linkMismatch("https://www.nts.go.kr/환급", "http://nts-refund.example.com")).toEqual({ shown: "nts.go.kr", real: "nts-refund.example.com" });
  });

  it("호스트 앞 사용자 이름으로 꾸민 주소는 글과 상관없이 앞쪽을 보이는 곳으로 알린다", () => {
    expect(linkMismatch("https://gwangjin.go.kr@evil.example", "https://gwangjin.go.kr@evil.example")).toEqual({ shown: "gwangjin.go.kr", real: "evil.example" });
    expect(linkMismatch("여기를 누르세요", "https://www.gwangjin.go.kr:pw@evil.example/login")).toEqual({ shown: "gwangjin.go.kr", real: "evil.example" });
  });

  it("같은 호스트·주소 꼴이 아닌 글·메일 주소는 아니다", () => {
    expect(linkMismatch("www.gwangjin.go.kr/news", "https://gwangjin.go.kr/news?id=1")).toBeNull();
    expect(linkMismatch("여기를 누르세요", "https://evil.example")).toBeNull();
    expect(linkMismatch("a@b.go.kr", "mailto:a@b.go.kr")).toBeNull();
  });
});

describe("hrefHost·displayHref", () => {
  it("호스트는 www. 를 떼고, 못 읽는 주소는 비운다", () => {
    expect(hrefHost("https://WWW.Gwangjin.go.kr/a")).toBe("gwangjin.go.kr");
    expect(hrefHost("mailto:a@b.kr")).toBe("");
    expect(hrefHost("http://")).toBe("");
  });

  it("경로의 한글은 읽히게, 호스트는 퓨니코드로, 보이지 않는 글자는 %꼴로 보인다", () => {
    expect(displayHref("https://www.law.go.kr/%EB%B2%95%EB%A0%B9")).toBe("https://www.law.go.kr/법령");
    expect(displayHref("https://광진.kr/a")).toMatch(/^https:\/\/xn--[a-z0-9-]+\.kr\/a$/);
    const shown = displayHref(`https://a.kr/${RLO}rk.doog`);
    expect(shown.includes(RLO)).toBe(false);
    expect(shown).toContain("%E2%80%AE");
  });
});

describe("isThisPcUrl", () => {
  it("이 PC 자신을 가리키는 주소만 참이다", () => {
    expect(isThisPcUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isThisPcUrl(" http://localhost:1234/v1 ")).toBe(true);
    expect(isThisPcUrl("http://[::1]:8080/v1")).toBe(true);
  });

  it("다른 컴퓨터·못 읽는 주소·빈 칸은 아니다", () => {
    expect(isThisPcUrl("http://192.168.0.10:11434/v1")).toBe(false);
    expect(isThisPcUrl("https://ai.example.go.kr/v1")).toBe(false);
    expect(isThisPcUrl("http://127.0.0.1.example.com/v1")).toBe(false);
    expect(isThisPcUrl("127.0.0.1:11434")).toBe(false);
    expect(isThisPcUrl("")).toBe(false);
  });
});
