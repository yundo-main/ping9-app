// PING9 Edu — 교육용 도구 셸 (별도 Vercel 프로젝트).
// PING9 본체 코드(apps/web)는 import하지 않고, packages의 엔진·공용 타입만 쓴다 —
// 그래야 두 배포가 서로를 건드리지 않는다.

import { createSimulator } from "@ping9/engine";
import { EXAMPLE_DOCUMENTS } from "@ping9/shared/examples";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { onSession, signOut } from "./auth";
import { LoginPanel } from "./login-panel";

export function App() {
  const [picked, setPicked] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => onSession((next) => { setSession(next); setSessionReady(true); }), []);
  const example = EXAMPLE_DOCUMENTS[picked]!;
  // 엔진이 edu에서도 그대로 도는지 확인하는 최소 연결 — 실제 교육 UI는 여기에 붙는다
  const snapshot = useMemo(() => {
    const sim = createSimulator();
    const result = sim.load(example.document);
    return result.ok ? sim.getSnapshot() : undefined;
  }, [example]);

  return (
    <main className="edu">
      <h1>PING9 Edu</h1>
      <p className="sub">PING9 시뮬레이터 기반 교육용 도구 — 별도 Vercel 프로젝트로 배포됩니다</p>
      {sessionReady && (session === null
        ? <LoginPanel />
        : <p className="edu-user">{session.user.email}로 로그인 중<button onClick={() => void signOut()}>로그아웃</button></p>)}
      <div className="edu-grid">
        {EXAMPLE_DOCUMENTS.map((candidate, index) => (
          <button key={candidate.name} className="edu-card" onClick={() => setPicked(index)}
            style={{ textAlign: "left", cursor: "pointer", borderColor: index === picked ? "#0284C7" : undefined }}>
            <b>{candidate.name}</b>
            <span>장비 {candidate.document.devices.length}대 · 링크 {candidate.document.links.length}개</span>
          </button>
        ))}
      </div>
      {snapshot !== undefined && (
        <div className="edu-card" style={{ marginTop: 16 }}>
          <b>{example.name} — 엔진 스냅샷</b>
          <span>
            {snapshot.document.devices.map((device) => `${device.name}(${device.kind})`).join(" · ")}
          </span>
        </div>
      )}
    </main>
  );
}
