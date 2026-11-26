import { describe, expect, test } from "vitest";
import { LESSONS } from "./lessons";
import { checkSchema, defineLesson, isReasonCode, lessonSchema } from "./lesson";

describe("레슨 스키마 (E1)", () => {
  test("내장 레슨이 스키마를 통과한다", () => {
    for (const lesson of LESSONS) {
      expect(() => lessonSchema.parse(lesson)).not.toThrow();
      // trace 체크의 코드가 진짜 엔진 이유 코드다 — 오타는 여기서 잡힌다
      for (const check of lesson.checks) {
        if (check.kind === "trace") expect(isReasonCode(check.code), check.code).toBe(true);
      }
    }
  });

  test("checks가 비어 있으면 거부된다", () => {
    const lesson = LESSONS[0]!;
    expect(() => defineLesson({ ...lesson, checks: [] })).toThrow();
  });

  test("잘못된 토폴로지는 거부된다", () => {
    const lesson = LESSONS[0]!;
    const broken = { ...lesson, startDocument: { ...lesson.startDocument, schemaVersion: 2 } };
    expect(() => defineLesson(broken as typeof lesson)).toThrow();
  });

  test("모든 check 종류가 스키마에 있다", () => {
    for (const check of [
      { kind: "ping", from: "PC1", to: "192.168.1.20" },
      { kind: "route", device: "R1", network: "10.0.0.0" },
      { kind: "trace", code: "ARP_REQUEST_SENT" },
      { kind: "link", a: { device: "PC1", port: "Ethernet0" }, b: { device: "SW1", port: "FastEthernet0/1" } },
      { kind: "ip", device: "PC1", port: "Ethernet0", ip: "192.168.1.10", mask: "255.255.255.0" },
    ]) {
      expect(() => checkSchema.parse(check)).not.toThrow();
    }
    expect(() => checkSchema.parse({ kind: "quiz", question: "?" })).toThrow();
  });
});
