---
title: 'LB 플라이아웃 항목에 계층 이름 추가 + 스위치 플라이아웃 호버 동작'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 스위치 플라이아웃의 LB 항목은 형제 항목(L1 Hub · L2 Switch · L3 Switch)과 달리 계층 표기가 없고, 플라이아웃은 클릭으로만 여닫혀 마우스가 벗어나도 열린 채로 남는다.

**Approach:** LB 항목 라벨을 `L4/L7 LB`로 바꾸고, 스위치 그룹에 마우스오버로 열기 + 이탈 시 자동 닫기(원복)를 추가한다.

</frozen-after-approval>

## Implementation Notes

- 파일: `apps/web/src/components/palette.tsx` 한 곳.
- 라벨: `{tool("lb", "LB")}` → `{tool("lb", "L4/L7 LB")}` (palette.tsx:80). aria-label은 자동으로 `L4/L7 LB 추가`가 된다.
- 호버: 스위치 `.tool-group` div에 `onMouseEnter → setSwitchesOpen(true)`, `onMouseLeave → setSwitchesOpen(false)`를 추가하고 기존 `onClick` 토글은 유지한다(터치·키보드 폴백).
- 같은 `switch-flyout` 패턴을 쓰는 라우터 그룹(palette.tsx:85-98)에도 동일하게 적용해 두 플라이아웃의 동작을 일치시킨다.
- 바꾸지 않는 것: `KIND_NAME`(캔버스 라벨 `LB` 유지 — 아이콘 배지 `L4·7`이 이미 표시), `TIPS` 툴팁 문구.
- 검증: `pnpm test`·`pnpm typecheck`·`pnpm lint`. SSR 테스트는 이벤트를 흉내 못 하므로 새 테스트 없이 기존 스위트 통과로 확인한다.
- 프로젝트 규칙: 새 Task ID `T0.55` — `docs/task-logs/T0.55-*.md` 작성 + README 목록 추가, 코드와 같은 커밋, 영어 커밋 메시지, main 직접 커밋.

## Review Triage Log

Blind Hunter 리뷰(서브에이전트) 결과 — 판정과 처리:

- **patch** — 플라이아웃 `left: calc(100% + 8px)`의 8px 틈이 mouseleave를 유발해 호버로 도달 불가 → `.switch-flyout::before` 투명 다리 추가.
- **patch** — 터치 탭이 합성 mouseenter+click으로 첫 탭 무효 → `pointerType` 기반 핸들러로 분리(마우스=호버, 터치/펜=pointerdown 토글, 키보드=click detail 0 토글). 마우스 클릭 토글은 호버 동작과 충돌해 제거.
- **patch** — `full`·`dragCancel !== 'idle'` 상태에서도 호버 열림 → 게이트 추가.
- **patch** — 툴팁이 여전히 "눌러 …"라 현 동작과 불일치 → "올리거나 눌러 …"로 갱신.
- **low·기각** — 호버 경로 테스트 없음: SSR 스위트는 이벤트 디스패치 불가, jsdom/RTL 도입은 이 변경 규모 대비 과잉.
- **low·기각** — `L4/L7` vs 배지 `L4·7` 표기 불일치: 라벨은 사용자 요청 표기 그대로, 배지는 공간상 축약 표기라 별개로 유지.
- 작업 기록(`docs/task-logs/T0.55-*.md` + README 행)은 규칙대로 같은 커밋에 포함.
