// PING9 Edu — 네트워크 진도별 학습도구 (별도 Vercel 프로젝트).
// 본체 코드(apps/web)는 import하지 않고 packages의 엔진·editor·edu-core만 쓴다 (edu/README.md 경계 규칙).
// 화면 전환은 해시 라우팅 — `#/lesson/<id>`·`#/lessons`·`#/login`·`#/signup`·`#/dashboard`
// 로그인한 사용자의 홈은 대시보드: 루트로 오면 대시보드로 보내고 레슨 목록은 `#/lessons`에 둔다

import logoUrl from "@ping9/editor/assets/logo.png";
import { LESSONS, type Lesson } from "@ping9/edu-core";
import { useEffect, useState } from "react";
import { onSession, signOut, type EduSession } from "./auth";
import { AuthPage } from "./auth-page";
import { Dashboard } from "./dashboard";
import { LessonList } from "./lesson-list";
import { LessonPlayer } from "./lesson-player";
import { loadPassed, markPassed, pullPassed, pushPassed } from "./progress";
import { TeacherDashboard } from "./teacher-dashboard";

const LESSON_HASH = /^#\/lesson\/(.+)$/;

export function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  const [passed, setPassed] = useState<Map<string, string>>(() => loadPassed());
  const [session, setSession] = useState<EduSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => onSession((next) => {
    setSession(next);
    setSessionReady(true);
    if (next !== null && !next.guest) void pullPassed(next).then(setPassed);
  }), []);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openLesson = (lesson: Lesson | null) => {
    window.location.hash = lesson === null ? "#/lessons" : `/lesson/${lesson.id}`;
  };

  const list = (
    <main className="edu">
      <div className="edu-top">
        <div>
          <h1><img src={logoUrl} className="edu-logo" alt="" /> PING9 Edu</h1>
          <p className="sub">네트워크 진도별 학습도구 — 단원을 골라 실습하고 자동 채점까지 받습니다</p>
        </div>
        {sessionReady && (session === null
          ? <a className="edu-login-link" href="#/login">로그인</a>
          : <p className="edu-user"><a className="edu-login-link" href="#/dashboard">대시보드</a>{session.guest ? "게스트" : session.email}<button onClick={() => void signOut()}>로그아웃</button></p>)}
      </div>
      <LessonList lessons={LESSONS} passed={passed} onPick={openLesson} />
    </main>
  );

  if (route === "#/login" || route === "#/signup") {
    return (
      <AuthPage
        mode={route === "#/signup" ? "signup" : "login"}
        onBack={() => { window.location.hash = "#/lessons"; }}
        onDone={() => { window.location.hash = "#/dashboard"; }}
      />
    );
  }

  if (route === "#/dashboard") {
    if (sessionReady && session === null) {
      window.location.hash = "#/login";
      return null;
    }
    if (session !== null) {
      if (session.role === "teacher") {
        return <TeacherDashboard session={session} lessons={LESSONS}
          onBack={() => { window.location.hash = "#/lessons"; }}
          onSignOut={() => void signOut()} />;
      }
      return <Dashboard session={session} lessons={LESSONS} passed={passed} onPick={openLesson}
        onBack={() => { window.location.hash = "#/lessons"; }}
        onSignOut={() => void signOut()} />;
    }
    return null;
  }

  if (route === "#/lessons") {
    return list;
  }

  const match = LESSON_HASH.exec(route);
  const lesson = match === null ? null : LESSONS.find((candidate) => candidate.id === match[1]) ?? null;
  const lessonIndex = lesson === null ? -1 : LESSONS.indexOf(lesson);
  const nextLesson = lessonIndex >= 0 && lessonIndex + 1 < LESSONS.length ? LESSONS[lessonIndex + 1]! : null;

  if (match !== null && lesson !== null) {
    return (
      <LessonPlayer
        lesson={lesson}
        nextLesson={nextLesson}
        session={session}
        onExit={() => openLesson(null)}
        onPassed={(id) => {
          const next = markPassed(id);
          setPassed(next);
          if (session !== null) pushPassed(id, next.get(id)!, session);
        }}
        onNext={openLesson}
      />
    );
  }

  // 첫 화면은 로그인 — 세션이 있으면 대시보드가 홈. 레슨 목록은 `#/lessons`로 열린다
  if (session !== null) {
    window.location.hash = "#/dashboard";
    return null;
  }
  return (
    <AuthPage
      mode="login"
      onBack={() => { window.location.hash = "#/lessons"; }}
      onDone={() => { window.location.hash = "#/dashboard"; }}
    />
  );
}
