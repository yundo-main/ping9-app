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

  // 로그아웃하면 첫 화면(로그인)으로 돌아간다 — 머물던 화면이 세션을 요구할 수 있으므로
  const logout = () => {
    void signOut();
    window.location.hash = "#/login";
  };

  const list = (
    <main className="edu">
      <div className="edu-top">
        <div>
          <h1><img src={logoUrl} className="edu-logo" alt="" /> PING9 Edu</h1>
          <p className="sub">네트워크 진도별 학습도구 — 단원을 골라 실습하고 자동 채점까지 받습니다</p>
        </div>
        {session !== null && (
          <p className="edu-user"><a className="edu-login-link" href="#/dashboard">대시보드</a>{session.guest ? "게스트" : session.email}<button onClick={logout}>로그아웃</button></p>
        )}
      </div>
      <LessonList lessons={LESSONS} passed={passed} onPick={openLesson} />
    </main>
  );

  if (route === "#/login" || route === "#/signup") {
    return (
      <AuthPage
        mode={route === "#/signup" ? "signup" : "login"}
        onDone={() => { window.location.hash = "#/dashboard"; }}
      />
    );
  }

  // 세션(계정·게스트) 없이는 어디로도 못 간다 — 로그인 화면이 서비스의 문 (E6.8)
  if (!sessionReady) return null;
  if (session === null) {
    window.location.hash = "#/login";
    return null;
  }

  if (route === "#/dashboard") {
    if (session.role === "teacher") {
      return <TeacherDashboard session={session} lessons={LESSONS}
        onBack={() => { window.location.hash = "#/lessons"; }}
        onSignOut={logout} />;
    }
    return <Dashboard session={session} lessons={LESSONS} passed={passed} onPick={openLesson}
      onBack={() => { window.location.hash = "#/lessons"; }}
      onSignOut={logout} />;
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

  // 게이트를 지나면 세션은 항상 있다 — 나머지 경로는 전부 대시보드로
  window.location.hash = "#/dashboard";
  return null;
}
