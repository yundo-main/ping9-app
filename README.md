# PING9

네트워크 장비(PC, Server, Switch(L2·L3·LB), Hub, Router)를 배치·연결하고, CLI로 설정해 ping의 과정과 실패 원인을 눈으로 확인하는 네트워크 시뮬레이터입니다. Windows·macOS용 Tauri 데스크톱 앱으로 배포합니다 — 웹 서버로는 실행하지 않습니다.

| 내용 | 위치 |
|---|---|
| 지금 진행 중인 목표 | [docs/project-plan/06-two-pc-ping-plan.md](docs/project-plan/06-two-pc-ping-plan.md) |
| 계획 문서 (요구사항, 설계, 개발 계획) | [docs/project-plan/](docs/project-plan/README.md) |
| 작업 단위(Task) 상세 | [docs/project-plan/04-tasks/](docs/project-plan/04-tasks/) |
| Task별 진행 기록 | [docs/task-logs/](docs/task-logs/README.md) |
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

pnpm 모노레포. 의존 방향은 `web → engine → shared`, `web → shared`뿐입니다.

| 폴더 | 내용 |
|---|---|
| `packages/shared` | 엔진·화면이 함께 쓰는 타입, Zod 스키마, 예시 자료 |
| `packages/engine` | 시뮬레이션 엔진. 브라우저와 Node의 기능을 쓰지 않는 순수 TypeScript |
| `apps/web` | React 화면 + Tauri 데스크톱 껍데기 (`src-tauri/`) |

### `packages/engine/src/` 세부 역할

| 폴더 | 역할 |
|---|---|
| `kernel/` | 장비 종류를 모르는 이산 사건 커널 (가상 시계 + 사건 큐) |
| `devices/` | PC, Server(HTTP·DNS·FTP·NTP·SSH 서비스), Hub, Switch·L3 Switch(VLAN 포워딩·SVI), LB, Router(정적 라우팅·RIP·GRE/IPsec VPN·루프백) 모델 |
| `protocols/` | ARP, IPv4 호스트, 전송 계층, iptables 필터 |
| `cli/` | Cisco IOS 유사 CLI(Switch·Router), VyOS·Linux 라우터 CLI, Linux·Windows PC·서버 콘솔, SSH 원격 세션 |
| `reducer/` | Document 변경 명령 처리기. 불변, 거부 시 무변경 |
| `simulator.ts` | web과 engine의 유일한 경계. `load`/`dispatch`/`console`/`getSnapshot`/`subscribe`/`undo`/`redo` |

### `apps/web/src/` 세부 역할

| 폴더 | 역할 |
|---|---|
| `components/` | 캔버스, 터미널 창, 속성·링크 패널, 패킷 카드 등 화면 부품 |
| `replay/` | ping·경로 교환 재생의 단계·타임라인 계산 |
| `terminal/` | 터미널 상태, 키 처리, 명령 큐, ping 출력 간격 |
| `format/`, `messages/` | 포트·주소·케이블 표시 문자열과 사용자 메시지 |
| `app.tsx` | 편집기 화면 뼈대. 화면 상태만 들고 나머지는 engine 스냅샷에서 읽음 |

### 개발자

원본 프로젝트: [TL-cg11/PING9](https://github.com/TL-cg11/PING9) — 웹 기반 네트워크 시뮬레이터
- SDY
- yysong1249
- ssunyoung2

데스크톱 앱 (Tauri — Windows · macOS)
- jarrod kim