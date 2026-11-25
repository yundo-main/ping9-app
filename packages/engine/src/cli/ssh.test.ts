// SSH 클라이언트와 원격 세션 (T0.56). 공개 인터페이스(createSimulator)로만 확인한다.
// 토폴로지: PC1 — R1 — SRV1. R1이 SSH 수신이 켜진 라우터이기도 하다.
import { validateTrace } from "@ping9/shared";
import type { Command, ConsoleResult } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createSimulator } from "../simulator";

const PC1 = "11111111-1111-4111-8111-111111111111";
const SRV = "22222222-2222-4222-8222-222222222222";
const RTR = "33333333-3333-4333-8333-333333333333";
const LINK1 = "55555555-5555-4555-8555-555555555555";
const LINK2 = "66666666-6666-4666-8666-666666666666";

const texts = (result: ConsoleResult): string[] =>
  result.lines.flatMap((line) => (line.kind === "text" ? [line.text] : []));

async function lab() {
  const sim = createSimulator();
  const must = (command: unknown) => expect(sim.dispatch(command as Command)).toMatchObject({ ok: true });
  must({ type: "device/add", id: PC1, kind: "pc", position: { x: 0, y: 0 }, os: "linux" });
  must({ type: "device/add", id: SRV, kind: "server", position: { x: 400, y: 0 } });
  must({ type: "device/rename", deviceId: SRV, name: "SRV1" });
  must({ type: "device/add", id: RTR, kind: "router", position: { x: 200, y: 0 } });
  must({ type: "link/add", id: LINK1, ends: [{ deviceId: PC1, port: "Ethernet0" }, { deviceId: RTR, port: "GigabitEthernet0/0" }] });
  must({ type: "link/add", id: LINK2, ends: [{ deviceId: SRV, port: "Ethernet0" }, { deviceId: RTR, port: "GigabitEthernet0/1" }] });
  must({ type: "pc/set-ip", deviceId: PC1, ip: "10.0.1.10", mask: "255.255.255.0", gateway: "10.0.1.1" });
  must({ type: "server/set-ip", deviceId: SRV, ip: "10.0.2.10", mask: "255.255.255.0", gateway: "10.0.2.1" });
  for (const [port, ip] of [["GigabitEthernet0/0", "10.0.1.1"], ["GigabitEthernet0/1", "10.0.2.1"]] as const) {
    must({ type: "interface/set-ip", deviceId: RTR, port, ip, mask: "255.255.255.0" });
    must({ type: "interface/set-admin", deviceId: RTR, port, adminUp: true });
  }
  const pc = (line: string) => sim.console(PC1).exec(line);
  const srv = (line: string) => sim.console(SRV).exec(line);
  const rtr = (line: string) => sim.console(RTR).exec(line);
  const prompt = (deviceId: string) => sim.console(deviceId).prompt();
  return { sim, must, pc, srv, rtr, prompt };
}

describe("ssh 클라이언트", () => {
  test("ssh admin@서버IP → 비밀번호 → 원격 셸이 열리고 exit로 돌아온다", async () => {
    const { pc, prompt } = await lab();
    const connect = await pc("ssh admin@10.0.2.10");
    // 배너 교환의 추적이 재생된다
    expect(connect.lines[0]).toMatchObject({ kind: "trace" });
    expect(prompt(PC1)).toBe("admin@10.0.2.10's password:");

    const opened = await pc("ping9");
    expect(texts(opened)).toEqual(["SRV1에 접속했습니다 — exit나 logout으로 돌아갑니다"]);
    // 프롬프트가 원격 서버의 셸로 바뀐다
    expect(prompt(PC1)).toBe("user@SRV1 ~ $");

    // 원격 명령은 서버에서 실행된다 — ssh 서비스가 떠 있으니 tcp/22가 보인다
    const remote = await pc("ss -tuln");
    expect(texts(remote).join("\n")).toContain("tcp    LISTEN  0.0.0.0:22");

    const closed = await pc("exit");
    expect(texts(closed)).toEqual(["Connection to 10.0.2.10 closed."]);
    expect(prompt(PC1)).toBe("user@PC1 ~ $");
  });

  test("`ssh -l 사용자 IP` 형태도 된다", async () => {
    const { pc, prompt } = await lab();
    await pc("ssh -l admin 10.0.2.10");
    expect(prompt(PC1)).toBe("admin@10.0.2.10's password:");
    await pc("ping9");
    expect(prompt(PC1)).toBe("user@SRV1 ~ $");
  });

  test("비밀번호가 세 번 틀리면 끊는다", async () => {
    const { pc, prompt } = await lab();
    await pc("ssh admin@10.0.2.10");
    expect(texts(await pc("wrong"))).toEqual(["Permission denied, please try again."]);
    expect(prompt(PC1)).toBe("admin@10.0.2.10's password:");
    await pc("wrong");
    expect(texts(await pc("wrong"))).toEqual(["Permission denied (publickey,password)."]);
    expect(prompt(PC1)).toBe("user@PC1 ~ $");
  });

  test("인스펙터에서 만든 계정으로 접속된다 — 기본 계정을 지우면 그 계정은 안 된다", async () => {
    const { pc, must, prompt } = await lab();
    must({ type: "server/set-ssh-accounts", deviceId: SRV, accounts: [{ user: "bob", password: "s3cret" }] });
    await pc("ssh bob@10.0.2.10");
    await pc("s3cret");
    expect(prompt(PC1)).toBe("user@SRV1 ~ $");
    await pc("exit");
    await pc("ssh admin@10.0.2.10");
    expect(texts(await pc("ping9"))).toEqual(["Permission denied, please try again."]);
  });

  test("ssh 서비스를 끄면 Connection refused다", async () => {
    const { pc, must } = await lab();
    must({ type: "server/set-service", deviceId: SRV, service: "ssh", enabled: false });
    const result = await pc("ssh admin@10.0.2.10");
    expect(texts(result)).toEqual(["ssh: connect to host 10.0.2.10 port 22: Connection refused"]);
  });

  test("서버 콘솔에서도 ssh로 다른 서버·라우터에 붙는다", async () => {
    const { srv, rtr, prompt } = await lab();
    // SRV1 → R1: 먼저 라우터에 SSH를 켠다
    await rtr("enable");
    await rtr("configure terminal");
    await rtr("ip domain-name ping9.test");
    await rtr("crypto key generate rsa");
    await rtr("username admin secret cisco");
    const connect = await srv("ssh admin@10.0.2.1");
    expect(connect.lines[0]).toMatchObject({ kind: "trace" });
    await srv("cisco");
    // 설정은 라우터의 세션에 남아 있다 — 접속하면 그 모드의 프롬프트가 이어진다
    expect(prompt(SRV)).toBe("R1(config)#");
    // config 모드의 exit는 접속이 아니라 모드를 닫는다
    await srv("exit");
    expect(prompt(SRV)).toBe("R1#");
    // 기본 모드에서 exit하면 접속이 끊긴다
    const closed = await srv("exit");
    expect(texts(closed)).toEqual(["Connection to 10.0.2.1 closed."]);
    expect(prompt(SRV)).toBe("user@SRV1 ~ $");
  });
});

describe("라우터의 SSH 수신", () => {
  async function routerSsh() {
    const env = await lab();
    await env.rtr("enable");
    await env.rtr("configure terminal");
    return env;
  }

  test("domain-name 없이 crypto key를 만들면 안 된다", async () => {
    const { rtr } = await routerSsh();
    const result = await rtr("crypto key generate rsa");
    expect(texts(result)).toEqual(["% Please define a domain-name first."]);
  });

  test("domain-name + RSA 키 + 계정 셋이 모이면 SSH가 열리고 `show ip ssh`가 켜짐을 보인다", async () => {
    const { rtr, pc, prompt } = await routerSsh();
    await rtr("ip domain-name ping9.test");
    await rtr("crypto key generate rsa modulus 2048");
    await rtr("username admin secret cisco");
    await rtr("end");
    const status = await rtr("show ip ssh");
    expect(texts(status)[0]).toBe("SSH Enabled - version 2.0");

    await pc("ssh admin@10.0.1.1");
    await pc("cisco");
    expect(prompt(PC1)).toBe("R1#");
    // 원격으로 라우터 명령이 돌고, config 모드에서 exit는 접속이 아니라 모드를 닫는다
    await pc("configure terminal");
    expect(prompt(PC1)).toBe("R1(config)#");
    await pc("exit");
    expect(prompt(PC1)).toBe("R1#");
    const closed = await pc("exit");
    expect(texts(closed)).toEqual(["Connection to 10.0.1.1 closed."]);
  });

  test("SSH를 안 켠 라우터에는 Connection refused다 — 추적은 TCP RST/ICMP 도달 불가 경로", async () => {
    const { pc, sim } = await lab();
    const result = await pc("ssh admin@10.0.1.1");
    expect(texts(result)).toEqual(["ssh: connect to host 10.0.1.1 port 22: Connection refused"]);
    const trace = sim.getTrace(sim.getSnapshot().traces[0]!.id)!;
    expect(validateTrace(trace)).toMatchObject({ ok: true });
  });

  test("running-config에 SSH 설정이 남는다", async () => {
    const { rtr } = await routerSsh();
    await rtr("ip domain-name ping9.test");
    await rtr("crypto key generate rsa");
    await rtr("username admin secret cisco");
    await rtr("end");
    const config = await rtr("show running-config");
    const body = texts(config).join("\n");
    expect(body).toContain("username admin secret cisco");
    expect(body).toContain("ip domain-name ping9.test");
    expect(body).toContain("crypto key generate rsa");
  });
});
