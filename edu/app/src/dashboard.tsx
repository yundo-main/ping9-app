// 개인 대시보드 (`#/dashboard`) — 로그인한 사용자의 진도가 모이는 화면 (E3.4).
// 표시 이름·역할은 가입 시 user_metadata에 넣은 값, 진도는 지금은 localStorage (E4.2에서 계정 DB로)

import type { Lesson } from "@ping9/edu-core";
import type { EduSession } from "./auth";
import { UNIT_TITLES } from "./lesson-list";

export function Dashboard({ session, lessons, passed, onPick, onBack }: {
  readonly session: EduSession;
  readonly lessons: readonly Lesson[];
  readonly passed: ReadonlySet<string>;
  readonly onPick: (lesson: Lesson) => void;
  readonly onBack: () => void;
}) {
  const totalPassed = lessons.filter((lesson) => passed.has(lesson.id)).length;
  const resume = lessons.find((lesson) => !passed.has(lesson.id)) ?? null;

  const units = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const unit = units.get(lesson.unit) ?? [];
    unit.push(lesson);
    units.set(lesson.unit, unit);
  }

  return (
    <main className="edu">
      <div className="edu-top">
        <div>
          <h1>{session.name}님의 대시보드</h1>
          <p className="sub">{session.guest ? "게스트 모드" : session.email} · {session.role === "teacher" ? "교사" : "학생"}</p>
          {session.guest && <p className="edu-guest-note">진도는 이 브라우저에만 저장돼요 — <a href="#/signup">가입</a>하면 계정에 남습니다</p>}
        </div>
        <button type="button" className="edu-back" onClick={onBack}>← 레슨 목록</button>
      </div>

      <div className="edu-dash-grid">
        <section className="edu-card edu-dash-resume">
          <b>이어서 학습</b>
          {resume !== null ? (
            <>
              <span className="edu-dash-resume-title">{resume.title}</span>
              <span>{UNIT_TITLES[resume.unit] ?? resume.unit} · 목표 {resume.checks.length}개</span>
              <button type="button" className="edu-next" onClick={() => onPick(resume)}>이어서 하기 →</button>
            </>
          ) : (
            <span>모든 레슨을 마쳤어요 🎉</span>
          )}
        </section>

        <section className="edu-card">
          <b>전체 진도</b>
          <span className="edu-dash-big">{totalPassed} / {lessons.length}</span>
          <span>레슨 통과</span>
          <div className="edu-bar"><i style={{ width: `${lessons.length === 0 ? 0 : (totalPassed / lessons.length) * 100}%` }} /></div>
        </section>
      </div>

      <section className="edu-unit">
        <h2>단원별 진도</h2>
        <div className="edu-dash-units">
          {[...units.entries()].map(([unit, list]) => {
            const sorted = [...list].sort((a, b) => a.order - b.order);
            const done = sorted.filter((lesson) => passed.has(lesson.id));
            return (
              <div key={unit} className="edu-card">
                <b>{UNIT_TITLES[unit] ?? unit} <i className="edu-unit-progress">{done.length} / {sorted.length}</i></b>
                <div className="edu-bar"><i style={{ width: `${(done.length / sorted.length) * 100}%` }} /></div>
                <ul className="edu-dash-lessons">
                  {sorted.map((lesson) => (
                    <li key={lesson.id}>
                      <button type="button" className={passed.has(lesson.id) ? "ok" : ""} onClick={() => onPick(lesson)}>
                        {passed.has(lesson.id) ? "✓ " : ""}{lesson.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
