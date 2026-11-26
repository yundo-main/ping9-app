# PING9 Edu

PING9 시뮬레이터(`packages/engine` + `packages/shared`)를 기반으로 한 **교육용 도구**. PING9 본체와 **배포가 완전히 분리된 별도 Vercel 프로젝트**다.

- 배포 주소: **https://ping9-edu.vercel.app** (Vercel 프로젝트 이름 `ping9-edu`, 프로젝트 ID `prj_FlKFlMRIYRjSVsKs2mul12EJh11e`)

## 문서

- [docs/README.md](docs/README.md) — **Edu 스펙 문서 모음** (ping9-app의 `docs/`와 별도 관리)
- [docs/dev-plan.md](docs/dev-plan.md) — 개발 계획과 소스 트리 제안
- [../docs/repo-structure.md](../docs/repo-structure.md) — 저장소 구조와 두 제품의 경계 규칙 (공용 문서)

## 분리 규칙

| 항목 | 내용 |
|---|---|
| 디렉터리 | `edu/` — `apps/`(PING9 본체)와 형제 관계의 최상위 디렉터리. 본체 코드와 섞이지 않는다 |
| 의존 방향 | `edu/app → packages/*(editor·engine·shared), edu/core`만 허용. `apps/web`을 import하지 않는다 |
| 배포 | `apps/web` → GitHub Pages + Tauri 데스크톱. `edu/app` → 별도 Vercel 프로젝트 |
| 저장소 | 같은 저장소 — 엔진 변경이 자동으로 반영된다 (버전 공유) |
| 스펙 문서 | `edu/docs/` — ping9-app의 `docs/`와 별개. 작업 기록도 `edu/docs/task-logs/`의 E-시리즈 |

## 로컬 실행

```bash
pnpm install
pnpm --filter @ping9/edu dev
```

## Vercel 연결 (대시보드에서 한 번만)

1. 새 프로젝트 → 이 저장소를 가져온다. **프로젝트 이름을 `ping9-edu`로** 지으면 기본 주소가 `ping9-edu.vercel.app`이 된다
2. **Root Directory**를 `edu/app`으로 설정한다 — 그러면 `edu/app/vercel.json`이 적용된다
3. **Ignored Build Step**에 `git diff HEAD^ HEAD --quiet -- edu/ packages/`를 넣으면 edu와 패키지가 바뀐 커밋만 배포된다
4. 환경변수·도메인은 이 프로젝트의 설정에만 생긴다 — PING9의 Pages/데스크톱 배포와 무관하다
