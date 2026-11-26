// 커리큘럼 목록 — 단원별로 묶은 레슨 카드. 누르면 레슨 플레이어로 간다 (E3.1)

import type { Lesson } from "@ping9/edu-core";

/** 단원 id → 보이는 이름. 커리큘럼은 dev-plan의 N1–N12다 */
export const UNIT_TITLES: Record<string, string> = {
  "n1-basics": "N1 네트워크 기초",
};

export function LessonList({ lessons, onPick }: { readonly lessons: readonly Lesson[]; readonly onPick: (lesson: Lesson) => void }) {
  const units = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const unit = units.get(lesson.unit) ?? [];
    unit.push(lesson);
    units.set(lesson.unit, unit);
  }

  return (
    <div className="edu-units">
      {[...units.entries()].map(([unit, list]) => (
        <section key={unit} className="edu-unit">
          <h2>{UNIT_TITLES[unit] ?? unit}</h2>
          <div className="edu-grid">
            {list.sort((a, b) => a.order - b.order).map((lesson) => (
              <button key={lesson.id} className="edu-card" onClick={() => onPick(lesson)} type="button">
                <b>{lesson.title}</b>
                <span>{lesson.brief.split("\n")[0]}</span>
                <span>목표 {lesson.checks.length}개</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
