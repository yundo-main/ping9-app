// 레슨 플레이어 — 시작 토폴로지를 editor 싱글턴에 올리고 EditorApp을 전체 화면으로 띄운다.
// 학생은 본체와 같은 화면에서 장비를 고치고, "채점하기"가 grader로 완료 조건을 평가한다 (E3.3)

import { grade, type GradeResult, type Lesson } from "@ping9/edu-core";
import { EditorApp, simulator, type MenuActions } from "@ping9/editor";
import { useEffect, useRef, useState } from "react";
import { signOut, type EduSession } from "./auth";
import { checkLabel } from "./check-label";
import { recordAttempt } from "./classes";
import { UNIT_TITLES } from "./lesson-list";
import { Markdown } from "./markdown";

const LEVEL_LABELS: Record<string, string> = {
  beginner: "초급",
  intermediate: "중급",
  advanced: "고급",
};

export function LessonPlayer({ lesson, nextLesson, session, onExit, onPassed, onNext }: {
  readonly lesson: Lesson;
  readonly nextLesson: Lesson | null;
  readonly session: EduSession | null;
  readonly onExit: () => void;
  readonly onPassed: (lessonId: string) => void;
  readonly onNext: (lesson: Lesson) => void;
}) {
  const [ready, setReady] = useState(false);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [briefOpen, setBriefOpen] = useState(true);
  const [step, setStep] = useState(0);
  const running = useRef(false);
  // EditorApp이 노출하는 파일 동작 — 플레이어 바의 내보내기·가져오기 버튼이 이걸 부른다 (E6.4)
  const actions = useRef<MenuActions | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 레슨 진입 시 시작 토폴로지를 올린다 — EditorApp은 스냅샷을 구독하므로 먼저 load하면 그 상태로 그린다
  useEffect(() => {
    simulator.load(lesson.startDocument);
    setReady(true);
    setResult(null);
    setStep(0);
  }, [lesson]);

  const gradeNow = async () => {
    if (running.current) return;
    running.current = true;
    setGrading(true);
    try {
      const graded = await grade(simulator, lesson);
      setResult(graded);
      recordAttempt(lesson.id, graded, session);
      if (graded.ok) onPassed(lesson.id);
    } finally {
      running.current = false;
      setGrading(false);
    }
  };

  const passCount = result?.results.filter((checkResult) => checkResult.ok).length ?? 0;

  return (
    <div className="edu-player">
      <div className={`edu-player-body${briefOpen ? "" : " brief-closed"}`}>
        {briefOpen && (
          <aside className="edu-brief">
            {lesson.goals !== undefined && lesson.goals.length > 0 && (
              <ul className="edu-goals">
                {lesson.goals.map((goal, index) => (
                  <li key={index}>
                    <button type="button" onClick={() => setStep(goal.step - 1)}
                      className={step === goal.step - 1 ? "on" : ""}>
                      {goal.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="edu-step">
              <div className="edu-step-nav">
                <button type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>← 이전</button>
                <span>단계 {step + 1} / {lesson.steps.length}</span>
                <button type="button" disabled={step + 1 >= lesson.steps.length} onClick={() => setStep((value) => value + 1)}>다음 →</button>
              </div>
              <div className="edu-step-dots">
                {lesson.steps.map((stepItem, index) => (
                  <button key={index} type="button" className={index === step ? "on" : ""} onClick={() => setStep(index)}
                    aria-label={stepItem.short ?? `단계 ${index + 1}`} title={stepItem.short} />
                ))}
              </div>
              {lesson.steps[step]!.chapter !== undefined && (
                <span className="edu-eyebrow">{lesson.steps[step]!.chapter}</span>
              )}
              {lesson.steps[step]!.short !== undefined && (
                <b className="edu-step-title">{lesson.steps[step]!.short}</b>
              )}
              <Markdown text={lesson.steps[step]!.text} />
              {lesson.steps[step]!.callout !== undefined && (
                <p className={`edu-callout ${lesson.steps[step]!.callout!.kind}`}>
                  {lesson.steps[step]!.callout!.text}
                </p>
              )}
              {lesson.steps[step]!.hint !== undefined && (
                <details className="edu-hint"><summary>힌트</summary><p>{lesson.steps[step]!.hint}</p></details>
              )}
            </div>
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
          {ready && (
            <EditorApp key={lesson.id}
              features={{ fileActions: false, crumb: false }}
              onActions={(menuActions) => { actions.current = menuActions; }}
              topbarStart={
                <div className="edu-tb">
                  <button type="button" className="edu-tb-back" onClick={onExit}>← 목록</button>
                  <span className="edu-tb-unit">{UNIT_TITLES[lesson.unit] ?? lesson.unit}</span>
                  <b className="edu-tb-title">{lesson.title}</b>
                  {lesson.level !== undefined && <i className={`edu-level lvl-${lesson.level}`}>{LEVEL_LABELS[lesson.level] ?? lesson.level}</i>}
                  {lesson.minutes !== undefined && <span className="edu-tb-minutes">~{lesson.minutes}분</span>}
                </div>
              }
              topbarEnd={
                <div className="edu-tb">
                  <button type="button" className="edu-tb-btn" onClick={() => actions.current?.exportTopology()}>⤓ 내보내기</button>
                  <button type="button" className="edu-tb-btn" onClick={() => fileInput.current?.click()}>⤒ 가져오기</button>
                  <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="가져올 파일"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file !== undefined) void actions.current?.importTopology(file);
                    }} />
                  <button type="button" className="edu-tb-btn" onClick={() => setBriefOpen((open) => !open)}>
                    {briefOpen ? "과제 닫기" : "과제 보기"}
                  </button>
                  <button type="button" className="edu-grade" onClick={() => void gradeNow()} disabled={grading}>
                    {grading ? "채점 중…" : "채점하기"}
                  </button>
                  {session !== null && (
                    <span className="edu-tb-user" title={session.guest ? "게스트" : session.email}>
                      {session.guest ? "게스트" : session.email}
                      <button type="button" className="edu-tb-btn" onClick={() => void signOut()}>로그아웃</button>
                    </span>
                  )}
                  {session === null && <a className="edu-tb-btn" href="#/login">로그인</a>}
                </div>
              } />
          )}
        </div>
      </div>
    </div>
  );
}
