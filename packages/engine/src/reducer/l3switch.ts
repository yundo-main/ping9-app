// reducer: L3 Switch 구성 (T0.33). `interface vlan`, `no switchport`, `ip routing`,
// 그리고 라우터와 겹치는 `interface/set-ip`·`route/*`·`rip/*`의 l3switch 쪽 처리기.
// 라우터 처리기는 `findRouter`가 kind를 검사하므로, 여기서 l3switch용을 따로 둔다.

import {
  DEFAULT_VLAN_ID, LIMITS, VLAN_ID_MAX, VLAN_ID_MIN, checkInterfaceAddress,
  checkRouterInterfaceOverlap, checkStaticRoute, checkVlanId, DEFAULT_DISTANCE,
  classfulNetwork, errorInfo, isPortName, isSviName, validateDocument,
} from "@ping9/shared";
import type {
  CommandOf, ErrorInfo, L3SwitchConfig, L3SwitchDevice, L3SwitchPortConfig,
  Notice, RipConfig, StaticRoute, TopologyDocument,
} from "@ping9/shared";

import { describeValue } from "../describe";
import type { CommandHandler, ReduceResult } from "../reducer";

export function findL3Switch(document: TopologyDocument, deviceId: unknown):
  | { readonly ok: true; readonly device: L3SwitchDevice }
  | { readonly ok: false; readonly error: ErrorInfo } {
  const device = typeof deviceId === "string" ? document.devices.find(candidate => candidate.id === deviceId) : undefined;
  if (device === undefined) return { ok: false, error: errorInfo("DEVICE_NOT_FOUND", { deviceId: describeValue(deviceId) }) };
  if (device.kind !== "l3switch") {
    return { ok: false, error: errorInfo("DEVICE_KIND_MISMATCH", {
      deviceId: device.id, expected: "l3switch", actual: device.kind }) };
  }
  return { ok: true, device };
}

/** 기본값과 같은 설정을 뺀다. 라우티드 포트는 L2 필드(mode·accessVlan)를 떨군다 */
function normalizePorts(config: L3SwitchConfig): Readonly<Record<string, L3SwitchPortConfig>> {
  const ports: Record<string, L3SwitchPortConfig> = {};
  const names = Object.keys(config.ports).sort((a, b) =>
    (isPortName("l3switch", a) ? Number(a.slice(a.lastIndexOf("/") + 1)) : 0) -
    (isPortName("l3switch", b) ? Number(b.slice(b.lastIndexOf("/") + 1)) : 0));
  for (const name of names) {
    const port = config.ports[name]!;
    if (port.routed === true) {
      if (!port.adminUp) ports[name] = { adminUp: false, mode: "access", routed: true };
      else ports[name] = { adminUp: true, mode: "access", routed: true };
      continue;
    }
    const accessVlan = port.accessVlan === 1 ? undefined : port.accessVlan;
    const allowsAll = port.allowedVlans?.length === 1 &&
      port.allowedVlans[0]![0] === VLAN_ID_MIN && port.allowedVlans[0]![1] === VLAN_ID_MAX;
    const allowedVlans = allowsAll ? undefined : port.allowedVlans;
    if (port.adminUp && port.mode === "access" && accessVlan === undefined && allowedVlans === undefined) continue;
    ports[name] = { adminUp: port.adminUp, mode: port.mode,
      ...(accessVlan !== undefined && { accessVlan }),
      ...(allowedVlans !== undefined && { allowedVlans }) };
  }
  return ports;
}

function withL3SwitchConfig(
  document: TopologyDocument, device: L3SwitchDevice, config: L3SwitchConfig, notices: readonly Notice[] = [],
): ReduceResult {
  const hasDefaultVlan = config.vlans.some(vlan => vlan.id === DEFAULT_VLAN_ID);
  const hasRoom = config.vlans.length < LIMITS.maxVlansPerSwitch;
  const normalized: L3SwitchConfig = {
    ...config,
    vlans: config.vlans.filter(vlan => vlan.id !== DEFAULT_VLAN_ID || hasDefaultVlan || hasRoom)
      .map(vlan => ({ id: vlan.id, name: vlan.name })),
    ports: normalizePorts(config),
  };
  const checked = validateDocument({
    ...document,
    devices: document.devices.map(candidate => candidate.id === device.id ? { ...device, config: normalized } : candidate),
  });
  return checked.ok ? { ok: true, document: checked.document, notices } : checked;
}

const unchanged = (document: TopologyDocument): ReduceResult => ({ ok: true, document, notices: [] });

/** L3 인터페이스 키 검사: `Vlan<id>`(SVI) 또는 routed 포트 이름 */
function checkL3Interface(device: L3SwitchDevice, name: unknown): ErrorInfo | null {
  if (typeof name !== "string") {
    return errorInfo("UNKNOWN_PORT", { deviceId: device.id, kind: "l3switch", port: describeValue(name) });
  }
  if (isSviName(name)) return null;
  if (isPortName("l3switch", name) && device.config.ports[name]?.routed === true) return null;
  return errorInfo("UNKNOWN_PORT", { deviceId: device.id, kind: "l3switch", port: name });
}

// ---- l3switch/* 명령 ----

/** `interface vlan <id>` — SVI를 만든다. VLAN 자체는 `vlan <id>`로 따로 만든다 (없으면 SVI는 down) */
export const createSvi: CommandHandler<"l3switch/svi"> = (document, command) => {
  const found = findL3Switch(document, command.deviceId);
  if (!found.ok) return found;
  const vlanError = typeof command.vlan === "number" ? checkVlanId(command.vlan) : errorInfo("CLI_INVALID_VALUE", { token: describeValue(command.vlan) });
  if (vlanError !== null) return { ok: false, error: vlanError };
  const name = `Vlan${command.vlan}`;
  if (found.device.config.interfaces[name] !== undefined) return unchanged(document);
  return withL3SwitchConfig(document, found.device, {
    ...found.device.config,
    interfaces: { ...found.device.config.interfaces, [name]: { adminUp: true } },
  });
};

/** `no interface vlan <id>` — SVI를 지운다 */
export const removeSvi: CommandHandler<"l3switch/remove-svi"> = (document, command) => {
  const found = findL3Switch(document, command.deviceId);
  if (!found.ok) return found;
  const name = typeof command.name === "string" ? command.name : "";
  if (found.device.config.interfaces[name] === undefined || !isSviName(name)) {
    return { ok: false, error: errorInfo("UNKNOWN_PORT", { deviceId: found.device.id, kind: "l3switch", port: describeValue(command.name) }) };
  }
  const interfaces = { ...found.device.config.interfaces };
  delete interfaces[name];
  return withL3SwitchConfig(document, found.device, { ...found.device.config, interfaces });
};

/** `no switchport` / `switchport` — 포트의 L3/L2 전환. L2로 돌리면 그 포트의 L3 구성도 지운다 */
export const setRouted: CommandHandler<"l3switch/set-routed"> = (document, command) => {
  const found = findL3Switch(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  if (typeof command.port !== "string" || !isPortName("l3switch", command.port) || typeof command.routed !== "boolean") {
    return { ok: false, error: errorInfo("UNKNOWN_PORT", { deviceId: device.id, kind: "l3switch", port: describeValue(command.port) }) };
  }
  const port = device.config.ports[command.port];
  const ports = { ...device.config.ports };
  if (command.routed) {
    if (port?.routed === true) return unchanged(document);
    ports[command.port] = { adminUp: port?.adminUp ?? true, mode: "access", routed: true };
    return withL3SwitchConfig(document, device, {
      ...device.config, ports,
      interfaces: { ...device.config.interfaces, [command.port]: { adminUp: true } },
    });
  }
  if (port?.routed !== true) return unchanged(document);
  const interfaces = { ...device.config.interfaces };
  delete interfaces[command.port];
  delete ports[command.port];
  return withL3SwitchConfig(document, device, { ...device.config, ports, interfaces });
};

/** `ip routing` / `no ip routing` */
export const setIpRouting: CommandHandler<"l3switch/set-ip-routing"> = (document, command) => {
  const found = findL3Switch(document, command.deviceId);
  if (!found.ok) return found;
  if (typeof command.enabled !== "boolean") {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "enabled" }) };
  }
  if ((found.device.config.ipRouting ?? false) === command.enabled) return unchanged(document);
  return withL3SwitchConfig(document, found.device, {
    ...found.device.config,
    ...(command.enabled ? { ipRouting: true } : { ipRouting: undefined }),
  });
};

// ---- 라우터와 겹치는 명령의 l3switch 처리기 ----

export function l3SetInterfaceIp(document: TopologyDocument, device: L3SwitchDevice,
  command: CommandOf<"interface/set-ip">): ReduceResult {
  const portError = checkL3Interface(device, command.port);
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
  return withL3SwitchConfig(document, device, {
    ...device.config,
    interfaces: { ...device.config.interfaces,
      [command.port]: { adminUp: device.config.interfaces[command.port]?.adminUp ?? true, ip: command.ip, mask: command.mask } },
  });
}

export function l3ClearInterfaceIp(document: TopologyDocument, device: L3SwitchDevice,
  command: CommandOf<"interface/clear-ip">): ReduceResult {
  const portError = checkL3Interface(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  return withL3SwitchConfig(document, device, {
    ...device.config,
    interfaces: { ...device.config.interfaces,
      [command.port]: { adminUp: device.config.interfaces[command.port]?.adminUp ?? true } },
  });
}

/** `shutdown`/`no shutdown`: SVI·라우티드 포트는 interfaces에, L2 포트는 ports에 쓴다 */
export function l3SetAdmin(document: TopologyDocument, device: L3SwitchDevice,
  command: CommandOf<"interface/set-admin">): ReduceResult {
  if (typeof command.adminUp !== "boolean") {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "adminUp" }) };
  }
  if (typeof command.port === "string" && (isSviName(command.port) || device.config.ports[command.port]?.routed === true)) {
    const iface = device.config.interfaces[command.port];
    if (iface === undefined) {
      return { ok: false, error: errorInfo("UNKNOWN_PORT", { deviceId: device.id, kind: "l3switch", port: command.port }) };
    }
    return withL3SwitchConfig(document, device, {
      ...device.config,
      interfaces: { ...device.config.interfaces, [command.port]: { ...iface, adminUp: command.adminUp } },
    });
  }
  if (typeof command.port !== "string" || !isPortName("l3switch", command.port)) {
    return { ok: false, error: errorInfo("UNKNOWN_PORT", { deviceId: device.id, kind: "l3switch", port: describeValue(command.port) }) };
  }
  const port = device.config.ports[command.port];
  return withL3SwitchConfig(document, device, {
    ...device.config,
    ports: { ...device.config.ports, [command.port]: {
      adminUp: command.adminUp, mode: port?.mode ?? "access",
      ...(port?.accessVlan !== undefined && { accessVlan: port.accessVlan }),
      ...(port?.allowedVlans !== undefined && { allowedVlans: port.allowedVlans }) } },
  });
}

const sameRoute = (a: StaticRoute, b: { network: string; mask: string; nextHop: string }) =>
  a.network === b.network && a.mask === b.mask && a.nextHop === b.nextHop;

export function l3AddRoute(document: TopologyDocument, device: L3SwitchDevice,
  command: CommandOf<"route/add">): ReduceResult {
  const error = checkStaticRoute(device.id, command, device.config.interfaces);
  if (error !== null) return { ok: false, error };
  const distance = command.distance ?? DEFAULT_DISTANCE.static;
  const route = { network: command.network, mask: command.mask, nextHop: command.nextHop, distance };
  const existing = device.config.staticRoutes.find(candidate => sameRoute(candidate, command));
  if (existing !== undefined) {
    if ((existing.distance ?? DEFAULT_DISTANCE.static) === distance) return unchanged(document);
    return withL3SwitchConfig(document, device, {
      ...device.config,
      staticRoutes: device.config.staticRoutes.map(candidate => candidate === existing ? route : candidate),
    });
  }
  if (device.config.staticRoutes.length >= LIMITS.maxStaticRoutesPerRouter) {
    return { ok: false, error: errorInfo("LIMIT_EXCEEDED", { limit: "staticRoutes", max: LIMITS.maxStaticRoutesPerRouter }) };
  }
  return withL3SwitchConfig(document, device, { ...device.config, staticRoutes: [...device.config.staticRoutes, route] });
}

export function l3RemoveRoute(document: TopologyDocument, device: L3SwitchDevice,
  command: CommandOf<"route/remove">): ReduceResult {
  const error = checkStaticRoute(device.id, command, device.config.interfaces);
  if (error !== null) return { ok: false, error };
  const target = device.config.staticRoutes.find(route => sameRoute(route, command) &&
    (command.distance === undefined || (route.distance ?? DEFAULT_DISTANCE.static) === command.distance));
  if (target === undefined) {
    return { ok: false, error: errorInfo("ROUTE_NOT_FOUND", {
      deviceId: device.id, network: command.network, mask: command.mask, nextHop: command.nextHop }) };
  }
  return withL3SwitchConfig(document, device, {
    ...device.config, staticRoutes: device.config.staticRoutes.filter(route => route !== target) });
}

function withRip(document: TopologyDocument, device: L3SwitchDevice, rip: RipConfig | undefined): ReduceResult {
  return withL3SwitchConfig(document, device, rip === undefined
    ? { ...device.config, rip: undefined }
    : { ...device.config, rip });
}

function ripDevice(document: TopologyDocument, deviceId: unknown):
  | { readonly ok: true; readonly device: L3SwitchDevice; readonly rip: RipConfig }
  | { readonly ok: false; readonly error: ErrorInfo } {
  const found = findL3Switch(document, deviceId);
  if (!found.ok) return found;
  const { rip } = found.device.config;
  if (rip === undefined) return { ok: false, error: errorInfo("RIP_NOT_ENABLED", { deviceId: found.device.id }) };
  return { ok: true, device: found.device, rip };
}

function networkOf(value: unknown): { readonly ok: true; readonly network: string } | { readonly ok: false; readonly error: ErrorInfo } {
  const network = typeof value === "string" && value.length <= 64 ? classfulNetwork(value) : null;
  return network === null
    ? { ok: false, error: errorInfo("RIP_NETWORK_INVALID", { network: describeValue(value) }) }
    : { ok: true, network };
}

export function l3EnableRip(document: TopologyDocument, device: L3SwitchDevice): ReduceResult {
  if (device.config.rip !== undefined) return unchanged(document);
  return withRip(document, device, { networks: [], passiveInterfaces: [] });
}

export function l3DisableRip(document: TopologyDocument, device: L3SwitchDevice): ReduceResult {
  if (device.config.rip === undefined) return unchanged(document);
  return withRip(document, device, undefined);
}

export function l3AddRipNetwork(document: TopologyDocument, command: CommandOf<"rip/add-network">): ReduceResult {
  const found = ripDevice(document, command.deviceId);
  if (!found.ok) return found;
  const parsed = networkOf(command.network);
  if (!parsed.ok) return parsed;
  const { device, rip } = found;
  if (rip.networks.includes(parsed.network)) return unchanged(document);
  if (rip.networks.length >= LIMITS.maxRipNetworks) {
    return { ok: false, error: errorInfo("LIMIT_EXCEEDED", { limit: "ripNetworks", max: LIMITS.maxRipNetworks }) };
  }
  return withRip(document, device, { ...rip, networks: [...rip.networks, parsed.network] });
}

export function l3RemoveRipNetwork(document: TopologyDocument, command: CommandOf<"rip/remove-network">): ReduceResult {
  const found = ripDevice(document, command.deviceId);
  if (!found.ok) return found;
  const parsed = networkOf(command.network);
  if (!parsed.ok) return parsed;
  const { device, rip } = found;
  if (!rip.networks.includes(parsed.network)) {
    return { ok: false, error: errorInfo("RIP_NETWORK_NOT_FOUND", { deviceId: device.id, network: parsed.network }) };
  }
  return withRip(document, device, { ...rip, networks: rip.networks.filter(network => network !== parsed.network) });
}

export function l3SetRipPassive(document: TopologyDocument, device: L3SwitchDevice,
  command: CommandOf<"rip/set-passive">): ReduceResult {
  const portError = checkL3Interface(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  const rip = device.config.rip;
  if (rip === undefined) return { ok: false, error: errorInfo("RIP_NOT_ENABLED", { deviceId: device.id }) };
  const has = rip.passiveInterfaces.includes(command.port);
  if (command.passive === has) return unchanged(document);
  return withRip(document, device, { ...rip,
    passiveInterfaces: command.passive
      ? [...rip.passiveInterfaces, command.port]
      : rip.passiveInterfaces.filter(port => port !== command.port) });
}
