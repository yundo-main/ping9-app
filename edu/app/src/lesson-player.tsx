// 레슨 플레이어 — 시작 토폴로지를 editor 싱글턴에 올리고 EditorApp을 전체 화면으로 띄운다.
// 학생은 본체와 같은 화면에서 장비를 고치고, "채점하기"가 grader로 완료 조건을 평가한다 (E3.3)

import { grade, type GradeResult, type Lesson } from "@ping9/edu-core";
import { EditorApp, simulator } from "@ping9/editor";
import { useEffect, useRef, useState } from "react";
import { checkLabel } from "./check-label";
import { UNIT_TITLES } from "./lesson-list";
import { Markdown } from "./markdown";

export function LessonPlayer({ lesson, nextLesson, onExit, onPassed, onNext }: {
  readonly lesson: Lesson;
  readonly nextLesson: Lesson | null;
  readonly onExit: () => void;
  readonly onPassed: (lessonId: string) => void;
  readonly onNext: (lesson: Lesson) => void;
}) {
  const [ready, setReady] = useState(false);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [briefOpen, setBriefOpen] = useState(true);
  const running = useRef(false);

  // 레슨 진입 시 시작 토폴로지를 올린다 — EditorApp은 스냅샷을 구독하므로 먼저 load하면 그 상태로 그린다
  useEffect(() => {
    simulator.load(lesson.startDocument);
    setReady(true);
    setResult(null);
  }, [lesson]);

  const gradeNow = async () => {
    if (running.current) return;
    running.current = true;
    setGrading(true);
    try {
      const graded = await grade(simulator, lesson);
      setResult(graded);
      if (graded.ok) onPassed(lesson.id);
    } finally {
      running.current = false;
      setGrading(false);
    }
  };

  const passCount = result?.results.filter((checkResult) => checkResult.ok).length ?? 0;

  return (
    <div className="edu-player">
      <header className="edu-player-bar">
        <button type="button" className="edu-back" onClick={onExit}>← 목록</button>
        <div className="edu-player-title">
          <span className="edu-player-unit">{UNIT_TITLES[lesson.unit] ?? lesson.unit}</span>
          <b>{lesson.title}</b>
        </div>
        <button type="button" className="edu-brief-toggle" onClick={() => setBriefOpen((open) => !open)}>
          {briefOpen ? "과제 닫기" : "과제 보기"}
        </button>
        <button type="button" className="edu-grade" onClick={() => void gradeNow()} disabled={grading}>
          {grading ? "채점 중…" : "채점하기"}
        </button>
      </header>
      <div className={`edu-player-body${briefOpen ? "" : " brief-closed"}`}>
        {briefOpen && (
          <aside className="edu-brief">
            <Markdown text={lesson.brief} />
            <h3>완료 조건</h3>
            <ul className="edu-checks">
              {lesson.checks.map((check, index) => (
                <li key={index}>{checkLabel(check)}</li>
              ))}
            </ul>
            {result !== null && (
              <div className={`edu-result ${result.ok ? "pass" : "fail"}`}>
                <b>{result.ok ? "레슨 완료" : `${passCount} / ${result.results.length} 통과`}</b>
                <ul className="edu-checks">
                  {result.results.map((checkResult, index) => (
                    <li key={index} className={checkResult.ok ? "ok" : "no"}>
                      {checkResult.ok ? "✓" : "✗"} {checkLabel(checkResult.check)}
                      <span>{checkResult.detail}</span>
                    </li>
                  ))}
                </ul>
                {result.ok && nextLesson !== null && (
                  <button type="button" className="edu-next" onClick={() => onNext(nextLesson)}>
                    다음 레슨 →<span>{nextLesson.title}</span>
                  </button>
                )}
                {result.ok && nextLesson === null && (
                  <p className="edu-all-done">모든 레슨을 마쳤어요</p>
                )}
              </div>
            )}
          </aside>
        )}
        <div className="edu-player-sim">
          {ready && <EditorApp key={lesson.id} />}
        </div>
      </div>
    </div>
  );
}
