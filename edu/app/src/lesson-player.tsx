// 레슨 플레이어 — 시작 토폴로지를 editor 싱글턴에 올리고 EditorApp을 전체 화면으로 띄운다.
// 학생은 본체와 같은 화면에서 장비를 고치고, "채점하기"가 grader로 완료 조건을 평가한다 (E3.1)

import { grade, type GradeResult, type Lesson } from "@ping9/edu-core";
import { EditorApp, simulator } from "@ping9/editor";
import { useEffect, useRef, useState } from "react";
import { checkLabel } from "./check-label";
import { UNIT_TITLES } from "./lesson-list";

export function LessonPlayer({ lesson, onExit }: { readonly lesson: Lesson; readonly onExit: () => void }) {
  const [ready, setReady] = useState(false);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const running = useRef(false);

  // 레슨 진입 시 시작 토폴로지를 올린다 — EditorApp은 스냅샷을 구독하므로 먼저 load하면 그 상태로 그린다
  useEffect(() => {
    simulator.load(lesson.startDocument);
    setReady(true);
  }, [lesson]);

  const gradeNow = async () => {
    if (running.current) return;
    running.current = true;
    setGrading(true);
    try {
      setResult(await grade(simulator, lesson));
    } finally {
      running.current = false;
      setGrading(false);
    }
  };

  return (
    <div className="edu-player">
      <header className="edu-player-bar">
        <button type="button" className="edu-back" onClick={onExit}>← 목록</button>
        <div className="edu-player-title">
          <span className="edu-player-unit">{UNIT_TITLES[lesson.unit] ?? lesson.unit}</span>
          <b>{lesson.title}</b>
        </div>
        <button type="button" className="edu-grade" onClick={() => void gradeNow()} disabled={grading}>
          {grading ? "채점 중…" : "채점하기"}
        </button>
      </header>
      <div className="edu-player-body">
        <aside className="edu-brief">
          <p className="edu-brief-text">{lesson.brief}</p>
          <h3>완료 조건</h3>
          <ul className="edu-checks">
            {lesson.checks.map((check, index) => (
              <li key={index}>{checkLabel(check)}</li>
            ))}
          </ul>
          {result !== null && (
            <div className={`edu-result ${result.ok ? "pass" : "fail"}`}>
              <b>{result.ok ? "레슨 완료 — 전부 통과했어요" : "아직 조건이 남아 있어요"}</b>
              <ul className="edu-checks">
                {result.results.map((checkResult, index) => (
                  <li key={index} className={checkResult.ok ? "ok" : "no"}>
                    {checkResult.ok ? "✓" : "✗"} {checkLabel(checkResult.check)}
                    <span>{checkResult.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
        <div className="edu-player-sim">
          {ready && <EditorApp key={lesson.id} />}
        </div>
      </div>
    </div>
  );
}
