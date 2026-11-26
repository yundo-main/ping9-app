// 인증 화면 — 로그인(`#/login`)과 회원가입(`#/signup`) 두 페이지 (E3.4).
// 비로그인이어도 레슨은 열리고, 진도를 계정에 저장하려면 로그인이 필요하다.
// Google 버튼은 Supabase 대시보드에서 provider를 켜면 그대로 동작한다.

import { useState } from "react";
import { signInWithEmail, signInWithGoogle, signUpWithEmail, supabase } from "./auth";

export function AuthPage({ mode, onBack, onDone }: {
  readonly mode: "login" | "signup";
  readonly onBack: () => void;
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

  return (
    <div className="edu-auth">
      <div className="edu-auth-card">
        <button type="button" className="edu-back" onClick={onBack}>← 목록으로</button>
        <h1>{signup ? "회원가입" : "로그인"}</h1>
        <p className="edu-auth-sub">
          {signup ? "진도와 제출을 계정에 저장하려면 가입이 필요해요" : "PING9 Edu 계정으로 로그인해요"}
        </p>
        {supabase === undefined ? (
          <p className="edu-login-note">로그인 설정 전이에요 — Supabase env가 없어 비로그인으로 동작 중입니다</p>
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
            <button type="button" className="edu-google" disabled={busy}
              onClick={() => void run(signInWithGoogle, "Google로 이동합니다")}>Google로 계속</button>
            {message !== null && <p className="edu-login-note">{message}</p>}
            <p className="edu-auth-switch">
              {signup ? "이미 계정이 있으신가요? " : "계정이 없으신가요? "}
              <a href={signup ? "#/login" : "#/signup"}>{signup ? "로그인" : "가입하기"}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
