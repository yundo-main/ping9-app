// reducer: LB 구성 (T0.34). `lb/set-frontends`는 Inspector가 편집한 프런트엔드 목록을 통째로 넣고,
// `interface/set-ip`·`interface/set-admin`·`route/*`는 라우터 처리기에서 이쪽으로 분기한다.

import {
  DEFAULT_DISTANCE, LIMITS, checkInterfaceAddress, checkRouterInterfaceOverlap,
  checkStaticRoute, errorInfo, isPortName, validateDocument,
} from "@ping9/shared";
import type {
  CommandOf, ErrorInfo, LbConfig, LbDevice, LbFrontend, Notice, StaticRoute, TopologyDocument,
} from "@ping9/shared";

import { describeValue } from "../describe";
import type { CommandHandler, ReduceResult } from "../reducer";

export function findLb(document: TopologyDocument, deviceId: unknown):
  | { readonly ok: true; readonly device: LbDevice }
  | { readonly ok: false; readonly error: ErrorInfo } {
  const device = typeof deviceId === "string" ? document.devices.find(candidate => candidate.id === deviceId) : undefined;
  if (device === undefined) return { ok: false, error: errorInfo("DEVICE_NOT_FOUND", { deviceId: describeValue(deviceId) }) };
  if (device.kind !== "lb") {
    return { ok: false, error: errorInfo("DEVICE_KIND_MISMATCH", {
      deviceId: device.id, expected: "lb", actual: device.kind }) };
  }
  return { ok: true, device };
}

function withLbConfig(
  document: TopologyDocument, device: LbDevice, config: LbConfig, notices: readonly Notice[] = [],
): ReduceResult {
  const checked = validateDocument({
    ...document,
    devices: document.devices.map(candidate => candidate.id === device.id ? { ...device, config } : candidate),
  });
  return checked.ok ? { ok: true, document: checked.document, notices } : checked;
}

const unchanged = (document: TopologyDocument): ReduceResult => ({ ok: true, document, notices: [] });

function checkLbPort(device: LbDevice, port: unknown): ErrorInfo | null {
  return typeof port === "string" && isPortName("lb", port)
    ? null
    : errorInfo("UNKNOWN_PORT", { deviceId: device.id, kind: "lb", port: describeValue(port) });
}

/** Inspector의 프런트엔드 편집. 경계 밖에서 온 값을 하나씩 확인해 LbFrontend로 만든다 */
function readFrontend(value: unknown): LbFrontend | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as { listenPort?: unknown; mode?: unknown; backends?: unknown };
  if (typeof input.listenPort !== "number" || !Number.isInteger(input.listenPort) ||
    input.listenPort < 1 || input.listenPort > 65535) return null;
  if (input.mode !== "tcp" && input.mode !== "http") return null;
  if (!Array.isArray(input.backends)) return null;
  const backends = input.backends.flatMap((entry): LbFrontend["backends"] => {
    if (typeof entry !== "object" || entry === null) return [];
    const backend = entry as { ip?: unknown; port?: unknown; weight?: unknown };
    if (typeof backend.ip !== "string" || typeof backend.port !== "number" || typeof backend.weight !== "number" ||
      !Number.isInteger(backend.port) || !Number.isInteger(backend.weight)) return [];
    return [{ ip: backend.ip.slice(0, 64), port: backend.port, weight: backend.weight }];
  });
  if (backends.length !== input.backends.length) return null;
  return { listenPort: input.listenPort, mode: input.mode, backends };
}

export const setFrontends: CommandHandler<"lb/set-frontends"> = (document, command) => {
  const found = findLb(document, command.deviceId);
  if (!found.ok) return found;
  if (!Array.isArray(command.frontends)) {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "frontends" }) };
  }
  const frontends = command.frontends.map(readFrontend);
  if (frontends.some(frontend => frontend === null)) {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "frontends" }) };
  }
  return withLbConfig(document, found.device, {
    ...found.device.config, frontends: frontends as readonly LbFrontend[] });
};

// ---- 라우터와 겹치는 명령의 lb 처리기 ----

export function lbSetInterfaceIp(document: TopologyDocument, device: LbDevice,
  command: CommandOf<"interface/set-ip">): ReduceResult {
  const portError = checkLbPort(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  if (typeof command.ip !== "string" || command.ip.length > 64) {
    return { ok: false, error: errorInfo("INVALID_IPV4", { value: describeValue(command.ip) }) };
  }
  if (typeof command.mask !== "string" || command.mask.length > 64) {
    return { ok: false, error: errorInfo("INVALID_MASK", { value: describeValue(command.mask) }) };
  }
  const addressError = checkInterfaceAddress(command.ip, command.mask);
  if (addressError !== null) return { ok: false, error: addressError };
  const overlap = checkRouterInterfaceOverlap(device.id, command.port, command.ip, command.mask, device.config.interfaces);
  if (overlap !== null) return { ok: false, error: overlap };
  return withLbConfig(document, device, {
    ...device.config,
    interfaces: { ...device.config.interfaces,
      [command.port]: { adminUp: device.config.interfaces[command.port]?.adminUp ?? false, ip: command.ip, mask: command.mask } },
  });
}

export function lbClearInterfaceIp(document: TopologyDocument, device: LbDevice,
  command: CommandOf<"interface/clear-ip">): ReduceResult {
  const portError = checkLbPort(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  return withLbConfig(document, device, {
    ...device.config,
    interfaces: { ...device.config.interfaces,
      [command.port]: { adminUp: device.config.interfaces[command.port]?.adminUp ?? false } },
  });
}

export function lbSetAdmin(document: TopologyDocument, device: LbDevice,
  command: CommandOf<"interface/set-admin">): ReduceResult {
  const portError = checkLbPort(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  if (typeof command.adminUp !== "boolean") {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "adminUp" }) };
  }
  return withLbConfig(document, device, {
    ...device.config,
    interfaces: { ...device.config.interfaces,
      [command.port]: { ...(device.config.interfaces[command.port] ?? {}), adminUp: command.adminUp } },
  });
}

const sameRoute = (a: StaticRoute, b: { network: string; mask: string; nextHop: string }) =>
  a.network === b.network && a.mask === b.mask && a.nextHop === b.nextHop;

export function lbAddRoute(document: TopologyDocument, device: LbDevice,
  command: CommandOf<"route/add">): ReduceResult {
  const error = checkStaticRoute(device.id, command, device.config.interfaces);
  if (error !== null) return { ok: false, error };
  const distance = command.distance ?? DEFAULT_DISTANCE.static;
  const route = { network: command.network, mask: command.mask, nextHop: command.nextHop, distance };
  const existing = device.config.staticRoutes.find(candidate => sameRoute(candidate, command));
  if (existing !== undefined) {
    if ((existing.distance ?? DEFAULT_DISTANCE.static) === distance) return unchanged(document);
    return withLbConfig(document, device, {
      ...device.config,
      staticRoutes: device.config.staticRoutes.map(candidate => candidate === existing ? route : candidate),
    });
  }
  if (device.config.staticRoutes.length >= LIMITS.maxStaticRoutesPerRouter) {
    return { ok: false, error: errorInfo("LIMIT_EXCEEDED", { limit: "staticRoutes", max: LIMITS.maxStaticRoutesPerRouter }) };
  }
  return withLbConfig(document, device, { ...device.config, staticRoutes: [...device.config.staticRoutes, route] });
}

export function lbRemoveRoute(document: TopologyDocument, device: LbDevice,
  command: CommandOf<"route/remove">): ReduceResult {
  const error = checkStaticRoute(device.id, command, device.config.interfaces);
  if (error !== null) return { ok: false, error };
  const target = device.config.staticRoutes.find(route => sameRoute(route, command) &&
    (command.distance === undefined || (route.distance ?? DEFAULT_DISTANCE.static) === command.distance));
  if (target === undefined) {
    return { ok: false, error: errorInfo("ROUTE_NOT_FOUND", {
      deviceId: device.id, network: command.network, mask: command.mask, nextHop: command.nextHop }) };
  }
  return withLbConfig(document, device, {
    ...device.config, staticRoutes: device.config.staticRoutes.filter(route => route !== target) });
}
