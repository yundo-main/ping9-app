// 레슨 진도 — 게스트·비로그인은 브라우저 localStorage, 계정 로그인이면 Supabase progress 테이블에도 쓴다.
// 로그인하면 서버 진도를 가져와 로컬과 합집합으로 맞춘다 (기기 간 진도가 따라오는 경로).
// 값은 통과한 레슨 id의 집합이다

import { supabase, type EduSession } from "./auth";

const KEY = "ping9-edu-progress";

export function loadPassed(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function markPassed(lessonId: string): Set<string> {
  const passed = loadPassed();
  passed.add(lessonId);
  localStorage.setItem(KEY, JSON.stringify([...passed]));
  return passed;
}

/** 통과를 서버에도 기록한다 — 게스트·미설정이면 아무것도 안 한다. RLS가 본인 행만 허용한다 */
export function pushPassed(lessonId: string, session: EduSession): void {
  if (session.guest || supabase === undefined) return;
  void supabase.from("progress").upsert(
    { user_id: session.id, lesson_id: lessonId },
    { onConflict: "user_id,lesson_id" },
  );
}

/** 서버 진도를 가져와 로컬과 합집합 — 로그인 직후 한 번 부른다 */
export async function pullPassed(session: EduSession): Promise<Set<string>> {
  if (session.guest || supabase === undefined) return loadPassed();
  const { data, error } = await supabase.from("progress").select("lesson_id");
  if (error !== null) return loadPassed();
  const remote = new Set<string>((data ?? []).map((row) => String(row["lesson_id"])));
  const merged = new Set([...loadPassed(), ...remote]);
  localStorage.setItem(KEY, JSON.stringify([...merged]));
  // 로컬에만 있던 통과도 서버로 올려 다음 기기에서도 보이게 한다
  for (const lessonId of merged) {
    if (!remote.has(lessonId)) pushPassed(lessonId, session);
  }
  return merged;
}
