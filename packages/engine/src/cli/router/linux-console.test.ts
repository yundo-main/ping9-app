import { PORT_NAMES, validateDocument } from "@ping9/shared";
import { ROUTER_LAB as LAB, staticRoutingLabDocument } from "@ping9/shared/examples";
import { describe, expect, test } from "vitest";

import { createSimulator } from "../../index";
import type { ConsolePort, Simulator } from "../../index";

const ROUTER_ID = "00000000-0000-4000-8000-000000000200";
const GI0 = PORT_NAMES.router[0];

const text = (lines: readonly { readonly kind: string; readonly text?: string }[]) =>
  lines.map((line) => (line.kind === "text" ? line.text : "")).join("\n");

function open() {
  const simulator = createSimulator();
  expect(simulator.dispatch({ type: "device/add", id: ROUTER_ID, kind: "router", position: { x: 300, y: 200 } }).ok).toBe(true);
  expect(simulator.dispatch({ type: "router/set-cli-style", deviceId: ROUTER_ID, style: "linux" }).ok).toBe(true);
  return { simulator, port: simulator.console(ROUTER_ID) };
}

async function run(port: ConsolePort, ...lines: string[]) {
  let result = await port.exec("");
  for (const line of lines) result = await port.exec(line);
  return result;
}

function routerConfig(simulator: Simulator, deviceId = ROUTER_ID) {
  const device = simulator.getSnapshot().document.devices.find((candidate) => candidate.id === deviceId);
  if (device === undefined || device.kind !== "router") throw new Error("router not found");
  return device.config;
}

describe("리눅스 네이티브 라우터 콘솔 (T16.1)", () => {
  test("프롬프트는 root 셸이다", async () => {
    const { port } = open();
    expect(port.prompt()).toBe("root@R1:~#");
    expect((await port.exec("ip addr")).prompt).toBe("root@R1:~#");
  });

  test("ip addr은 물리 포트를 eth0~eth3으로 보인다", async () => {
    const { port } = open();
    const output = text((await run(port, "ip addr")).lines);
    for (const name of ["eth0", "eth1", "eth2", "eth3"]) expect(output).toContain(name);
    expect(output).not.toContain("GigabitEthernet");
    // 주소가 없고 꺼져 있는 처음 상태
    expect(output.match(/inet /g)).toHaveLength(1); // lo만
  });

  test("ip addr add와 del로 인터페이스 주소를 설정하고 지운다", async () => {
    const { simulator, port } = open();
    const added = await run(port, "ip addr add 10.0.0.1/24 dev eth0");
    expect(added.lines.filter((line) => line.kind === "error")).toEqual([]);
    expect(routerConfig(simulator).interfaces[GI0]).toMatchObject({ ip: "10.0.0.1", mask: "255.255.255.0" });
    expect(validateDocument(simulator.getSnapshot().document).ok).toBe(true);
    const output = text((await run(port, "ip addr show eth0")).lines);
    expect(output).toContain("inet 10.0.0.1/24 scope global eth0");
    await run(port, "ip addr del 10.0.0.1/24 dev eth0");
    expect(routerConfig(simulator).interfaces[GI0]?.ip).toBeUndefined();
  });

  test("ip link set으로 포트를 끄고 켠다", async () => {
    const { simulator, port } = open();
    expect(routerConfig(simulator).interfaces[GI0]?.adminUp ?? false).toBe(false);
    await run(port, "ip link set eth0 up");
    expect(routerConfig(simulator).interfaces[GI0]?.adminUp).toBe(true);
    // 케이블이 없으면 관리 상태만 켜지고 carrier는 없다 (실제와 같음)
    expect(text((await run(port, "ip link show eth0")).lines)).toContain("NO-CARRIER");
    await run(port, "ip link set eth0 down");
    expect(routerConfig(simulator).interfaces[GI0]?.adminUp).toBe(false);
    const eth0Line = text((await run(port, "ip link show eth0")).lines).split("\n").find((line) => line.includes("eth0:"));
    expect(eth0Line).toContain("<BROADCAST,MULTICAST> mtu 1500 state DOWN");
  });

  test("ip route로 정적 경로를 더하고 본다", async () => {
    const { simulator, port } = open();
    await run(port,
      "ip addr add 10.0.12.1/30 dev eth0",
      "ip link set eth0 up",
      "ip route add default via 10.0.12.2",
      "ip route add 192.168.2.0/24 via 10.0.12.2");
    expect(routerConfig(simulator).staticRoutes).toEqual([
      { network: "0.0.0.0", mask: "0.0.0.0", nextHop: "10.0.12.2" },
      { network: "192.168.2.0", mask: "255.255.255.0", nextHop: "10.0.12.2" },
    ]);
    // 케이블이 없으면 경로가 라우팅 테이블에서 비활성이라 `ip route`는 비어 있다
    expect(text((await run(port, "ip route")).lines).trim()).toBe("");
    await run(port, "ip route del default via 10.0.12.2");
    expect(routerConfig(simulator).staticRoutes).toHaveLength(1);
  });

  test("링크가 살아 있는 라우터의 ip route는 connected·static을 보인다", async () => {
    const sim = createSimulator();
    expect(sim.load(staticRoutingLabDocument).ok).toBe(true);
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1!, style: "linux" }).ok).toBe(true);
    const output = text((await run(sim.console(LAB.r1!), "ip route")).lines);
    expect(output).toContain("192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.1");
    expect(output).toContain("192.168.2.0/24 via 10.0.12.2 dev eth1");
  });

  test("sysctl이 net.ipv4.ip_forward를 보이고 바꾼다", async () => {
    const { simulator, port } = open();
    expect(text((await run(port, "sysctl net.ipv4.ip_forward")).lines)).toContain("= 1");
    const off = await run(port, "sysctl net.ipv4.ip_forward=0");
    expect(text(off.lines)).toContain("net.ipv4.ip_forward = 0");
    expect(routerConfig(simulator).ipForward).toBe(false);
    await run(port, "sysctl -w net.ipv4.ip_forward=1");
    // 켜짐은 기본값이라 문서에 남기지 않는다
    expect(routerConfig(simulator).ipForward).toBeUndefined();
    expect(text((await run(port, "sysctl bogus.key")).lines)).toContain("cannot stat /proc/sys/bogus/key");
    expect(text((await run(port, "sysctl net.ipv4.ip_forward=x")).lines)).toContain("rejecting value");
  });

  test("hostname으로 장비 이름을 바꾼다", async () => {
    const { simulator, port } = open();
    expect(text((await run(port, "hostname")).lines)).toContain("R1");
    await run(port, "hostname edge");
    expect(simulator.getSnapshot().document.devices.find((d) => d.id === ROUTER_ID)?.name).toBe("edge");
    expect(port.prompt()).toBe("root@edge:~#");
  });

  test("Tab과 ?가 리눅스 명령을 돕는다", () => {
    const { port } = open();
    expect(port.help("").map((entry) => entry.token)).toContain("sysctl");
    expect(port.complete("ip li")).toBe("ip link ");
  });
});

describe("리눅스 라우터의 ip_forward 차단 (T16.1)", () => {
  test("ip_forward가 꺼지면 지나가는 ping이 IP_FORWARD_DISABLED로 버려진다", async () => {
    const sim = createSimulator();
    expect(sim.load(staticRoutingLabDocument).ok).toBe(true);
    expect(sim.dispatch({ type: "router/set-cli-style", deviceId: LAB.r1!, style: "linux" }).ok).toBe(true);
    // 켜져 있을 때는 평소처럼 통과한다
    const before = await sim.console(LAB.pc1!).exec("ping 192.168.2.10");
    expect(before.lines.filter((line) => line.kind === "text" && line.text.includes("bytes=32"))).toHaveLength(4);

    expect(text((await sim.console(LAB.r1!).exec("sysctl net.ipv4.ip_forward=0")).lines)).toContain("= 0");
    const dropped = await sim.console(LAB.pc1!).exec("ping 192.168.2.10");
    expect(dropped.lines.filter((line) => line.kind === "text" && line.text.includes("bytes=32"))).toHaveLength(0);
    const traceIds = sim.getSnapshot().traces.map((summary) => summary.id);
    const reasons = traceIds.flatMap((id) =>
      (sim.getTrace(id)?.events ?? []).flatMap((event) => ("reason" in event && event.reason !== undefined ? [event.reason.code] : [])));
    expect(reasons).toContain("IP_FORWARD_DISABLED");

    await sim.console(LAB.r1!).exec("sysctl net.ipv4.ip_forward=1");
    const after = await sim.console(LAB.pc1!).exec("ping 192.168.2.10");
    expect(after.lines.filter((line) => line.kind === "text" && line.text.includes("bytes=32"))).toHaveLength(4);
  });
});
