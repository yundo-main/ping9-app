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
    expect(cloudPortInfo(2)).toEqual({ network: "1.0.0.8", mask: "255.255.255.252", cloudIp: "1.0.0.9", peerIp: "1.0.0.10" });
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

describe("클라우드 내부 RIP (T0.69)", () => {
  const R1 = id(20);
  const R2 = id(21);

  const PCA = id(4);
  const PCB = id(5);

  /** PCA──R1──cloud Port0, R2──cloud Port1──PCB의 뒤로 PCB. 각 라우터는 링크 주소 + PC가 붙은 LAN을 갖고 RIP를 켠다 */
  async function ripLab(): Promise<Simulator> {
    const sim = createSimulator();
    for (const [deviceId, kind] of [[R1, "router"], [R2, "router"], [CLOUD, "cloud"], [PCA, "pc"], [PCB, "pc"]] as const) {
      expect(sim.dispatch({ type: "device/add", id: deviceId, kind, position: { x: 0, y: 0 } }).ok).toBe(true);
    }
    const link = (idSuffix: number, router: string, cloudPort: string) =>
      sim.dispatch({ type: "link/add", id: id(idSuffix), ends: [{ deviceId: router, port: "GigabitEthernet0/0" }, { deviceId: CLOUD, port: cloudPort }] });
    expect(link(30, R1, "Port0").ok).toBe(true);
    expect(link(31, R2, "Port1").ok).toBe(true);
    // LAN 인터페이스에 장비가 붙어야 그 네트워크가 라우팅 테이블에 올라 광고된다 (no-link면 광고하지 않는다)
    const lanLink = (idSuffix: number, router: string, pc: string) =>
      sim.dispatch({ type: "link/add", id: id(idSuffix), ends: [{ deviceId: router, port: "GigabitEthernet0/1" }, { deviceId: pc, port: "Ethernet0" }] });
    expect(lanLink(32, R1, PCA).ok).toBe(true);
    expect(lanLink(33, R2, PCB).ok).toBe(true);
    for (const [router, transitIp, lanIp, pc, pcIp] of [
      [R1, cloudPortInfo(0).peerIp, "192.168.1.1", PCA, "192.168.1.10"],
      [R2, cloudPortInfo(1).peerIp, "192.168.2.1", PCB, "192.168.2.10"],
    ] as const) {
      expect(sim.dispatch({ type: "interface/set-ip", deviceId: router, port: "GigabitEthernet0/0", ip: transitIp, mask: "255.255.255.252" }).ok).toBe(true);
      expect(sim.dispatch({ type: "interface/set-admin", deviceId: router, port: "GigabitEthernet0/0", adminUp: true }).ok).toBe(true);
      expect(sim.dispatch({ type: "interface/set-ip", deviceId: router, port: "GigabitEthernet0/1", ip: lanIp, mask: "255.255.255.0" }).ok).toBe(true);
      expect(sim.dispatch({ type: "interface/set-admin", deviceId: router, port: "GigabitEthernet0/1", adminUp: true }).ok).toBe(true);
      expect(sim.dispatch({ type: "router/set-ip-forward", deviceId: router, enabled: true }).ok).toBe(true);
      expect(sim.dispatch({ type: "pc/set-ip", deviceId: pc, ip: pcIp, mask: "255.255.255.0", gateway: lanIp }).ok).toBe(true);
    }
    return sim;
  }

  test("RIP를 켠 라우터의 LAN을 배우고 다른 포트로 다시 광고한다", async () => {
    const sim = await ripLab();
    for (const [router, lan] of [[R1, "192.168.1.0"], [R2, "192.168.2.0"]] as const) {
      expect(sim.dispatch({ type: "rip/enable", deviceId: router }).ok).toBe(true);
      // dispatch마다 경로 교환이 도는 동안 클라우드도 Request/Response를 주고받는다
      expect(sim.dispatch({ type: "rip/add-network", deviceId: router, network: "1.0.0.0" }).ok).toBe(true);
      expect(sim.dispatch({ type: "rip/add-network", deviceId: router, network: lan }).ok).toBe(true);
    }
    // 클라우드가 양쪽 LAN을 배웠다
    const cloud = sim.getSnapshot().views[CLOUD];
    expect(cloud?.kind).toBe("cloud");
    if (cloud?.kind !== "cloud") return;
    const learned = cloud.routes.filter(route => route.distance === 120);
    expect(learned.map(route => `${route.network} via ${route.nextHop}`).sort())
      .toEqual(["192.168.1.0 via 1.0.0.2", "192.168.2.0 via 1.0.0.6"]);
    // 라우터는 클라우드가 재광고한 상대 LAN을 배웠고, PC끼리도 통한다 — 정적 경로가 하나도 없어도
    for (const [router, lanIp] of [[R1, "192.168.2.1"], [R2, "192.168.1.1"]] as const) {
      const result = await sim.console(router).exec(`ping ${lanIp}`);
      expect(text(result)).toContain("Success rate: 4/4");
    }
    const pcResult = await sim.console(PCA).exec("ping -n 1 192.168.2.10");
    expect(success(pcResult)).toHaveLength(1);
  });

  test("같은 네트워크를 두 포트에서 배우면 먼저 온 경로가 우선된다", async () => {
    const sim = await ripLab();
    // R1(Port0)과 R2(Port1)가 둘 다 192.168.1.0/24를 광고한다 — Port0이 먼저라 우선경로가 된다
    expect(sim.dispatch({ type: "rip/enable", deviceId: R1 }).ok).toBe(true);
    expect(sim.dispatch({ type: "rip/add-network", deviceId: R1, network: "1.0.0.0" }).ok).toBe(true);
    expect(sim.dispatch({ type: "rip/add-network", deviceId: R1, network: "192.168.1.0" }).ok).toBe(true);
    expect(sim.dispatch({ type: "rip/enable", deviceId: R2 }).ok).toBe(true);
    expect(sim.dispatch({ type: "rip/add-network", deviceId: R2, network: "1.0.0.0" }).ok).toBe(true);
    expect(sim.dispatch({ type: "rip/add-network", deviceId: R2, network: "192.168.2.0" }).ok).toBe(true);
    expect(sim.dispatch({ type: "rip/add-network", deviceId: R2, network: "192.168.1.0" }).ok).toBe(true);
    const cloud = sim.getSnapshot().views[CLOUD];
    if (cloud?.kind !== "cloud") throw new Error("cloud view가 없다");
    const same = cloud.routes.filter(route => route.network === "192.168.1.0" && route.distance === 120);
    // 우선경로 하나만 남는다 — 같은 메트릭의 나중 광고는 받아들이지 않는다
    expect(same).toHaveLength(1);
    expect(same[0]!.port).toBe("Port0");
  });

  test("RIP를 켜지 않으면 /30 링크 주소까지만 닿는다", async () => {
    const sim = await ripLab();
    // RIP 없이는 상대 라우터의 LAN으로 가는 경로가 없다
    const result = await sim.console(R1).exec("ping -n 1 192.168.2.1");
    expect(success(result)).toHaveLength(0);
    const cloud = sim.getSnapshot().views[CLOUD];
    expect(cloud?.kind === "cloud" ? cloud.routes.filter(route => route.distance === 120) : ["unexpected"]).toEqual([]);
  });
});
