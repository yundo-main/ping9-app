// 학생 대시보드 (`#/dashboard`) — 진도·스트릭·과제가 모이는 화면.
// 스타일은 designed-to-scale.vercel.app의 종이 느낌(cream + mono + pop 버튼)을 따른다 (E4.3 개선).

import type { Lesson } from "@ping9/edu-core";
import { useEffect, useState } from "react";
import { updateDisplayName, type EduSession } from "./auth";
import { joinClassByCode, listAssignments, listJoinedClasses, type Assignment, type EduClass } from "./classes";
import { UNIT_TITLES } from "./lesson-list";

/** 마지막 활동일부터 거슬러 올라가는 연속 학습일 */
function streak(passed: ReadonlyMap<string, string>): number {
  const days = new Set([...passed.values()].map((iso) => iso.slice(0, 10)));
  if (days.size === 0) return 0;
  const latest = [...days].sort().at(-1)!;
  let count = 0;
  const cursor = new Date(`${latest}T00:00:00`);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
}

export function Dashboard({ session, lessons, passed, onPick, onBack, onSignOut }: {
  readonly session: EduSession;
  readonly lessons: readonly Lesson[];
  readonly passed: ReadonlyMap<string, string>;
  readonly onPick: (lesson: Lesson) => void;
  readonly onBack: () => void;
  readonly onSignOut: () => void;
}) {
  const [classes, setClasses] = useState<EduClass[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(session.name);

  useEffect(() => {
    if (session.guest) return;
    void listJoinedClasses(session).then((list) => {
      setClasses(list);
      void listAssignments(list.map((cls) => cls.id)).then(setAssignments);
    });
  }, [session]);

  const totalPassed = lessons.filter((lesson) => passed.has(lesson.id)).length;
  const resume = lessons.find((lesson) => !passed.has(lesson.id)) ?? null;
  const days = streak(passed);

  const units = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const unit = units.get(lesson.unit) ?? [];
    unit.push(lesson);
    units.set(lesson.unit, unit);
  }

  const join = async () => {
    const error = await joinClassByCode(joinCode);
    setJoinMessage(error ?? "반에 들어갔어요");
    if (error === null) {
      setJoinCode("");
      void listJoinedClasses(session).then(setClasses);
      void listAssignments(classes.map((cls) => cls.id)).then(setAssignments);
    }
  };

  const saveName = async () => {
    setEditingName(false);
    if (name.trim() !== "" && name !== session.name) await updateDisplayName(name);
  };

  return (
    <main className="edu edu-dash">
      <div className="edu-top">
        <div>
          <h1 className="edu-dash-name">
            {editingName ? (
              <input autoFocus value={name} maxLength={40}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(event) => { if (event.key === "Enter") void saveName(); }} />
            ) : (
              <>{session.name}님 <button type="button" className="edu-name-edit" onClick={() => setEditingName(true)} aria-label="이름 바꾸기">✎</button></>
            )}
          </h1>
          <p className="sub">{session.guest ? "게스트 모드" : session.email} · {session.role === "teacher" ? "교사" : "학생"}</p>
          {session.guest && <p className="edu-note">진도는 이 브라우저에만 저장돼요 — <a href="#/signup">가입</a>하면 계정에 남습니다</p>}
        </div>
        <div className="edu-top-actions">
          <button type="button" className="edu-btn" onClick={onBack}>레슨 목록</button>
          <button type="button" className="edu-btn" onClick={onSignOut}>로그아웃</button>
        </div>
      </div>

      <div className="edu-chips">
        <div className="edu-chip" data-level={totalPassed === lessons.length && lessons.length > 0 ? "good" : "warn"}>
          <span className="edu-chip-label">전체 진도</span>
          <b>{totalPassed} / {lessons.length}</b>
          <div className="edu-bar"><i style={{ width: `${lessons.length === 0 ? 0 : (totalPassed / lessons.length) * 100}%` }} /></div>
        </div>
        <div className="edu-chip" data-level={days > 0 ? "good" : "warn"}>
          <span className="edu-chip-label">연속 학습</span>
          <b>{days}일</b>
          <span className="edu-chip-sub">{days > 0 ? "통과한 날이 이어져요" : "첫 통과를 기록해요"}</span>
        </div>
        <div className="edu-chip" data-level="warn">
          <span className="edu-chip-label">과제</span>
          <b>{assignments.filter((a) => !passed.has(a.lessonId)).length}개 남음</b>
          <span className="edu-chip-sub">{classes.length === 0 ? "반에 들어가면 과제가 보여요" : `${classes.length}개 반`}</span>
        </div>
      </div>

      {resume !== null && (
        <section className="edu-card edu-resume">
          <div className="edu-resume-text">
            <span className="edu-eyebrow">이어서 학습</span>
            <b>{resume.title}</b>
            <span>{UNIT_TITLES[resume.unit] ?? resume.unit} · 목표 {resume.checks.length}개</span>
          </div>
          <button type="button" className="edu-btn-pop" onClick={() => onPick(resume)}>이어서 하기 →</button>
        </section>
      )}

      {assignments.length > 0 && (
        <section className="edu-card">
          <b className="edu-eyebrow">과제</b>
          <ul className="edu-lessons">
            {assignments.map((assignment) => {
              const lesson = lessons.find((candidate) => candidate.id === assignment.lessonId);
              const done = passed.has(assignment.lessonId);
              return (
                <li key={assignment.id} className="edu-lesson-row">
                  <span className={`edu-mark${done ? " done" : ""}`}>{done ? "✓" : "○"}</span>
                  <button type="button" onClick={() => lesson !== undefined && onPick(lesson)} disabled={lesson === undefined}>
                    {lesson?.title ?? assignment.lessonId}
                  </button>
                  <span className="edu-when">{assignment.dueAt !== null ? `마감 ${new Date(assignment.dueAt).toLocaleDateString("ko-KR")}` : "마감 없음"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!session.guest && (
        <section className="edu-card edu-join">
          <b className="edu-eyebrow">반 참가</b>
          <div className="edu-join-row">
            <input placeholder="참가 코드" value={joinCode} maxLength={12}
              onChange={(event) => setJoinCode(event.target.value)} />
            <button type="button" className="edu-btn-pop" onClick={() => void join()}>참가</button>
          </div>
          {joinMessage !== null && <p className="edu-note">{joinMessage}</p>}
          {classes.length > 0 && <p className="edu-note">들어간 반: {classes.map((cls) => cls.name).join(" · ")}</p>}
        </section>
      )}

      {[...units.entries()].map(([unit, list]) => {
        const sorted = [...list].sort((a, b) => a.order - b.order);
        const done = sorted.filter((lesson) => passed.has(lesson.id));
        return (
          <section key={unit} className="edu-card">
            <div className="edu-unit-head">
              <b className="edu-eyebrow">{UNIT_TITLES[unit] ?? unit}</b>
              <span className="edu-chip-sub">{done.length} / {sorted.length}</span>
            </div>
            <div className="edu-bar"><i style={{ width: `${(done.length / sorted.length) * 100}%` }} /></div>
            <ul className="edu-lessons">
              {sorted.map((lesson) => {
                const passedAt = passed.get(lesson.id);
                return (
                  <li key={lesson.id} className="edu-lesson-row">
                    <span className={`edu-mark${passedAt !== undefined ? " done" : ""}`}>{passedAt !== undefined ? "✓" : "○"}</span>
                    <button type="button" onClick={() => onPick(lesson)}>{lesson.title}</button>
                    {passedAt !== undefined && <span className="edu-when">{daysAgo(passedAt)}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
