// LB의 리눅스 네이티브 명령 정의 목록 (T0.34). 라우터의 linux 스타일과 같은 형태다 —
// `ip addr`/`ip link`/`ip route`/`ip neigh`가 인터페이스와 정적 경로를 다룬다.
// 프런트엔드(VIP·백엔드)는 Inspector에서 편집하고, `ss -tln` 비슷한 `haproxy` 줄은 없다.

import {
  PORT_NAMES, checkHostIpv4, errorInfo, maskToPrefixLength, normalizeCidr, prefixLengthToMask, portIndex,
} from "@ping9/shared";
import type { ConsoleLine, LbDevice, PortStatus, RouteEntryView } from "@ping9/shared";

import { macAddressFor } from "../../mac";
import { computeViews } from "../../views";
import { customParam, defineCommand, linesFromDispatch, param } from "../ios";
import type { CommandArgs, CommandContext, CommandDefinition, CommandOutcome, ParamValue } from "../ios";
import { linuxPingLines } from "../pc/ping-output";
import { readCount } from "../pc/ping";
import { readCidr } from "../pc/linux-commands";

const text = (value: string): ConsoleLine => ({ kind: "text", text: value });

function lbOf(context: CommandContext): LbDevice | undefined {
  return context.device.kind === "lb" ? context.device : undefined;
}

const ethParam = customParam("eth", "Interface name (eth0-eth1)", (value, kind): ParamValue => {
  const port = kind === "lb" && /^eth[0-1]$/.test(value) ? PORT_NAMES.lb[Number(value.slice(3))] : undefined;
  return port === undefined
    ? { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: value }) }
    : { ok: true, value: port };
});

const cidrParam = customParam("cidr", "IPv4 prefix (a.b.c.d/len)", readCidr);
const gatewayParam = param("gateway", "ipv4", "Next hop address");
const countParam = customParam("count", "Number of echo requests (1-10)", readCount);

const LINK_STATE: Readonly<Record<PortStatus, string>> = {
  up: "<BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP",
  "no-link": "<NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 state DOWN",
  "peer-down": "<NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 state DOWN",
  "admin-down": "<BROADCAST,MULTICAST> mtu 1500 state DOWN",
};

const LO_LINE = text("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN");

function statusOf(lb: LbDevice, context: CommandContext, port: string): PortStatus {
  return computeViews(context.document)[lb.id]?.ports.find(candidate => candidate.name === port)?.status ?? "no-link";
}

function showAddresses(args: CommandArgs, context: CommandContext): CommandOutcome {
  const lb = lbOf(context);
  if (lb === undefined) return {};
  const only = args["eth"] === undefined ? undefined : String(args["eth"]);
  const ports = PORT_NAMES.lb.filter(port => only === undefined || port === only);
  return {
    lines: [
      LO_LINE,
      text("    inet 127.0.0.1/8 scope host lo"),
      ...ports.flatMap(port => {
        const iface = lb.config.interfaces[port];
        const prefix = iface?.mask === undefined ? null : maskToPrefixLength(iface.mask);
        const index = portIndex("lb", port);
        return [
          text(`${index + 2}: ${port}: ${LINK_STATE[statusOf(lb, context, port)]}`),
          text(`    link/ether ${macAddressFor(lb.id, index)} brd ff:ff:ff:ff:ff:ff`),
          ...(iface?.ip === undefined || prefix === null ? [] : [text(`    inet ${iface.ip}/${prefix} scope global ${port}`)]),
        ];
      }),
    ],
  };
}

function showLinks(args: CommandArgs, context: CommandContext): CommandOutcome {
  const lb = lbOf(context);
  if (lb === undefined) return {};
  const only = args["eth"] === undefined ? undefined : String(args["eth"]);
  const ports = PORT_NAMES.lb.filter(port => only === undefined || port === only);
  return {
    lines: [
      LO_LINE,
      text("    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00"),
      ...ports.flatMap(port => [
        text(`${portIndex("lb", port) + 2}: ${port}: ${LINK_STATE[statusOf(lb, context, port)]}`),
        text(`    link/ether ${macAddressFor(lb.id, portIndex("lb", port))} brd ff:ff:ff:ff:ff:ff`),
      ]),
    ],
  };
}

function addAddress(args: CommandArgs, context: CommandContext): CommandOutcome {
  const [ip = "", length = ""] = String(args["cidr"]).split("/");
  const mask = prefixLengthToMask(Number(length));
  if (mask === null) return { lines: [{ kind: "error", ...errorInfo("CLI_INVALID_VALUE", { token: String(args["cidr"]) }) }] };
  const result = context.dispatch({ type: "interface/set-ip", deviceId: context.device.id, port: String(args["eth"]), ip, mask });
  return { lines: linesFromDispatch(result) };
}

function clearAddress(args: CommandArgs, context: CommandContext): CommandOutcome {
  const result = context.dispatch({ type: "interface/clear-ip", deviceId: context.device.id, port: String(args["eth"]) });
  return { lines: linesFromDispatch(result) };
}

function setLink(adminUp: boolean) {
  return (args: CommandArgs, context: CommandContext): CommandOutcome => {
    const result = context.dispatch({ type: "interface/set-admin", deviceId: context.device.id, port: String(args["eth"]), adminUp });
    return { lines: linesFromDispatch(result) };
  };
}

function routeLine(lb: LbDevice, route: RouteEntryView): string | undefined {
  const port = route.port;
  if (port === undefined) return undefined;
  const prefix = maskToPrefixLength(route.mask);
  if (prefix === null) return undefined;
  if (route.source === "connected") {
    const source = lb.config.interfaces[port]?.ip;
    return `${route.network}/${prefix} dev ${port} proto kernel scope link${source === undefined ? "" : ` src ${source}`}`;
  }
  const next = route.nextHop === undefined ? "" : ` via ${route.nextHop}`;
  const destination = route.network === "0.0.0.0" && prefix === 0 ? "default" : `${route.network}/${prefix}`;
  return `${destination}${next} dev ${port}`;
}

function showIpRoute(_args: CommandArgs, context: CommandContext): CommandOutcome {
  const lb = lbOf(context);
  if (lb === undefined || context.runtime === undefined) return {};
  const table = context.runtime.routingTable(lb.id);
  return { lines: table.flatMap(route => {
    const line = routeLine(lb, route);
    return line === undefined ? [] : [text(line)];
  }) };
}

function readTarget(args: CommandArgs): { network: string; mask: string } | { error: string } {
  const target = args["cidr"] === undefined ? "0.0.0.0/0" : String(args["cidr"]);
  const normalized = normalizeCidr(target);
  const mask = normalized === null ? null : prefixLengthToMask(Number(normalized.split("/")[1]));
  return normalized === null || mask === null ? { error: target } : { network: normalized.split("/")[0]!, mask };
}

function addRoute(args: CommandArgs, context: CommandContext): CommandOutcome {
  const target = readTarget(args);
  if ("error" in target) {
    return { lines: [{ kind: "error", ...errorInfo("CLI_INVALID_VALUE", { token: target.error }) }] };
  }
  const result = context.dispatch({
    type: "route/add", deviceId: context.device.id,
    network: target.network, mask: target.mask, nextHop: String(args["gateway"]),
  });
  return { lines: linesFromDispatch(result) };
}

function removeRoute(args: CommandArgs, context: CommandContext): CommandOutcome {
  const target = readTarget(args);
  if ("error" in target) {
    return { lines: [{ kind: "error", ...errorInfo("CLI_INVALID_VALUE", { token: target.error }) }] };
  }
  const result = context.dispatch({
    type: "route/remove", deviceId: context.device.id,
    network: target.network, mask: target.mask, nextHop: String(args["gateway"]),
  });
  return { lines: linesFromDispatch(result) };
}

function showNeigh(_args: CommandArgs, context: CommandContext): CommandOutcome {
  if (context.runtime === undefined) return {};
  return {
    lines: context.runtime.arpTable(context.device.id).map(entry =>
      text(`${entry.ip} dev ${entry.port} lladdr ${entry.mac} REACHABLE`)),
  };
}

function flushNeigh(_args: CommandArgs, context: CommandContext): CommandOutcome {
  context.runtime?.clearArp(context.device.id);
  return {};
}

/** 프런트엔드 목록 — HAProxy 설정 파일을 보는 자리 */
function showFrontends(_args: CommandArgs, context: CommandContext): CommandOutcome {
  const lb = lbOf(context);
  if (lb === undefined) return {};
  if (lb.config.frontends.length === 0) return { lines: [text("no listeners configured")] };
  return {
    lines: lb.config.frontends.flatMap(frontend => [
      text(`listen :${frontend.listenPort} mode ${frontend.mode}`),
      ...frontend.backends.map(backend =>
        text(`    server ${backend.ip}:${backend.port} weight ${backend.weight}${backend.pathPrefix === undefined ? "" : ` path ${backend.pathPrefix}`}`)),
    ]),
  };
}

function runPing(args: CommandArgs, context: CommandContext): CommandOutcome {
  const lb = lbOf(context);
  if (lb === undefined || context.runtime === undefined) return {};
  const target = String(args["ip"]);
  const count = args["count"] === undefined ? 4 : Number(args["count"]);
  if (checkHostIpv4(target) !== null) return { lines: [text(`ping: ${target}: Name or service not known`)] };
  const run = context.runtime.ping({ deviceId: lb.id, targetIp: target, count, stopOnUnsent: true });
  if (!run.ok) return { lines: [{ kind: "error", ...run.error }] };
  return { lines: linuxPingLines(target, undefined, run.rounds) };
}

const linux = (tokens: CommandDefinition["tokens"], help: string, run: CommandDefinition["run"]) =>
  defineCommand({ modes: ["user"], devices: ["lb"], tokens, help, run, caseSensitive: true });

export const LB_COMMANDS: readonly CommandDefinition[] = [
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
  linux(["haproxy", "-c"], "Show the configured listeners and backends", showFrontends),
  linux(["cat", "/etc/haproxy/haproxy.cfg"], "Show the configured listeners and backends", showFrontends),
  linux(["ping", param("ip", "ipv4", "Destination IPv4 address")], "Send 4 echo requests", runPing),
  linux(["ping", "-c", countParam, param("ip", "ipv4", "Destination IPv4 address")], "Send the given number of echo requests", runPing),
  linux(["ping", param("ip", "ipv4", "Destination IPv4 address"), "-c", countParam], "Send the given number of echo requests", runPing),
  linux(["hostname"], "Show the device name", (_args, context) => ({ lines: [text(context.device.name)] })),
  linux(["hostname", param("name", "word", "New hostname")], "Rename the device", (args, context) => ({
    lines: linesFromDispatch(context.dispatch({ type: "device/rename", deviceId: context.device.id, name: String(args["name"]) })),
  })),
];
