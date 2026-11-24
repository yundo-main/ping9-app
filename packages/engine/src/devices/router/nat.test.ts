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

describe("동적 NAT와 overload (T16.3)", () => {
  const errors = (result: ConsoleResult) => result.lines.filter(line => line.kind === "error");
  const textOf = (result: ConsoleResult) => result.lines.flatMap(line => line.kind === "text" ? [line.text] : []).join("\n");
  const setup = async (sim: ReturnType<typeof open>) => {
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/1", nat: "outside" });
    sim.dispatch({ type: "interface/set-nat", deviceId: LAB.r1, port: "GigabitEthernet0/0", nat: "inside" });
    const con = sim.console(LAB.r1);
    for (const line of ["enable", "configure terminal"]) {
      expect(errors(await con.exec(line))).toEqual([]);
    }
    return con;
  };

  test("`ip nat inside source list` 풀 규칙은 안쪽 호스트를 풀 주소에 1:1로 대응한다", async () => {
    const sim = open();
    const con = await setup(sim);
    // R2가 풀 주소로 돌아올 수 있게 경로를 준다 — 풀은 R1이 proxy ARP로 받는 주소다
    expect(sim.dispatch({ type: "route/add", deviceId: LAB.r2, network: "203.0.113.0", mask: "255.255.255.0", nextHop: "10.0.12.1" }).ok).toBe(true);
    for (const line of [
      "ip nat pool CORP 203.0.113.10 203.0.113.20 netmask 255.255.255.0",
      "access-list 1 permit 192.168.1.0 0.0.0.255",
      "ip nat inside source list 1 pool CORP",
      "end",
    ]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    const events = natEvents(sim);
    expect(events.some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.direction === "inside-to-outside" &&
      event.reason.params.insideIp === "192.168.1.10" && event.reason.params.outsideIp === "203.0.113.10")).toBe(true);
    expect(events.some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.direction === "outside-to-inside" &&
      event.reason.params.insideIp === "192.168.1.10" && event.reason.params.outsideIp === "203.0.113.10")).toBe(true);
    // 1:1 대응은 포트 없이 보이고, running-config에 세 줄이 남는다
    const shown = textOf(await con.exec("show ip nat translations"));
    expect(shown).toContain("203.0.113.10");
    expect(shown).toContain("192.168.1.10");
    const running = textOf(await con.exec("show running-config"));
    expect(running).toContain("ip nat pool CORP 203.0.113.10 203.0.113.20 netmask 255.255.255.0");
    expect(running).toContain("access-list 1 permit 192.168.1.0 0.0.0.255");
    expect(running).toContain("ip nat inside source list 1 pool CORP");
  });

  test("`interface <iface> overload`는 그 인터페이스 주소로 포트를 나눠 쓰고, ACL이 맞지 않으면 변환하지 않는다", async () => {
    const sim = open();
    const con = await setup(sim);
    for (const line of [
      "access-list 1 permit 192.168.1.0 0.0.0.255",
      "ip nat inside source list 1 interface gi0/1 overload",
      "end",
    ]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    // 192.168.1.10은 ACL 1을 허락받아 10.0.12.1로 PAT된다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.outsideIp === "10.0.12.1")).toBe(true);
    // 다른 네트워크만 허락하는 ACL을 쓰는 규칙은 PC1을 변환하지 않는다 — 변환 없이 지나간다
    const before = new Set(sim.getSnapshot().traces.map(summary => summary.id));
    for (const line of ["configure terminal",
      "access-list 9 permit 10.9.9.0 0.0.0.255",
      "ip nat inside source list 9 interface gi0/1 overload",
      "no ip nat inside source list 1 interface gi0/1",
      "end"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    const newEvents = sim.getSnapshot().traces.filter(summary => !before.has(summary.id)).flatMap(summary =>
      (sim.getTrace(summary.id)?.events ?? []).filter(event => event.reason?.code === "NAT_TRANSLATED"));
    expect(newEvents).toHaveLength(0);
    // `show access-lists`에 목록이 보인다
    const shown = textOf(await con.exec("show access-lists"));
    expect(shown).toContain("Standard IP access list 9");
    expect(shown).toContain("permit 10.9.9.0, wildcard bits 0.0.0.255");
  });

  test("`pool <name> overload`는 풀 주소로 PAT하고, 쓰는 중인 풀은 지울 수 없다", async () => {
    const sim = open();
    const con = await setup(sim);
    expect(sim.dispatch({ type: "route/add", deviceId: LAB.r2, network: "203.0.113.0", mask: "255.255.255.0", nextHop: "10.0.12.1" }).ok).toBe(true);
    for (const line of [
      "ip nat pool CORP 203.0.113.10 203.0.113.20 netmask 255.255.255.0",
      "access-list 1 permit 192.168.1.0 0.0.0.255",
      "ip nat inside source list 1 pool CORP overload",
      "end",
    ]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.outsideIp === "203.0.113.10")).toBe(true);
    const shown = textOf(await con.exec("show ip nat translations"));
    expect(shown).toContain("203.0.113.10");
    // 쓰는 중인 풀은 지우지 못한다 — 규칙을 지운 뒤에야 지워진다
    await con.exec("configure terminal");
    expect(errors(await con.exec("no ip nat pool CORP")).length).toBeGreaterThan(0);
    expect(errors(await con.exec("no ip nat inside source list 1 pool CORP"))).toEqual([]);
    expect(errors(await con.exec("no ip nat pool CORP"))).toEqual([]);
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && (cleared.config.natPools ?? [])).toHaveLength(0);
    expect(cleared?.kind === "router" && (cleared.config.natSources ?? [])).toHaveLength(0);
  });

  test("설정 검증: 없는 풀·범위 밖 ACL 번호·잘못된 풀 범위·없는 규칙 삭제는 거절된다", async () => {
    const sim = open();
    const con = await setup(sim);
    for (const line of [
      "ip nat inside source list 1 pool NOPE",            // 없는 풀
      "access-list 100 permit any",                       // 1-99 밖
      "ip nat pool BAD 10.0.0.10 10.0.0.5 netmask 255.255.255.0", // 뒤집힌 범위
      "ip nat inside source list 77 pool CORP",           // 아직 풀도 규칙도 없음
      "no ip nat inside source list 77 pool CORP",        // 없는 규칙 삭제
      "no access-list 9",                                 // 없는 ACL 삭제
    ]) {
      expect(errors(await con.exec(line)), line).not.toEqual([]);
    }
    // 정상 입력은 받아들인다 — interface 규칙은 약어 인터페이스 이름도 풀어준다
    expect(errors(await con.exec("ip nat pool CORP 203.0.113.10 203.0.113.20 netmask 255.255.255.0"))).toEqual([]);
    expect(errors(await con.exec("ip nat inside source list 1 interface Gi0/1 overload"))).toEqual([]);
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.natSources).toEqual([
      { listId: 1, interface: "GigabitEthernet0/1", overload: true },
    ]);
  });
});

describe("linux·vyos 스타일의 동적 NAT·overload (T16.3)", () => {
  const errors = (result: ConsoleResult) => result.lines.filter(line => line.kind === "error");
  const textOf = (result: ConsoleResult) => result.lines.flatMap(line => line.kind === "text" ? [line.text] : []).join("\n");

  test("linux의 SNAT 범위 규칙은 동적 NAT가 되고 스코프 MASQUERADE는 overload가 된다", async () => {
    const sim = open();
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1, style: "linux" }).ok).toBe(true);
    expect(sim.dispatch({ type: "route/add", deviceId: LAB.r2, network: "203.0.113.0", mask: "255.255.255.0", nextHop: "10.0.12.1" }).ok).toBe(true);
    const con = sim.console(LAB.r1);
    // -o eth1에 SNAT 범위 → outside 표시와 natSources 규칙이 함께 생긴다
    expect(errors(await con.exec("iptables -t nat -A POSTROUTING -s 192.168.1.0/24 -o eth1 -j SNAT --to-source 203.0.113.10-203.0.113.20"))).toEqual([]);
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.natSources).toEqual([
      { network: "192.168.1.0", wildcard: "0.0.0.255", poolStart: "203.0.113.10", poolEnd: "203.0.113.20", overload: false },
    ]);
    expect(configured?.kind === "router" && configured.config.interfaces["GigabitEthernet0/1"]?.nat).toBe("outside");
    // 1:1 변환 — 포트는 그대로고 주소는 풀의 첫 주소다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.outsideIp === "203.0.113.10")).toBe(true);
    // -S에 규칙이 보이고 -D로 지운다
    expect(textOf(await con.exec("iptables -t nat -S POSTROUTING"))).toContain("-A POSTROUTING -s 192.168.1.0/24 -o eth1 -j SNAT --to-source 203.0.113.10-203.0.113.20");
    expect(errors(await con.exec("iptables -t nat -D POSTROUTING -s 192.168.1.0/24 -o eth1 -j SNAT --to-source 203.0.113.10-203.0.113.20"))).toEqual([]);
    const cleared = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(cleared?.kind === "router" && (cleared.config.natSources ?? [])).toHaveLength(0);
    // 스코프 MASQUERADE: 그 범위만 인터페이스 주소로 PAT한다
    expect(errors(await con.exec("iptables -t nat -A POSTROUTING -s 10.9.9.0/24 -o eth1 -j MASQUERADE"))).toEqual([]);
    const scoped = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(scoped?.kind === "router" && scoped.config.natSources).toEqual([
      { network: "10.9.9.0", wildcard: "0.0.0.255", interface: "GigabitEthernet0/1", overload: true },
    ]);
  });

  test("vyos의 범위 translation은 commit 뒤 동적 NAT 규칙이 되고 왕복으로 보인다", async () => {
    const sim = open();
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1, style: "vyos" }).ok).toBe(true);
    expect(sim.dispatch({ type: "route/add", deviceId: LAB.r2, network: "203.0.113.0", mask: "255.255.255.0", nextHop: "10.0.12.1" }).ok).toBe(true);
    const con = sim.console(LAB.r1);
    for (const line of ["configure",
      "set nat source rule 500 outbound-interface eth1",
      "set nat source rule 500 source address 192.168.1.0/24",
      "set nat source rule 500 translation address 203.0.113.10-203.0.113.20",
      "commit", "exit"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    const configured = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(configured?.kind === "router" && configured.config.natSources).toEqual([
      { network: "192.168.1.0", wildcard: "0.0.0.255", poolStart: "203.0.113.10", poolEnd: "203.0.113.20", overload: false },
    ]);
    // 동작 확인 — 안쪽 호스트가 풀 주소로 변환된다
    expect(success((await sim.console(LAB.pc1).exec("ping -n 1 192.168.2.10")).lines)).toHaveLength(1);
    expect(natEvents(sim).some(event => event.reason?.code === "NAT_TRANSLATED" &&
      event.reason.params.outsideIp === "203.0.113.10")).toBe(true);
    // 왕복: 설정을 다시 그리면 같은 규칙이 나온다
    const shown = textOf(await con.exec("show configuration commands"));
    expect(shown).toContain("set nat source rule 500 outbound-interface");
    expect(shown).toContain("set nat source rule 500 source address '192.168.1.0/24'");
    expect(shown).toContain("set nat source rule 500 translation address '203.0.113.10-203.0.113.20'");
    // overload은 translation port로 표현한다
    for (const line of ["configure", "set nat source rule 500 translation port 1-65535", "commit", "exit"]) {
      expect(errors(await con.exec(line)), line).toEqual([]);
    }
    const overloaded = sim.getSnapshot().document.devices.find(d => d.id === LAB.r1);
    expect(overloaded?.kind === "router" && overloaded.config.natSources?.[0]?.overload).toBe(true);
    const reshown = textOf(await con.exec("show configuration commands"));
    expect(reshown).toContain("set nat source rule 500 translation port '1-65535'");
  });
});
