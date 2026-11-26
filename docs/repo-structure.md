# 저장소 구조와 프로젝트 경계

저장소 하나(`yundo-main/ping9-app`)에 **두 개의 독립 제품**이 있다. 코드는 공유하고, 배포·도메인·문서·Task 번호는 완전히 분리한다.

| 제품 | 내용 | 배포 |
|---|---|---|
| **ping9-app** | 네트워크 시뮬레이터 본체 — 장비 배치·CLI·패킷 추적 | GitHub Pages(`web-pages.yml`) + Tauri 데스크톱(`desktop-release.yml`) |
| **PING9 Edu** | 네트워크 진도별 학습도구 — 레슨·자동 채점 | Vercel 프로젝트 `ping9-edu` (Root Directory `edu/app`) → `ping9-edu.vercel.app` |

> 코어 공유의 계약과 연결부(seam)는 [core-sharing.md](core-sharing.md)에 따로 정리했다.

## 레이어

```
┌─ 제품 셸 ─────────────────────────────────────────┐
│  apps/web        ping9-app 셸                      │
│    main.tsx          EditorApp 렌더               │
│    file-platform.ts  Tauri 저장 창·메뉴            │
│    src-tauri/        데스크톱 껍데기               │
│  edu/app         PING9 Edu 셸 (Vercel)            │
│    lesson-player.tsx EditorApp 임베드 + 채점       │
│    auth·login        Supabase 로그인              │
│  edu/core        edu 전용 로직 — 레슨·채점 (순수 TS) │
├─ 공용 코어 (두 제품이 같이 쓴다) ────────────────────┤
│  packages/editor   시뮬레이터 화면 — Tauri를 모른다  │
│  packages/engine   시뮬레이션 엔진 — 순수 TS        │
│  packages/shared   타입·스키마·검증 — 순수 TS       │
└───────────────────────────────────────────────────┘
```

## 의존 규칙 (자동 검사됨 — `pnpm check:imports`)

| 파일 위치 | 가져올 수 있는 것 | 금지 |
|---|---|---|
| `packages/shared` | 없음 (최하위) | react·vite·tauri — 순수 TS |
| `packages/engine` | `@ping9/shared` | react·vite·tauri — 순수 TS |
| `packages/editor` | `@ping9/engine`, `@ping9/shared`, react | `@tauri-apps/*` — 플랫폼은 prop으로 받는다 |
| `apps/web` | `@ping9/editor`(+css), tauri, react | `@ping9/engine`·`shared` 직접 — editor 경유. `edu/*` |
| `edu/app` | `@ping9/editor`, `engine`, `shared`, `@ping9/edu-core` | `apps/*`, `@ping9/web` |
| `edu/core` | `@ping9/engine`, `@ping9/shared` | `apps/*`, UI 프레임워크 |
| 어디든 | 패키지 **이름**으로만 import | 상대 경로로 패키지 밖 탈출(`../../packages/…`) — exports 우회 금지 |

핵심 규칙 두 줄: **공용 코어(packages)는 제품을 모르고, 제품은 서로를 모른다.**

## 엔진 공유 방식

- **워크스페이스 소스 참조** — `package.json`의 `"@ping9/engine": "workspace:*"`가 소스(`src/index.ts`)를 직접 가리킨다. npm 배포 없이 같은 저장소의 HEAD가 그대로 들어간다
- **버전은 항상 같은 저장소 커밋** — 엔진을 고치면 다음 빌드부터 Pages·데스크톱·Vercel 모두에 반영된다. 제품별로 다른 엔진 버전을 굴리려면 저장소를 갈라야 하는데, 그러면 동기화 비용이 생기므로 지금 구조를 유지한다
- **번들은 각 제품 것** — 엔진 소스가 공유돼도 빌드 산출물(`apps/web/dist`, `edu/app/dist`)은 제품별로 따로 만들어진다

## 새 코드를 둘 곳 — 결정표

| 코드가 무엇인가 | 위치 |
|---|---|
| 두 제품이 다 쓰는 타입·검증 | `packages/shared` |
| 시뮬레이션 동작 (장비·프로토콜·CLI) | `packages/engine` |
| 편집기 화면 부품 (캔버스·터미널·패널) | `packages/editor` |
| 데스크톱 전용 동작 (저장 창·메뉴·파일) | `apps/web` — editor엔 prop으로 넘긴다 |
| Edu 전용 UI (레슨 목록·채점 결과) | `edu/app` |
| 레슨 데이터·채점 로직 | `edu/core` — UI 없는 순수 TS |
| ping9-app 문서·랜딩 | `docs/` (Pages 배포) |
| Edu 스펙·기록 | `edu/docs/` — Task는 E-시리즈 |
| 본체 Task 기록 | `docs/task-logs/` — T-시리즈 |

## 검사와 배포 분리

- `pnpm check`가 `check:imports`를 먼저 돌려 경계 위반을 커밋 전에 잡는다
- main push → Pages·desktop은 항상 돌고, Vercel은 `edu/`,`packages/`가 바뀐 커밋만 배포된다(Ignored Build Step)

## 향후 분리 옵션 (지금은 안 함)

edu가 본체와 다른 릴리스 주기·다른 엔진 버전이 필요해지면 `edu/`+`packages/`를 별도 저장소로 분리하는 길이 있다. 그때는 패키지를 npm에 배포하거나 vendor로 복사해야 한다 — 동기화 비용 때문에 요구사항이 생기기 전엔 모노레포를 유지한다.
