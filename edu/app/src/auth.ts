// 로그인 — Supabase Auth (dev-plan E4). 이메일·비밀번호는 Supabase가 기본으로 켜서 바로 쓰고,
// Google 소셜 로그인은 Supabase 대시보드에서 provider를 켜면 같은 버튼이 그대로 동작한다.
// 키는 anon public key라 클라이언트에 노출돼도 된다. 비밀은 서비스 키뿐이라 여기에 두지 않는다.

import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** env가 없으면 비로그인 모드로 돈다 — 개발 중 키 없이도 앱이 뜬다 */
export const supabase = url !== undefined && anonKey !== undefined
  ? createClient(url, anonKey)
  : undefined;

/** 에러 메시지를 반환한다 — 성공이면 null */
async function call(promise: Promise<{ error: { message: string } | null }>): Promise<string | null> {
  const { error } = await promise;
  return error?.message ?? null;
}

export function signInWithEmail(email: string, password: string): Promise<string | null> {
  if (supabase === undefined) return Promise.resolve("로그인이 아직 설정되지 않았어요");
  return call(supabase.auth.signInWithPassword({ email, password }));
}

export function signUpWithEmail(email: string, password: string): Promise<string | null> {
  if (supabase === undefined) return Promise.resolve("로그인이 아직 설정되지 않았어요");
  return call(supabase.auth.signUp({ email, password }));
}

export function signInWithGoogle(): Promise<string | null> {
  if (supabase === undefined) return Promise.resolve("로그인이 아직 설정되지 않았어요");
  return call(supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  }).then(result => result, () => ({ error: { message: "Google 로그인을 시작하지 못했어요" } })));
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

export function onSession(callback: (session: Session | null) => void): void {
  if (supabase === undefined) {
    callback(null);
    return;
  }
  void supabase.auth.getSession().then(({ data }) => callback(data.session));
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
