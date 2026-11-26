// 로그인 패널 — 이메일·비밀번호 로그인/가입 + Google 버튼(추후 설정).
// 비로그인이어도 앱은 뜨고, 과제 진행도를 서버에 저장하려면 로그인이 필요하다는 안내를 둔다.

import { useState } from "react";
import { signInWithEmail, signInWithGoogle, signUpWithEmail, supabase } from "./auth";

export function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (supabase === undefined) {
    return <p className="edu-login-note">로그인 설정 전이에요 — Supabase env가 없어 비로그인으로 동작 중입니다</p>;
  }

  const run = async (action: () => Promise<string | null>, success: string) => {
    setBusy(true);
    setMessage(null);
    const error = await action();
    setMessage(error ?? success);
    setBusy(false);
  };

  return (
    <div className="edu-login">
      <form onSubmit={(event) => { event.preventDefault(); void run(() => signInWithEmail(email, password), "로그인했어요"); }}>
        <input type="email" placeholder="이메일" value={email} required autoComplete="email"
          onChange={(event) => setEmail(event.target.value)} />
        <input type="password" placeholder="비밀번호" value={password} required minLength={6}
          autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
        <div className="edu-login-actions">
          <button type="submit" disabled={busy}>로그인</button>
          <button type="button" disabled={busy}
            onClick={() => void run(() => signUpWithEmail(email, password), "가입 확인 메일을 보냈어요")}>가입</button>
          <button type="button" disabled={busy} className="edu-google"
            onClick={() => void run(signInWithGoogle, "Google로 이동합니다")}>Google로 로그인</button>
        </div>
      </form>
      {message !== null && <p className="edu-login-note">{message}</p>}
    </div>
  );
}
