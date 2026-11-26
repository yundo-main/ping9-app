# 코어 공유 설계

두 제품(ping9-app·PING9 Edu)이 **같은 코어 위에 얹히는** 구조의 계약과 연결부(seam). 경계 규칙의 표는 [repo-structure.md](repo-structure.md), 이 문서는 "왜·어떻게 공유하는가"를 다룬다.

## 계층과 계약

```
제품 셸        apps/web (본체)      edu/app (교육)
               │  Tauri·파일·메뉴    │  로그인·레슨·채점·진도
               ▼                    ▼
┌────────── 코어 계약 (product-agnostic) ──────────┐
│ packages/editor   EditorApp(props) — 화면         │
│ packages/engine   Simulator 인터페이스 — 동작      │
│ packages/shared   Document·검증·이유 코드 — 타입    │
└───────────────────────────────────────────────────┘
```

| 코어 | 계약 — 제품에게 약속하는 것 |
|---|---|
| `packages/shared` | 문서 형식·검증·이유 코드. 두 제품이 같은 토폴로지 파일을 주고받는 언어 |
| `packages/engine` | `createSimulator() → { load, dispatch, console, getSnapshot, subscribe, undo, redo }`. 브라우저든 어디든 돌아가는 순수 TS |
| `packages/editor` | `<EditorApp download? onActions? />` — 전체 편집기 화면 + `simulator` 싱글턴 + `useSnapshot` 훅 + `editor.css` |

## 연결부 (seam) — 제품이 코어에 끼는 곳

코어는 제품을 모르고, 제품은 이 지점들로만 맞춤화한다:

| seam | 어디 | 제품이 하는 일 |
|---|---|---|
| `download` prop | EditorApp | 파일 저장 구현 (web: Tauri 저장 창, edu: 생략→브라우저 다운로드) |
| `onActions` prop | EditorApp | 데스크톱 메뉴 액션 연결 (web만 사용) |
| `simulator` 싱글턴 | editor | 제품이 Document를 `load`해 시작 상태를 정한다 (edu: 레슨의 `startDocument`) |
| `Simulator` 인터페이스 | engine | 채점기·도구가 콘솔을 치고 스냅샷을 읽는다 (edu-core의 `grade`) |
| `editor.css` | editor | 화면 스타일 — 제품이 자기 CSS로 필요한 부분만 오버라이드 |

## 코어에 넣는 기준

새 기능이 생기면 이 순서로 묻는다:

1. **두 제품 중 둘 이상이 쓸 가능성이 있는가?** → `packages/*`로. 하나라도 제품 이름(edu, lesson)이나 플랫폼(tauri) 냄새가 나면 셸에 둔다
2. 화면인가, 동작인가, 타입인가? → editor / engine / shared로 나눠 놓는다
3. 코어 코드에 제품 분기를 쓰고 싶어지는가? → 그건 seam이 필요한 신호다. 코어에 `if (isEdu)`를 넣지 말고 **prop·콜백·설정 객체**로 열어 둔다

## 코어의 불변 조건

- **packages는 DOM·플랫폼·제품을 모른다** — engine·shared는 순수 TS, editor는 브라우저 DOM까지만 (Tauri 모름)
- **제품끼리 서로를 모른다** — `apps/web`과 `edu/app` 사이 import 금지. 교류는 `packages/*` 이름으로만
- **버전은 저장소 HEAD** — 제품별로 다른 코어 버전을 굴리지 않는다. 분기가 필요해지면 그때가 저장소 분리 시점

## 열어 둔 seam 후보 (필요해지면)

| 제안 | 용도 |
|---|---|
| `EditorApp`의 `features` prop | edu에서 파일 메뉴·팔레트 일부를 끄는 등 화면 조각 on/off — 지금은 없다 |
| `createEditorSimulator()` | 화면마다 독립 시뮬레이터 — 지금은 싱글턴 `simulator`로 둘 다 충분 |
| `editor`의 재생·터미널 부품을 개별 export | edu가 화면 일부만 재조합하고 싶을 때 — 지금은 전체 EditorApp만 쓴다 |

후보는 **요구가 생길 때** 연다 — 지금 미리 열어 두면 계약만 복잡해진다.
