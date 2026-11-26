// 레슨 형식 (dev-plan E1). 단원별 커리큘럼의 한 과제 — 시작 토폴로지와
// 완료 조건(Check)의 나열이다. 채점기(grader, E2)가 Check를 평가한다.

import { REASON_CODES, validateDocument, type ReasonCode, type TopologyDocument } from "@ping9/shared";
import { z } from "zod";

/** 장비 참조 — 레슨 안에서 장비는 이름으로 가리킨다 (학생이 보는 이름과 같다) */
const deviceName = z.string().min(1).max(64);

/** 완료 조건 — 순서대로 평가된다 */
export const checkSchema = z.discriminatedUnion("kind", [
  // from 장비 콘솔에서 to(IP 또는 장비 이름)로 ping이 성공한다
  z.object({ kind: z.literal("ping"), from: deviceName, to: z.string().min(1) }),
  // 장비의 라우팅 표에 이 네트워크로 가는 경로가 있다
  z.object({ kind: z.literal("route"), device: deviceName, network: z.string().min(1) }),
  // 추적에 이 이유 코드의 이벤트가 남는다 (예: ARP_REQUEST_SENT)
  z.object({ kind: z.literal("trace"), code: z.string().min(1) }),
  // 두 장비의 포트 사이에 링크가 있다
  z.object({
    kind: z.literal("link"),
    a: z.object({ device: deviceName, port: z.string().min(1) }),
    b: z.object({ device: deviceName, port: z.string().min(1) }),
  }),
  // 장비의 이 포트에 이 주소가 설정돼 있다 (PC의 ip/config나 라우터의 interface)
  z.object({ kind: z.literal("ip"), device: deviceName, port: z.string().min(1), ip: z.string().min(1), mask: z.string().min(1) }),
]);
export type Check = z.infer<typeof checkSchema>;

export const lessonSchema = z.object({
  /** "n1-first-ping" — URL·진도 키로 쓴다 */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** "n1-basics" — 커리큘럼 단원 id */
  unit: z.string().regex(/^[a-z0-9-]+$/),
  /** 단원 안 순서 */
  order: z.number().int().positive(),
  title: z.string().min(1),
  /** 목록 카드에 보이는 한 줄 요약 */
  summary: z.string().min(1),
  /** 단계 안내 — 학생이 순서대로 넘기는 안내 카드 (마크다운 허용, hint는 접는 힌트) */
  steps: z.array(z.object({
    text: z.string().min(1),
    hint: z.string().optional(),
  })).min(1),
  /** 시작 토폴로지 — 엔진의 Document와 같은 형식. shared의 topologyDocumentSchema는
   *  내부용이라 여기선 `validateDocument`로 검증한다 */
  startDocument: z.custom<TopologyDocument>((value) => validateDocument(value).ok),
  checks: z.array(checkSchema).min(1),
});
export type Lesson = z.infer<typeof lessonSchema>;

/** 레슨을 정의하고 검증한다 — JSON 데이터든 코드든 잘못된 내용은 정의 시점에 걸린다 */
export function defineLesson(input: unknown): Lesson {
  return lessonSchema.parse(input);
}

/** 이유 코드 문자열이 엔진의 ReasonCode인지 — trace 체크의 오타를 정의 시점에 잡는다 */
const REASON_CODE_SET = new Set<string>(REASON_CODES);
export function isReasonCode(code: string): code is ReasonCode {
  return REASON_CODE_SET.has(code);
}
