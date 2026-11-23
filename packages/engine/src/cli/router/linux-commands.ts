// 리눅스 네이티브 라우터의 명령 정의 목록 (T16.1). `cliStyle === "linux"`인 Router의 콘솔이 이 목록을 쓴다.
// 정의 형태와 해석기는 다른 장비와 같은 cli/ios의 것이다 (AD-8). 명령은 Linux PC의 것과 비슷하지만
// 인터페이스가 eth0~eth3 네 개이고 `ip route`가 라우팅 테이블을, `sysctl`이 전달 스위치를 다룬다.
// Linux의 `ethN`은 콘솔에서만 쓴다. 문서 안의 포트 이름은 `GigabitEthernet0/N`이다.

import {
  PORT_NAMES,
  errorInfo,
  maskToPrefixLength,
  normalizeCidr,
  portIndex,
  prefixLengthToMask,
} from "@ping9/shared";
import type { ConsoleLine, PortStatus, RouteEntryView, RouterDevice } from "@ping9/shared";

import { macAddressFor } from "../../mac";
import { computeViews } from "../../views";
import { ROUTER_TTL } from "../../devices/router/router-model";
import { customParam, defineCommand, linesFromDispatch, param } from "../ios";
import type { CommandArgs, CommandContext, CommandDefinition, CommandOutcome, ParamValue } from "../ios";
import { readCidr } from "../pc/linux-commands";
import { linuxPingLines, loopbackPingLines } from "../pc/ping-output";
import { readCount } from "../pc/ping";
import { linuxTracerouteLines } from "../pc/traceroute-output";
import { readMaxHops } from "../pc/traceroute";

const text = (value: string): ConsoleLine => ({ kind: "text", text: value });

function routerOf(context: CommandContext): RouterDevice | undefined {
  return context.device.kind === "router" ? context.device : undefined;
}

/** 문서 포트 `GigabitEthernet0/N` → 콘솔 이름 `ethN` */
function ethName(port: string): string {
  return `eth${portIndex("router", port)}`;
}

/** 콘솔 이름 `eth0`~`eth3` → 문서 포트. 없는 번호면 undefined */
function ethPortOf(name: string): string | undefined {
  const match = /^eth([0-3])$/.exec(name);
  return match === null ? undefined : PORT_NAMES.router[Number(match[1])];
}

/** `eth0`~`eth3` 자리. 값은 문서 포트 이름으로 돌려준다 */
const ethParam = customParam("eth", "Interface name (eth0-eth3)", (value, kind): ParamValue => {
  const port = kind === "router" ? ethPortOf(value) : undefined;
  return port === undefined
    ? { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: value }) }
    : { ok: true, value: port };
});

/** 포트의 링크 상태. 화면과 같은 값을 쓴다 (AD-7) */
function statusOf(router: RouterDevice, context: CommandContext, port: string): PortStatus {
  return computeViews(context.document)[router.id]?.ports.find((candidate) => candidate.name === port)?.status ?? "no-link";
}

const LINK_STATE: Readonly<Record<PortStatus, string>> = {
  up: "<BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP",
  "no-link": "<NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 state DOWN",
  "peer-down": "<NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 state DOWN",
  "admin-down": "<BROADCAST,MULTICAST> mtu 1500 state DOWN",
};

const LO_LINE = text("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN");

/** `ip addr`의 포트 한 덩어리 */
function addressBlock(router: RouterDevice, context: CommandContext, port: string, index: number): ConsoleLine[] {
  const iface = router.config.interfaces[port];
  const prefix = iface?.mask === undefined ? null : maskToPrefixLength(iface.mask);
  return [
    text(`${index + 2}: ${ethName(port)}: ${LINK_STATE[statusOf(router, context, port)]}`),
    text(`    link/ether ${macAddressFor(router.id, index)} brd ff:ff:ff:ff:ff:ff`),
    ...(iface?.ip === undefined || prefix === null ? [] : [text(`    inet ${iface.ip}/${prefix} scope global ${ethName(port)}`)]),
  ];
}

function showAddresses(args: CommandArgs, context: CommandContext): CommandOutcome {
  const router = routerOf(context);
  if (router === undefined) return {};
  const only = args["eth"] === undefined ? undefined : String(args["eth"]);
  const ports = PORT_NAMES.router.filter((port) => only === undefined || port === only);
  return {
    lines: [
      LO_LINE,
      text("    inet 127.0.0.1/8 scope host lo"),
      ...ports.flatMap((port) => addressBlock(router, context, port, portIndex("router", port))),
    ],
  };
}

function showLinks(args: CommandArgs, context: CommandContext): CommandOutcome {
  const router = routerOf(context);
  if (router === undefined) return {};
  const only = args["eth"] === undefined ? undefined : String(args["eth"]);
  const ports = PORT_NAMES.router.filter((port) => only === undefined || port === only);
  return {
    lines: [
      LO_LINE,
      text("    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00"),
      ...ports.flatMap((port) => [
        text(`${portIndex("router", port) + 2}: ${ethName(port)}: ${LINK_STATE[statusOf(router, context, port)]}`),
        text(`    link/ether ${macAddressFor(router.id, portIndex("router", port))} brd ff:ff:ff:ff:ff:ff`),
      ]),
    ],
  };
}

/** `ip addr add <주소/길이> dev ethN`. IOS 모드의 `ip address`와 같은 Command다 (AD-3) */
function addAddress(args: CommandArgs, context: CommandContext): CommandOutcome {
  const [ip = "", length = ""] = String(args["cidr"]).split("/");
  const mask = prefixLengthToMask(Number(length));
  if (mask === null) return { lines: [{ kind: "error", ...errorInfo("CLI_INVALID_VALUE", { token: String(args["cidr"]) }) }] };
  const result = context.dispatch({ type: "interface/set-ip", deviceId: context.device.id, port: String(args["eth"]), ip, mask });
  return { lines: linesFromDispatch(result) };
}

/** `ip addr del`과 `flush`. 포트의 주소를 지운다 */
function clearAddress(_args: CommandArgs, context: CommandContext): CommandOutcome {
  const result = context.dispatch({ type: "interface/clear-ip", deviceId: context.device.id, port: String(_args["eth"]) });
  return { lines: linesFromDispatch(result) };
}

/** `ip link set ethN up|down` */
function setLink(adminUp: boolean) {
  return (args: CommandArgs, context: CommandContext): CommandOutcome => {
    const result = context.dispatch({ type: "interface/set-admin", deviceId: context.device.id, port: String(args["eth"]), adminUp });
    return { lines: linesFromDispatch(result) };
  };
}

/** `ip route`의 경로 한 줄. 나가는 포트가 없는 경로는 보이지 않는다 */
function routeLine(router: RouterDevice, route: RouteEntryView): string | undefined {
  const port = route.port;
  if (port === undefined) return undefined;
  const prefix = maskToPrefixLength(route.mask);
  if (prefix === null) return undefined;
  if (route.source === "connected") {
    const source = router.config.interfaces[port]?.ip;
    return `${route.network}/${prefix} dev ${ethName(port)} proto kernel scope link${source === undefined ? "" : ` src ${source}`}`;
  }
  const next = route.nextHop === undefined ? "" : ` via ${route.nextHop}`;
  const destination = route.network === "0.0.0.0" && prefix === 0 ? "default" : `${route.network}/${prefix}`;
  return route.source === "rip"
    ? `${destination}${next} dev ${ethName(port)} proto rip metric ${route.metric}`
    : `${destination}${next} dev ${ethName(port)}`;
}

function showIpRoute(_args: CommandArgs, context: CommandContext): CommandOutcome {
  const router = routerOf(context);
  if (router === undefined || context.runtime === undefined) return {};
  const table = context.runtime.routingTable(router.id);
  return { lines: table.flatMap((route) => {
    const line = routeLine(router, route);
    return line === undefined ? [] : [text(line)];
  }) };
}

/** `ip route add default via`와 `ip route add <대상/길이> via`. IOS의 `ip route`와 같은 Command다 */
function addRoute(args: CommandArgs, context: CommandContext): CommandOutcome {
  const target = args["cidr"] === undefined ? "0.0.0.0/0" : String(args["cidr"]);
  const normalized = normalizeCidr(target);
  const mask = normalized === null ? null : prefixLengthToMask(Number(normalized.split("/")[1]));
  if (normalized === null || mask === null) {
    return { lines: [{ kind: "error", ...errorInfo("CLI_INVALID_VALUE", { token: target }) }] };
  }
  const result = context.dispatch({
    type: "route/add", deviceId: context.device.id,
    network: normalized.split("/")[0]!, mask, nextHop: String(args["gateway"]),
  });
  return { lines: linesFromDispatch(result) };
}

function removeRoute(args: CommandArgs, context: CommandContext): CommandOutcome {
  const target = args["cidr"] === undefined ? "0.0.0.0/0" : String(args["cidr"]);
  const normalized = normalizeCidr(target);
  const mask = normalized === null ? null : prefixLengthToMask(Number(normalized.split("/")[1]));
  if (normalized === null || mask === null) {
    return { lines: [{ kind: "error", ...errorInfo("CLI_INVALID_VALUE", { token: target }) }] };
  }
  const result = context.dispatch({
    type: "route/remove", deviceId: context.device.id,
    network: normalized.split("/")[0]!, mask, nextHop: String(args["gateway"]),
  });
  return { lines: linesFromDispatch(result) };
}

/** `ip neigh`. 포트가 여럿이라 PC의 것을 다시 쓰지 않고 `dev ethN`을 직접 쓴다 */
function showNeigh(_args: CommandArgs, context: CommandContext): CommandOutcome {
  if (context.runtime === undefined) return {};
  return {
    lines: context.runtime.arpTable(context.device.id).map((entry) =>
      text(`${entry.ip} dev ${ethName(entry.port)} lladdr ${entry.mac} REACHABLE`)),
  };
}

function flushNeigh(_args: CommandArgs, context: CommandContext): CommandOutcome {
  context.runtime?.clearArp(context.device.id);
  return {};
}

/** 자기 인터페이스나 127.x로의 ping은 링크를 지나지 않는다 */
function isLoopback(router: RouterDevice, target: string): boolean {
  return target.startsWith("127.") || Object.values(router.config.interfaces).some((iface) => iface.adminUp && iface.ip === target);
}

function runPing(args: CommandArgs, context: CommandContext): CommandOutcome {
  const router = routerOf(context);
  if (router === undefined || context.runtime === undefined) return {};
  const target = String(args["ip"]);
  const count = args["count"] === undefined ? 4 : Number(args["count"]);
  if (isLoopback(router, target)) return { lines: loopbackPingLines("linux", target, count, ROUTER_TTL) };
  const run = context.runtime.ping({ deviceId: router.id, targetIp: target, count, stopOnUnsent: true });
  if (!run.ok) return { lines: [{ kind: "error", ...run.error }] };
  return { lines: linuxPingLines(target, undefined, run.rounds) };
}

function runTraceroute(args: CommandArgs, context: CommandContext): CommandOutcome {
  const router = routerOf(context);
  if (router === undefined || context.runtime === undefined) return {};
  const target = String(args["ip"]);
  const maxHops = args["hops"] === undefined ? 30 : Number(args["hops"]);
  if (isLoopback(router, target)) {
    return { lines: linuxTracerouteLines(target, undefined, maxHops, true, { kind: "loopback", targetIp: target }) };
  }
  const run = context.runtime.traceroute({ deviceId: router.id, targetIp: target, maxHops });
  if (!run.ok) return { lines: [{ kind: "error", ...run.error }] };
  return { lines: linuxTracerouteLines(target, undefined, maxHops, true, run.rounds) };
}

const IP_FORWARD_KEY = "net.ipv4.ip_forward";

/** `sysctl <키>[=<값>]`. 지금은 `net.ipv4.ip_forward` 하나만 안다 */
function runSysctl(args: CommandArgs, context: CommandContext): CommandOutcome {
  const router = routerOf(context);
  if (router === undefined) return {};
  const raw = String(args["setting"]);
  const equal = raw.indexOf("=");
  const key = equal < 0 ? raw : raw.slice(0, equal);
  if (key !== IP_FORWARD_KEY) {
    return { lines: [text(`sysctl: cannot stat /proc/sys/${key.replaceAll(".", "/")}: No such file or directory`)] };
  }
  if (equal < 0) {
    return { lines: [text(`${IP_FORWARD_KEY} = ${router.config.ipForward === false ? 0 : 1}`)] };
  }
  const value = raw.slice(equal + 1);
  if (value !== "0" && value !== "1") {
    return { lines: [text(`sysctl: setting key "${IP_FORWARD_KEY}", rejecting value "${value}"`)] };
  }
  const result = context.dispatch({ type: "router/set-ip-forward", deviceId: router.id, enabled: value === "1" });
  return { lines: result.ok ? [text(`${IP_FORWARD_KEY} = ${value}`)] : linesFromDispatch(result) };
}

const cidrParam = customParam("cidr", "Network and prefix length, e.g. 10.0.0.0/24", readCidr);
const ipParam = param("ip", "ipv4", "Destination IPv4 address");
const gatewayParam = param("gateway", "ipv4", "Next hop address");
const countParam = customParam("count", "Number of echo requests (1-10)", readCount);
const hopsParam = customParam("hops", "Maximum number of hops (1-30)", readMaxHops);
const sysctlParam = customParam("setting", "Kernel key, optionally with =value", (value) => ({ ok: true, value }));

const linux = (tokens: CommandDefinition["tokens"], help: string, run: CommandDefinition["run"]) =>
  defineCommand({ modes: ["user"], devices: ["router"], tokens, help, run, caseSensitive: true });

export const LINUX_ROUTER_COMMANDS: readonly CommandDefinition[] = [
  linux(["ip", "addr"], "Show addresses", showAddresses),
  linux(["ip", "a"], "Show addresses", showAddresses),
  linux(["ip", "addr", "show"], "Show addresses", showAddresses),
  linux(["ip", "addr", "show", ethParam], "Show addresses of the interface", showAddresses),
  linux(["ip", "addr", "add", cidrParam, "dev", ethParam], "Set the interface address", addAddress),
  linux(["ip", "addr", "del", cidrParam, "dev", ethParam], "Remove the interface address", clearAddress),
  linux(["ip", "addr", "flush", "dev", ethParam], "Remove all addresses of the interface", clearAddress),
  linux(["ip", "link"], "Show links", showLinks),
  linux(["ip", "link", "show"], "Show links", showLinks),
  linux(["ip", "link", "show", ethParam], "Show the link of the interface", showLinks),
  linux(["ip", "link", "set", ethParam, "down"], "Turn the interface off", setLink(false)),
  linux(["ip", "link", "set", ethParam, "up"], "Turn the interface on", setLink(true)),
  linux(["ip", "route"], "Show the routing table", showIpRoute),
  linux(["ip", "route", "show"], "Show the routing table", showIpRoute),
  linux(["ip", "route", "add", "default", "via", gatewayParam], "Add a default route", addRoute),
  linux(["ip", "route", "add", cidrParam, "via", gatewayParam], "Add a route", addRoute),
  linux(["ip", "route", "del", "default", "via", gatewayParam], "Remove the default route", removeRoute),
  linux(["ip", "route", "del", cidrParam, "via", gatewayParam], "Remove a route", removeRoute),
  linux(["ip", "neigh"], "Show the neighbour (ARP) table", showNeigh),
  linux(["ip", "neigh", "show"], "Show the neighbour (ARP) table", showNeigh),
  linux(["ip", "neigh", "flush", "all"], "Delete all neighbour entries", flushNeigh),
  linux(["ping", ipParam], "Send 4 echo requests", runPing),
  linux(["ping", "-c", countParam, ipParam], "Send the given number of echo requests", runPing),
  linux(["ping", ipParam, "-c", countParam], "Send the given number of echo requests", runPing),
  linux(["traceroute", ipParam], "Show the routers on the way (up to 30 hops)", runTraceroute),
  linux(["traceroute", "-n", ipParam], "Print addresses only", runTraceroute),
  linux(["traceroute", "-m", hopsParam, ipParam], "Trace up to the given number of hops", runTraceroute),
  linux(["traceroute", "-n", "-m", hopsParam, ipParam], "Trace up to the given number of hops", runTraceroute),
  linux(["sysctl", sysctlParam], "Show or set a kernel key (net.ipv4.ip_forward)", runSysctl),
  linux(["sysctl", "-w", sysctlParam], "Set a kernel key (net.ipv4.ip_forward)", runSysctl),
  linux(["hostname"], "Show the device name", (_args, context) => ({ lines: [text(context.device.name)] })),
  linux(["hostname", param("name", "word", "New hostname")], "Rename the device", (args, context) => ({
    lines: linesFromDispatch(context.dispatch({ type: "device/rename", deviceId: context.device.id, name: String(args["name"]) })),
  })),
];
