// 로그인 — Supabase Auth (dev-plan E4) + 게스트 모드.
// 이메일·비밀번호는 Supabase가 기본으로 켜서 바로 쓰고, Google 소셜 로그인은 대시보드에서 provider를 켜면 동작한다.
// 게스트는 Supabase 없이 로컬 세션으로 시작한다 — 진도는 그대로 localStorage에 저장된다.
// 키는 anon public key라 클라이언트에 노출돼도 된다. 비밀은 서비스 키뿐이라 여기에 두지 않는다.

import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** env가 없으면 비로그인 모드로 돈다 — 개발 중 키 없이도 앱이 뜬다 */
export const supabase = url !== undefined && anonKey !== undefined
  ? createClient(url, anonKey)
  : undefined;

/** 화면이 쓰는 세션 — Supabase 세션과 게스트 세션을 같은 모양으로 */
export interface EduSession {
  /** auth.users의 id — DB 행의 user_id로 쓴다. 게스트는 빈 문자열 */
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: "student" | "teacher";
  readonly guest: boolean;
}

const GUEST_KEY = "ping9-edu-guest";

function readGuest(): EduSession | null {
  try {
    if (localStorage.getItem(GUEST_KEY) !== "1") return null;
  } catch {
    return null;
  }
  return { id: "", email: "", name: "게스트", role: "student", guest: true };
}

function mapSession(session: Session): EduSession {
  const meta = session.user.user_metadata as Record<string, unknown> | undefined;
  const email = session.user.email ?? "";
  return {
    id: session.user.id,
    email,
    name: typeof meta?.["display_name"] === "string" ? meta["display_name"] : email.split("@")[0] ?? "사용자",
    role: meta?.["role"] === "teacher" ? "teacher" : "student",
    guest: false,
  };
}

/** 세션 구독자 — 게스트 시작·로그아웃처럼 Supabase 이벤트가 없는 변화도 전한다 */
const listeners = new Set<(session: EduSession | null) => void>();

function emit(session: EduSession | null): void {
  for (const listener of listeners) listener(session);
}

/** 게스트로 시작 — Supabase 없이도 대시보드·진도가 동작한다. 진도는 이 브라우저에만 남는다 */
export function signInAsGuest(): void {
  try {
    localStorage.setItem(GUEST_KEY, "1");
  } catch {
    // 저장이 막혀도 세션 자체는 동작한다
  }
  emit(readGuest());
}

/** 에러 메시지를 반환한다 — 성공이면 null */
async function call(promise: Promise<{ error: { message: string } | null }>): Promise<string | null> {
  const { error } = await promise;
  return error?.message ?? null;
}

export function signInWithEmail(email: string, password: string): Promise<string | null> {
  if (supabase === undefined) return Promise.resolve("로그인이 아직 설정되지 않았어요");
  return call(supabase.auth.signInWithPassword({ email, password }));
}

/** 가입 시 함께 저장할 프로필 — user_metadata로 들어가고 E4.2의 users 테이블로 옮긴다 */
export interface SignUpMeta {
  readonly name: string;
  readonly role: "student" | "teacher";
}

export function signUpWithEmail(email: string, password: string, meta: SignUpMeta): Promise<string | null> {
  if (supabase === undefined) return Promise.resolve("로그인이 아직 설정되지 않았어요");
  return call(supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: meta.name, role: meta.role } },
  }));
}

export function signInWithGoogle(): Promise<string | null> {
  if (supabase === undefined) return Promise.resolve("로그인이 아직 설정되지 않았어요");
  return call(supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  }).then(result => result, () => ({ error: { message: "Google 로그인을 시작하지 못했어요" } })));
}

export async function signOut(): Promise<void> {
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    // 저장 접근이 막혀도 로그아웃은 진행한다
  }
  emit(null);
  await supabase?.auth.signOut();
}

export function onSession(callback: (session: EduSession | null) => void): void {
  listeners.add(callback);
  if (supabase === undefined) {
    callback(readGuest());
    return;
  }
  void supabase.auth.getSession().then(({ data }) => {
    callback(data.session === null ? readGuest() : mapSession(data.session));
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session === null ? readGuest() : mapSession(session));
  });
}
