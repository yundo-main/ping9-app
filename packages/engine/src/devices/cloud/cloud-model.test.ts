// T0.68: 인터넷 클라우드 — 포트별 고정 /30 링크망에서 ARP, 전달(TTL--), 자기 주소 응답을 본다
import { cloudPortInfo, validateDocument, validateTrace } from "@ping9/shared";
import type { ConsoleResult } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createSimulator } from "../../simulator";
import type { Simulator } from "../../simulator";

const text = (result: ConsoleResult) => result.lines.map(line => line.kind === "text" ? line.text : "").join("\n");
const success = (result: ConsoleResult) => result.lines.filter(line => line.kind === "text" && line.text.includes("bytes=32"));

const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const PC1 = id(1);
const PC2 = id(2);
const CLOUD = id(3);

/** PC1──cloud Port0, PC2──cloud Port1. PC는 각 포트 /30의 상대 주소를 쓰고 게이트웨이는 클라우드 쪽이다 */
async function open(): Promise<Simulator> {
  const sim = createSimulator();
  for (const [deviceId, kind] of [[PC1, "pc"], [PC2, "pc"], [CLOUD, "cloud"]] as const) {
    expect(sim.dispatch({ type: "device/add", id: deviceId, kind, position: { x: 0, y: 0 } }).ok).toBe(true);
  }
  const link = (idSuffix: number, pc: string, cloudPort: string) =>
    sim.dispatch({ type: "link/add", id: id(idSuffix), ends: [{ deviceId: pc, port: "Ethernet0" }, { deviceId: CLOUD, port: cloudPort }] });
  expect(link(10, PC1, "Port0").ok).toBe(true);
  expect(link(11, PC2, "Port1").ok).toBe(true);
  expect(validateDocument(sim.getSnapshot().document).ok).toBe(true);
  for (const [deviceId, index] of [[PC1, 0], [PC2, 1]] as const) {
    const { mask, cloudIp, peerIp } = cloudPortInfo(index);
    expect(sim.dispatch({ type: "pc/set-ip", deviceId, ip: peerIp, mask, gateway: cloudIp }).ok).toBe(true);
  }
  return sim;
}

describe("인터넷 클라우드 (T0.68)", () => {
  test("포트마다 1.0.0.0/8을 자른 /30 링크망이 고정 배정된다", () => {
    expect(cloudPortInfo(0)).toEqual({ network: "1.0.0.0", mask: "255.255.255.252", cloudIp: "1.0.0.1", peerIp: "1.0.0.2" });
    expect(cloudPortInfo(3)).toEqual({ network: "1.0.0.12", mask: "255.255.255.252", cloudIp: "1.0.0.13", peerIp: "1.0.0.14" });
  });

  test("붙은 PC 둘 사이를 TTL을 줄여 전달한다", async () => {
    const sim = await open();
    const result = await sim.console(PC1).exec(`ping ${cloudPortInfo(1).peerIp}`);
    expect(success(result)).toHaveLength(4);
    // PC의 TTL 128이 클라우드를 지나며 127로 줄어 응답에 보인다
    expect(text(result)).toContain("TTL=127");
    for (const summary of sim.getSnapshot().traces) {
      expect(validateTrace(sim.getTrace(summary.id)).ok).toBe(true);
      const codes = sim.getTrace(summary.id)!.events.map(event => event.reason.code);
      expect(codes).toContain("IPV4_FORWARDED");
    }
  });

  test("반대 방향도 같은 규칙으로 돌아온다", async () => {
    const sim = await open();
    const result = await sim.console(PC2).exec(`ping -n 1 ${cloudPortInfo(0).peerIp}`);
    expect(success(result)).toHaveLength(1);
  });

  test("자기 포트 주소는 로컬 도착이라 echo 요청에 직접 응답한다", async () => {
    const sim = await open();
    const result = await sim.console(PC1).exec(`ping -n 1 ${cloudPortInfo(0).cloudIp}`);
    expect(success(result)).toHaveLength(1);
    expect(text(result)).toContain("TTL=64");
  });

  test("어느 포트의 상대 주소도 아니면 Destination host unreachable이다", async () => {
    const sim = await open();
    const result = await sim.console(PC1).exec("ping -n 1 8.8.8.8");
    expect(success(result)).toHaveLength(0);
  });

  test("콘솔은 없다 — 어떤 명령도 알 수 없는 명령이다", async () => {
    const sim = await open();
    const console_ = sim.console(CLOUD);
    expect(console_.prompt()).toBe("CLOUD1>");
    expect((await console_.exec("show ip route")).lines.some(line => line.kind === "error")).toBe(true);
  });

  test("배운 ARP는 표 보기에 나오고 리셋하면 비워진다", async () => {
    const sim = await open();
    await sim.console(PC1).exec(`ping -n 1 ${cloudPortInfo(1).peerIp}`);
    const view = sim.getSnapshot().views[CLOUD];
    expect(view?.kind).toBe("cloud");
    if (view?.kind !== "cloud") return;
    expect(view.arpTable.length).toBeGreaterThan(0);
    sim.resetSimulation();
    const cleared = sim.getSnapshot().views[CLOUD];
    expect(cleared?.kind === "cloud" ? cleared.arpTable : ["unexpected"]).toEqual([]);
  });
});
