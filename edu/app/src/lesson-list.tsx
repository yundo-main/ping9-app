// 커리큘럼 목록 — 단원별로 묶은 레슨 카드. 진도(통과 배지·단원 진행률)를 보여 준다 (E3.3)

import type { Lesson } from "@ping9/edu-core";
import { TopologyThumb } from "./topology-thumb";

const LEVEL_LABELS: Record<string, string> = {
  beginner: "초급",
  intermediate: "중급",
  advanced: "고급",
};

/** 단원 id → 보이는 이름. 커리큘럼은 dev-plan의 N1–N12다 */
export const UNIT_TITLES: Record<string, string> = {
  "n1-basics": "N1 네트워크 기초",
  "n2-arp": "N2 ARP와 MAC 주소",
  "n3-vlan": "N3 스위치와 VLAN",
  "n4-l3switch": "N4 L3 스위치",
  "n5-subnet": "N5 IP 주소와 서브넷",
  "n6-routing": "N6 라우팅 기초",
  "n7-rip": "N7 동적 라우팅",
  "n8-services": "N8 네트워크 서비스",
  "n9-lb": "N9 로드밸런서",
  "n10-nat": "N10 NAT",
  "n11-firewall": "N11 방화벽",
  "n12-vpn": "N12 VPN",
};

export function LessonList({ lessons, passed, onPick }: {
  readonly lessons: readonly Lesson[];
  readonly passed: ReadonlyMap<string, string>;
  readonly onPick: (lesson: Lesson) => void;
}) {
  const units = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const unit = units.get(lesson.unit) ?? [];
    unit.push(lesson);
    units.set(lesson.unit, unit);
  }
  const totalPassed = lessons.filter((lesson) => passed.has(lesson.id)).length;

  return (
    <div className="edu-units">
      <div className="edu-progress-overall">
        <span>전체 진도 <b>{totalPassed} / {lessons.length}</b> 레슨</span>
        <div className="edu-bar"><i style={{ width: `${lessons.length === 0 ? 0 : (totalPassed / lessons.length) * 100}%` }} /></div>
      </div>
      {[...units.entries()].map(([unit, list]) => {
        const sorted = [...list].sort((a, b) => a.order - b.order);
        const unitPassed = sorted.filter((lesson) => passed.has(lesson.id)).length;
        return (
          <section key={unit} className="edu-unit">
            <div className="edu-unit-head">
              <h2>{UNIT_TITLES[unit] ?? unit}</h2>
              <span className="edu-unit-progress">{unitPassed} / {sorted.length} 완료</span>
            </div>
            <div className="edu-grid">
              {sorted.map((lesson) => {
                const done = passed.has(lesson.id);
                return (
                  <button key={lesson.id} className={`edu-card${done ? " done" : ""}`} onClick={() => onPick(lesson)} type="button">
                    <TopologyThumb document={lesson.startDocument} />
                    <b>{lesson.title}{done && <i className="edu-done">완료</i>}</b>
                    <span>{lesson.summary}</span>
                    <span>
                      {lesson.level !== undefined && <i className={`edu-level lvl-${lesson.level}`}>{LEVEL_LABELS[lesson.level] ?? lesson.level}</i>}
                      {lesson.minutes !== undefined && `~${lesson.minutes}분 · `}
                      목표 {lesson.checks.length}개 · 단계 {lesson.steps.length}개
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
