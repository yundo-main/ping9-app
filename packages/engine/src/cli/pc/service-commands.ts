// T0.20: 서비스를 쓰는 명령어(`curl`, `nslookup`, `ntpdate`, `w32tm`)와 서버의 명령어(`ss`, `systemctl`).
// 요청 명령은 Document를 바꾸지 않고 Runtime만 쓴다 (`CommandContext.runtime.exchange`). 요청 하나가 추적 하나다.
// 이름 풀이는 없다: `curl`은 IP 주소만 받고, 이름은 `nslookup <이름> <서버>`로 직접 물어본다.
// os.ts가 OS별 명령 목록 뒤에 이 목록을 붙인다.

import { isPcDevice,

  SERVICE_PORTS,
  checkHostName,
  errorInfo,
  parseIpv4,
} from "@ping9/shared";
import type { ConsoleLine, ErrorInfo, OsKind, PcDevice, ServiceKind } from "@ping9/shared";

import type { ServiceOutcome } from "../../runtime";
import { customParam, defineCommand, param } from "../ios";
import type { CommandArgs, CommandContext, CommandDefinition, CommandOutcome, ParamValue } from "../ios";

const text = (value: string): ConsoleLine => ({ kind: "text", text: value });
const errorLine = (error: ErrorInfo): ConsoleLine => ({ kind: "error", ...error });
const clip = (value: string): string => (value.length > 64 ? value.slice(0, 64) : value);

function pcOf(context: CommandContext): PcDevice | undefined {
  return isPcDevice(context.device) ? context.device : undefined;
}

/** 첫 줄 바로 뒤에 추적 줄을 둔다. 화면이 그 추적을 재생한 뒤에 첫 줄을 보인다 (ping의 회차와 같은 길) */
function withTrace(lines: readonly string[], traceId: number): ConsoleLine[] {
  const [first = "", ...rest] = lines;
  return [text(first), { kind: "trace", traceId }, ...rest.map(text)];
}

export interface ParsedUrl {
  readonly scheme: "http" | "https" | "ftp";
  readonly host: string;
  readonly port: number;
  /** `/`로 시작한다 */
  readonly path: string;
}

/**
 * `curl`의 주소. `[http://|https://|ftp://]<IP>[:포트][/경로]`. 이름 풀이가 없어 호스트는 IP 주소만 받는다.
 * 경로는 영문자, 숫자, `.`, `_`, `-`, `/`만. 틀리면 null
 */
export function parseUrl(value: string): ParsedUrl | null {
  // 방식 이름은 대소문자를 가리지 않는다 (`HTTP://`)
  const match = /^(?:(https?|ftp):\/\/)?([0-9.]+)(?::([0-9]{1,5}))?(\/[A-Za-z0-9._/-]{0,48})?$/i.exec(value);
  if (match === null) return null;
  const scheme = (match[1]?.toLowerCase() ?? "http") as ParsedUrl["scheme"];
  const host = match[2]!;
  const port = match[3] === undefined ? SERVICE_PORTS[scheme].port : Number(match[3]);
  if (parseIpv4(host) === null || port < 1 || port > 65535) return null;
  return { scheme, host, port, path: match[4] ?? "/" };
}

function readUrl(value: string): ParamValue {
  return parseUrl(value) === null
    ? { ok: false, error: errorInfo("SERVICE_URL_INVALID", { value: clip(value) }) }
    : { ok: true, value };
}

/** DNS 이름. 대소문자를 가리지 않아 소문자로 맞춘다 */
function readHostName(value: string): ParamValue {
  const name = value.toLowerCase();
  const error = checkHostName(name);
  return error === null ? { ok: true, value: name } : { ok: false, error };
}

/** 자기 주소나 127.x로 보낸 요청은 링크를 지나지 않는다. PC는 서비스를 듣지 않아 모두 거절이다 */
function localOutcome(pc: PcDevice, targetIp: string): ServiceOutcome | undefined {
  return targetIp === pc.config.ip || targetIp.startsWith("127.") ? { kind: "refused", timeUs: 0 } : undefined;
}

interface Requested {
  readonly outcome: ServiceOutcome;
  /** 링크를 지난 요청이면 그 추적 */
  readonly traceId?: number;
}

function request(
  context: CommandContext, pc: PcDevice, service: ServiceKind, protocol: "tcp" | "udp", targetIp: string, port: number, message: string,
): Requested | { readonly error: ErrorInfo } | undefined {
  const local = localOutcome(pc, targetIp);
  if (local !== undefined) return { outcome: local };
  if (context.runtime === undefined) return undefined;
  const run = context.runtime.exchange({ deviceId: pc.id, service, protocol, targetIp, port, message });
  return run.ok ? { outcome: run.outcome, traceId: run.traceId } : { error: run.error };
}

const done = (lines: readonly string[], traceId: number | undefined): CommandOutcome =>
  ({ lines: traceId === undefined ? lines.map(text) : withTrace(lines, traceId) });

/** `curl`. HTTP는 문서를, FTP는 목록(`ftp://<IP>/`)이나 파일을 받는다. 출력은 Windows와 Linux가 같다 */
function runCurl(args: CommandArgs, context: CommandContext): CommandOutcome {
  const pc = pcOf(context);
  const url = parseUrl(String(args["url"]));
  if (pc === undefined || url === null) return {};
  const message = url.scheme === "ftp" ? (url.path === "/" ? "LIST" : `RETR ${url.path.slice(1)}`) : `GET ${url.path}`;
  const result = request(context, pc, url.scheme, "tcp", url.host, url.port, message);
  if (result === undefined) return {};
  if ("error" in result) return { lines: [errorLine(result.error)] };

  const { outcome } = result;
  const failed = (code: number, reason: string) => [`curl: (${code}) Failed to connect to ${url.host} port ${url.port}: ${reason}`];
  switch (outcome.kind) {
    case "response":
      // FTP의 실패 응답(550)은 본문이 없다. curl의 문구로 보인다. HTTP로 다른 서비스의 포트에 물었으면 받은 줄을 그대로 보인다
      if (outcome.data === undefined) {
        return done([url.scheme === "ftp" ? `curl: (78) RETR response: ${outcome.message.slice(0, 3)}` : outcome.message], result.traceId);
      }
      return done(outcome.data.split("\n"), result.traceId);
    case "refused":
      return done(failed(7, "Connection refused"), result.traceId);
    case "timeout":
      return done(failed(28, "Connection timed out"), result.traceId);
    case "unreachable":
    case "expired":
      return done(failed(7, "No route to host"), result.traceId);
    case "unsent":
      return done(failed(7, "Network is unreachable"), result.traceId);
  }
}

/** `nslookup <이름> <서버>`. 답은 `<이름> A <주소>`나 `NXDOMAIN <이름>`으로 온다 */
function runNslookup(os: OsKind) {
  return (args: CommandArgs, context: CommandContext): CommandOutcome => {
    const pc = pcOf(context);
    if (pc === undefined) return {};
    const name = String(args["name"]);
    const server = String(args["server"]);
    const result = request(context, pc, "dns", "udp", server, SERVICE_PORTS.dns.port, `A ${name}`);
    if (result === undefined) return {};
    if ("error" in result) return { lines: [errorLine(result.error)] };

    const { outcome } = result;
    const address = outcome.kind === "response" && outcome.message.startsWith(`${name} A `) ? outcome.message.slice(name.length + 3) : undefined;
    if (os === "linux") {
      const head = [`Server:\t\t${server}`, `Address:\t${server}#53`, ""];
      if (address !== undefined) return done([...head, `Name:\t${name}`, `Address: ${address}`], result.traceId);
      if (outcome.kind === "response") return done([...head, `** server can't find ${name}: NXDOMAIN`], result.traceId);
      const reason = outcome.kind === "refused" ? "connection refused" : "timed out";
      return done([`;; communications error to ${server}#53: ${reason}`, ";; no servers could be reached"], result.traceId);
    }
    const head = ["Server:  UnKnown", `Address:  ${server}`, ""];
    if (address !== undefined) return done([...head, `Name:    ${name}`, `Address:  ${address}`], result.traceId);
    if (outcome.kind === "response") return done([...head, `*** UnKnown can't find ${name}: Non-existent domain`], result.traceId);
    return done(["DNS request timed out.", "    timeout was 2 seconds.", `*** Request to ${server} timed-out`], result.traceId);
  };
}

/** 가상 µs를 초로 */
const seconds = (timeUs: number, digits: number): string => (timeUs / 1_000_000).toFixed(digits);

/** Linux `ntpdate -q <서버>`. 시뮬레이터에 벽시계가 없어 offset은 0이고 날짜 줄은 없다. delay는 가상 시간의 왕복이다 */
function runNtpdate(args: CommandArgs, context: CommandContext): CommandOutcome {
  const pc = pcOf(context);
  if (pc === undefined) return {};
  const server = String(args["ip"]);
  const result = request(context, pc, "ntp", "udp", server, SERVICE_PORTS.ntp.port, "client");
  if (result === undefined) return {};
  if ("error" in result) return { lines: [errorLine(result.error)] };
  const { outcome } = result;
  return done(outcome.kind === "response"
    ? [`server ${server}, stratum 1, offset +0.000000, delay ${seconds(outcome.timeUs, 5)}`]
    : ["ntpdate: no server suitable for synchronization found"], result.traceId);
}

/** `/computer:10.0.2.10`에서 주소를 읽는다 */
function readComputer(value: string): ParamValue {
  const match = /^\/computer:(.+)$/i.exec(value);
  return match === null || parseIpv4(match[1]!) === null
    ? { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: clip(value) }) }
    : { ok: true, value: match[1]! };
}

/** Windows `w32tm /stripchart /computer:<서버>`. 한 번만 묻는다. 시각 칸은 없다 */
function runW32tm(args: CommandArgs, context: CommandContext): CommandOutcome {
  const pc = pcOf(context);
  if (pc === undefined) return {};
  const server = String(args["computer"]);
  const result = request(context, pc, "ntp", "udp", server, SERVICE_PORTS.ntp.port, "client");
  if (result === undefined) return {};
  if ("error" in result) return { lines: [errorLine(result.error)] };
  const { outcome } = result;
  // 첫 줄이 재생 뒤에 뜨도록 결과 줄을 앞에 둔다
  return done(outcome.kind === "response"
    ? [`d:+${seconds(outcome.timeUs, 7).padStart(10, "0")}s o:+00.0000000s  [${server}:123]`]
    : [`error: 0x800705B4  [${server}:123]`], result.traceId);
}


const urlParam = customParam("url", "Address: [http://|https://|ftp://]<IP>[:port][/path]", readUrl);
const nameParam = customParam("name", "Host name to look up, e.g. www.ping9.test", readHostName);
const serverParam = param("server", "ipv4", "DNS server address");
const ipParam = param("ip", "ipv4", "NTP server address");
const computerParam = customParam("computer", "NTP server, e.g. /computer:10.0.2.10", readComputer);

const pcCommand = (tokens: CommandDefinition["tokens"], help: string, run: CommandDefinition["run"]) =>
  defineCommand({ modes: ["user"], devices: ["pc"], tokens, help, run });

export const WINDOWS_SERVICE_COMMANDS: readonly CommandDefinition[] = [
  pcCommand(["curl", urlParam], "Fetch a web page (http(s)://) or a file list (ftp://) from a server", runCurl),
  pcCommand(["nslookup", nameParam, serverParam], "Ask a DNS server for the address of a name", runNslookup("windows")),
  pcCommand(["w32tm", "/stripchart", computerParam], "Ask an NTP server once", runW32tm),
];

export const LINUX_SERVICE_COMMANDS: readonly CommandDefinition[] = [
  pcCommand(["curl", urlParam], "Fetch a web page (http(s)://) or a file list (ftp://) from a server", runCurl),
  pcCommand(["nslookup", nameParam, serverParam], "Ask a DNS server for the address of a name", runNslookup("linux")),
  pcCommand(["ntpdate", "-q", ipParam], "Ask an NTP server once", runNtpdate),
];

