// IOS 라우터의 루프백 인터페이스 (T0.57). 공개 인터페이스(createSimulator)로만 확인한다.
// 토폴로지: PC1 — R1. R1에 Loopback0 10.255.255.1/32를 만들고 ping·show·running-config를 본다.
import { validateTrace } from "@ping9/shared";
import type { Command, ConsoleResult } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createSimulator } from "../simulator";

const PC1 = "11111111-1111-4111-8111-111111111111";
const RTR = "33333333-3333-4333-8333-333333333333";
const LINK1 = "55555555-5555-4555-8555-555555555555";

const texts = (result: ConsoleResult): string[] =>
  result.lines.flatMap((line) => (line.kind === "text" ? [line.text] : []));

async function lab() {
  const sim = createSimulator();
  const must = (command: unknown) => expect(sim.dispatch(command as Command)).toMatchObject({ ok: true });
  must({ type: "device/add", id: PC1, kind: "pc", position: { x: 0, y: 0 }, os: "linux" });
  must({ type: "device/add", id: RTR, kind: "router", position: { x: 200, y: 0 } });
  must({ type: "link/add", id: LINK1, ends: [{ deviceId: PC1, port: "Ethernet0" }, { deviceId: RTR, port: "GigabitEthernet0/0" }] });
  must({ type: "pc/set-ip", deviceId: PC1, ip: "10.0.1.10", mask: "255.255.255.0", gateway: "10.0.1.1" });
  must({ type: "interface/set-ip", deviceId: RTR, port: "GigabitEthernet0/0", ip: "10.0.1.1", mask: "255.255.255.0" });
  must({ type: "interface/set-admin", deviceId: RTR, port: "GigabitEthernet0/0", adminUp: true });
  const pc = (line: string) => sim.console(PC1).exec(line);
  const rtr = (line: string) => sim.console(RTR).exec(line);
  const makeLoopback = async (name: string, ip: string, mask: string) => {
    await rtr("enable");
    await rtr("configure terminal");
    await rtr(`interface ${name}`);
    await rtr(`ip address ${ip} ${mask}`);
    await rtr("end");
  };
  return { sim, must, pc, rtr, makeLoopback };
}

describe("루프백 인터페이스", () => {
  test("interface loopback0로 만들면 켜진 상태로 생기고 ip address를 단다", async () => {
    const { sim, rtr } = await lab();
    await rtr("enable");
    await rtr("configure terminal");
    await rtr("interface loopback0");
    await rtr("ip address 10.255.255.1 255.255.255.255");
    await rtr("end");
    const router = sim.getSnapshot().document.devices.find(d => d.id === RTR)!;
    if (router.kind !== "router") throw new Error("router expected");
    expect(router.config.loopbacks).toEqual({ Loopback0: { adminUp: true, ip: "10.255.255.1", mask: "255.255.255.255" } });
  });

  test("줄임 이름 int lo0도 Loopback0으로 읽힌다", async () => {
    const { sim, rtr } = await lab();
    await rtr("enable");
    await rtr("configure terminal");
    await rtr("int lo0");
    expect(sim.console(RTR).prompt()).toBe("R1(config-if)#");
  });

  test("PC에서 루프백 주소로 ping이 된다", async () => {
    const { sim, pc, makeLoopback } = await lab();
    await makeLoopback("loopback0", "10.255.255.1", "255.255.255.255");
    const result = await pc("ping 10.255.255.1");
    expect(texts(result).join("\n")).toContain("10.255.255.1");
    expect(texts(result).join("\n")).toMatch(/from 10.255.255.1/);
    const trace = sim.getTrace(sim.getSnapshot().traces[0]!.id)!;
    expect(validateTrace(trace)).toMatchObject({ ok: true });
  });

  test("라우터에서 자기 루프백으로 ping은 링크를 지나지 않는다", async () => {
    const { sim, rtr, makeLoopback } = await lab();
    await makeLoopback("loopback0", "10.255.255.1", "255.255.255.255");
    const result = await rtr("ping 10.255.255.1");
    expect(texts(result).join("\n")).toMatch(/Reply from 10.255.255.1/);
    expect(sim.getSnapshot().traces.length).toBe(0);
  });

  test("show ip interface brief와 running-config에 루프백이 나온다", async () => {
    const { rtr, makeLoopback } = await lab();
    await makeLoopback("loopback0", "10.255.255.1", "255.255.255.255");
    const brief = texts(await rtr("show ip interface brief")).join("\n");
    expect(brief).toContain("Loopback0");
    expect(brief).toContain("10.255.255.1");
    const config = texts(await rtr("show running-config")).join("\n");
    expect(config).toContain("interface Loopback0");
    expect(config).toContain(" ip address 10.255.255.1 255.255.255.255");
  });

  test("no interface loopback0으로 지우면 brief에서 사라진다", async () => {
    const { rtr, makeLoopback } = await lab();
    await makeLoopback("loopback0", "10.255.255.1", "255.255.255.255");
    await rtr("configure terminal");
    await rtr("no interface loopback0");
    await rtr("end");
    const brief = texts(await rtr("show ip interface brief")).join("\n");
    expect(brief).not.toContain("Loopback0");
  });

  test("shutdown한 루프백은 ping이 안 된다", async () => {
    const { pc, rtr, makeLoopback } = await lab();
    await makeLoopback("loopback0", "10.255.255.1", "255.255.255.255");
    await rtr("configure terminal");
    await rtr("interface loopback0");
    await rtr("shutdown");
    await rtr("end");
    const result = await pc("ping 10.255.255.1");
    expect(texts(result).join("\n")).not.toMatch(/Reply from 10.255.255.1/);
  });

  test("만들지 않은 루프백도 interface 명령으로 들어가면 자동으로 생긴다", async () => {
    const { sim, rtr } = await lab();
    await rtr("enable");
    await rtr("configure terminal");
    await rtr("interface loopback2");
    const router = sim.getSnapshot().document.devices.find(d => d.id === RTR)!;
    if (router.kind !== "router") throw new Error("router expected");
    expect(router.config.loopbacks?.Loopback2).toMatchObject({ adminUp: true });
  });

  test("VyOS·Linux 라우터는 루프백 명령이 없다", async () => {
    const { sim, must, rtr } = await lab();
    must({ type: "router/set-cli-style", deviceId: RTR, style: "vyos" });
    await rtr("configure");
    expect(texts(await rtr("interface loopback0")).join("\n")).not.toContain("Loopback0");
    const router = sim.getSnapshot().document.devices.find(d => d.id === RTR)!;
    if (router.kind !== "router") throw new Error("router expected");
    expect(router.config.loopbacks).toBeUndefined();
  });
});
