// PING9 Edu — 네트워크 진도별 학습도구 (별도 Vercel 프로젝트).
// 본체 코드(apps/web)는 import하지 않고 packages의 엔진·editor·edu-core만 쓴다 (edu/README.md 경계 규칙).

import { LESSONS, type Lesson } from "@ping9/edu-core";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { onSession, signOut } from "./auth";
import { LessonList } from "./lesson-list";
import { LessonPlayer } from "./lesson-player";
import { LoginPanel } from "./login-panel";

export function App() {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => onSession((next) => { setSession(next); setSessionReady(true); }), []);

  if (lesson !== null) {
    return <LessonPlayer lesson={lesson} onExit={() => setLesson(null)} />;
  }

  return (
    <main className="edu">
      <h1>PING9 Edu</h1>
      <p className="sub">네트워크 진도별 학습도구 — 단원을 골라 실습하고 자동 채점까지 받습니다</p>
      {sessionReady && (session === null
        ? <LoginPanel />
        : <p className="edu-user">{session.user.email}로 로그인 중<button onClick={() => void signOut()}>로그아웃</button></p>)}
      <LessonList lessons={LESSONS} onPick={setLesson} />
    </main>
  );
}
