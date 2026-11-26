// Google 소셜 로그인 — Supabase Auth의 Google provider (dev-plan E4).
// 키는 anon public key라 클라이언트에 노출돼도 된다. 비밀은 서비스 키뿐이라 여기에 두지 않는다.

import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** env가 없으면 비로그인 모드로 돈다 — 개발 중 키 없이도 앱이 뜬다 */
export const supabase = url !== undefined && anonKey !== undefined
  ? createClient(url, anonKey)
  : undefined;

export async function signInWithGoogle(): Promise<void> {
  if (supabase === undefined) return;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

export function onSession(callback: (session: Session | null) => void): void {
  if (supabase === undefined) return;
  void supabase.auth.getSession().then(({ data }) => callback(data.session));
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
