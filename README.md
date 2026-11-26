# PING9

네트워크 장비(PC, Server, Switch(L2·L3·LB), Hub, Router)를 배치·연결하고, CLI로 설정해 ping의 과정과 실패 원인을 눈으로 확인하는 네트워크 시뮬레이터입니다. Windows·macOS용 Tauri **데스크톱 앱**과 **웹 버전**(GitHub Pages — [yundo-main.github.io/ping9-app](https://yundo-main.github.io/ping9-app/)) 두 갈래로 배포합니다.

| 내용 | 위치 |
|---|---|
| 지금 진행 중인 목표 | [docs/project-plan/06-two-pc-ping-plan.md](docs/project-plan/06-two-pc-ping-plan.md) |
| 계획 문서 (요구사항, 설계, 개발 계획) | [docs/project-plan/](docs/project-plan/README.md) |
| 작업 단위(Task) 상세 | [docs/project-plan/04-tasks/](docs/project-plan/04-tasks/) |
| Task별 진행 기록 | [docs/task-logs/](docs/task-logs/README.md) — 본체 T-시리즈. Edu는 [edu/docs/task-logs/](edu/docs/task-logs/README.md)의 E-시리즈 |
| 팀 작업 규칙 | [CLAUDE.md](CLAUDE.md) |

## 시작하기

Node 24 (`>=24.19 <25`, `.nvmrc`는 24.22.2)와 pnpm 12.16.1이 필요합니다.

```bash
corepack enable        # pnpm 명령을 켭니다. 권한 오류가 나면: npm install -g pnpm@12.16.1
pnpm install
pnpm check             # lint, 타입 검사, 테스트, 빌드를 차례로 실행
pnpm dev               # 화면 개발 서버 (http://localhost:5173, 점유 중이면 다음 포트)
pnpm desktop:release   # 데스크톱 앱 빌드 — 산출물이 deploy/<버전>/에 모입니다
```

시스템 기본 `node`가 24가 아닌 경우(예: Homebrew로 `node@24`를 keg-only로 설치한 Mac):

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm dev
```

## 구조

pnpm 모노레포. 의존 방향은 `web → editor → engine → shared`, `edu → editor`뿐입니다. 두 제품(ping9-app·PING9 Edu)의 경계와 의존 규칙은 [docs/repo-structure.md](docs/repo-structure.md) — `pnpm check:imports`가 자동으로 지키게 한다.

| 폴더 | 내용 |
|---|---|
| `packages/shared` | 엔진·화면이 함께 쓰는 타입·Zod 스키마·검증·포트 규칙·예시 자료 |
| `packages/engine` | 시뮬레이션 엔진. 브라우저와 Node의 기능을 쓰지 않는 순수 TypeScript |
| `packages/editor` | 시뮬레이터 화면 패키지 — 캔버스·터미널·인스펙터·재생. `apps/web`(본체)과 `edu/app`(교육)이 같이 쓴다. 플랫폼 동작(파일 저장·메뉴)은 prop으로 받아 Tauri를 모른다 (E3.0) |
| `apps/web` | 본체 앱 껍데기 — `main.tsx`(EditorApp 렌더) + `file-platform.ts`(Tauri 저장 창·메뉴) + `src-tauri/` |
| `edu/app` | 교육용 도구 — PING9 엔진 기반, 별도 Vercel 프로젝트로 배포 ([edu/README.md](edu/README.md)) |
| `docs/` | **ping9-app**의 문서 — 랜딩·사용설명서(Pages 배포), `project-plan/`, `task-logs/`. Edu의 스펙은 `edu/docs/`가 별도 관리 |
| `scripts/` | `desktop-release.mjs`(dmg 수집), `check-secrets.mjs`(비밀값 검사), `update-landing-history.mjs`(랜딩 히스토리 생성) |
| `deploy/` | `desktop-release` 산출물(dmg·manifest). gitignore 대상 |
| `.github/workflows/` | `ci.yml`(check), `desktop-release.yml`, `web-pages.yml`(Pages 배포) |
| `edu/app/vercel.json` | Vercel 배포 설정 — **Vercel 관련 내용은 전부 edu에서 진행**한다 |

### `packages/shared/src/` 세부 역할

| 파일 | 역할 |
|---|---|
| `document.ts` | `Device`·`Link`·`TopologyDocument` 정의와 `PORT_NAMES`(장비별 포트 이름·수) |
| `schema.ts`, `validate.ts` | 저장 파일 스키마(Zod)와 토폴로지 검증 |
| `view.ts` | 화면에 보이는 장비 뷰 타입 — 포트 상태, ARP·MAC·라우팅 표, 배운 경로 |
| `trace.ts`, `codes.ts` | 추적 이벤트 타입과 이유 코드·메시지 |
| `command.ts`, `console.ts` | 명령(`dispatch`) 타입과 콘솔 입출력 타입 |

### `packages/engine/src/` 세부 역할

| 폴더 | 역할 |
|---|---|
| `kernel/` | 장비 종류를 모르는 이산 사건 커널 (가상 시계 + 사건 큐) |
| `devices/` | PC, Server(HTTP·DNS·FTP·NTP·SSH 서비스), Hub, Switch·L3 Switch(VLAN 포워딩·SVI), LB, Router(정적 라우팅·RIP·GRE/IPsec VPN·루프백), Cloud(1.0.0.0/8을 /30으로 자른 가상 ISP 망 — 포트별 RIP 스피커) 모델 |
| `protocols/` | ARP, IPv4 호스트, 전송 계층, iptables 필터 |
| `cli/` | Cisco IOS 유사 CLI(Switch·Router), VyOS·Linux 라우터 CLI, Linux·Windows PC·서버 콘솔, SSH 원격 세션 |
| `reducer/` | Document 변경 명령 처리기. 불변, 거부 시 무변경 |
| `runtime.ts` | 장비 모델 관리 — 모델 생성, 프레임 전달, 타이머, RIP 경로 교환, 스냅샷 뷰 채우기 |
| `views.ts`, `topology.ts` | 스냅샷 뷰 계산과 링크·포트 조회 도우미 |
| `simulator.ts` | web과 engine의 유일한 경계. `load`/`dispatch`/`console`/`getSnapshot`/`subscribe`/`undo`/`redo` |

### `packages/editor/src/` 세부 역할

| 폴더 | 역할 |
|---|---|
| `components/` | 캔버스, 터미널 창, 속성·링크 패널, 패킷 카드, 클라우드 내부 구조 창 등 화면 부품 |
| `replay/` | ping·경로 교환 재생의 단계·타임라인 계산 |
| `terminal/` | 터미널 상태, 키 처리, 명령 큐, ping 출력 간격 |
| `format/`, `messages/` | 포트·주소·케이블 표시 문자열과 사용자 메시지 |
| `styles/` | `editor.css` — 편집기 전체 스타일 (`@ping9/editor/editor.css`로 import) |
| `simulator.ts` | 엔진 Simulator 인스턴스와 React의 연결 (`useSnapshot`) |
| `topology-file.ts` | 토폴로지 파일 저장·불러오기 (저장 창 같은 플랫폼 동작은 앱이 prop으로 넘김) |
| `app.tsx` | `EditorApp` — 편집기 화면 뼈대. 화면 상태만 들고 나머지는 engine 스냅샷에서 읽음 |
| `index.ts` | 공개 표면 — `EditorApp`, `MenuActions`, `simulator`, `useSnapshot` |

### `apps/web/src/` 세부 역할

| 파일 | 역할 |
|---|---|
| `main.tsx` | 엔트리 — `EditorApp`을 렌더하고 Tauri 플랫폼 구현을 prop으로 꽂는다 |
| `file-platform.ts` | Tauri 전용 파일·메뉴 동작 — 저장/열기 창, 메뉴 이벤트 → `MenuActions` 연결 |
| `src-tauri/` | Tauri 데스크톱 껍데기 (Rust 최소 부팅 코드, 아이콘, 번들 설정) |

### 개발자

원본 프로젝트: [TL-cg11/PING9](https://github.com/TL-cg11/PING9) — 웹 기반 네트워크 시뮬레이터
- Do-yoon Sung (TL-cg11, 성도윤)
- Seon-yu Yong (yysong1249, 용선유)
- Seon-young Min (ssunyoung2, 민선영)

데스크톱 앱 (Tauri — Windows · macOS) + 웹 버전 (GitHub Pages)
- jarrod kim