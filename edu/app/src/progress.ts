// 레슨 진도 — 로그인 전까지 브라우저 localStorage에 둔다 (E4.2에서 DB로 옮긴다).
// 값은 통과한 레슨 id의 집합이다

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
