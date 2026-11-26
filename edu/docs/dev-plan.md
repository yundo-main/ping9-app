# PING9 Edu 개발 계획

PING9 시뮬레이터 코어(`packages/shared` + `packages/engine`) 위에 올리는 **교육용 솔루션**의 개발 계획. 본체(`apps/web` → GitHub Pages + Tauri)와 배포가 분리된 별도 Vercel 프로젝트 — `ping9-edu.vercel.app`.

- 작성일: 2026-12-08
- 상태: 초안 — 1단계 범위는 검토 후 확정한다

## 1. 방향

| 항목 | 결정 |
|---|---|
| 성격 | PING9 기반 네트워크 교육 솔루션 — 본체는 "자유 실습 도구", Edu는 "정답이 있는 수업 도구" |
| 경계 | `edu/* → packages/*` 방향으로만 의존. `apps/web` 코드는 import하지 않는다 |
| 배포 | Vercel 별도 프로젝트. 저장소는 공유하므로 엔진 개선이 자동 반영된다 |
| 인증/DB | 1단계는 없음 — 로컬스토리지 진행도. 계정은 후속 단계에서 Vercel Postgres로 |

## 2. 단계 (Milestone)

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **E0. 스캐폴드** ✅ | `edu/app` Vite 셸 + Vercel 설정 + 분리 규칙 문서 | T0.74 완료 |
| **E1. 과제 형식 정의** | 레슨 데이터 스키마 — 목표 상태(토폴로지·설정), 제약(편집 잠금 범위), 성공 조건(검사 식) | 스키마 + 샘플 레슨 1개가 검증을 통과 |
| **E2. 자동 채점기** | 엔진 스냅샷/콘솔 출력을 검사하는 순수 TS 채점기 — "PC1→PC2 ping 성공", "경로가 존재", "추적에 ARP 포함" 같은 조건 | 채점기가 성공·실패를 구분하는 테스트 |
| **E3. 레슨 화면** | 학생 UI — 과제 설명 + 임베디드 시뮬레이터 + "채점" 버튼 + 결과 피드백 | 레슨 1개가 브라우저에서 처음부터 끝까지 돈다 |
| **E4. 진행도** | 로컬스토리지에 레슨별 완료 기록 + 목록 화면 | 새로고침해도 완료가 남는다 |
| **E5. 시나리오 공유** (선택) | 과제를 URL/파일로 교사가 배포 | 링크로 과제를 연다 |
| **E6. 계정·교사 모드** (후속) | Vercel Postgres + 로그인 — 반·제출 관리 | 별도 계획 |

### 레슨 형식 초안 (E1)

```ts
interface Lesson {
  readonly id: string;               // "arp-basics"
  readonly title: string;
  readonly brief: string;            // 학생에게 보이는 과제 설명
  readonly startDocument: TopologyDocument;   // 시작 토폴로지 (잠금 장비 포함 가능)
  readonly checks: readonly Check[]; // 순서대로 평가
}

type Check =
  | { kind: "ping"; from: string; to: string }                    // 콘솔 ping 성공
  | { kind: "route"; device: string; network: string }            // 라우팅 표에 경로 존재
  | { kind: "trace"; event: string }                              // 추적에 이유 코드 포함
  | { kind: "config"; device: string; check: string };            // 설정 상태 검사
```

## 3. 소스 트리 제안

지금 구조에서 바뀌는 부분만. **`edu/` 안에 자체 패키지를 둬서** "교육 모듈 = edu/ 한 폴더"라는 경계를 유지한다:

```
edu/
├── README.md                 분리 규칙 + Vercel 절차 (있음)
├── docs/
│   └── dev-plan.md           이 문서
├── core/                     ← NEW 패키지 @ping9/edu-core (순수 TS — engine처럼 DOM 없음)
│   └── src/
│       ├── lesson.ts         Lesson·Check 스키마 (Zod)
│       ├── grader.ts         스냅샷·콘솔 출력 → 통과/실패 판정
│       └── lessons/          내장 레슨 데이터 (TS 파일 = 버전 관리되는 커리큘럼)
└── app/                      @ping9/edu (있음 — Vite + React)
    └── src/
        ├── lesson-runner.ts  세션: simulator 인스턴스 + grader 호출
        ├── components/       레슨 목록·과제 패널·채점 결과·토폴로지 뷰어
        └── progress.ts       로컬스토리지 진행도
```

`pnpm-workspace.yaml`은 `edu/*`만 잡고 있으므로 **`edu/**`로 넓혀** `edu/core`를 포함시킨다 — 한 줄 변경.

### 검토가 필요한 큰 결정: 시뮬레이터 편집 UI 재사용

E3에서 "학생이 장비를 배치·설정하는 화면"이 필요한데, 그 화면은 지금 `apps/web` 안에 있다. 선택지:

| 방식 | 내용 | 평가 |
|---|---|---|
| **A. `packages/editor` 추출** ⭐ | `apps/web`의 캔버스·터미널·인스펙터를 공용 패키지로 옮겨 본체와 Edu가 같이 쓴다 | 구조가 가장 깨끗 — "시뮬레이터 UI"가 재사용 자산이 된다. 단 한 번의 대형 이동(파일 수십 개 + 경계 재정의)이 필요 |
| B. Edu 전용 간이 에디터 | Edu에 최소 편집 UI를 새로 만든다 | 빠르지만 두 화면이 영원히 갈라진다 — 본체 개선이 Edu에 안 들어옴 |
| C. iframe 임베드 | Pages에 올라간 본체를 Edu 페이지가 iframe으로 띄운다 | 코드 이동 없지만 두 앱이 세션·도메인을 공유 못 해 채점 연동이 깨진다 — 채점이 핵심인 Edu엔 안 맞음 |

**제안: A를 E3 직전에 한 번 한다.** 순서 — `packages/editor`를 만들고 `apps/web`의 `components/`·`terminal/`·`replay/`·`format/`·`messages/`·`canvas-interaction.ts`·`simulator.ts`를 옮긴 뒤, `apps/web`은 앱 껍데기(라우팅·Tauri·파일 저장)만 남긴다. 그 다음 Edu가 `packages/editor`를 소비한다. 이 이동이 본체 코드를 건드리는 유일한 작업이고, 이후엔 Edu가 완전히 독립적으로 커진다.

### 이후 트리 (A 채택 시)

```
packages/
├── shared    타입·스키마 (기존)
├── engine    시뮬레이션 코어 (기존)
└── editor    ← NEW. React 시뮬레이터 UI — apps/web에서 옮긴 편집기 부품

apps/web      본체 — editor를 조립하는 껍데기 + Tauri + 토폴로지 파일
edu/
├── core      레슨·채점 (순수 TS)
└── app       Edu UI — editor + core를 소비
```

## 4. 작업 순서와 Task 후보

| Task | 단계 | 내용 |
|---|---|---|
| E1.1 | E1 | `@ping9/edu-core` 패키지 + Lesson/Check Zod 스키마 + 샘플 레슨 1개 |
| E2.1 | E2 | `grader.ts` — ping/route/trace/config 검사 + 테스트 |
| E3.0 | E3 전 | `packages/editor` 추출 이동 (큰 작업 — 별도 계획서 필요) |
| E3.1 | E3 | 레슨 화면 — 과제 패널 + editor 임베드 + 채점 버튼 |
| E4.1 | E4 | 진행도 저장 + 레슨 목록 |
| E5.1 | E5 | 과제 내보내기/가져오기 (파일·URL) |

각 작업은 `edu/docs/task-logs/`에 `E-시리즈`로 기록한다 — 본체 Task(T-시리즈, `docs/task-logs/`)와 번호·위치가 모두 분리된다.

## 5. 열린 질문

- ❓ 레슨 콘텐츠는 코드에 박는가(TS 파일, 버전 관리) DB에 넣는가(교사가 화면에서 제작)? — 1단계는 코드 내장, 교사 제작은 E6 이후
- ❓ 학생의 자유 실습도 Edu에 허용하는가, 아니면 과제 모드만인가? — 자유 실습은 본체로 보내는 게 역할 분리에 맞다
- ❓ Vercel 비용/제한 — Hobby 플랜으로 충분한가 (정적 + 서버리스만 쓰면 무료 범위)
