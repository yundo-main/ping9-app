# PING9

네트워크 장비를 배치·연결하고 CLI로 설정해 통신을 실습하는 네트워크 시뮬레이터. `TL-cg11/PING9`(3인 팀 프로젝트)를 fork해 1인으로 진행하는 데스크톱 앱 + 웹 서비스 버전.

- 저장소: https://github.com/yundo-main/ping9-app. 2026-11-24에 옮겼고, 그 전의 저장소는 `TL-cg11/PING9` (옛 PR이 거기 있음).
- 배포: 두 갈래다. Tauri 데스크톱 앱 — `pnpm desktop:release`가 `deploy/<버전>/`에 dmg/exe를 모으고 릴리스에 올린다 (docs/task-logs/T0.24-remove-vercel.md, T17.1·T17.2). 웹 — `web-pages.yml` 워크플로가 main push마다 GitHub Pages에 배포한다: 랜딩 `https://yundo-main.github.io/ping9-app/`, 앱 `…/app/` (docs/task-logs/T0.63-github-pages-app.md). Vercel은 이제 **PING9 Edu(`edu/app`)**의 것이다 — 예전 ping9-app용 `vercel.json`은 걷어냈다.
- DB: 없다. 과거 Vercel 배포 시절의 Neon `ping9-db`는 더 이상 쓰지 않고 코드에서도 쓰지 않는다.
- 계획 문서: [docs/project-plan/README.md](docs/project-plan/README.md) — 문서의 "PacketTracer WEB"은 이 프로젝트의 옛 이름
- 작업 단위 상세: [docs/project-plan/04-tasks/](docs/project-plan/04-tasks/)
- 규칙 문서(AD): `_bmad-output/planning-artifacts/architecture/architecture-PacketTracer-WEB-2026-11-05/ARCHITECTURE-SPINE.md`

## 반드시 지킬 작업 규칙

1. **Task 하나를 진행할 때마다 기록 문서를 새로 만든다.** 위치는 제품별로 갈린다 — **ping9-app(본체)**은 `docs/task-logs/`의 **T-시리즈**, **PING9 Edu**는 `edu/docs/task-logs/`의 **E-시리즈**. 파일 이름은 `<Task ID>-<짧은-영문-설명>.md`, 형식은 [docs/task-logs/_TEMPLATE.md](docs/task-logs/_TEMPLATE.md). 진행 방식, 결과, 검증 출력, 계획과 달라진 점을 적는다. 기존 기록 문서에 다른 Task를 이어 쓰지 않는다.
2. 기록 문서는 그 Task의 코드와 **같은 커밋**에 넣고, 해당 시리즈의 목록 — 본체는 [docs/task-logs/README.md](docs/task-logs/README.md), Edu는 [edu/docs/task-logs/README.md](edu/docs/task-logs/README.md) — 에 한 줄을 추가한다.
3. 1인 작업이라 `main`에 직접 커밋한다. 팀 시절의 `feat/<Task ID>-<설명>` 브랜치 + Pull Request 규칙은 쓰지 않는다 (옛 브랜치는 병합 잔재로만 남아 있음).
4. 완료 판단은 [개발 계획 4.3절의 공통 완료 조건](docs/project-plan/04-development-plan.md#43-분해-구조-읽는-법)을 따른다.
5. **커밋 메시지는 영어로 쓴다.** `Co-Authored-By: Claude ...`, "Generated with Claude Code" 같은 AI 표시 줄을 넣지 않는다. 문서 본문은 한국어로 쓴다.
6. 계획 문서와 다르게 구현했으면 기록 문서의 "계획과 달라진 점"에 적는다. 계획 문서 본문은 필요하면 직접 고친다 — 다만 계획 문서는 팀 시절 산출물이라 옛 조건(3인 분담, 웹 배포, Vercel)이 곳곳에 남아 있을 수 있다.

## 검사와 배포

- `main`에 push하면 GitHub Actions의 `check`가 돈다: 비밀값 형태 검사, 취약점 검사, lint, 타입 검사, 테스트, 빌드, Rust(`cargo check`). push 전에 `pnpm check`와 `pnpm check:secrets`로 미리 본다.
- 과거에는 Vercel Git 연동이 배포했지만 T0.24에서 제거했다 (docs/task-logs/T0.4-public-repo-and-git-deploy.md).
- 비밀값(토큰, DB 주소, `.env` 파일)은 저장소에 넣지 않는다.
- 커밋에는 개인 이메일 대신 GitHub의 noreply 주소를 쓴다. GitHub 설정의 Emails에서 "Keep my email addresses private"와 "Block command line pushes that expose my email"을 켜고, `git config user.email`을 그 화면에 나오는 `<숫자>+<아이디>@users.noreply.github.com`으로 맞춘다.
- 2026-11-05 전에 받은 폴더에서는 push하지 않는다. 옛 커밋이 공개 저장소에 올라간다. 저장소를 새로 받는다.

## 계획 문서와 달라진 결정

[docs/task-logs/T0.1-repo-and-deploy-setup.md](docs/task-logs/T0.1-repo-and-deploy-setup.md)에 기록. 요약: 배포를 "VM 한 대 + Docker Compose + Caddy"에서 Vercel로, DB를 "PostgreSQL 컨테이너"에서 Vercel Marketplace의 무료 Postgres로 바꿨다. **2026-11-24에 Vercel 연동을 걷어내고 데스크톱 앱 배포로 갔다** (docs/task-logs/T0.24-remove-vercel.md). 2026-11-25에는 GitHub Pages로 웹 배포를 다시 얹었다 (docs/task-logs/T0.63-github-pages-app.md). 03 문서 3.10절과 Story 2.2의 Task는 아직 옛 내용이다.
