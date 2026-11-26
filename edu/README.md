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

## 수동 배포 (CLI)

Git 연동 없이 CLI로 바로 올릴 수도 있다 — 저장소 **루트**에서 실행한다 (프로젝트의 `rootDirectory: edu/app` 설정이 루트 기준이라 `edu/app` 안에서 deploy하면 경로가 꼬인다):

```bash
vercel link --yes --project ping9-edu       # 한 번만
vercel pull --yes --environment=production  # 설정·env 다운로드
vercel build --prod                         # 로컬 빌드 → .vercel/output
vercel deploy --prebuilt --prod             # 프로덕션 배포
```

- 로컬 빌드라 pnpm 워크스페이스(`@ping9/*`)를 그대로 해결한다
- CLI가 만드는 `.vercel/`, `.env.local`은 gitignore 대상 — 커밋하지 않는다
- 도메인 관리: `vercel domains add <도메인> ping9-edu` — 프로젝트 도메인으로 붙여야 프로덕션 배포를 따라간다
## Supabase Auth 설정

프로젝트: `etquisloivqtbjjdbduk` (리전 Seoul). 클라이언트 env는 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` — Vercel Production env와 `edu/app/.env.local`에 둘 다 들어가 있다.

- 이메일 로그인: `mailer_autoconfirm`이 켜져 있어 확인 메일 없이 가입 즉시 로그인된다. 비밀번호 최소 길이는 플랫폼 하한인 6자.
- 테이블: `progress`(진도)·`classes`·`class_members`·`assignments`·`attempts` — RLS가 본인/반 교사 행만 연다. 참가는 `join_class(code)` RPC.

### 소셜 로그인 (Google)

provider는 이미 켜져 있고(`external_google_enabled`) Site URL·리다이렉트 허용 목록도 설정됐다 — **Google 자격증명만 넣으면 된다**:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 동의 화면 설정 → 클라이언트 ID 만들기 (웹 애플리케이션)
2. 승인된 리다이렉션 URI에 등록: `https://etquisloivqtbjjdbduk.supabase.co/auth/v1/callback`
3. Supabase 대시보드 → Authentication → Sign In / Providers → Google에 **Client ID + Client Secret** 입력 후 저장

코드는 `signInWithGoogle()`(`edu/app/src/auth.ts`)이 그대로 동작한다 — 버튼은 로그인/가입 화면에 이미 있다.
