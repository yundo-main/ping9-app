// 커리큘럼 — 레슨은 JSON 데이터다. 코드(TS)가 아닌 데이터로 두는 이유:
// 콘텐츠가 코드와 분리돼 나중에 교사 편집·다국어 로케일 디렉터리로 늘릴 수 있다 (참고: step-through 코스 구조).
// defineLesson이 로드 시점에 스키마·토폴로지·check를 검증한다.

import { defineLesson } from "../lesson";
import type { Lesson } from "../lesson";
import n1FirstPing from "./n1-first-ping.json";
import n2ArpWatch from "./n2-arp-watch.json";
import n3VlanSplit from "./n3-vlan-split.json";
import n6RouterGateway from "./n6-router-gateway.json";

/** 커리큘럼 순서의 모든 레슨 — unit, order 순으로 정렬돼 있다고 가정한다 */
export const LESSONS: readonly Lesson[] = [
  defineLesson(n1FirstPing),
  defineLesson(n2ArpWatch),
  defineLesson(n3VlanSplit),
  defineLesson(n6RouterGateway),
];
