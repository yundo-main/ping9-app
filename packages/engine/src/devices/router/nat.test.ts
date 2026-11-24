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

describe("정적 NAT와 변환 표", () => {
  test("`router/set-static-nat`는 바깥 주소를 안쪽 호스트로 고정 대응하고 `no`로 지운다", async () => {
    const sim = open();
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/1", nat: "outside" });
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/0", nat: "inside" });
    // 같은 주소·없는 대응 삭제는 거절된다
    expect(sim.dispatch({ type: "router/set-static-nat", deviceId: LAB.r1, insideIp: "10.0.12.1", outsideIp: "10.0.12.1" }))
      .toMatchObject({ ok: false, error: { code: "NAT_STATIC_SAME_ADDRESS" } });
    expect(sim.dispatch({ type: "router/set-static-nat", deviceId: LAB.r1, insideIp: "192.168.1.10", outsideIp: null }))
      .toMatchObject({ ok: false, error: { code: "NAT_STATIC_NOT_FOUND" } });
    // outside 인터페이스 주소(10.0.12.1)를 PC1에 고정 대응한다
    expect(sim.dispatch({ type: "router/set-static-nat", deviceId: LAB.r1, insideIp: "192.168.1.10", outsideIp: "10.0.12.1" }).ok).toBe(true);
    // 바깥 PC가 바깥 주소를 찌르면 안쪽 호스트에 도달한다 — 바인딩이 없어도 된다
    expect(success((await sim.console(LAB.pc2).exec("ping -n 1 10.0.12.1")).lines)).toHaveLength(1);
    const events = natEvents(sim);
    expect(events.some(event => event.reason?.code === "NAT_TRANSLATED" && event.reason.params.direction === "outside-to-inside" && event.reason.params.insideIp === "192.168.1.10")).toBe(true);
    expect(events.some(event => event.reason?.code === "NAT_TRANSLATED" && event.reason.params.direction === "inside-to-outside" && event.reason.params.outsideIp === "10.0.12.1")).toBe(true);
    // running-config에 남고 지우면 사라진다
    const con = sim.console(LAB.r1);
    await con.exec("enable");
    const running = await con.exec("show running-config");
    expect(running.lines.map(l => l.kind === "text" ? l.text : "").join("\n")).toContain("ip nat inside source static 192.168.1.10 10.0.12.1");
    for (const line of ["configure terminal", "no ip nat inside source static 192.168.1.10 10.0.12.1", "end"]) {
      expect((await con.exec(line)).lines.filter(l => l.kind === "error")).toEqual([]);
    }
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && (cleared.config.natStatics ?? [])).toHaveLength(0);
  });

  test("`show ip nat translations`는 static 대응과 동적 바인딩을 함께 보인다", async () => {
    const sim = open();
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/1", nat: "outside" });
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/0", nat: "inside" });
    const con = sim.console(LAB.r1);
    for (const line of ["enable", "configure terminal", "ip nat inside source static 192.168.1.99 10.0.12.9", "end"]) {
      expect((await con.exec(line)).lines.filter(l => l.kind === "error")).toEqual([]);
    }
    // PC1은 static 대응(.99)이 아니니 동적 바인딩이 생긴다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    const shown = (await con.exec("show ip nat translations")).lines.map(l => l.kind === "text" ? l.text : "").join("\n");
    expect(shown).toContain("192.168.1.99");   // static 행
    expect(shown).toContain("10.0.12.9");
    expect(shown).toContain("192.168.1.10");   // 동적 바인딩 행
    expect(shown).toContain("192.168.2.10");   // 상대방
  });
});

describe("linux·vyos 스타일 NAT", () => {
  const errors = (result: ConsoleResult) => result.lines.filter(line => line.kind === "error");
  const textOf = (result: ConsoleResult) => result.lines.flatMap(line => line.kind === "text" ? [line.text] : []).join("\n");

  test("linux 라우터의 `iptables -t nat` MASQUERADE는 outside 역할과 같고 `-S`/`-L`로 보인다", async () => {
    const sim = open();
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1, style: "linux" }).ok).toBe(true);
    const con = sim.console(LAB.r1);
    expect(errors(await con.exec("iptables -t nat -A POSTROUTING -o eth1 -j MASQUERADE"))).toEqual([]);
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.interfaces["GigabitEthernet0/1"]?.nat).toBe("outside");
    expect(textOf(await con.exec("iptables -t nat -S POSTROUTING"))).toContain("-A POSTROUTING -o eth1 -j MASQUERADE");
    expect(textOf(await con.exec("iptables -t nat -L POSTROUTING"))).toContain("MASQUERADE");
    // 실제 변환: 안쪽 PC의 ping 출발지가 eth1 주소로 바뀐다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.direction === "inside-to-outside" && event.reason.params.outsideIp === "10.0.12.1")).toBe(true);
    // -D로 지우면 역할이 사라진다
    expect(errors(await con.exec("iptables -t nat -D POSTROUTING -o eth1 -j MASQUERADE"))).toEqual([]);
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && cleared.config.interfaces["GigabitEthernet0/1"]?.nat).toBeUndefined();
  });

  test("vyos의 `nat source rule` masquerade는 commit 뒤 outside 역할이 되고, 반쪽 규칙은 거절된다", async () => {
    const sim = open();
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1, style: "vyos" }).ok).toBe(true);
    const con = sim.console(LAB.r1);
    for (const line of ["configure",
      "set nat source rule 10 outbound-interface eth1",
      "set nat source rule 10 translation address masquerade",
      "commit", "exit"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.interfaces["GigabitEthernet0/1"]?.nat).toBe("outside");
    expect(textOf(await con.exec("show configuration commands"))).toContain("nat source rule 10");
    // 변환도 동작한다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED")).toBe(true);
    // outbound-interface만 있는 반쪽 규칙은 commit이 거절한다
    expect(errors(await con.exec("configure"))).toEqual([]);
    expect(errors(await con.exec("set nat source rule 20 outbound-interface eth0"))).toEqual([]);
    expect(errors(await con.exec("commit")).length).toBeGreaterThan(0);
    await con.exec("exit discard");
  });
});

describe("linux·vyos 스타일의 정적 NAT", () => {
  const errors = (result: ConsoleResult) => result.lines.filter(line => line.kind === "error");
  const textOf = (result: ConsoleResult) => result.lines.flatMap(line => line.kind === "text" ? [line.text] : []).join("\n");

  test("linux의 DNAT 규칙은 정적 대응을 만들고 `-L`/`-S PREROUTING`에 보인다", async () => {
    const sim = open();
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/1", nat: "outside" });
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1, style: "linux" }).ok).toBe(true);
    const con = sim.console(LAB.r1);
    expect(errors(await con.exec("iptables -t nat -A PREROUTING -d 10.0.12.1 -j DNAT --to-destination 192.168.1.10"))).toEqual([]);
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.natStatics).toEqual([{ insideIp: "192.168.1.10", outsideIp: "10.0.12.1" }]);
    expect(textOf(await con.exec("iptables -t nat -S PREROUTING"))).toContain("-A PREROUTING -d 10.0.12.1 -j DNAT --to-destination 192.168.1.10");
    expect(textOf(await con.exec("iptables -t nat -L PREROUTING"))).toContain("DNAT");
    // 바깥 PC가 바깥 주소를 찌르면 안쪽 호스트에 도달한다
    expect(success((await sim.console(LAB.pc2).exec("ping -n 1 10.0.12.1")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.direction === "outside-to-inside" && event.reason.params.insideIp === "192.168.1.10")).toBe(true);
    expect(errors(await con.exec("iptables -t nat -D PREROUTING -d 10.0.12.1 -j DNAT --to-destination 192.168.1.10"))).toEqual([]);
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && (cleared.config.natStatics ?? [])).toHaveLength(0);
  });

  test("vyos의 DNAT·SNAT 규칙 쌍은 commit 뒤 정적 대응이 되고 왕복으로 보인다", async () => {
    const sim = open();
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1, style: "vyos" }).ok).toBe(true);
    const con = sim.console(LAB.r1);
    for (const line of ["configure",
      "set nat destination rule 100 inbound-interface eth1",
      "set nat destination rule 100 destination address 10.0.12.1",
      "set nat destination rule 100 translation address 192.168.1.10",
      "set nat source rule 100 outbound-interface eth1",
      "set nat source rule 100 source address 192.168.1.10",
      "set nat source rule 100 translation address 10.0.12.1",
      "commit", "exit"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.interfaces["GigabitEthernet0/1"]?.nat).toBe("outside");
    expect(configured?.kind === "router" && configured.config.natStatics).toEqual([{ insideIp: "192.168.1.10", outsideIp: "10.0.12.1" }]);
    // 왕복 설정: 지우고 다시 들어가도 같은 규칙이 나온다
    for (const line of ["configure", "delete nat", "commit", "exit"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && (cleared.config.natStatics ?? [])).toHaveLength(0);
    const shown = textOf(await con.exec("show configuration commands"));
    expect(shown).not.toContain("nat destination rule");
    // outside 인터페이스만 남겨두고 정적만 돌려놓으면 source rule로도 같은 대응이 된다
    for (const line of ["configure",
      "set nat source rule 10 outbound-interface eth1", "set nat source rule 10 translation address masquerade",
      "set nat source rule 100 outbound-interface eth1", "set nat source rule 100 source address 192.168.1.10",
      "set nat source rule 100 translation address 10.0.12.1", "commit", "exit"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    const restored = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(restored?.kind === "router" && restored.config.natStatics).toEqual([{ insideIp: "192.168.1.10", outsideIp: "10.0.12.1" }]);
  });
});
