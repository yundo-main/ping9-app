// Router의 NAT (T16.2): inside에서 나가는 패킷의 출발지가 outside 인터페이스 주소로 바뀌고,
// 돌아오는 응답은 바인딩으로 안쪽 호스트에 되돌아간다.
import type { ConsoleResult } from "@ping9/shared";
import { ROUTER_LAB as LAB, staticRoutingLabDocument } from "@ping9/shared/examples";
import { describe, expect, test } from "vitest";
import { createSimulator } from "../../simulator";

const open = () => { const sim = createSimulator(); expect(sim.load(staticRoutingLabDocument).ok).toBe(true); return sim; };
const success = (lines: ConsoleResult["lines"]) =>
  lines.filter(line => line.kind === "text" && line.text.includes("bytes=32"));
const natEvents = (sim: ReturnType<typeof open>) => sim.getSnapshot().traces.flatMap(summary =>
  (sim.getTrace(summary.id)?.events ?? []).filter(event => event.reason?.code === "NAT_TRANSLATED"));

describe("NAT 주소 변환", () => {
  test("`interface/set-nat`는 라우터에만 있다. outside로 나가는 ping은 라우터 주소로 바뀌어 돌아온다", async () => {
    const sim = open();
    expect(sim.dispatch({ type: "interface/set-nat", deviceId: LAB.pc1, port: "Ethernet0", nat: "outside" })).toMatchObject({
      ok: false, error: { code: "DEVICE_KIND_MISMATCH" },
    });
    expect(sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "Gi0/1", nat: "outside" }).ok).toBe(false); // 없는 포트 이름
    expect(sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/1", nat: "outside" }).ok).toBe(true);
    expect(sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/0", nat: "inside" }).ok).toBe(true);

    const result = await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10");
    expect(success(result.lines)).toHaveLength(1);
    const events = natEvents(sim);
    expect(events.some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.direction === "inside-to-outside" &&
      event.reason.params.insideIp === "192.168.1.10" && event.reason.params.outsideIp === "10.0.12.1")).toBe(true);
    expect(events.some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.direction === "outside-to-inside" &&
      event.reason.params.insideIp === "192.168.1.10")).toBe(true);
  });

  test("NAT가 없으면 ping이 그냥 지나가고, 바깥에서 시작한 연결은 라우터가 받는다", async () => {
    const sim = open();
    // NAT 없이는 이미 통하는 경로다 — 변환 이벤트가 안 나온다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim)).toHaveLength(0);
    // 바깥 PC가 outside 인터페이스 주소를 직접 찌르면 라우터가 답한다 (바인딩 없음)
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/1", nat: "outside" });
    expect(success((await sim.console(LAB.pc2).exec("ping -n 1 10.0.12.1")).lines)).toHaveLength(1);
  });

  test("IOS의 `ip nat outside`와 `no ip nat outside`가 역할을 주고 지우며, running-config에 남는다", async () => {
    const sim = open();
    const con = sim.console(LAB.r1);
    for (const line of ["enable", "configure terminal", "interface gi0/1", "ip nat outside", "end"]) {
      expect((await con.exec(line)).lines.filter(l => l.kind === "error")).toEqual([]);
    }
    expect(sim.getSnapshot().document.devices.find(d => d.id === LAB.r1)).toMatchObject({
      kind: "router", config: { interfaces: { "GigabitEthernet0/1": { nat: "outside" } } },
    });
    const running = await con.exec("show running-config");
    expect(running.lines.map(l => l.kind === "text" ? l.text : "").join("\n")).toContain(" ip nat outside");
    for (const line of ["configure terminal", "interface gi0/1", "no ip nat outside", "end"]) {
      expect((await con.exec(line)).lines.filter(l => l.kind === "error")).toEqual([]);
    }
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && cleared.config.interfaces["GigabitEthernet0/1"]?.nat).toBeUndefined();
  });
});
