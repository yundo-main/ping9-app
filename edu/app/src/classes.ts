// 반(클래스)·과제·채점 시도 — 교사 대시보드와 학생의 반 참가·과제가 쓰는 데이터 접근.
// 전부 RLS 아래에서 돈다: 교사는 본인 반, 학생은 본인 행·소속 반만 보인다.

import type { GradeResult } from "@ping9/edu-core";
import { supabase, type EduSession } from "./auth";

export interface EduClass {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;
}

export interface ClassMember {
  readonly userId: string;
  readonly displayName: string;
}

export interface Assignment {
  readonly id: string;
  readonly classId: string;
  readonly lessonId: string;
  readonly dueAt: string | null;
}

/** 학생 진도표 — 학생 id → 통과한 레슨 id 집합 */
export type ProgressMatrix = ReadonlyMap<string, ReadonlySet<string>>;

export interface FailedCheckStat {
  readonly lessonId: string;
  readonly label: string;
  readonly count: number;
}

function ready(session: EduSession | null): boolean {
  return session !== null && !session.guest && supabase !== undefined;
}

/** 참가 코드 — 교사가 학생에게 나눠 주는 8자리 */
function joinCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

// ── 교사 ────────────────────────────────────────────────

export async function createClass(session: EduSession, name: string): Promise<string | null> {
  if (!ready(session)) return "로그인이 필요해요";
  const { error } = await supabase!.from("classes").insert({ name, join_code: joinCode(), teacher_id: session.id });
  return error?.message ?? null;
}

/** 내가 만든 반 목록 + 멤버 수 */
export async function listTeachingClasses(session: EduSession): Promise<EduClass[]> {
  if (!ready(session)) return [];
  const { data } = await supabase!
    .from("classes")
    .select("id,name,join_code,class_members(count)")
    .eq("teacher_id", session.id)
    .order("created_at");
  return (data ?? []).map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    joinCode: String(row["join_code"]),
    memberCount: ((row["class_members"] as { count: number }[] | null)?.[0]?.count) ?? 0,
  }));
}

export async function listMembers(classId: string): Promise<ClassMember[]> {
  if (supabase === undefined) return [];
  const { data } = await supabase.from("class_members").select("user_id,display_name").eq("class_id", classId).order("joined_at");
  return (data ?? []).map((row) => ({ userId: String(row["user_id"]), displayName: String(row["display_name"] ?? "학생") }));
}

export async function createAssignment(classId: string, lessonId: string, dueAt: string | null): Promise<string | null> {
  if (supabase === undefined) return "로그인이 필요해요";
  const { error } = await supabase.from("assignments").upsert(
    { class_id: classId, lesson_id: lessonId, due_at: dueAt },
    { onConflict: "class_id,lesson_id" },
  );
  return error?.message ?? null;
}

export async function removeAssignment(id: string): Promise<void> {
  if (supabase === undefined) return;
  await supabase.from("assignments").delete().eq("id", id);
}

/** 반 학생들의 진도 — RLS가 교사에게 멤버 행을 열어 준다 */
export async function progressOfMembers(memberIds: readonly string[]): Promise<ProgressMatrix> {
  if (supabase === undefined || memberIds.length === 0) return new Map();
  const { data } = await supabase.from("progress").select("user_id,lesson_id").in("user_id", [...memberIds]);
  const matrix = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const userId = String(row["user_id"]);
    const set = matrix.get(userId) ?? new Set<string>();
    set.add(String(row["lesson_id"]));
    matrix.set(userId, set);
  }
  return matrix;
}

/** 반 학생들의 최근 실패 시도를 조건별로 묶는다 — "어디서 막히는가" 분석용 */
export async function failedCheckStats(memberIds: readonly string[]): Promise<FailedCheckStat[]> {
  if (supabase === undefined || memberIds.length === 0) return [];
  const { data } = await supabase.from("attempts").select("lesson_id,failed_checks").in("user_id", [...memberIds]).eq("ok", false).order("created_at", { ascending: false }).limit(200);
  const stats = new Map<string, FailedCheckStat>();
  for (const row of data ?? []) {
    const lessonId = String(row["lesson_id"]);
    const labels = row["failed_checks"];
    for (const label of Array.isArray(labels) ? labels : []) {
      const key = `${lessonId}|${String(label)}`;
      stats.set(key, { lessonId, label: String(label), count: (stats.get(key)?.count ?? 0) + 1 });
    }
  }
  return [...stats.values()].sort((a, b) => b.count - a.count);
}

// ── 학생 ────────────────────────────────────────────────

/** 참가 코드로 반에 들어간다 — 성공하면 null */
export async function joinClassByCode(code: string): Promise<string | null> {
  if (supabase === undefined) return "로그인이 필요해요";
  const { error } = await supabase.rpc("join_class", { code: code.trim().toLowerCase() });
  return error === null ? null : error.message.includes("invalid join code") ? "코드가 맞지 않아요" : error.message;
}

/** 내가 들어간 반 목록 */
export async function listJoinedClasses(session: EduSession): Promise<EduClass[]> {
  if (!ready(session)) return [];
  const { data } = await supabase!
    .from("class_members")
    .select("classes(id,name,join_code)")
    .eq("user_id", session.id);
  return (data ?? [])
    .map((row) => {
      const raw = row["classes"] as unknown;
      const cls = (Array.isArray(raw) ? raw[0] : raw) as { id: string; name: string; join_code: string } | null | undefined;
      return cls == null ? null : { id: String(cls.id), name: String(cls.name), joinCode: String(cls.join_code), memberCount: 0 };
    })
    .filter((cls): cls is EduClass => cls !== null);
}

/** 여러 반의 과제 목록 */
export async function listAssignments(classIds: readonly string[]): Promise<Assignment[]> {
  if (supabase === undefined || classIds.length === 0) return [];
  const { data } = await supabase.from("assignments").select("id,class_id,lesson_id,due_at").in("class_id", [...classIds]).order("created_at");
  return (data ?? []).map((row) => ({
    id: String(row["id"]),
    classId: String(row["class_id"]),
    lessonId: String(row["lesson_id"]),
    dueAt: row["due_at"] === null ? null : String(row["due_at"]),
  }));
}

/** 채점 시도를 기록한다 — 막힘 분석과 선생님 진도에 쓰인다 */
export function recordAttempt(lessonId: string, result: GradeResult, session: EduSession | null): void {
  if (!ready(session) || supabase === undefined) return;
  void supabase.from("attempts").insert({
    user_id: session!.id,
    lesson_id: lessonId,
    ok: result.ok,
    failed_checks: result.results.filter((checkResult) => !checkResult.ok).map((checkResult) => checkResult.detail),
  });
}
