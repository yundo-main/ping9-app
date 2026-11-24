// 도움말 창 (T0.30): 모든 절과 닫기 버튼이 나오는지 본다
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { HelpDialog } from "./help-dialog";

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
});
