// RIP v2 모듈 (T11.2.2). Router 모델에 붙어 경로를 주고받고 배운다.
// 경로 교환 1회는 배운 경로를 모두 지우고 처음부터 배운다 (설계 결정 1). 끊긴 경로가 저절로 사라지고 count-to-infinity가 없다.
// split horizon만 하고 poison reverse는 하지 않는다 (IOS 기본값, 결정 5). 바뀐 경로만 triggered update로 알린다 (결정 4).

import {
  classfulNetwork, DEFAULT_DISTANCE, isSameNetwork, parseIpv4, RIP_INFINITY, RIP_MAX_ENTRIES, RIP_MULTICAST_IP,
  RIP_MULTICAST_MAC, RIP_UDP_PORT,
} from "@ping9/shared";
import type { Device, RipConfig, RipEntry, RipPacket } from "@ping9/shared";

import type { Frame, SimContext, TimerRef } from "../../kernel";
import { deviceRef } from "../../topology";
import type { RoutingEntry } from "./routing";

/** RIP 패킷은 Router를 넘어가지 않는다 */
const RIP_TTL = 1;

/**
 * 정기 갱신(실제는 30초마다 전체 경로)을 경로 교환 1회에 한 번 흉내 낸다. 가상 시간 30ms 뒤.
 * 이것이 없으면 passive 인터페이스 너머의 경로를 듣지 못한다 (Request에 답하지 않으므로)
 */
export const RIP_UPDATE_DELAY_US = 30_000;
const UPDATE_TIMER = "rip-update";

/** RIP가 다는 L3 인터페이스. 라우터는 물리 포트 이름, L3 스위치는 SVI(`Vlan10`)나 라우티드 포트다 (T0.33) */
export interface RipInterface {
  readonly name: string;
  readonly ip: string;
  readonly network: string;
  readonly mask: string;
}

export interface RipHost {
  device(): Device;
  rip(): RipConfig | undefined;
  /** RIP가 참여할 수 있는 켜진 L3 인터페이스 (직접 연결망만) */
  interfaces(): readonly RipInterface[];
  /** 인터페이스의 출발지 MAC */
  macOf(iface: string): string;
  /** 보낼 이벤트의 linkId. SVI처럼 링크가 하나로 정해지지 않으면 undefined */
  linkOf(iface: string): string | undefined;
  /** 만들어진 RIP 프레임을 그 인터페이스로 내보낸다 */
  send(ctx: SimContext, iface: string, frame: Frame, parentSeq?: number): void;
}

const keyOf = (route: { readonly network: string; readonly mask: string }) => `${route.network}/${route.mask}`;

/** 작은 네트워크 주소부터, 같으면 긴 마스크부터. 출력과 패킷 순서를 결정적으로 만든다 */
const byNetwork = (a: RoutingEntry, b: RoutingEntry) =>
  (parseIpv4(a.network)! - parseIpv4(b.network)!) || (parseIpv4(b.mask)! - parseIpv4(a.mask)!);

export class RipModule {
  readonly #host: RipHost;
  /** 배운 경로. 목적지(네트워크/마스크)마다 하나 */
  readonly #routes = new Map<string, RoutingEntry>();

  constructor(host: RipHost) {
    this.#host = host;
  }

  /** `routingTable(config, ports, learned)`의 세 번째 인자 */
  routes(): readonly RoutingEntry[] {
    return [...this.#routes.values()].sort(byNetwork);
  }

  clear(): void {
    this.#routes.clear();
  }

  /** 경로 교환의 시작: 배운 경로를 지우고 보낼 인터페이스마다 Request를 보낸다 */
  startExchange(ctx: SimContext): void {
    this.#routes.clear();
    if (this.#host.rip() === undefined) return;
    for (const port of this.#sendPorts()) {
      this.#send(ctx, port, { command: "request", entries: [] }, RIP_MULTICAST_MAC, RIP_MULTICAST_IP);
    }
    ctx.setTimer(this.#host.device().id, UPDATE_TIMER, RIP_UPDATE_DELAY_US);
  }

  /** 정기 갱신: 보낼 인터페이스마다 전체 경로 (split horizon) */
  onTimer(ctx: SimContext, timer: TimerRef): void {
    if (timer.key !== UPDATE_TIMER) return;
    for (const port of this.#sendPorts()) {
      this.#sendEntries(ctx, port, this.#advertised(port), RIP_MULTICAST_MAC, RIP_MULTICAST_IP);
    }
  }

  /** RIP 프레임을 받았다. 장비 모델이 IF_DOWN·NO_IP·MAC 확인을 마치고 받은 인터페이스를 넘긴다 */
  onFrame(ctx: SimContext, iface: string, frame: Frame): void {
    const device = this.#host.device();
    const ref = deviceRef(device);
    const { ipv4, rip, ethernet } = frame.snapshot;
    if (ipv4 === undefined || rip === undefined) return;
    const local = this.#participating().find(route => route.port === iface);
    if (local === undefined) {
      // RIP를 켜지 않았거나 이 인터페이스가 `network`에 없다. 멀티캐스트 그룹에 없는 것과 같다
      ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "RIP", action: "drop", reason: { code: "NOT_FOR_ME", params: { device: ref } } });
      return;
    }
    if (!isSameNetwork(ipv4.sourceIp, local.network, local.mask)) {
      ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "RIP", action: "drop",
        reason: { code: "RIP_SOURCE_NOT_ON_LINK", params: { device: ref, port: iface, sourceIp: ipv4.sourceIp } } });
      return;
    }
    if (rip.command === "request") {
      const received = ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "RIP", action: "receive",
        reason: { code: "RIP_REQUEST_RECEIVED", params: { device: ref, port: iface, sourceIp: ipv4.sourceIp } } });
      // passive 인터페이스는 듣기만 한다
      if (!this.#sendPorts().includes(iface)) return;
      // 요청한 쪽에게 바로 답한다. 받은 프레임의 MAC을 쓰므로 ARP는 하지 않는다
      this.#sendEntries(ctx, iface, this.#advertised(iface), ethernet.sourceMac, ipv4.sourceIp, received);
      return;
    }
    const received = ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "RIP", action: "receive",
      reason: { code: "RIP_RESPONSE_RECEIVED", params: { device: ref, port: iface, sourceIp: ipv4.sourceIp, routes: rip.entries.length } } });
    const connected = this.#host.interfaces();
    const changed: RoutingEntry[] = [];
    let cause = received;
    for (const entry of rip.entries) {
      if (entry.metric >= RIP_INFINITY || connected.some(route => keyOf(route) === keyOf(entry))) continue;
      const known = this.#routes.get(keyOf(entry));
      const better = known === undefined || entry.metric < known.metric ||
        (known.nextHop === ipv4.sourceIp && entry.metric !== known.metric);
      if (!better) continue;
      const route: RoutingEntry = {
        source: "rip", network: entry.network, mask: entry.mask, nextHop: ipv4.sourceIp, port: iface,
        distance: DEFAULT_DISTANCE.rip, metric: entry.metric,
      };
      this.#routes.set(keyOf(route), route);
      changed.push(route);
      cause = ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "RIP", action: "learn", parentSeq: received,
        reason: { code: known === undefined ? "RIP_ROUTE_LEARNED" : "RIP_ROUTE_CHANGED",
          params: { device: ref, network: route.network, mask: route.mask, nextHop: ipv4.sourceIp, port: iface, metric: entry.metric } } });
    }
    if (changed.length === 0) return;
    // triggered update: 바뀐 경로만, 모든 보낼 인터페이스로 (split horizon)
    for (const out of this.#sendPorts()) {
      const entries = changed.filter(route => route.port !== out).sort(byNetwork).map(route => this.#entryOf(route));
      this.#sendEntries(ctx, out, entries, RIP_MULTICAST_MAC, RIP_MULTICAST_IP, cause);
    }
  }

  /** 켜져 있고 IP의 클래스풀 네트워크가 `network`에 있는 인터페이스의 직접 연결 경로 */
  #participating(): readonly RoutingEntry[] {
    const rip = this.#host.rip();
    if (rip === undefined) return [];
    return this.#host.interfaces()
      .filter(iface => rip.networks.includes(classfulNetwork(iface.ip) ?? ""))
      .map(iface => ({ source: "connected" as const, network: iface.network, mask: iface.mask,
        port: iface.name, distance: DEFAULT_DISTANCE.connected, metric: 0 }));
  }

  /** 참여 인터페이스 가운데 passive가 아닌 것. 포트 순서 */
  #sendPorts(): readonly string[] {
    const passive = this.#host.rip()?.passiveInterfaces ?? [];
    return this.#participating().map(route => route.port).filter(port => !passive.includes(port));
  }

  /** `port`로 알릴 전체 경로: 참여 인터페이스의 직접 연결 네트워크 + 배운 경로. split horizon */
  #advertised(port: string): readonly RipEntry[] {
    const routes = [...this.#participating(), ...this.#routes.values()].filter(route => route.port !== port);
    return routes.sort(byNetwork).map(route => this.#entryOf(route));
  }

  /** 보낼 때 metric에 1을 더한다. 받은 쪽은 그 값을 그대로 쓴다. 직접 연결은 1 */
  #entryOf(route: RoutingEntry): RipEntry {
    return { network: route.network, mask: route.mask, metric: Math.min(route.metric + 1, RIP_INFINITY) };
  }

  /** 알릴 것이 없으면 보내지 않는다. 25개씩 나눠 보낸다 */
  #sendEntries(ctx: SimContext, port: string, entries: readonly RipEntry[], mac: string, ip: string, parentSeq?: number): void {
    for (let start = 0; start < entries.length; start += RIP_MAX_ENTRIES) {
      this.#send(ctx, port, { command: "response", entries: entries.slice(start, start + RIP_MAX_ENTRIES) }, mac, ip, parentSeq);
    }
  }

  #send(ctx: SimContext, iface: string, rip: RipPacket, mac: string, ip: string, parentSeq?: number): void {
    const device = this.#host.device();
    const sourceIp = this.#host.interfaces().find(candidate => candidate.name === iface)?.ip;
    if (sourceIp === undefined) return;
    const frame = ctx.createFrame({
      ethernet: { sourceMac: this.#host.macOf(iface), destinationMac: mac },
      ipv4: { sourceIp, destinationIp: ip, ttl: RIP_TTL },
      udp: { sourcePort: RIP_UDP_PORT, destinationPort: RIP_UDP_PORT },
      rip,
    });
    const linkId = this.#host.linkOf(iface);
    const ref = deviceRef(device);
    const sent = ctx.record({
      frame, deviceId: device.id, outPort: iface, ...(linkId === undefined ? {} : { linkId }),
      ...(parentSeq === undefined ? {} : { parentSeq }), layer: "RIP", action: "create",
      reason: rip.command === "request"
        ? { code: "RIP_REQUEST_SENT", params: { device: ref, port: iface } }
        : { code: "RIP_RESPONSE_SENT", params: { device: ref, port: iface, routes: rip.entries.length } },
    });
    this.#host.send(ctx, iface, frame, sent);
  }
}
