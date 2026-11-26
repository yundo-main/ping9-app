// 채점기 테스트 — N1 첫 레슨을 엔진에 올려 학생 행동(dispatch·콘솔)을 흉내내고 채점한다.

import { createSimulator } from "@ping9/engine";
import { describe, expect, test } from "vitest";
import { grade } from "./grader";
import { LESSONS } from "./lessons";

const n1FirstPing = LESSONS[0]!;

const PC1 = "11111111-1111-4111-8111-111111111111";
const PC2 = "33333333-3333-4333-8333-333333333333";

function open() {
  const sim = createSimulator();
  const result = sim.load(n1FirstPing.startDocument);
  expect(result.ok).toBe(true);
  return sim;
}

function configure(sim: ReturnType<typeof open>) {
  expect(sim.dispatch({ type: "pc/set-ip", deviceId: PC1, ip: "192.168.1.10", mask: "255.255.255.0", gateway: null }).ok).toBe(true);
  expect(sim.dispatch({ type: "pc/set-ip", deviceId: PC2, ip: "192.168.1.20", mask: "255.255.255.0", gateway: null }).ok).toBe(true);
}

describe("채점기 (E2)", () => {
  test("아무것도 안 한 상태면 불합격이다", async () => {
    const sim = open();
    const result = await grade(sim, n1FirstPing);
    expect(result.ok).toBe(false);
    // 주소 체크가 왜 안 됐는지 이유가 붙는다
    const ip = result.results.find((entry) => entry.check.kind === "ip");
    expect(ip?.ok).toBe(false);
    expect(ip?.detail).toContain("주소가 없어요");
  });

  test("주소만 주고 ping을 안 치면 trace 체크가 남는다", async () => {
    const sim = open();
    configure(sim);
    // 채점기의 ping은 학생이 직접 쳐야 하는 trace 체크를 가리지 않는다 — 레슨 순서상 trace가 ping보다 앞
    const result = await grade(sim, n1FirstPing);
    expect(result.ok).toBe(false);
    const trace = result.results.find((entry) => entry.check.kind === "trace");
    expect(trace?.ok).toBe(false);
  });

  test("주소 설정 + 학생 ping이면 합격이다", async () => {
    const sim = open();
    configure(sim);
    // 학생이 직접 ping을 친다 — ARP 추적이 남는다
    await sim.console(PC1).exec("ping -n 1 192.168.1.20");
    const result = await grade(sim, n1FirstPing);
    expect(result.ok).toBe(true);
    expect(result.results.map((entry) => entry.ok)).toEqual([true, true, true, true]);
  });

  test("한쪽 주소가 틀리면 그 체크만 불합격이다", async () => {
    const sim = open();
    configure(sim);
    expect(sim.dispatch({ type: "pc/set-ip", deviceId: PC2, ip: "192.168.2.20", mask: "255.255.255.0", gateway: null }).ok).toBe(true);
    await sim.console(PC1).exec("ping -n 1 192.168.1.20");
    const result = await grade(sim, n1FirstPing);
    expect(result.ok).toBe(false);
    const wrong = result.results.find((entry) => entry.check.kind === "ip" && entry.check.device === "PC2");
    expect(wrong?.ok).toBe(false);
    expect(wrong?.detail).toContain("192.168.2.20");
  });
});
