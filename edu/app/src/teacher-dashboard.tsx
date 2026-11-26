// 교사 대시보드 (`#/dashboard`, role=teacher) — 반 관리·학생 진도표·과제·막힘 분석.
// 학생 대시보드와 같은 종이 느낌 스타일, 진도 데이터는 RLS 아래 반 멤버 것만 읽는다.

import type { Lesson } from "@ping9/edu-core";
import { useEffect, useState } from "react";
import type { EduSession } from "./auth";
import {
  createAssignment,
  createClass,
  failedCheckStats,
  listAssignments,
  listMembers,
  listTeachingClasses,
  progressOfMembers,
  removeAssignment,
  type Assignment,
  type ClassMember,
  type EduClass,
  type FailedCheckStat,
  type ProgressMatrix,
} from "./classes";
import { UNIT_TITLES } from "./lesson-list";

function lessonTitle(lessons: readonly Lesson[], id: string): string {
  return lessons.find((lesson) => lesson.id === id)?.title ?? id;
}

export function TeacherDashboard({ session, lessons, onBack, onSignOut }: {
  readonly session: EduSession;
  readonly lessons: readonly Lesson[];
  readonly onBack: () => void;
  readonly onSignOut: () => void;
}) {
  const [classes, setClasses] = useState<EduClass[]>([]);
  const [selected, setSelected] = useState<EduClass | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [matrix, setMatrix] = useState<ProgressMatrix>(new Map());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [blocked, setBlocked] = useState<FailedCheckStat[]>([]);
  const [newClassName, setNewClassName] = useState("");
  const [assignLesson, setAssignLesson] = useState("");
  const [assignDue, setAssignDue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const refreshClasses = async () => setClasses(await listTeachingClasses(session));
  useEffect(() => { void refreshClasses(); }, [session]);

  const openClass = async (cls: EduClass) => {
    setSelected(cls);
    const memberList = await listMembers(cls.id);
    setMembers(memberList);
    const ids = memberList.map((member) => member.userId);
    setMatrix(await progressOfMembers(ids));
    setAssignments(await listAssignments([cls.id]));
    setBlocked(await failedCheckStats(ids));
  };

  const addClass = async () => {
    const error = await createClass(session, newClassName.trim());
    setMessage(error);
    if (error === null) { setNewClassName(""); void refreshClasses(); }
  };

  const addAssignment = async () => {
    if (selected === null || assignLesson === "") return;
    const error = await createAssignment(selected.id, assignLesson, assignDue === "" ? null : new Date(assignDue).toISOString());
    setMessage(error);
    if (error === null) {
      setAssignLesson("");
      setAssignDue("");
      setAssignments(await listAssignments([selected.id]));
    }
  };

  const doneCount = members.filter((member) => matrix.get(member.userId)?.size).length;

  return (
    <main className="edu edu-dash">
      <div className="edu-top">
        <div>
          <h1>{session.name} 선생님</h1>
          <p className="sub">{session.email} · 교사</p>
        </div>
        <div className="edu-top-actions">
          <button type="button" className="edu-btn" onClick={onBack}>레슨 목록</button>
          <button type="button" className="edu-btn" onClick={onSignOut}>로그아웃</button>
        </div>
      </div>

      <div className="edu-chips">
        <div className="edu-chip" data-level="warn">
          <span className="edu-chip-label">내 반</span>
          <b>{classes.length}개</b>
          <span className="edu-chip-sub">참가 코드로 학생을 초대</span>
        </div>
        <div className="edu-chip" data-level={doneCount > 0 ? "good" : "warn"}>
          <span className="edu-chip-label">진행 중인 학생</span>
          <b>{selected === null ? "-" : `${doneCount} / ${members.length}`}</b>
          <span className="edu-chip-sub">{selected?.name ?? "반을 선택하세요"}</span>
        </div>
        <div className="edu-chip" data-level={blocked.length === 0 ? "good" : "bad"}>
          <span className="edu-chip-label">막힌 조건</span>
          <b>{selected === null ? "-" : `${blocked.length}종`}</b>
          <span className="edu-chip-sub">실패 시도 기준</span>
        </div>
      </div>

      <section className="edu-card">
        <b className="edu-eyebrow">반 만들기</b>
        <div className="edu-join-row">
          <input placeholder="반 이름 (예: 2학년 3반)" value={newClassName} maxLength={60}
            onChange={(event) => setNewClassName(event.target.value)} />
          <button type="button" className="edu-btn-pop" disabled={newClassName.trim() === ""} onClick={() => void addClass()}>만들기</button>
        </div>
        {message !== null && <p className="edu-note">{message}</p>}
        {classes.length > 0 && (
          <ul className="edu-lessons">
            {classes.map((cls) => (
              <li key={cls.id} className="edu-lesson-row">
                <span className={`edu-mark${selected?.id === cls.id ? " done" : ""}`}>{selected?.id === cls.id ? "●" : "○"}</span>
                <button type="button" onClick={() => void openClass(cls)}>{cls.name}</button>
                <span className="edu-when">코드 <code className="edu-code">{cls.joinCode}</code> · 학생 {cls.memberCount}명</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected !== null && (
        <>
          <section className="edu-card">
            <div className="edu-unit-head">
              <b className="edu-eyebrow">{selected.name} — 학생 진도표</b>
              <span className="edu-chip-sub">참가 코드 <code className="edu-code">{selected.joinCode}</code></span>
            </div>
            {members.length === 0 ? (
              <p className="edu-note">아직 학생이 없어요 — 참가 코드를 나눠 주세요</p>
            ) : (
              <div className="edu-matrix-wrap">
                <table className="edu-matrix">
                  <thead>
                    <tr>
                      <th>학생</th>
                      {[...lessons].sort((a, b) => a.order - b.order).map((lesson) => (
                        <th key={lesson.id} title={lesson.title}>{UNIT_TITLES[lesson.unit] ?? lesson.unit}<br />{lesson.order}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.userId}>
                        <td>{member.displayName}</td>
                        {[...lessons].sort((a, b) => a.order - b.order).map((lesson) => (
                          <td key={lesson.id} className={matrix.get(member.userId)?.has(lesson.id) ? "ok" : ""}>
                            {matrix.get(member.userId)?.has(lesson.id) ? "✓" : "·"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="edu-card">
            <b className="edu-eyebrow">과제</b>
            <div className="edu-join-row">
              <select value={assignLesson} onChange={(event) => setAssignLesson(event.target.value)}>
                <option value="">레슨 선택…</option>
                {[...lessons].sort((a, b) => a.order - b.order).map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>{lesson.title}</option>
                ))}
              </select>
              <input type="date" value={assignDue} onChange={(event) => setAssignDue(event.target.value)} />
              <button type="button" className="edu-btn-pop" disabled={assignLesson === ""} onClick={() => void addAssignment()}>내주기</button>
            </div>
            {assignments.length > 0 && (
              <ul className="edu-lessons">
                {assignments.map((assignment) => (
                  <li key={assignment.id} className="edu-lesson-row">
                    <span className="edu-mark">▸</span>
                    <span>{lessonTitle(lessons, assignment.lessonId)}</span>
                    <span className="edu-when">
                      {assignment.dueAt !== null ? `마감 ${new Date(assignment.dueAt).toLocaleDateString("ko-KR")}` : "마감 없음"}
                      {" · "}{members.filter((m) => matrix.get(m.userId)?.has(assignment.lessonId)).length}/{members.length}명 완료
                      {" "}<button type="button" className="edu-link-btn" onClick={() => void removeAssignment(assignment.id).then(() => openClass(selected))}>삭제</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {blocked.length > 0 && (
            <section className="edu-card">
              <b className="edu-eyebrow">학생들이 막히는 조건</b>
              <ul className="edu-lessons">
                {blocked.slice(0, 8).map((stat) => (
                  <li key={`${stat.lessonId}|${stat.label}`} className="edu-lesson-row">
                    <span className="edu-mark bad">✗</span>
                    <span>{lessonTitle(lessons, stat.lessonId)} — {stat.label}</span>
                    <span className="edu-when">{stat.count}회</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
