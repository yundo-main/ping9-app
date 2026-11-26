// 인증 화면 — 로그인(`#/login`)과 회원가입(`#/signup`) 두 페이지 (E3.4).
// 세션(계정 또는 게스트) 없이는 어떤 화면으로도 못 간다 — 이 화면이 서비스의 문이다 (E6.8).
// Google 버튼은 Supabase 대시보드에서 provider를 켜면 그대로 동작한다.

import heroUrl from "@ping9/editor/assets/panel-penguin.png";
import { useState } from "react";
import { signInAsGuest, signInWithEmail, signInWithGithub, signInWithGoogle, signUpWithEmail, supabase } from "./auth";

// 소셜 버튼의 브랜드 마크 — 공식 단순 로고의 SVG 패스 (E6.13 후속)
const GOOGLE_MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.3 1.2-3.3 0-6.1-2.2-7.1-5.3l-3.9 3C3 20.5 7.2 24 12 24z"/><path fill="#FBBC05" d="M4.9 14.1c-.3-.8-.4-1.6-.4-2.1s.1-1.5.4-2.1l-3.9-3C.4 8.3 0 10.1 0 12s.4 3.7 1 5.1l3.9-3z"/><path fill="#EA4335" d="M12 4.6c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.2 0 3 3.5 1 8l3.9 3c1-3.1 3.8-6.4 7.1-6.4z"/></svg>
);
const GITHUB_MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.3 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"/></svg>
);

export function AuthPage({ mode, onDone }: {
  readonly mode: "login" | "signup";
  readonly onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordCheck, setPasswordCheck] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signup = mode === "signup";

  const run = async (action: () => Promise<string | null>, success: string, done = false) => {
    setBusy(true);
    setMessage(null);
    const error = await action();
    if (error === null && done) { onDone(); return; }
    setMessage(error ?? success);
    setBusy(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (signup) {
      if (password !== passwordCheck) { setMessage("비밀번호가 서로 달라요"); return; }
      void run(() => signUpWithEmail(email, password, { name: name.trim(), role }), "가입 확인 메일을 보냈어요 — 메일함을 확인해 주세요");
    } else {
      void run(() => signInWithEmail(email, password), "", true);
    }
  };

  const guest = (
    <button type="button" className="edu-guest" disabled={busy}
      onClick={() => { signInAsGuest(); onDone(); }}>게스트로 시작하기</button>
  );

  return (
    <div className="edu-auth">
      <div className="edu-auth-card">
        <img src={heroUrl} className="edu-auth-hero" alt="네트워크 탐험을 시작해 볼까요?" />
        <div className="edu-auth-body">
        <h1>{signup ? "회원가입" : "PING9 Edu"}</h1>
        <p className="edu-auth-sub">
          {signup ? "진도와 제출을 계정에 저장하려면 가입이 필요해요" : "PING9 Edu 계정으로 로그인해요"}
        </p>
        {supabase === undefined ? (
          <>
            <p className="edu-login-note">계정 로그인은 설정 전이에요 — 게스트로는 바로 시작할 수 있습니다</p>
            {guest}
          </>
        ) : (
          <>
            <form onSubmit={submit}>
              {signup && (
                <>
                  <label>이름<input type="text" placeholder="표시 이름" value={name} required maxLength={40}
                    autoComplete="name" onChange={(event) => setName(event.target.value)} /></label>
                  <div className="edu-role">
                    <label className={role === "student" ? "on" : ""}>
                      <input type="radio" name="role" checked={role === "student"} onChange={() => setRole("student")} />
                      학생
                    </label>
                    <label className={role === "teacher" ? "on" : ""}>
                      <input type="radio" name="role" checked={role === "teacher"} onChange={() => setRole("teacher")} />
                      교사
                    </label>
                  </div>
                </>
              )}
              <label>이메일<input type="email" placeholder="name@school.kr" value={email} required
                autoComplete="email" onChange={(event) => setEmail(event.target.value)} /></label>
              <label>비밀번호<input type="password" placeholder="6자 이상" value={password} required minLength={6}
                autoComplete={signup ? "new-password" : "current-password"} onChange={(event) => setPassword(event.target.value)} /></label>
              {signup && (
                <label>비밀번호 확인<input type="password" placeholder="한 번 더" value={passwordCheck} required minLength={6}
                  autoComplete="new-password" onChange={(event) => setPasswordCheck(event.target.value)} /></label>
              )}
              <button type="submit" className="edu-auth-submit" disabled={busy}>
                {busy ? "처리 중…" : signup ? "가입하기" : "로그인"}
              </button>
            </form>
            <div className="edu-auth-divider"><span>또는</span></div>
            <div className="edu-auth-socials">
              <button type="button" className="edu-google" disabled={busy}
                onClick={() => void run(signInWithGoogle, "Google로 이동합니다")}>{GOOGLE_MARK}Google로 계속</button>
              <button type="button" className="edu-google edu-github" disabled={busy}
                onClick={() => void run(signInWithGithub, "GitHub로 이동합니다")}>{GITHUB_MARK}GitHub로 계속</button>
            </div>
            {guest}
            {message !== null && <p className="edu-login-note">{message}</p>}
            <p className="edu-auth-switch">
              {signup ? "이미 계정이 있으신가요? " : "계정이 없으신가요? "}
              <a href={signup ? "#/login" : "#/signup"}>{signup ? "로그인" : "가입하기"}</a>
            </p>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
