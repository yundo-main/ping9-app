// 레슨 진도 — 게스트·비로그인은 브라우저 localStorage, 계정 로그인이면 Supabase progress 테이블에도 쓴다.
// 로그인하면 서버 진도를 가져와 로컬과 합집합으로 맞춘다 (기기 간 진도가 따라오는 경로).
// 값은 레슨 id → 통과 시각(ISO)의 맵이다

import { supabase, type EduSession } from "./auth";

const KEY = "ping9-edu-progress";

export function loadPassed(): Map<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw === null ? {} : JSON.parse(raw);
    if (Array.isArray(list)) {
      // 옛 형식(레슨 id 배열) — 시각이 없으니 지금으로 채운다
      const now = new Date().toISOString();
      return new Map(list.filter((item): item is string => typeof item === "string").map((id) => [id, now]));
    }
    if (typeof list === "object" && list !== null) {
      return new Map(Object.entries(list).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
    return new Map();
  } catch {
    return new Map();
  }
}

export function markPassed(lessonId: string): Map<string, string> {
  const passed = loadPassed();
  passed.set(lessonId, new Date().toISOString());
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(passed)));
  return passed;
}

/** 통과를 서버에도 기록한다 — 게스트·미설정이면 아무것도 안 한다. RLS가 본인 행만 허용한다 */
export function pushPassed(lessonId: string, passedAt: string, session: EduSession): void {
  if (session.guest || supabase === undefined) return;
  void supabase.from("progress").upsert(
    { user_id: session.id, lesson_id: lessonId, passed_at: passedAt },
    { onConflict: "user_id,lesson_id" },
  );
}

/** 서버 진도를 가져와 로컬과 합집합 — 로그인 직후 한 번 부른다 */
export async function pullPassed(session: EduSession): Promise<Map<string, string>> {
  if (session.guest || supabase === undefined) return loadPassed();
  const { data, error } = await supabase.from("progress").select("lesson_id,passed_at");
  if (error !== null) return loadPassed();
  const remote = new Map<string, string>(
    (data ?? []).map((row) => [String(row["lesson_id"]), String(row["passed_at"])]),
  );
  const merged = new Map([...loadPassed(), ...remote]);
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(merged)));
  // 로컬에만 있던 통과도 서버로 올려 다음 기기에서도 보이게 한다
  for (const [lessonId, passedAt] of merged) {
    if (!remote.has(lessonId)) pushPassed(lessonId, passedAt, session);
  }
  return merged;
}
