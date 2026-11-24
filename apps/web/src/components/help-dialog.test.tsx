// 도움말 창 (T0.30): 모든 절과 닫기 버튼이 나오는지 본다
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { HelpDialog } from "./help-dialog";
import { AboutDialog } from "./about-dialog";

describe("도움말 창", () => {
  const html = renderToString(<HelpDialog onClose={() => {}} />);

  test("모든 절의 제목이 나온다", () => {
    for (const title of ["시작하기", "PC·서버 콘솔", "라우터·스위치 콘솔 (Cisco IOS)", "콘솔 스타일", "시뮬레이션 모드", "단축키"]) {
      expect(html).toContain(title);
    }
  });

  test("주요 기능의 명령이 실린다", () => {
    for (const text of ["ip nat inside · outside", "show ip nat translations", "ping", "⏯ 시뮬레이션"]) {
      expect(html).toContain(text);
    }
  });

  test("닫기 버튼과 대화상자 표시가 있다", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="도움말 닫기"');
  });

  test("정보 열기를 주면 PING9에 관하여 링크가 나오고, 주지 않으면 없다", () => {
    expect(renderToString(<HelpDialog onClose={() => {}} onAbout={() => {}} />)).toContain("PING9에 관하여");
    expect(html).not.toContain("PING9에 관하여");
  });
});

describe("PING9에 관하여 창 (T0.41)", () => {
  const html = renderToString(<AboutDialog onClose={() => {}} />);

  test("앱 이름·버전·원본과 포크 개발자가 나온다", () => {
    for (const text of ["PING9에 관하여", "1.0.0", "원본 프로젝트", "TL-cg11/PING9", "SDY", "yysong1249", "ssunyoung2", "jarrod kim", "Tauri"]) {
      expect(html).toContain(text);
    }
  });
});
