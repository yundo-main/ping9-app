// T0.33: L3 스위치의 인터페이스 상태와 라우팅 테이블.
// 라우터의 routing.ts와 같은 규칙인데, 인터페이스가 물리 포트 대신 SVI(`Vlan10`)거나
// 라우티드 포트(`no switchport`)다. SVI는 그 VLAN에 켜진 L2 포트가 있어야 up이다.

import {
  checkInterfaceAddress, DEFAULT_DISTANCE, isSameNetwork, isSviName, networkAddress,
  sviVlan, switchPort, switchVlans,
} from "@ping9/shared";
import type { L3InterfaceView, L3SwitchConfig, PortView } from "@ping9/shared";

import type { RoutingEntry } from "../router/routing";

const UNUSABLE_DISTANCE = 255;

/** SVI의 캐리어: VLAN이 존재하고, 그 VLAN에 속한 켜진 L2 포트가 하나라도 있다 */
function sviCarrier(config: L3SwitchConfig, vlan: number, ports: readonly PortView[]): boolean {
  if (!switchVlans(config).some(candidate => candidate.id === vlan)) return false;
  return ports.some(view => {
    if (view.status !== "up" || config.ports[view.name]?.routed === true) return false;
    const port = switchPort(config, view.name);
    return port.mode === "access"
      ? port.accessVlan === vlan
      : port.allowedVlans.some(([start, end]) => start <= vlan && vlan <= end);
  });
}

/** L3 인터페이스의 상태. SVI는 `up` 기준이 다르다 — 링크가 아니라 VLAN의 캐리어를 본다 */
export function l3InterfaceStates(
  config: L3SwitchConfig,
  ports: readonly PortView[],
): readonly L3InterfaceView[] {
  return Object.entries(config.interfaces).map(([name, iface]): L3InterfaceView => {
    const status = !iface.adminUp ? "admin-down"
      : isSviName(name)
        ? (sviCarrier(config, sviVlan(name)!, ports) ? "up" : "down")
        : (ports.find(view => view.name === name)?.status === "up" ? "up" : "down");
    return { name, ip: iface.ip, mask: iface.mask, status };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** 켜진 L3 인터페이스의 직접 연결 경로. `port` 필드는 인터페이스 이름이다 */
export function l3Connected(
  config: L3SwitchConfig,
  ports: readonly PortView[],
): readonly RoutingEntry[] {
  return l3InterfaceStates(config, ports).flatMap(state => {
    if (state.status !== "up" || state.ip === undefined || state.mask === undefined) return [];
    const network = networkAddress(state.ip, state.mask);
    return network === null ? [] : [{
      source: "connected" as const, network, mask: state.mask, port: state.name,
      distance: DEFAULT_DISTANCE.connected, metric: 0,
    }];
  });
}

/**
 * 라우팅 테이블. 후보는 직접 연결 + 정적 + 배운 경로 — 라우터와 같은 AD 규칙이다.
 * 정적 경로의 다음 홉은 켜진 직접 연결망으로만 해석한다
 */
export function l3RoutingTable(
  config: L3SwitchConfig,
  ports: readonly PortView[],
  learned: readonly RoutingEntry[] = [],
): readonly RoutingEntry[] {
  const connected = l3Connected(config, ports);
  const ownIps = new Set(Object.values(config.interfaces).map(iface => iface.ip));
  const active = config.staticRoutes.flatMap(route => {
    if (ownIps.has(route.nextHop)) return [];
    const exit = connected.find(candidate => isSameNetwork(route.nextHop, candidate.network, candidate.mask) &&
      checkInterfaceAddress(route.nextHop, candidate.mask) === null);
    return exit === undefined ? [] : [{
      source: "static" as const, network: route.network, mask: route.mask,
      nextHop: route.nextHop, port: exit.port, distance: route.distance ?? DEFAULT_DISTANCE.static, metric: 0,
    }];
  });
  // 배운 경로는 나가는 인터페이스가 살아 있을 때만 쓴다
  const usable = learned.filter(route => connected.some(candidate => candidate.port === route.port));
  const candidates = [...connected, ...active, ...usable].filter(route => route.distance < UNUSABLE_DISTANCE);
  const best = new Map<string, number>();
  for (const route of candidates) {
    const key = `${route.network}/${route.mask}`;
    best.set(key, Math.min(best.get(key) ?? Infinity, route.distance));
  }
  return candidates.filter(route => route.distance === best.get(`${route.network}/${route.mask}`));
}
