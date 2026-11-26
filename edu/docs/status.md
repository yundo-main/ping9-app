# PING9 Edu 개발 현황 — 2026-11-26 스냅샷

상세 내역은 [task-logs/](task-logs/README.md)의 E-시리즈. 이 문서는 지금 상태의 요약이다.

## 배포·접속

- 프로덕션: `ping9-edu.vercel.app` (= `ping9-app.vercel.app`, 같은 Vercel 배포). 수동 배포: `vercel build --prod && vercel deploy --prebuilt --prod`
- Supabase 프로젝트: `etquisloivqtbjjdbduk.supabase.co`
- 계정: 교사 `meta4rism@gmail.com/123456`, 학생 `networked@naver.com/123456` (최소 비밀번호 6자)

## 완료된 것

| 영역 | 상태 |
|---|---|
| 커리큘럼 | JSON 레슨 4개 (N1 ping / N2 ARP / N3 VLAN / N6 라우팅·게이트웨이) — level·minutes·goals·callout 메타 포함 (E6.1, E6.3) |
| 레슨 플레이어 | 과제 사이드바 + 단계 버튼 + 채점 + EditorApp 임베드 (E3.x). topbar 한 행 통합 — 목록/제목/내보내기/가져오기/채점/모드 (E6.4, E6.5) |
| 인증 | 이메일+비밀번호, 게스트, **로그인 필수 게이트** (E6.8), Google/GitHub 버튼 (코드 완료 — 자격증명 대기) |
| 진도 | Supabase `progress`에 통과 시각 저장, 학생 대시보드(칩·스트릭·과제·반 참가·이름 편집), 교사 대시보드(반·초대코드·학생×레슨 매트릭스·과제·막힘 분석) (E5.1) |
| 테마 | pingu 팔레트(ice/navy/cyan/beak) + 도트 그리드 배경, Pretendard (E6.2) |
| 3D | three.js 펭귄(로그인 페이지, 지연 로딩) + 레슨 카드 3D 토폴로지 썸네일 + 장비 모델 공장 공유 (E6.8–E6.10) |
| 코어 seam | `download`·`onActions`·`features{fileActions,crumb,icons3d}`·`topbarStart/End`·`aboutDesc/Extra` — docs/core-sharing.md에 목록 |

## 대기 중인 것

| 항목 | 상태 |
|---|---|
| Google 로그인 | provider ON + 리다이렉트 설정됨. Client ID/Secret을 Supabase에 입력하면 동작 (E4.4) |
| GitHub 로그인 | 코드 배포됨. GitHub OAuth App 생성 + Supabase provider에 자격증명 입력 필요 (E6.12) |
| 커리큘럼 확장 | N5·N7~N12 레슨 미작성. N5는 N6에 일부 흡수됨 |
| UX 계획 P1 | 진행 상태 DB 저장·복원, 자동 채점 강화, 실패 위치 안내 (edu/docs/ux-plan.md) |
| 팔레트 3D 아이콘 | `features.icons3d` seam은 있지만 edu는 꺼 둠 (E6.10 후속 결정) |
| 캔버스 장비 3D | 팔레트·썸네일만 3D. 캔버스 위 장비는 SVG — 상호작용 레이어라 별도 공사 |
| 코드 스플리팅 | index 번들 ~1.1MB — 라우트별 분리 후보 (ux-plan P4) |

## 알려진 함정

- `class_members`↔`classes` RLS 상호 참조는 `security definer` 함수로 우회 (E5.1 로그)
- Supabase Management API 설정값(`uri_allow_list` 등)은 쉼표 구분자가 필요 — 붙여서 보내면 합쳐짐
