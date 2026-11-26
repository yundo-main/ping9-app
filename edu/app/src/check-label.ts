// Check를 학생이 읽는 한 줄 목표로 바꾼다 — 채점 결과 목록과 과제 패널에서 같이 쓴다

import type { Check } from "@ping9/edu-core";

export function checkLabel(check: Check): string {
  switch (check.kind) {
    case "ping":
      return `${check.from}에서 ${check.to}로 ping 성공`;
    case "route":
      return `${check.device}의 라우팅 표에 ${check.network} 경로가 있다`;
    case "trace":
      return `추적에 ${check.code} 이벤트가 남는다`;
    case "link":
      return `${check.a.device} ${check.a.port} ↔ ${check.b.device} ${check.b.port} 링크`;
    case "ip":
      return `${check.device} ${check.port}에 ${check.ip} ${check.mask} 설정`;
  }
}
