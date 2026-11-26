# PING9 Edu — 스펙 문서

PING9 Edu의 스펙 문서 모음. **ping9-app(`docs/`)과 별도 프로젝트**이므로 요구사항·설계·작업 기록을 이 폴더에서 따로 관리한다.

| 문서 | 내용 | 상태 |
|---|---|---|
| [dev-plan.md](dev-plan.md) | 개발 계획 — 단계, 레슨 형식, 소스 트리 제안 | 초안 |
| `task-logs/` | Edu Task별 작업 기록 (`E-시리즈` 번호) | 시작 전 |

## 규칙

- Edu의 Task는 `docs/task-logs/`가 아니라 `edu/docs/task-logs/`에 기록한다 — 본체 T-시리즈와 섞이지 않게 `E-시리즈` 번호를 쓴다
- 스펙·설계 변경도 ping9-app의 `docs/project-plan/`이 아니라 이 폴더에 둔다
- 엔진·공용 패키지(`packages/`)의 스펙은 본체 문서(`docs/`)가 맡는다 — Edu는 소비자일 뿐
