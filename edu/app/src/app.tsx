// PING9 Edu — 네트워크 진도별 학습도구 (별도 Vercel 프로젝트).
// 본체 코드(apps/web)는 import하지 않고 packages의 엔진·editor·edu-core만 쓴다 (edu/README.md 경계 규칙).
// 화면 전환은 해시 라우팅 — `#/lesson/<id>`·`#/login`·`#/signup`

import { LESSONS, type Lesson } from "@ping9/edu-core";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { onSession, signOut } from "./auth";
import { AuthPage } from "./auth-page";
import { Dashboard } from "./dashboard";
import { LessonList } from "./lesson-list";
import { LessonPlayer } from "./lesson-player";
import { loadPassed, markPassed } from "./progress";

const LESSON_HASH = /^#\/lesson\/(.+)$/;

export function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  const [passed, setPassed] = useState<Set<string>>(() => loadPassed());
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => onSession((next) => { setSession(next); setSessionReady(true); }), []);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openLesson = (lesson: Lesson | null) => {
    window.location.hash = lesson === null ? "" : `/lesson/${lesson.id}`;
  };

  if (route === "#/login" || route === "#/signup") {
    return (
      <AuthPage
        mode={route === "#/signup" ? "signup" : "login"}
        onBack={() => { window.location.hash = ""; }}
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
      return <Dashboard session={session} lessons={LESSONS} passed={passed} onPick={openLesson}
        onBack={() => { window.location.hash = ""; }} />;
    }
    return null;
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
        onExit={() => openLesson(null)}
        onPassed={(id) => setPassed(markPassed(id))}
        onNext={openLesson}
      />
    );
  }

  return (
    <main className="edu">
      <div className="edu-top">
        <div>
          <h1>PING9 Edu</h1>
          <p className="sub">네트워크 진도별 학습도구 — 단원을 골라 실습하고 자동 채점까지 받습니다</p>
        </div>
        {sessionReady && (session === null
          ? <a className="edu-login-link" href="#/login">로그인</a>
          : <p className="edu-user"><a className="edu-login-link" href="#/dashboard">대시보드</a>{session.user.email}<button onClick={() => void signOut()}>로그아웃</button></p>)}
      </div>
      <LessonList lessons={LESSONS} passed={passed} onPick={openLesson} />
    </main>
  );
}
