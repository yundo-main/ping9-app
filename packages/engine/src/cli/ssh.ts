// T0.56: `ssh [-l <사용자>] [<사용자>@]<IP>` 클라이언트와 접속 세션의 공통 부품.
// 콘솔(console.ts)이 세션 상태(sshPending·ssh)를 보고 프롬프트와 실행을 위임한다.
// 단순화: TCP 연결과 배너 교환 하나만 선으로 그린다 — 비밀번호 인증과 키 교환은 선 위를 지나지 않고
// 대상 장비의 설정(sshAccounts / ssh.users)을 직접 읽어 판정한다. 비밀번호는 마스킹 없이 에코된다.

import { isServerDevice, parseIpv4, routerInterfaces, sshAccepts, sshAccountsOf } from "@ping9/shared";
import type { ConsoleLine, Device, SshAccount, TopologyDocument } from "@ping9/shared";

import { customParam, defineCommand, param } from "./ios";
import type { CommandArgs, CommandContext, CommandDefinition, CommandOutcome, ParamValue } from "./ios";
import { errorInfo } from "@ping9/shared";

const text = (value: string): ConsoleLine => ({ kind: "text", text: value });

/** 배너 요청·응답에 실는 문구. 서버의 응답(services.ts)과 같다 */
export const SSH_BANNER = "SSH-2.0-OpenSSH_PING9";

/**
 * 접속 대상 IP를 가진 장비 — SSH를 받는 건 서버와 라우터뿐이다.
 * 서버는 `config.ip`, 라우터는 켜진 인터페이스의 IP로 찾는다
 */
export function sshTargetOf(document: TopologyDocument, ip: string): Device | undefined {
  return document.devices.find((device) => {
    if (device.kind === "server") return device.config.ip === ip;
    if (device.kind === "router") {
      return Object.values(routerInterfaces(device.config)).some((iface) => iface.adminUp && iface.ip === ip);
    }
    return false;
  });
}

/** 그 장비가 받는 SSH 계정 목록. 서버는 인스펙터의 계정, 라우터는 CLI로 만든 계정 */
export function sshAccountsFor(device: Device): readonly SshAccount[] {
  if (isServerDevice(device)) return sshAccountsOf(device.config);
  if (device.kind === "router") return device.config.ssh?.users ?? [];
  return [];
}

/** 사용자·비밀번호가 맞으면 true */
export function sshAuthenticates(device: Device, user: string, password: string): boolean {
  return sshAccepts(sshAccountsFor(device), user, password);
}

export interface SshDestination {
  readonly user: string;
  readonly host: string;
}

/**
 * `ssh`의 대상: `<IP>`나 `<사용자>@<IP>`. `-l`은 별도 매개변수로 따로 온다.
 * 호스트는 IP 주소만 받는다 — 이름 풀이(DNS)는 시뮬레이션하지 않는다
 */
export function parseSshTarget(value: string): SshDestination | null {
  const at = value.lastIndexOf("@");
  const host = at === -1 ? value : value.slice(at + 1);
  const user = at === -1 ? "user" : value.slice(0, at);
  if (parseIpv4(host) === null || user.length === 0 || user.includes(" ")) return null;
  return { user, host };
}

function readTarget(textValue: string): ParamValue {
  return parseSshTarget(textValue) === null
    ? { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: textValue.slice(0, 32) }) }
    : { ok: true, value: textValue };
}

const targetParam = customParam("host", "Server or router IPv4 address, or user@IPv4", readTarget);
const userParam = param("user", "word", "Login user name");

const connect = (reason: string) => [`ssh: connect to host %HOST% port 22: ${reason}`];

function runSsh(args: CommandArgs, context: CommandContext): CommandOutcome {
  const device = context.device;
  const runtime = context.runtime;
  const destination = parseSshTarget(String(args["host"]));
  if (runtime === undefined || destination === null) return {};
  const user = args["user"] === undefined ? destination.user : String(args["user"]);
  const result = runtime.exchange({
    deviceId: device.id, service: "ssh", protocol: "tcp",
    targetIp: destination.host, port: 22, message: SSH_BANNER,
  });
  if (!result.ok) return { lines: [{ kind: "error", ...result.error }] };

  const trace = { kind: "trace", traceId: result.traceId } as const;
  const failed = (lines: string[]): CommandOutcome => ({
    lines: [trace, ...lines.map((line) => text(line.replace("%HOST%", destination.host)))],
  });
  switch (result.outcome.kind) {
    case "response": {
      const target = sshTargetOf(context.document, destination.host);
      // 응답이 왔는데 대상 장비를 못 찾는 일은 없다. 방어적으로 접속을 끊는다
      if (target === undefined) return failed(connect("Connection reset by peer"));
      return {
        lines: [trace],
        session: { ...context.session, sshPending: { targetId: target.id, host: destination.host, user, tries: 0 } },
      };
    }
    case "refused":
      return failed(connect("Connection refused"));
    case "timeout":
      return failed(connect("Connection timed out"));
    case "unreachable":
      return failed(connect("No route to host"));
    case "unsent":
      return failed(connect("Network is unreachable"));
    case "expired":
      return failed(connect("No route to host"));
  }
}

/** PC(Windows·Linux)와 Server 콘솔에서 쓰는 `ssh` 명령 정의 */
export const SSH_COMMANDS: readonly CommandDefinition[] = [
  defineCommand({ modes: ["user"], devices: ["pc", "server"], noAbbrev: true, tokens: ["ssh", targetParam], help: "Open a remote console over SSH", run: runSsh }),
  defineCommand({ modes: ["user"], devices: ["pc", "server"], noAbbrev: true, tokens: ["ssh", "-l", userParam, targetParam], help: "Open a remote console over SSH (user by -l)", run: runSsh }),
];
